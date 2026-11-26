# Pre-Release Checklist

Run through this before every production deploy. Items marked **[BLOCKER]**
must pass; the rest are strong recommendations.

## 1. Code health

- [ ] **[BLOCKER]** `npm run lint` — clean
- [ ] **[BLOCKER]** `npm run typecheck` — clean
- [ ] **[BLOCKER]** `npm run test` — all vitest suites pass
- [ ] **[BLOCKER]** `npm run build` — production build succeeds
- [ ] CI workflow (`.github/workflows/ci.yml`) is green on the release commit

## 2. Database

- [ ] **[BLOCKER]** All migrations in `supabase/migrations/` applied to the
      production project (`supabase db push` / migration history matches)
- [ ] `orders` constraints present: `orders_side_check`, unique
      `idempotency_key`, `cancel_requested`, `client_order_id`,
      `last_event_at` columns
- [ ] `plans` table seeded with the intended prices
- [ ] RLS spot-check: a non-admin user cannot read another user's orders,
      invoices, or exchange accounts

## 3. Secrets & environment

- [ ] **[BLOCKER]** Every required var from `.env.example` is set on the
      server: Supabase (service + public), `CRON_SECRET`, `PRICE_RELAY_SECRET`,
      `EXCHANGE_ENCRYPTION_KEY`, `TELEGRAM_*`, `VITE_APP_URL`
- [ ] **[BLOCKER]** `EXCHANGE_ENCRYPTION_KEY` matches the key that encrypted
      existing exchange credentials — rotating it strands every stored key
- [ ] Secrets are unique per environment (never reused across white-label
      instances)
- [ ] Payment config complete for the active billing path: Stripe keys
      **or** `USDT_TRON_ADDRESS` / `BSC_USDT_ADDRESS` (+ `TRONGRID_API_KEY`)

## 4. Execution path

- [ ] **[BLOCKER]** Exactly ONE execution path is running:
      `worker/production-worker.ts` (compose `worker` service). Confirm
      `worker/execution-worker.ts` is NOT running against the same database.
- [ ] Worker heartbeat healthy: `/tmp/tred-worker-heartbeat` freshness
      (compose healthcheck) is green
- [ ] Smoke test with a **paper** account end-to-end: signal → queued →
      dispatched → filled, order_events written
- [ ] If live trading is enabled: place one minimum-size live order on a
      test account and confirm precision/min-notional normalisation and
      SL/TP attach (watch for `execution_warning` events)
- [ ] Kill-switch works: trigger `monitor-anomalies` path or admin
      kill-switch and confirm new orders stop

## 5. Web & integrations

- [ ] Signup, login, password recovery emails arrive (Supabase auth hook +
      Resend configured)
- [ ] Telegram MTProto login + channel polling ingest a test signal
      (`last_processed_message_id` advances)
- [ ] `https://<domain>/api/public/health` returns OK
- [ ] `sitemap.xml` renders absolute URLs (`VITE_APP_URL` set)
- [ ] Stripe webhook / crypto auto-confirm verified end-to-end with a real
      small payment (or admin grant dry-run)

## 6. Rollback readiness

- [ ] Database backup/snapshot taken before migration
- [ ] Previous Docker image tag retained for instant rollback
- [ ] Rollback plan: `docker compose -f docker-compose.production.yml up -d`
      with the previous image; worker restarts pick up queued orders safely
      (idempotent claims)
