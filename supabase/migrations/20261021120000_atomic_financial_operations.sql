-- Operações financeiras atômicas.
--
-- Antes, registrar/estornar pagamento, cancelar recebível, aplicar crédito e
-- excluir contrato eram sequências de chamadas feitas pelo navegador: uma
-- falha no meio deixava o dado pela metade (pagamento sem auditoria, recibo
-- cancelado sem estorno, crédito aplicado duas vezes por duas abas abertas,
-- contrato excluído levando pagamentos e recibos em cascata). Cada operação
-- abaixo roda em uma única transação, com bloqueio das linhas envolvidas e a
-- auditoria gravada junto. Só gestores executam.

-- ---------------------------------------------------------------------------
-- Data de "hoje" da clínica (Recife, UTC-3, sem horário de verão).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clinic_today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT (now() AT TIME ZONE 'America/Recife')::date;
$function$;

-- ---------------------------------------------------------------------------
-- Status efetivo de um recebível. Espelha computeEffectiveStatus em
-- src/lib/paymentsService.ts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receivable_effective_status(
  _status text,
  _due_date date,
  _amount_due numeric,
  _amount_paid numeric,
  _credit_applied numeric,
  _remaining_due_date date
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_due numeric := COALESCE(_amount_due, 0);
  v_eff numeric := COALESCE(_amount_paid, 0) + COALESCE(_credit_applied, 0);
  v_today date := public.clinic_today();
BEGIN
  IF _status = 'cancelado' THEN
    RETURN 'cancelado';
  END IF;
  IF v_due > 0 AND v_eff >= v_due THEN
    RETURN 'recebido';
  END IF;
  IF v_eff > 0 AND v_eff < v_due THEN
    IF COALESCE(_remaining_due_date, _due_date) < v_today THEN
      RETURN 'atrasado';
    END IF;
    RETURN 'parcial';
  END IF;
  IF _due_date < v_today THEN
    RETURN 'atrasado';
  END IF;
  RETURN 'a_receber';
END;
$function$;

CREATE OR REPLACE FUNCTION public.require_gestor()
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'gestor'::app_role) THEN
    RAISE EXCEPTION 'Apenas gestores podem realizar esta operação.' USING ERRCODE = '42501';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.write_audit(
  _action text,
  _entity_type text,
  _entity_id uuid,
  _metadata jsonb
)
RETURNS void
LANGUAGE sql
SET search_path TO 'public'
AS $function$
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), _action, _entity_type, _entity_id, _metadata);
$function$;

-- ---------------------------------------------------------------------------
-- Recalcula os campos resumo (amount_paid, paid_at, payment_method, status) a
-- partir dos pagamentos ativos. paid_at é gravado ao meio-dia de Recife para
-- que a data não "volte um dia" quando exibida em horário local.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_receivable_summary(_receivable_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_total numeric;
  v_last_paid_at date;
  v_last_method text;
  v_status text;
BEGIN
  PERFORM public.require_gestor();

  SELECT * INTO r FROM public.receivables WHERE id = _receivable_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recebível não encontrado.';
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_total
    FROM public.receivable_payments
   WHERE receivable_id = _receivable_id AND status = 'ativo';

  SELECT paid_at, payment_method INTO v_last_paid_at, v_last_method
    FROM public.receivable_payments
   WHERE receivable_id = _receivable_id AND status = 'ativo'
   ORDER BY paid_at DESC, created_at DESC
   LIMIT 1;

  v_status := public.receivable_effective_status(
    r.status, r.due_date, r.amount_due, v_total, r.credit_applied_amount, r.remaining_due_date
  );

  UPDATE public.receivables
     SET amount_paid = NULLIF(v_total, 0),
         paid_at = CASE WHEN v_last_paid_at IS NULL THEN NULL
                        ELSE (v_last_paid_at + time '12:00') AT TIME ZONE 'America/Recife' END,
         payment_method = v_last_method,
         status = v_status
   WHERE id = _receivable_id;

  RETURN v_status;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Aplica créditos pendentes às próximas contas/cobranças do mesmo contrato
-- (recebíveis) ou da mesma recorrência (contas a pagar), em ordem de
-- reference_month, limitado ao saldo aberto de cada alvo. Mesma regra de
-- applyOneCredit (src/lib/creditApplications.ts), agora com bloqueio de
-- linha: execuções simultâneas nunca aplicam o mesmo crédito duas vezes.
-- Para quem não é gestor, não faz nada (é chamada ao abrir telas).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_pending_credits(_module text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cr record;
  v_src_month date;
  v_scope_id uuid;
  v_target_ids uuid[];
  v_target_id uuid;
  v_amount_due numeric;
  v_amount_paid numeric;
  v_credit numeric;
  v_open numeric;
  v_apply numeric;
  v_remaining numeric;
  v_current_id uuid;
  v_applied integer := 0;
BEGIN
  IF _module NOT IN ('receivable', 'payable') THEN
    RAISE EXCEPTION 'Módulo inválido: %', _module;
  END IF;
  IF NOT public.has_role(auth.uid(), 'gestor'::app_role) THEN
    RETURN 0;
  END IF;

  FOR cr IN
    SELECT * FROM public.financial_credit_applications
     WHERE module = _module AND status = 'pending' AND target_item_id IS NULL
     ORDER BY created_at
     FOR UPDATE SKIP LOCKED
  LOOP
    IF _module = 'receivable' THEN
      SELECT reference_month, contract_id INTO v_src_month, v_scope_id
        FROM public.receivables WHERE id = cr.source_item_id;
      SELECT array_agg(id ORDER BY reference_month, id) INTO v_target_ids
        FROM public.receivables
       WHERE contract_id = v_scope_id
         AND reference_month > v_src_month
         AND status IN ('a_receber', 'atrasado');
    ELSE
      SELECT reference_month, parent_payable_id INTO v_src_month, v_scope_id
        FROM public.payables WHERE id = cr.source_item_id;
      SELECT array_agg(id ORDER BY reference_month, id) INTO v_target_ids
        FROM public.payables
       WHERE parent_payable_id = v_scope_id
         AND reference_month > v_src_month
         AND status IN ('a_pagar', 'atrasado');
    END IF;
    -- avulso, sem vínculo ou ainda sem próxima instância: fica pendente
    CONTINUE WHEN v_scope_id IS NULL OR v_src_month IS NULL OR v_target_ids IS NULL;

    v_remaining := cr.amount;
    v_current_id := cr.id;

    FOREACH v_target_id IN ARRAY v_target_ids LOOP
      EXIT WHEN v_remaining <= 0.001;

      -- trava o alvo e relê o saldo já dentro do bloqueio
      IF _module = 'receivable' THEN
        SELECT amount_due, amount_paid, credit_applied_amount
          INTO v_amount_due, v_amount_paid, v_credit
          FROM public.receivables WHERE id = v_target_id FOR UPDATE;
      ELSE
        SELECT amount_due, amount_paid, credit_applied_amount
          INTO v_amount_due, v_amount_paid, v_credit
          FROM public.payables WHERE id = v_target_id FOR UPDATE;
      END IF;

      v_open := GREATEST(COALESCE(v_amount_due, 0) - COALESCE(v_amount_paid, 0) - COALESCE(v_credit, 0), 0);
      CONTINUE WHEN v_open <= 0; -- alvo já quitado: tenta o próximo

      v_apply := LEAST(v_remaining, v_open);

      IF _module = 'receivable' THEN
        UPDATE public.receivables
           SET credit_applied_amount = COALESCE(credit_applied_amount, 0) + v_apply
         WHERE id = v_target_id;
      ELSE
        UPDATE public.payables
           SET credit_applied_amount = COALESCE(credit_applied_amount, 0) + v_apply
         WHERE id = v_target_id;
      END IF;

      UPDATE public.financial_credit_applications
         SET target_item_id = v_target_id,
             status = 'applied',
             applied_at = now(),
             amount = v_apply
       WHERE id = v_current_id;
      v_applied := v_applied + 1;
      v_remaining := v_remaining - v_apply;

      IF v_remaining > 0.001 THEN
        -- aplicação parcial: o restante vira uma nova linha pendente, mesma origem
        INSERT INTO public.financial_credit_applications (
          module, source_item_id, source_payment_id, amount, status, reason, created_by, metadata
        ) VALUES (
          _module, cr.source_item_id, cr.source_payment_id, v_remaining, 'pending', cr.reason, cr.created_by,
          jsonb_build_object(
            'split_from', v_current_id,
            'note', 'Saldo remanescente de aplicação parcial de crédito'
          )
        )
        RETURNING id INTO v_current_id;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_applied;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Registra um pagamento (baixa) de recebível, com o tratamento do saldo
-- restante (pagamento parcial) ou do excedente (crédito na próxima cobrança
-- ou taxa na cobrança atual), tudo em uma transação.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_receivable_payment(
  _receivable_id uuid,
  _amount numeric,
  _paid_at date,
  _payment_method text,
  _attachment_path text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _remaining_due_date date DEFAULT NULL,
  _remaining_due_reason text DEFAULT NULL,
  _overpayment_action text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_amount numeric := round(_amount, 2);
  v_due numeric;
  v_credit numeric;
  v_already numeric;
  v_new_paid numeric;
  v_effective numeric;
  v_overpaid numeric;
  v_action text;
  v_payment_id uuid;
  v_notes text := NULLIF(btrim(COALESCE(_notes, '')), '');
BEGIN
  PERFORM public.require_gestor();

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Valor pago deve ser maior que zero.';
  END IF;
  IF _paid_at IS NULL THEN
    RAISE EXCEPTION 'Informe a data do pagamento.';
  END IF;

  SELECT * INTO r FROM public.receivables WHERE id = _receivable_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recebível não encontrado.';
  END IF;
  IF r.status = 'cancelado' THEN
    RAISE EXCEPTION 'Este recebível está cancelado e não aceita pagamentos.';
  END IF;

  v_due := COALESCE(r.amount_due, 0);
  v_credit := COALESCE(r.credit_applied_amount, 0);
  SELECT COALESCE(sum(amount), 0) INTO v_already
    FROM public.receivable_payments
   WHERE receivable_id = _receivable_id AND status = 'ativo';
  v_new_paid := v_already + v_amount;
  v_effective := v_new_paid + v_credit;
  v_overpaid := GREATEST(v_effective - v_due, 0);

  IF v_effective < v_due AND _remaining_due_date IS NULL THEN
    RAISE EXCEPTION 'Informe a nova data de vencimento do saldo restante.';
  END IF;

  v_action := NULL;
  IF v_overpaid > 0 THEN
    IF r.kind = 'avulso' THEN
      v_action := 'fee';
    ELSIF _overpayment_action IN ('credit', 'fee') THEN
      v_action := _overpayment_action;
    ELSE
      RAISE EXCEPTION 'Selecione o destino do excedente.';
    END IF;
  END IF;

  INSERT INTO public.receivable_payments (
    receivable_id, amount, paid_at, payment_method, attachment_path, notes, status, created_by
  ) VALUES (
    _receivable_id, v_amount, _paid_at, _payment_method, _attachment_path, v_notes, 'ativo', auth.uid()
  )
  RETURNING id INTO v_payment_id;

  PERFORM public.write_audit('receivable.payment_create', 'receivable', _receivable_id,
    jsonb_build_object('payment_id', v_payment_id, 'amount', v_amount, 'method', _payment_method));

  IF v_action = 'credit' THEN
    UPDATE public.receivables
       SET remaining_due_date = NULL, remaining_due_reason = NULL,
           remaining_due_updated_at = now(), remaining_due_updated_by = auth.uid()
     WHERE id = _receivable_id;
    INSERT INTO public.financial_credit_applications (
      module, source_item_id, source_payment_id, amount, status, reason, created_by
    ) VALUES (
      'receivable', _receivable_id, v_payment_id, v_overpaid, 'pending', v_notes, auth.uid()
    );
    PERFORM public.write_audit('receivable.overpayment_credit_next', 'receivable', _receivable_id,
      jsonb_build_object(
        'payment_id', v_payment_id, 'amount_due_before', v_due, 'payment_amount', v_amount,
        'amount_paid_after', v_new_paid, 'overpaid_amount', v_overpaid, 'overpayment_action', 'credit'
      ));
  ELSIF v_action = 'fee' THEN
    UPDATE public.receivables
       SET amount_due = v_due + v_overpaid,
           remaining_due_date = NULL, remaining_due_reason = NULL,
           remaining_due_updated_at = now(), remaining_due_updated_by = auth.uid()
     WHERE id = _receivable_id;
    PERFORM public.write_audit('receivable.overpayment_current_fee', 'receivable', _receivable_id,
      jsonb_build_object(
        'payment_id', v_payment_id, 'amount_due_before', v_due, 'amount_due_after', v_due + v_overpaid,
        'payment_amount', v_amount, 'amount_paid_after', v_new_paid, 'overpaid_amount', v_overpaid,
        'overpayment_action', 'fee'
      ));
  ELSIF v_effective < v_due THEN
    UPDATE public.receivables
       SET remaining_due_date = _remaining_due_date,
           remaining_due_reason = NULLIF(btrim(COALESCE(_remaining_due_reason, '')), ''),
           remaining_due_updated_at = now(), remaining_due_updated_by = auth.uid()
     WHERE id = _receivable_id;
    PERFORM public.write_audit('receivable.partial_remaining_due_set', 'receivable', _receivable_id,
      jsonb_build_object(
        'payment_id', v_payment_id, 'remaining_due_date', _remaining_due_date,
        'reason', NULLIF(btrim(COALESCE(_remaining_due_reason, '')), '')
      ));
  ELSE
    UPDATE public.receivables
       SET remaining_due_date = NULL, remaining_due_reason = NULL,
           remaining_due_updated_at = now(), remaining_due_updated_by = auth.uid()
     WHERE id = _receivable_id;
  END IF;

  PERFORM public.recompute_receivable_summary(_receivable_id);

  IF v_action = 'credit' THEN
    PERFORM public.apply_pending_credits('receivable');
  END IF;

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'overpaid_amount', v_overpaid,
    'overpayment_action', v_action
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- Núcleo do estorno: cancela os recibos emitidos do pagamento, marca o
-- pagamento como estornado e recalcula o recebível. Uso interno.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_receivable_payment_core(
  _payment_id uuid,
  _reason text,
  _receipt_reason text
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  p record;
  rc record;
  v_receipt_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT * INTO p FROM public.receivable_payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pagamento não encontrado.';
  END IF;
  IF p.status <> 'ativo' THEN
    RAISE EXCEPTION 'Este pagamento não está ativo.';
  END IF;

  FOR rc IN
    UPDATE public.receivable_receipts
       SET status = 'cancelado', cancelled_at = now(), cancelled_by = auth.uid(),
           cancel_reason = _receipt_reason
     WHERE payment_id = _payment_id AND status = 'emitido'
    RETURNING id, receipt_number, receivable_id
  LOOP
    v_receipt_ids := v_receipt_ids || rc.id;
    PERFORM public.write_audit('receivable.receipt_cancel', 'receivable', rc.receivable_id,
      jsonb_build_object('receipt_id', rc.id, 'receipt_number', rc.receipt_number, 'reason', _receipt_reason));
  END LOOP;

  UPDATE public.receivable_payments
     SET status = 'estornado', reversed_at = now(), reversed_by = auth.uid(), reverse_reason = _reason
   WHERE id = _payment_id;

  PERFORM public.recompute_receivable_summary(p.receivable_id);
  RETURN v_receipt_ids;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Estorno de um pagamento de recebível (com o cancelamento do recibo).
-- Pagamentos com tratamento de excedente (crédito/taxa) continuam bloqueados,
-- como já era a regra no app.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_receivable_payment(_payment_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(_reason, '')), '');
  v_receivable_id uuid;
  v_receipt_ids uuid[];
BEGIN
  PERFORM public.require_gestor();
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do estorno.';
  END IF;

  SELECT receivable_id INTO v_receivable_id FROM public.receivable_payments WHERE id = _payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pagamento não encontrado.';
  END IF;
  PERFORM 1 FROM public.receivables WHERE id = v_receivable_id FOR UPDATE;

  IF EXISTS (
       SELECT 1 FROM public.audit_logs
        WHERE entity_type = 'receivable'
          AND action LIKE '%overpayment%'
          AND metadata->>'payment_id' = _payment_id::text
     )
     OR EXISTS (
       SELECT 1 FROM public.financial_credit_applications
        WHERE module = 'receivable'
          AND source_payment_id = _payment_id
          AND status IN ('pending', 'applied')
     ) THEN
    RAISE EXCEPTION 'Este pagamento gerou crédito ou taxa de excedente. Desfaça esse ajuste antes de estornar o pagamento.';
  END IF;

  v_receipt_ids := public.reverse_receivable_payment_core(
    _payment_id, v_reason, 'Estorno do pagamento: ' || v_reason
  );

  PERFORM public.write_audit('receivable.payment_reverse', 'receivable', v_receivable_id,
    jsonb_build_object(
      'payment_id', _payment_id, 'reason', v_reason,
      'receipt_id', v_receipt_ids[1], 'receipt_ids', to_jsonb(v_receipt_ids)
    ));

  RETURN jsonb_build_object('receivable_id', v_receivable_id, 'receipts_cancelled', cardinality(v_receipt_ids));
END;
$function$;

-- ---------------------------------------------------------------------------
-- Cancelamento tipado de recebível. "cobranca_errada" estorna todos os
-- pagamentos ativos e cancela todos os recibos emitidos; "perda_contrato"
-- preserva os pagamentos já recebidos.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_receivable(
  _receivable_id uuid,
  _cancel_type text,
  _reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  p record;
  v_reason text := NULLIF(btrim(COALESCE(_reason, '')), '');
  v_payments integer := 0;
  v_receipts integer := 0;
  v_ids uuid[];
  rc record;
BEGIN
  PERFORM public.require_gestor();
  IF _cancel_type NOT IN ('perda_contrato', 'cobranca_errada') THEN
    RAISE EXCEPTION 'Tipo de cancelamento inválido.';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento.';
  END IF;

  SELECT * INTO r FROM public.receivables WHERE id = _receivable_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recebível não encontrado.';
  END IF;
  IF r.status = 'cancelado' THEN
    RAISE EXCEPTION 'Este recebível já está cancelado.';
  END IF;

  IF _cancel_type = 'cobranca_errada' THEN
    FOR p IN
      SELECT id FROM public.receivable_payments
       WHERE receivable_id = _receivable_id AND status = 'ativo'
       ORDER BY created_at
    LOOP
      v_ids := public.reverse_receivable_payment_core(
        p.id, 'Cobrança errada: ' || v_reason, 'Cobrança errada: ' || v_reason
      );
      v_payments := v_payments + 1;
      v_receipts := v_receipts + cardinality(v_ids);
    END LOOP;

    -- recibo legado, emitido no nível do recebível (sem pagamento vinculado)
    FOR rc IN
      UPDATE public.receivable_receipts
         SET status = 'cancelado', cancelled_at = now(), cancelled_by = auth.uid(),
             cancel_reason = 'Cobrança errada: ' || v_reason
       WHERE receivable_id = _receivable_id AND payment_id IS NULL AND status = 'emitido'
      RETURNING id, receipt_number
    LOOP
      v_receipts := v_receipts + 1;
      PERFORM public.write_audit('receivable.receipt_cancel', 'receivable', _receivable_id,
        jsonb_build_object('receipt_id', rc.id, 'receipt_number', rc.receipt_number,
                           'reason', 'Cobrança errada: ' || v_reason));
    END LOOP;
  END IF;

  UPDATE public.receivables
     SET status = 'cancelado',
         cancel_type = _cancel_type,
         cancel_reason = v_reason,
         cancelled_at = now(),
         cancelled_by = auth.uid()
   WHERE id = _receivable_id;

  PERFORM public.write_audit(
    CASE WHEN _cancel_type = 'perda_contrato' THEN 'receivable.cancel_as_loss'
         ELSE 'receivable.cancel_as_wrong_charge' END,
    'receivable', _receivable_id,
    jsonb_build_object('cancel_type', _cancel_type, 'reason', v_reason,
                       'payments_reversed', v_payments, 'receipts_cancelled', v_receipts));

  RETURN jsonb_build_object('payments_reversed', v_payments, 'receipts_cancelled', v_receipts);
END;
$function$;

-- ---------------------------------------------------------------------------
-- Exclusão de contrato. Contratos com dinheiro recebido ou recibo emitido não
-- podem ser excluídos (a exclusão apagaria pagamentos e recibos em cascata):
-- para esses, o caminho é "Cancelar contrato".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contract_delete_impact(_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_receivables integer;
  v_payments integer;
  v_receipts integer;
  v_paid_legacy integer;
  v_bookings integer;
  v_attachments integer;
BEGIN
  PERFORM public.require_gestor();

  SELECT count(*) INTO v_receivables FROM public.receivables WHERE contract_id = _contract_id;
  SELECT count(*) INTO v_payments
    FROM public.receivable_payments p
    JOIN public.receivables r ON r.id = p.receivable_id
   WHERE r.contract_id = _contract_id AND p.status = 'ativo';
  SELECT count(*) INTO v_receipts
    FROM public.receivable_receipts rr
    JOIN public.receivables r ON r.id = rr.receivable_id
   WHERE r.contract_id = _contract_id AND rr.status = 'emitido';
  -- recebíveis quitados pelo fluxo antigo, sem linha em receivable_payments
  SELECT count(*) INTO v_paid_legacy
    FROM public.receivables r
   WHERE r.contract_id = _contract_id
     AND COALESCE(r.amount_paid, 0) > 0
     AND NOT EXISTS (SELECT 1 FROM public.receivable_payments p WHERE p.receivable_id = r.id);
  SELECT count(*) INTO v_bookings FROM public.bookings WHERE contract_id = _contract_id;
  SELECT count(*) INTO v_attachments FROM public.contract_attachments WHERE contract_id = _contract_id;

  RETURN jsonb_build_object(
    'receivables', v_receivables,
    'payments', v_payments + v_paid_legacy,
    'receipts', v_receipts,
    'bookings', v_bookings,
    'attachments', v_attachments,
    'blocked', (v_payments + v_paid_legacy + v_receipts) > 0
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_contract(_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c record;
  v_impact jsonb;
BEGIN
  PERFORM public.require_gestor();

  SELECT * INTO c FROM public.contracts WHERE id = _contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato não encontrado.';
  END IF;
  PERFORM 1 FROM public.receivables WHERE contract_id = _contract_id FOR UPDATE;

  v_impact := public.contract_delete_impact(_contract_id);
  IF (v_impact->>'blocked')::boolean THEN
    RAISE EXCEPTION 'Este contrato tem % pagamento(s) e % recibo(s) emitido(s). Use "Cancelar contrato" para encerrá-lo sem apagar o histórico financeiro.',
      v_impact->>'payments', v_impact->>'receipts'
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.booking_conflicts bc
   WHERE EXISTS (
     SELECT 1 FROM public.bookings b
      WHERE b.contract_id = _contract_id AND b.id IN (bc.booking_id_a, bc.booking_id_b)
   );
  DELETE FROM public.receivables WHERE contract_id = _contract_id;
  DELETE FROM public.bookings WHERE contract_id = _contract_id;
  DELETE FROM public.contract_schedules WHERE contract_id = _contract_id;
  DELETE FROM public.contract_attachments WHERE contract_id = _contract_id;
  DELETE FROM public.contracts WHERE id = _contract_id;

  PERFORM public.write_audit('contract.delete', 'contract', _contract_id,
    jsonb_build_object('professional_id', c.professional_id, 'impact', v_impact));

  RETURN v_impact;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Permissões: funções internas não ficam expostas pela API.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.require_gestor() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.write_audit(text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reverse_receivable_payment_core(uuid, text, text) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.recompute_receivable_summary(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.apply_pending_credits(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.register_receivable_payment(uuid, numeric, date, text, text, text, date, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reverse_receivable_payment(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_receivable(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.contract_delete_impact(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_contract(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.recompute_receivable_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_pending_credits(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_receivable_payment(uuid, numeric, date, text, text, text, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_receivable_payment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_receivable(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contract_delete_impact(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_contract(uuid) TO authenticated;
