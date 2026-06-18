-- 1. Add is_maintenance to bookings
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS is_maintenance BOOLEAN NOT NULL DEFAULT false;

-- 2. Create payables table (contas a pagar)
CREATE TABLE IF NOT EXISTS public.payables (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('recorrente', 'avulso')),
  description   text NOT NULL,
  amount_due    numeric(12,2) NOT NULL CHECK (amount_due > 0),
  amount_paid   numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  due_date      date NOT NULL,
  reference_month date NOT NULL,
  status        text NOT NULL DEFAULT 'a_pagar'
                  CHECK (status IN ('a_pagar', 'parcial', 'pago', 'atrasado', 'cancelado')),
  recurrence_day integer CHECK (recurrence_day BETWEEN 1 AND 28),
  supplier      text,
  category      text,
  notes         text,
  cancel_reason text,
  cancelled_at  timestamptz,
  cancelled_by  uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_payables_due_date ON public.payables(due_date);
CREATE INDEX IF NOT EXISTS idx_payables_status   ON public.payables(status);
CREATE INDEX IF NOT EXISTS idx_payables_reference_month ON public.payables(reference_month);

-- 3. Create payable_payments table
CREATE TABLE IF NOT EXISTS public.payable_payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payable_id    uuid NOT NULL REFERENCES public.payables(id) ON DELETE CASCADE,
  amount        numeric(12,2) NOT NULL CHECK (amount > 0),
  paid_at       timestamptz NOT NULL DEFAULT now(),
  payment_method text,
  notes         text,
  status        text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'estornado')),
  reversed_at   timestamptz,
  reversed_by   uuid REFERENCES auth.users(id),
  reverse_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_payable_payments_payable ON public.payable_payments(payable_id);

-- 4. updated_at trigger for payables
CREATE OR REPLACE TRIGGER set_payables_updated_at
  BEFORE UPDATE ON public.payables
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. RLS
ALTER TABLE public.payables         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payable_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payables gestor all"
  ON public.payables FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'gestor'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'gestor'::app_role));

CREATE POLICY "payables visualizador read"
  ON public.payables FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'visualizador'::app_role));

CREATE POLICY "payable_payments gestor all"
  ON public.payable_payments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'gestor'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'gestor'::app_role));

CREATE POLICY "payable_payments visualizador read"
  ON public.payable_payments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'visualizador'::app_role));

-- 6. Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payables         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payable_payments TO authenticated;
GRANT ALL ON public.payables         TO service_role;
GRANT ALL ON public.payable_payments TO service_role;
