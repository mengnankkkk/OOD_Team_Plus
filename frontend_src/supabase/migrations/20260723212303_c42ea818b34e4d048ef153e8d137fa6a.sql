
ALTER TABLE public.onboarding_messages ADD COLUMN IF NOT EXISTS session_id UUID;

CREATE INDEX IF NOT EXISTS idx_onboarding_session ON public.onboarding_messages(user_id, session_id, created_at DESC);

WITH legacy AS (
  SELECT DISTINCT user_id, gen_random_uuid() AS sid
  FROM public.onboarding_messages
  WHERE session_id IS NULL
)
UPDATE public.onboarding_messages m
SET session_id = legacy.sid
FROM legacy
WHERE m.user_id = legacy.user_id AND m.session_id IS NULL;
