-- Fix: new users must get ZERO balances instead of hardcoded demo values (9748/320/12450).
-- The previous handle_new_user() seeded every fresh account with the same fake demo balance,
-- so any new signup showed $9,748 available. Balance fields now start at 0.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url, referral_code)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)),
    NEW.raw_user_meta_data->>'avatar_url',
    substr(md5(NEW.id::text || clock_timestamp()::text), 1, 10)
  ) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id,'user') ON CONFLICT DO NOTHING;
  INSERT INTO public.user_balances (user_id, available_balance, pending_commission, pending_withdrawal, total_earned)
  VALUES (NEW.id, 0, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END $function$;

-- Reset all existing rows: every account currently carries the identical demo values.
UPDATE public.user_balances
SET available_balance = 0,
    pending_commission = 0,
    pending_withdrawal = 0,
    total_earned = 0;
