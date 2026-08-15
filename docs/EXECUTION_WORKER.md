# Execution Worker Contract

The app runs on Node.js / a self-hosted server — edge runtime has no
filesystem and no long-running TCP connections, so MetaTrader 5 (native DLL)
and most exchange WebSocket order routers cannot run inside the app.

Execution therefore happens in an **external worker** the user hosts (VPS,
home machine, container). The worker polls queued orders, places them with the
broker / exchange, and reports the fill back.

## Order lifecycle

```
signal -> pipeline.functions.ts (parse + risk) -> orders (status='queued')
   -> worker calls claimQueuedOrders -> status='dispatched'
   -> worker places trade on MT5 / exchange
   -> worker calls reportExecution -> status='filled' | 'rejected' | ...
   -> worker polls broker for close, calls reportExecution again with pnl
```

## Auth

The worker authenticates as the **end user**: it signs in with the user's
credentials (or a personal-access token) and reuses the JWT.
Every call goes through `requireSupabaseAuth`; RLS confines the worker to
its own orders.

## API surface

Both endpoints are TanStack server functions; call them as RPC over HTTPS.

### `claimQueuedOrders({ limit })`
- Returns up to `limit` orders with `status='queued'`.
- Server flips them to `status='dispatched'` atomically so a second poll
  does not re-deliver them.

### `reportExecution({ orderId, status, fillPrice?, filledQuantity?, pnl?, exchangeOrderId?, errorMessage? })`
- `status`: one of `filled | partial | open | cancelled | rejected | closed`.
- Worker calls this after the broker confirms, and again on position close
  with the final PnL.

## Reference implementation (shipped in this repo)

`worker/execution-worker.ts` — a production-ready service-role daemon that
implements the full loop without an MT5 dependency:

- **Claim**: polls `orders` (status `queued` → `dispatched`, ordered by
  `created_at`, limit configurable via `WORKER_CLAIM_LIMIT`, default 10).
- **Place**: loads the user's `exchange_accounts` row, decrypts API creds
  with `EXCHANGE_ENCRYPTION_KEY`, and calls `placeExchangeOrder` (Binance /
  Bybit / OKX / KuCoin / MEXC / bridge adapters).
- **Report**: writes `status` / `exchange_order_id` / `fill_price` /
  `filled_quantity` back to `orders` and appends an `order_events` row for
  every transition.
- **Cancels**: processes `cancel_requested=true` orders against the live
  exchange (or marks cancelled locally when no exchange ref exists).
- **Reconcile**: for `open`/`partial` orders with an exchange ref, polls the
  exchange position; when the position is flat it marks the order `closed`
  and records PnL.
- **Watchdog**: `dispatched` orders older than 10 minutes with no fill
  report and no exchange ref are marked `rejected` so they never stall.

### Running it

```sh
# Env required (same values as the app's .env):
#   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EXCHANGE_ENCRYPTION_KEY
# Optional: WORKER_INTERVAL_MS (default 5000), WORKER_CLAIM_LIMIT (default 10)

npm run worker
```

Run it as a long-lived process (systemd unit, `docker compose` service, or
`nohup`) — it loops forever every `WORKER_INTERVAL_MS`.

### Docker

The worker can run as a sibling container using the same image:

```yaml
  worker:
    build: .
    command: ["npm", "run", "worker"]
    env_file: .env
    restart: unless-stopped
    networks: [traefik-network]
```

## Recommended worker loop (custom / MT5)

```
loop forever:
    orders = claimQueuedOrders(limit=10)
    for order in orders:
        try:
            broker_resp = mt5.order_send(...)  # or ccxt.create_order
            reportExecution(orderId=order.id, status='filled',
                            fillPrice=broker_resp.price,
                            filledQuantity=broker_resp.volume,
                            exchangeOrderId=str(broker_resp.id))
        except Exception as e:
            reportExecution(orderId=order.id, status='rejected',
                            errorMessage=str(e))
    sleep(2)
```

A reference Python implementation lives in the original Hermes repo under
`backend/services/mt5_bridge.py`; it can be ported to call the two RPCs
above instead of writing to the Express API.

## Real-time user-data streams (v2)

The worker also opens **private WebSocket user-data streams** for active
Binance/Bybit accounts (`worker/userDataStreams.ts`):

- Binance Futures: `POST /fapi/v1/listenKey` → `wss://fstream.binance.com/ws/<lk>`
  (listenKey renewed every 30 min; reconnect with 5s backoff)
- Bybit V5: `POST /v5/user-token/create` HMAC auth → `wss://stream.bybit.com/v5/private`
  (order topic; reconnect with 10s backoff)
- On `ORDER_TRADE_UPDATE` / `order` events the worker updates `orders`
  immediately (status, fill price, quantity) — no need to wait for the
  next 5s poll tick.
- **Best-effort:** stream failure never blocks trading — the REST poll loop
  remains the source of truth and the fallback.
- OKX / KuCoin / MEXC / paper / bridge accounts still use REST polling
  (their private WS requires venue-specific token exchanges — future work).

## Pitfalls

- `tsx` requires explicit `.ts` extensions on relative imports.
- Order events carry `client_order_id` (we set it when placing) — matching on
  it avoids ambiguity when several orders share a symbol.
