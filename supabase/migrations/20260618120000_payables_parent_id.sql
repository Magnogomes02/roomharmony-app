-- Adiciona parent_payable_id para rastrear instâncias recorrentes
ALTER TABLE public.payables
  ADD COLUMN IF NOT EXISTS parent_payable_id UUID REFERENCES public.payables(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS payables_parent_payable_id_idx ON public.payables(parent_payable_id);
