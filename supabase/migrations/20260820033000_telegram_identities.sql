-- "Login with Telegram": map Telegram user IDs to app accounts.
CREATE TABLE IF NOT EXISTS public.telegram_identities (
  tg_user_id bigint PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tg_username text,
  first_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.telegram_identities ENABLE ROW LEVEL SECURITY;
-- Only server-side (service role) access is needed.
