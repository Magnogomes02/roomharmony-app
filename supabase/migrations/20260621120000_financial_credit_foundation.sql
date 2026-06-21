-- Fase 1 da padronização de pagamento parcial/excedente: colunas de saldo
-- restante (nova data) e crédito aplicado, mais a tabela de aplicações de
-- crédito entre lançamentos. Tudo aditivo e com default neutro — nenhum
-- comportamento ou número muda até as fases seguintes passarem a popular
-- esses campos.

ALTER TABLE public.receivables
  ADD COLUMN IF NOT EXISTS remaining_due_date date null,
  ADD COLUMN IF NOT EXISTS remaining_due_updated_at timestamptz null,
  ADD COLUMN IF NOT EXISTS remaining_due_updated_by uuid null REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS remaining_due_reason text null,
  ADD COLUMN IF NOT EXISTS credit_applied_amount numeric NOT NULL DEFAULT 0;

ALTER TABLE public.payables
  ADD COLUMN IF NOT EXISTS remaining_due_date date null,
  ADD COLUMN IF NOT EXISTS remaining_due_updated_at timestamptz null,
  ADD COLUMN IF NOT EXISTS remaining_due_updated_by uuid null REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS remaining_due_reason text null,
  ADD COLUMN IF NOT EXISTS credit_applied_amount numeric NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.financial_credit_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL CHECK (module IN ('receivable', 'payable')),
  source_item_id uuid NOT NULL,
  source_payment_id uuid NULL,
  target_item_id uuid NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'reversed')),
  reason text NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz NULL,
  reversed_at timestamptz NULL,
  metadata jsonb NULL
);

CREATE INDEX IF NOT EXISTS idx_credit_applications_source ON public.financial_credit_applications(module, source_item_id);
CREATE INDEX IF NOT EXISTS idx_credit_applications_target ON public.financial_credit_applications(target_item_id);
CREATE INDEX IF NOT EXISTS idx_credit_applications_pending ON public.financial_credit_applications(module, status) WHERE status = 'pending';

ALTER TABLE public.financial_credit_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credit applications gestor all" ON public.financial_credit_applications
  FOR ALL USING (public.has_role(auth.uid(), 'gestor')) WITH CHECK (public.has_role(auth.uid(), 'gestor'));

CREATE POLICY "credit applications visualizador read" ON public.financial_credit_applications
  FOR SELECT USING (public.has_role(auth.uid(), 'visualizador'));
