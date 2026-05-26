ALTER TABLE public.contracts DROP COLUMN IF EXISTS template_id;
DELETE FROM public.settings WHERE key = 'contract_templates';