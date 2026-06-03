-- 1. Tabela de pagamentos
CREATE TABLE IF NOT EXISTS public.receivable_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receivable_id uuid NOT NULL REFERENCES public.receivables(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL,
  paid_at date NOT NULL,
  payment_method text,
  attachment_path text,
  notes text,
  status text NOT NULL DEFAULT 'ativo',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz,
  reversed_by uuid,
  reverse_reason text
);

CREATE INDEX IF NOT EXISTS idx_receivable_payments_receivable ON public.receivable_payments(receivable_id);
CREATE INDEX IF NOT EXISTS idx_receivable_payments_status ON public.receivable_payments(status);
CREATE INDEX IF NOT EXISTS idx_receivable_payments_paid_at ON public.receivable_payments(paid_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.receivable_payments TO authenticated;
GRANT ALL ON public.receivable_payments TO service_role;

ALTER TABLE public.receivable_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "receivable_payments gestor all" ON public.receivable_payments
  FOR ALL USING (public.has_role(auth.uid(), 'gestor'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'gestor'::app_role));

CREATE POLICY "receivable_payments visualizador read" ON public.receivable_payments
  FOR SELECT USING (public.has_role(auth.uid(), 'visualizador'::app_role));

CREATE POLICY "receivable_payments professional read own" ON public.receivable_payments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.receivables rec
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE rec.id = receivable_payments.receivable_id
        AND p.professional_id = rec.professional_id
    )
  );

-- 2. Colunas opcionais de cancelamento em receivables
ALTER TABLE public.receivables ADD COLUMN IF NOT EXISTS cancel_type text;
ALTER TABLE public.receivables ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE public.receivables ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.receivables ADD COLUMN IF NOT EXISTS cancelled_by uuid;

-- 3. Vínculo de recibo com pagamento (compatível com recibos antigos)
ALTER TABLE public.receivable_receipts
  ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES public.receivable_payments(id);

CREATE INDEX IF NOT EXISTS idx_receivable_receipts_payment ON public.receivable_receipts(payment_id);