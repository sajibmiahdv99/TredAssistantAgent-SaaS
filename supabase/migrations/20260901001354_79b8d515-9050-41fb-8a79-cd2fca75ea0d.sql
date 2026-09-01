-- One telegram account per user: enforce a unique user_id on
-- public.telegram_accounts so a user cannot link the same Telegram
-- session twice (duplicate rows would silently shadow each other).
--
-- Backfill guard: dedupe any pre-existing duplicate user_id rows by
-- keeping the most recently updated one, so this constraint is safe to
-- apply even on a DB that already has data.

-- 1) Drop duplicates, keeping latest updated_at per user.
DELETE FROM public.telegram_accounts a
USING public.telegram_accounts b
WHERE a.user_id = b.user_id
  AND a.updated_at < b.updated_at;

-- 2) Add the unique constraint.
ALTER TABLE public.telegram_accounts
  ADD CONSTRAINT telegram_accounts_user_id_key UNIQUE (user_id);
