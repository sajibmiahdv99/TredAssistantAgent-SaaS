-- Add message-id cursor for the channel signal poller.
-- The worker reads new messages from linked Telegram channels via the
-- user's own MTProto session (no bot required); this column tracks how
-- far we've read so messages are ingested exactly once.

ALTER TABLE public.personal_signal_channels
  ADD COLUMN IF NOT EXISTS last_processed_message_id bigint;

GRANT ALL ON public.personal_signal_channels TO service_role;
