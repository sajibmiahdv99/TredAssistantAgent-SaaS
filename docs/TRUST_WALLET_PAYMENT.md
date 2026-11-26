# Trust Wallet Payment (USDT TRC-20 / BEP-20) — Setup Guide

This replaces Stripe. No card/Stripe needed — customers pay **USDT on the
TRC-20 or BEP-20 network** to the operator's Trust Wallet address, and the
subscription activates **automatically after on-chain verification**. There
is also a **manual admin override** for edge cases.

## How the flow works (current)

1. User opens **Billing** → **Pay with Trust Wallet (USDT)**.
2. Selects a plan (from the `plans` DB table) + billing interval (monthly/yearly).
3. Clicks **Pay with Trust Wallet** → server creates a `pending` subscription +
   an invoice and returns the operator's USDT receive address + amount.
   Invoice numbers encode the network (`-BSC-` for BEP-20, otherwise TRC-20).
4. User sends USDT from Trust Wallet to that address.
5. **Auto-confirm (no TXID needed):** the production worker runs
   `confirmPendingCryptoPayments()` every 60s
   (`src/lib/crypto-pay.confirm.server.ts`). It scans on-chain transfers to
   the operator address — TronGrid for TRC-20, BSC RPC `eth_getLogs` for
   BEP-20 — and matches an invoice when:
   - the amount is within ±0.5 USDT of the invoice (absorbs exchange
     network fees),
   - the transfer **landed at/after** the invoice was created (a stale tx
     can't confirm a newer invoice),
   - the tx hash hasn't confirmed another invoice (`payments.
     external_payment_ref` records it for audit),
   - the invoice flip `pending → paid` is atomic, so concurrent workers
     can't double-activate.
6. The user can also paste the TXID manually (`verifyCryptoPayment`) as a
   fallback, and admin can **Grant** access manually on Admin → Subscriptions.

## Configuration (required)

```env
# Operator's Trust Wallet USDT receive addresses
USDT_TRON_ADDRESS=TYourTronAddress      # TRC-20 (starts with T...)
BSC_USDT_ADDRESS=0xYourBscAddress       # BEP-20 (starts with 0x...)

# Free TronGrid API key — https://www.trongrid.io/ (dashboard -> API keys)
TRONGRID_API_KEY=your_key_here
```

Notes:
- The **TRC-20 USDT contract** is fixed:
  `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` (decimals = 6).
- The **BEP-20 USDT contract** is fixed:
  `0x55d398326f99059fF775485246999027B3197955` (decimals = 18).
- If `TRONGRID_API_KEY` is absent, verification still queries TronGrid without
  a key (rate-limited but works).
- BSC scanning uses public RPCs with failover; the scan window is ~8000
  blocks (~6.7h), so invoices pending longer than that need manual TXID
  verification or an admin grant.

## Admin override (manual)
Admin → Subscriptions → each row has a **Grant** button:
- If the customer paid but auto-verify timed out / failed (e.g. TronGrid down), you
  can still activate their subscription manually.
- Also usable to grant complimentary access.

## What changed
- `src/lib/crypto-pay.functions.ts` — server functions:
  `getCryptoPayInfo`, `startCryptoPayment`, `verifyCryptoPayment`.
- `src/lib/crypto-pay.confirm.server.ts` — worker-side auto-confirm
  (TRC-20 + BEP-20) with atomic invoice claim and `payments` audit rows.
- `src/components/CryptoPay.tsx` — billing UI (plan select, address copy,
  tx-hash verify, live status).
- `src/routes/_authenticated/app.billing.tsx` — renders `<CryptoPay />`.
- `src/lib/admin.functions.ts` — `adminGrantSubscription`.
- `src/routes/_authenticated/admin.subscriptions.tsx` — Grant dialog.
- `.env.example` — `USDT_TRON_ADDRESS`, `BSC_USDT_ADDRESS`, `TRONGRID_API_KEY`.

## Plan prices
Plans are read from the `plans` DB table (edit in Admin → Plans). Set
`monthly_price` / `yearly_price` there — the crypto flow uses those values.
