CREATE TABLE IF NOT EXISTS public.receivable_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receivable_id uuid NOT NULL REFERENCES public.receivables(id) ON DELETE CASCADE,
  receipt_number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'emitido' CHECK (status IN ('emitido','cancelado')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by uuid REFERENCES auth.users(id),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id),
  cancel_reason text,
  professional_id uuid NOT NULL,
  professional_name text NOT NULL,
  professional_document text,
  professional_email text,
  professional_phone text,
  room_id uuid,
  room_name text,
  kind text NOT NULL,
  reference_month date NOT NULL,
  due_date date NOT NULL,
  paid_at timestamptz NOT NULL,
  payment_method text,
  amount_due numeric NOT NULL,
  amount_paid numeric NOT NULL,
  clinic_name text,
  clinic_cnpj text,
  clinic_address text,
  receipt_title text,
  receipt_body text,
  receipt_footer text,
  receipt_path text,
  authentication_code text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.receivable_receipts TO authenticated;
GRANT ALL ON public.receivable_receipts TO service_role;

ALTER TABLE public.receivable_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "receivable_receipts gestor all"
  ON public.receivable_receipts
  FOR ALL
  USING (has_role(auth.uid(), 'gestor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'gestor'::app_role));

CREATE POLICY "receivable_receipts visualizador read"
  ON public.receivable_receipts
  FOR SELECT
  USING (has_role(auth.uid(), 'visualizador'::app_role));

CREATE POLICY "receivable_receipts professional read"
  ON public.receivable_receipts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.professional_id = receivable_receipts.professional_id
    )
  );

CREATE INDEX IF NOT EXISTS idx_receivable_receipts_receivable_id
  ON public.receivable_receipts(receivable_id);
CREATE INDEX IF NOT EXISTS idx_receivable_receipts_status
  ON public.receivable_receipts(status);
CREATE INDEX IF NOT EXISTS idx_receivable_receipts_professional
  ON public.receivable_receipts(professional_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_receivable_receipts_one_active
  ON public.receivable_receipts(receivable_id)
  WHERE status = 'emitido';

CREATE TRIGGER trg_receivable_receipts_updated_at
  BEFORE UPDATE ON public.receivable_receipts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();