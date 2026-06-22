-- Despesa avulsa parcelada: grupo de parcelas + colunas em payables.
-- Parcelamento é um avulso com vínculo lateral (installment_group_id), nunca
-- recorrência (parent_payable_id continua exclusivo da recorrência mensal).

CREATE TABLE IF NOT EXISTS public.payable_installment_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  description text NOT NULL,
  supplier text NULL,
  category text NULL,
  total_amount numeric NOT NULL CHECK (total_amount > 0),
  installments_count integer NOT NULL CHECK (installments_count > 1),
  first_due_date date NOT NULL,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'cancelado')),
  notes text NULL,
  created_by uuid NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER set_payable_installment_groups_updated_at
  BEFORE UPDATE ON public.payable_installment_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.payables
  ADD COLUMN IF NOT EXISTS installment_group_id uuid NULL REFERENCES public.payable_installment_groups(id),
  ADD COLUMN IF NOT EXISTS installment_number integer NULL,
  ADD COLUMN IF NOT EXISTS installment_total integer NULL;

CREATE INDEX IF NOT EXISTS idx_payables_installment_group_id ON public.payables(installment_group_id);
CREATE INDEX IF NOT EXISTS idx_payables_installment_group_number ON public.payables(installment_group_id, installment_number);

ALTER TABLE public.payables
  ADD CONSTRAINT payables_installment_fields_consistency CHECK (
    installment_group_id IS NULL
    OR (installment_number IS NOT NULL AND installment_total IS NOT NULL)
  ),
  ADD CONSTRAINT payables_installment_number_positive CHECK (
    installment_number IS NULL OR installment_number >= 1
  ),
  ADD CONSTRAINT payables_installment_total_ge_number CHECK (
    installment_total IS NULL OR installment_number IS NULL OR installment_total >= installment_number
  );

ALTER TABLE public.payable_installment_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payable installment groups gestor all" ON public.payable_installment_groups
  FOR ALL USING (public.has_role(auth.uid(), 'gestor')) WITH CHECK (public.has_role(auth.uid(), 'gestor'));

CREATE POLICY "payable installment groups visualizador read" ON public.payable_installment_groups
  FOR SELECT USING (public.has_role(auth.uid(), 'visualizador'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payable_installment_groups TO authenticated;
GRANT ALL ON public.payable_installment_groups TO service_role;
