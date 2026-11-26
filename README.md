# TredAssistantAgent (SaaS)

Automated crypto signal trading platform. Telegram signals are ingested,
parsed, risk-checked per subscriber, and executed on the user's own exchange
account — with paper trading, backtesting, billing (Stripe or Trust Wallet
USDT), affiliates, an admin panel, and white-label branding.

## Architecture

```
Telegram channels ──► channel poller (MTProto) ──► ingest pipeline
TradingView/webhooks ─► /api/public/hooks/webhook-signal/:token ──┘
                                                              │
                          parse (regex + optional AI) ──► risk engine
                                                              │
                                            orders (status=queued, idempotency_key)
                                                              │
                        production-worker ──► POST /api/public/hooks/process-orders
                                                              │
                              exchange adapters (Binance / Bybit / OKX / KuCoin / MEXC /
                              MT5 & DEX bridge / paper) ◄── decrypted API creds
```

- **Frontend + API**: TanStack Start (React 19), Tailwind 4, shadcn/ui.
  Server functions and API routes live in `src/lib/**` and `src/routes/api/**`.
- **Database / auth**: Supabase (Postgres + RLS + auth hooks). Migrations in
  `supabase/migrations/`.
- **Background processing**: `worker/production-worker.ts` is the single
  scheduler. It calls the app's internal hooks (`/api/public/hooks/*`,
  guarded by `CRON_SECRET`) for order execution, position monitoring, balance
  sync, notifications and backtests, and runs the Telegram channel poller and
  crypto-payment confirmer in-process.
- **Live order updates**: `worker/userDataStreams.ts` opens Binance/Bybit
  private WebSocket streams for instant fill events; REST polling remains the
  source of truth.

> `worker/execution-worker.ts` is a **legacy standalone daemon** kept for
> reference. Do **not** run it against the same database as
> `production-worker.ts` — both claim queued orders and would double-execute.

## Order execution guarantees

- **Atomic claim**: only the run that flips `queued → dispatched` may place
  the order; a second scheduler skips it.
- **Idempotent queueing**: signals upsert orders on a unique
  `idempotency_key`, so retries and duplicate Telegram messages never
  double-queue.
- **Precision & minimums**: every adapter normalises quantity/price to the
  venue's instrument spec (step size, tick size, min qty / min notional,
  contract size) before placement — Binance `-1111` / `-4164` and their
  OKX/KuCoin/MEXC equivalents.
- **Symbol mapping**: unified `BTCUSDT` is converted per venue
  (`BTC-USDT-SWAP`, `XBTUSDTM`, `BTC_USDT`).
- **Timeout recovery**: a place call that fails *after* the exchange accepted
  it is recovered by client-order-id lookup (Binance/Bybit/OKX) instead of
  being falsely rejected; stale `dispatched` orders get the same recovery
  attempt before the watchdog rejects them.
- **Protection warnings**: SL/TP attach failures are recorded as
  `execution_warning` order events — a filled but unprotected position is
  never silent.

## Development

Requires Node.js 22+.

```sh
npm install          # .npmrc already sets legacy-peer-deps
cp .env.example .env # fill in Supabase + integration keys
npm run dev
```

Useful scripts: `npm run lint` · `npm run typecheck` · `npm run test` ·
`npm run build`.

## Deployment (Docker / VPS)

`docker-compose.production.yml` runs two containers from one image:

- **app** — the TanStack Start server (`node serve.mjs`), health-checked on
  `/api/public/health`, behind Traefik with Let's Encrypt.
- **worker** — `worker/production-worker.ts`, waits for the app to be
  healthy, heartbeat file checked by its own healthcheck.

```sh
cp .env.example .env   # fill everything; see "Configuration" below
docker compose -f docker-compose.production.yml up -d --build
```

Run the Supabase migrations against your project before first boot
(`supabase/migrations/`, e.g. via `supabase db push`).

## Configuration

All variables are documented in `.env.example`. The load-bearing ones:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | service-role DB access for hooks/workers |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` | browser client |
| `VITE_APP_URL` | public base URL (sitemap, billing redirects) |
| `CRON_SECRET` | guards `/api/public/hooks/*` |
| `PRICE_RELAY_SECRET` | guards the optional price-relay push endpoint |
| `EXCHANGE_ENCRYPTION_KEY` | encrypts users' exchange API keys at rest |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` / `TELEGRAM_SESSION_ENC_KEY` | MTProto channel polling |
| `OPENAI_API_KEY` (+ optional `OPENAI_BASE_URL`/`OPENAI_MODEL`) | AI fallback signal parser |
| `USDT_TRON_ADDRESS` / `BSC_USDT_ADDRESS` (+ `TRONGRID_API_KEY`) | Trust Wallet crypto payments |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_PRO_MONTHLY` | Stripe billing (optional) |
| `SUPABASE_AUTH_HOOK_SECRET` | verifies the Supabase send-email hook |

## Payments

Two independent billing paths:

- **Stripe** — card checkout + `stripe-webhook` (HMAC-verified).
- **Trust Wallet (USDT TRC-20 / BEP-20)** — `docs/TRUST_WALLET_PAYMENT.md`.
  The worker's auto-confirmer matches on-chain transfers to pending invoices
  (amount window ± network fee, transfer must land after invoice creation,
  one tx confirms at most one invoice, atomic pending→paid claim) and
  activates the subscription. Admin manual grant exists for edge cases.

## White-label

Branding is env-driven (`VITE_BRAND_*`, see `src/lib/brand.ts` and
`docs/WHITE_LABEL.md`). Each instance gets its own Supabase project and its
own secrets — never shared across brands.

## Docs

- `docs/EXECUTION_WORKER.md` — execution model, order lifecycle, recovery
- `docs/PRICE_RELAY.md` — optional WebSocket price relay
- `docs/TRUST_WALLET_PAYMENT.md` — crypto billing setup
- `docs/WHITE_LABEL.md` — re-branding checklist
- `docs/PRE_RELEASE_CHECKLIST.md` — run this before every deploy
