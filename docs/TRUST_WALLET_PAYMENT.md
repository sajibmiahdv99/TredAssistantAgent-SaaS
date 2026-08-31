# Trust Wallet Payment (USDT TRC-20) — Setup Guide

This replaces Stripe. No card/Stripe needed — customers pay **USDT on the TRC-20
network** to the operator's Trust Wallet address, and the subscription activates
**automatically after on-chain verification** (TronGrid). There is also a
**manual admin override** for edge cases.

## Why this exists
The app's original billing used Stripe (`billing.functions.ts`, `stripe.server.ts`).
If you don't have Stripe, only a subset of plans were purchasable and the checkout
was blocked. This crypto path lets you take money with just a Trust Wallet.

## How the flow works
1. User opens **Billing** → **Pay with Trust Wallet (USDT)**.
2. Selects a plan (from the `plans` DB table) + billing interval (monthly/yearly).
3. Clicks **Pay with Trust Wallet** → server creates a `pending` subscription +
   an invoice (`TW-...`) and returns the operator's USDT (TRC-20) address + amount.
4. User sends USDT from Trust Wallet to that address (network = **TRC-20**).
5. User pastes the **transaction hash (TXID)** and clicks **Verify & Activate**.
6. `verifyCryptoPayment` queries TronGrid for confirmed USDT (TRC-20) transfers to
   the operator address, validates the tx, token, amount (>= invoice), then marks the
   invoice paid and activates the subscription (+1 month). The billing page refreshes.
7. If auto-verify fails for any reason, admin can **Grant** access manually on the
   Admin → Subscriptions page (`adminGrantSubscription`).

## Configuration (required)
Add to `.env`:

```env
# Operator's Trust Wallet USDT (TRC-20) receive address (starts with T...)
USDT_TRON_ADDRESS=TYourWalletAddress

# Free TronGrid API key — https://www.trongrid.io/ (dashboard -> API keys)
TRONGRID_API_KEY=your_key_here
```

Notes:
- **USDT_TRON_ADDRESS** must be a valid **TRC-20** address (Tron network, starts with `T`).
- The **TRC-20 USDT contract** is fixed:
  `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` (decimals = 6).
- If `TRONGRID_API_KEY` is absent, verification still queries TronGrid without a key
  (rate-limited but works).

## Admin override (manual)
Admin → Subscriptions → each row has a **Grant** button:
- If the customer paid but auto-verify timed out / failed (e.g. TronGrid down), you
  can still activate their subscription manually.
- Also usable to grant complimentary access.

## What changed
- `src/lib/crypto-pay.functions.ts` — new server functions:
  `getCryptoPayInfo`, `startCryptoPayment`, `verifyCryptoPayment`.
- `src/components/CryptoPay.tsx` — new billing UI (plan select, address copy,
  tx-hash verify, live status).
- `src/routes/_authenticated/app.billing.tsx` — renders `<CryptoPay />`.
- `src/lib/admin.functions.ts` — new `adminGrantSubscription`.
- `src/routes/_authenticated/admin.subscriptions.tsx` — Grant dialog.
- `.env.example` — added `USDT_TRON_ADDRESS`, `TRONGRID_API_KEY`.

## Plan prices
Plans are read from the `plans` DB table (edit in Admin → Plans). Set
`monthly_price` / `yearly_price` there — the crypto flow uses those values.
