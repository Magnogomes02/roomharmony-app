-- Cancelamento de contrato com fluxo completo:
-- pergunta mes de corte e multa rescisoria, cancela recebiveis futuros como
-- perda, cancela reservas futuras do contrato e resolve conflitos pendentes
-- ligados a elas, tudo em uma unica transacao.

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS cancel_effective_month date,
  ADD COLUMN IF NOT EXISTS termination_fee_amount numeric,
  ADD COLUMN IF NOT EXISTS termination_fee_receivable_id uuid REFERENCES public.receivables(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.cancel_contract(
  _contract_id uuid,
  _effective_month date,
  _termination_fee numeric DEFAULT NULL,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c record;
  v_effective_month date;
  v_receivables_cancelled integer := 0;
  v_bookings_cancelled integer := 0;
  v_conflicts_resolved integer := 0;
  v_fee_receivable_id uuid := NULL;
BEGIN
  IF NOT public.has_role(auth.uid(), 'gestor'::app_role) THEN
    RAISE EXCEPTION 'Apenas gestores podem cancelar contratos.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO c FROM public.contracts WHERE id = _contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato nao encontrado.';
  END IF;
  IF c.status = 'cancelado' THEN
    RAISE EXCEPTION 'Contrato ja esta cancelado.';
  END IF;

  v_effective_month := date_trunc('month', _effective_month)::date;

  -- 1. Cancela recebiveis ainda abertos a partir do mes de corte (perda = saldo aberto).
  --    Pagamentos ja recebidos (amount_paid) nao sao alterados.
  WITH updated AS (
    UPDATE public.receivables
       SET status = 'cancelado',
           cancel_type = 'perda_contrato',
           cancel_reason = COALESCE(_reason, 'Cancelamento de contrato'),
           cancelled_at = now(),
           cancelled_by = auth.uid()
     WHERE contract_id = _contract_id
       AND reference_month >= v_effective_month
       AND status NOT IN ('recebido', 'cancelado')
    RETURNING id
  )
  SELECT count(*) INTO v_receivables_cancelled FROM updated;

  -- 2. Cancela reservas futuras (ativas/em conflito) ligadas ao contrato a partir do corte.
  WITH updated AS (
    UPDATE public.bookings
       SET status = 'cancelada'
     WHERE contract_id = _contract_id
       AND start_at >= v_effective_month
       AND status IN ('ativa', 'conflito')
    RETURNING id
  )
  SELECT count(*) INTO v_bookings_cancelled FROM updated;

  -- 3. Resolve conflitos pendentes cujas reservas acabaram de ser canceladas.
  WITH updated AS (
    UPDATE public.booking_conflicts bc
       SET status = 'resolvido',
           resolved_at = now(),
           resolved_by = auth.uid(),
           resolution_notes = 'Resolvido automaticamente: contrato cancelado'
     WHERE bc.status = 'pendente'
       AND (
         EXISTS (
           SELECT 1 FROM public.bookings b
            WHERE b.id = bc.booking_id_a AND b.status = 'cancelada' AND b.contract_id = _contract_id
         )
         OR EXISTS (
           SELECT 1 FROM public.bookings b
            WHERE b.id = bc.booking_id_b AND b.status = 'cancelada' AND b.contract_id = _contract_id
         )
       )
    RETURNING id
  )
  SELECT count(*) INTO v_conflicts_resolved FROM updated;

  -- 4. Multa rescisoria, se houver, vira um recebivel avulso novo.
  IF _termination_fee IS NOT NULL AND _termination_fee > 0 THEN
    INSERT INTO public.receivables (
      kind, contract_id, professional_id, due_date, reference_month, amount_due, notes
    )
    VALUES (
      'avulso', _contract_id, c.professional_id, CURRENT_DATE,
      date_trunc('month', CURRENT_DATE)::date, _termination_fee,
      'Multa rescisória — contrato cancelado'
    )
    RETURNING id INTO v_fee_receivable_id;
  END IF;

  -- 5. Marca o contrato como cancelado com os metadados da operacao.
  UPDATE public.contracts
     SET status = 'cancelado',
         cancelled_at = now(),
         cancelled_by = auth.uid(),
         cancel_reason = _reason,
         cancel_effective_month = v_effective_month,
         termination_fee_amount = _termination_fee,
         termination_fee_receivable_id = v_fee_receivable_id
   WHERE id = _contract_id;

  RETURN jsonb_build_object(
    'receivables_cancelled', v_receivables_cancelled,
    'bookings_cancelled', v_bookings_cancelled,
    'conflicts_resolved', v_conflicts_resolved,
    'termination_fee_receivable_id', v_fee_receivable_id
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cancel_contract(uuid, date, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_contract(uuid, date, numeric, text) TO authenticated;
