-- 1. Campos novos
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS due_day integer NOT NULL DEFAULT 5
  CHECK (due_day BETWEEN 1 AND 28);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS avulso_amount numeric,
  ADD COLUMN IF NOT EXISTS avulso_paid_at timestamptz;

-- 2. Tabela de recebíveis
CREATE TABLE IF NOT EXISTS public.receivables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('contrato','avulso')),
  contract_id uuid REFERENCES public.contracts(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES public.professionals(id) ON DELETE RESTRICT,
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  reference_month date NOT NULL,
  due_date date NOT NULL,
  amount_due numeric NOT NULL DEFAULT 0,
  amount_paid numeric,
  paid_at timestamptz,
  payment_method text,
  notes text,
  attachment_path text,
  status text NOT NULL DEFAULT 'a_receber' CHECK (status IN ('a_receber','recebido','atrasado','cancelado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, reference_month),
  UNIQUE (booking_id)
);

CREATE INDEX IF NOT EXISTS idx_receivables_due_date ON public.receivables(due_date);
CREATE INDEX IF NOT EXISTS idx_receivables_status ON public.receivables(status);
CREATE INDEX IF NOT EXISTS idx_receivables_professional ON public.receivables(professional_id);

ALTER TABLE public.receivables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "receivables gestor all" ON public.receivables
  FOR ALL USING (has_role(auth.uid(), 'gestor')) WITH CHECK (has_role(auth.uid(), 'gestor'));

CREATE POLICY "receivables visualizador read" ON public.receivables
  FOR SELECT USING (has_role(auth.uid(), 'visualizador'));

CREATE POLICY "receivables professional read" ON public.receivables
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.professional_id = receivables.professional_id)
  );

CREATE TRIGGER trg_receivables_updated_at
  BEFORE UPDATE ON public.receivables
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Geração automática de parcelas
CREATE OR REPLACE FUNCTION public.generate_contract_receivables(_contract_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  cursor_month date;
  last_month date;
  due date;
  inserted_count integer := 0;
BEGIN
  SELECT * INTO c FROM contracts WHERE id = _contract_id;
  IF NOT FOUND OR c.monthly_value IS NULL OR c.monthly_value <= 0 THEN
    RETURN 0;
  END IF;

  cursor_month := date_trunc('month', c.start_date)::date;
  IF c.end_date IS NOT NULL THEN
    last_month := date_trunc('month', c.end_date)::date;
  ELSE
    last_month := date_trunc('month', (CURRENT_DATE + INTERVAL '12 months'))::date;
  END IF;

  WHILE cursor_month <= last_month LOOP
    due := (cursor_month + (LEAST(c.due_day, 28) - 1) * INTERVAL '1 day')::date;
    INSERT INTO receivables (kind, contract_id, professional_id, room_id, reference_month, due_date, amount_due)
    VALUES ('contrato', c.id, c.professional_id, c.room_id, cursor_month, due, c.monthly_value)
    ON CONFLICT (contract_id, reference_month) DO NOTHING;
    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    cursor_month := (cursor_month + INTERVAL '1 month')::date;
  END LOOP;

  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.regenerate_contract_receivables(_contract_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.generate_contract_receivables(_contract_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.on_contract_activated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'ativo' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'ativo') THEN
    PERFORM public.generate_contract_receivables(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contract_activated ON public.contracts;
CREATE TRIGGER trg_contract_activated
  AFTER INSERT OR UPDATE OF status, monthly_value, due_day, start_date, end_date ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.on_contract_activated();

-- 4. Atualização diária de status atrasado
CREATE OR REPLACE FUNCTION public.mark_overdue_receivables()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE receivables
     SET status = 'atrasado'
   WHERE status = 'a_receber'
     AND due_date < CURRENT_DATE;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- 5. Backfill: gerar para contratos já ativos
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM contracts WHERE status = 'ativo' LOOP
    PERFORM public.generate_contract_receivables(r.id);
  END LOOP;
END $$;