-- Adiciona campos de evidência de assinatura digital
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS signed_email text,
  ADD COLUMN IF NOT EXISTS signed_gps text,
  ADD COLUMN IF NOT EXISTS signed_user_agent text;
