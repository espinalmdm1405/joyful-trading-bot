CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE TABLE public.cron_tokens (name text PRIMARY KEY, token text NOT NULL DEFAULT encode(gen_random_bytes(32),'hex'));
GRANT ALL ON public.cron_tokens TO service_role;
ALTER TABLE public.cron_tokens ENABLE ROW LEVEL SECURITY;
INSERT INTO public.cron_tokens(name) VALUES ('bot');