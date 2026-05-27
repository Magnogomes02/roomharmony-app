-- =====================================================================
-- REGERAR RECEBÍVEIS DE TESTE A PARTIR DOS CONTRATOS ATIVOS
-- =====================================================================
-- Para uso em DEV / HOMOLOGAÇÃO após o reset_test_financial_data.sql.
-- Gera parcelas para cada contrato ativo e marca os recebíveis vencidos.
-- =====================================================================

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.contracts WHERE status = 'ativo' LOOP
    PERFORM public.generate_contract_receivables(r.id);
  END LOOP;
  PERFORM public.mark_overdue_receivables();
END $$;
