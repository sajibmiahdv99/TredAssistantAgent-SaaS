# Execution Worker Contract

The app runs on Node.js / a self-hosted server (Docker). Execution is
**hook-driven in production**; a standalone daemon is kept only for
reference.

## Two execution paths — run exactly one

### 1. Production path (current): `worker/production-worker.ts`

One scheduler process drives the app's internal hooks over authenticated
HTTP (`x-cron-secret: CRON_SECRET`):

| Job | Interval | Hook / task |
| --- | --- | --- |
| orders | 10s | `monitor-anomalies` (kill-switch) → `process-orders` |
| positions | 15s | `monitor-positions` → `sync-positions` |
| balances | 5min | `sync-balances` |
| notifications | 60s | `dispatch-notifications` |
| backtests | 5min | `run-backtests` |
| channels | 30s | `pollSignalChannelsOnce()` (in-process) |
| payments | 60s | `confirmPendingCryptoPayments()` (in-process) |

It waits for `/api/public/health` before starting, refuses to overlap runs,
writes a heartbeat file (`/tmp/tred-worker-heartbeat`, used by the Docker
healthcheck), and shuts down cleanly on SIGTERM/SIGINT.

`process-orders` does the heavy lifting inside the app process: atomic claim
→ paper short-circuit → market-fallback/slippage guard → place → report →
cancel processing → status sync → stale-dispatched watchdog.

### 2. Legacy path (reference only): `worker/execution-worker.ts`

A self-contained service-role daemon implementing the same loop directly
against the database (`npm run worker`). It exists for local debugging and
as a reference implementation.

> **Never run both against the same database.** Both claim `queued` orders;
> the atomic claim makes double-placement unlikely but the models differ
> (paper mode, slippage guard, invalid-key flagging only exist in the hook
> path). `docker-compose.yml` and `docker-compose.production.yml` both run
> `production-worker.ts`.

## Order lifecycle

```
signal -> pipeline.functions.ts (parse + risk) -> orders (status='queued', idempotency_key)
  -> claim: queued -> dispatched (atomic; only the flipper may place)
  -> place on exchange -> status='open' | 'filled' | 'partial' (+ exchange_order_id)
  -> WS user-data stream / REST sync updates status as fills arrive
  -> position flat on exchange -> status='closed' (+ pnl)
```

## Safety guarantees (all paths)

- **Atomic claim** — the `UPDATE ... WHERE status='queued'` returns exactly
  the rows this run flipped; concurrent schedulers can't double-place.
- **Idempotent queueing** — `orders.idempotency_key` (unique) absorbs
  duplicate signals and retries.
- **Precision normalisation** — every adapter rounds qty/price to the venue's
  instrument spec (`stepSize`/`tickSize`, min qty, min notional, contract
  size) before placement. This is what fixed Binance `-1111` (precision) and
  `-4164` (min notional), and now covers Bybit, OKX, KuCoin and MEXC the
  same way.
- **Symbol mapping** — unified `BTCUSDT` is converted per venue:
  OKX `BTC-USDT-SWAP`, KuCoin `XBTUSDTM`, MEXC `BTC_USDT`.
- **Client order ids** — normalised per venue (`clientOrderIdFor`): OKX/MEXC
  cap at 32 chars, `[A-Za-z0-9-]` only.
- **Timeout-after-accept recovery** — placement is never auto-retried (a
  retried POST could double-place). Instead, on failure the worker looks the
  order up by client order id (`fetchExchangeOrderByClientId`, Binance /
  Bybit / OKX) and adopts it if the exchange has it.
- **Stale-dispatched watchdog** — an order stuck in `dispatched` > 10 min
  with no exchange ref gets the same client-id recovery attempt, and is
  rejected only when the venue has no trace of it.
- **Protection warnings** — SL/TP attach failures are returned as
  `warnings` on the place result and recorded as `execution_warning` order
  events; a filled-but-unprotected position is never silent.
- **Rate-limit resilience** — non-placement exchange calls go through
  `fetchText` (15s timeout, retry with backoff on 418/429/5xx). Placement
  calls never retry.

## Real-time user-data streams

`worker/userDataStreams.ts` opens private WebSocket streams for active
Binance/Bybit accounts (started by the legacy daemon; REST polling in the
hook path remains the source of truth):

- Binance Futures: `POST /fapi/v1/listenKey` → `wss://fstream.binance.com/ws/<lk>`
  (listenKey renewed every 30 min; reconnect with 5s backoff)
- Bybit V5: HMAC auth → `wss://stream.bybit.com/v5/private` (order topic;
  reconnect with 10s backoff)
- Stream statuses are mapped to the DB spelling (`cancelled`, not
  `canceled`) and only transition non-terminal orders
  (`dispatched`/`open`/`partial`) — a late cancel can never clobber a fill.

## Crypto payment auto-confirm

`src/lib/crypto-pay.confirm.server.ts` runs every 60s from the production
worker. It matches on-chain USDT transfers (TRC-20 via TronGrid, BEP-20 via
BSC RPC logs) to pending invoices — amount window ± network fee, transfer
must have landed at/after invoice creation, one tx confirms at most one
invoice, and the `pending → paid` flip is atomic so concurrent workers can't
double-activate. Each confirmation writes a `payments` row with the tx hash
in `external_payment_ref`.

## Pitfalls

- `tsx` requires explicit `.ts` extensions on relative imports.
- Order events carry `client_order_id` (we set it when placing) — matching on
  it avoids ambiguity when several orders share a symbol.
- The order table stores `side` as `long`/`short`; adapters map to venue
  sides (`BUY`/`SELL`, `Buy`/`Sell`, `buy`/`sell`, MEXC `1`/`3`).
