-- O indice unico antigo bloqueava mais de 1 recibo "emitido" por
-- receivable_id, mesmo apos a introducao de payment_id (1 recibo por
-- pagamento). Substitui por dois indices: um para recibos novos
-- (por payment_id) e um para recibos legados (sem payment_id).

DROP INDEX IF EXISTS public.idx_receivable_receipts_one_active;

CREATE UNIQUE INDEX IF NOT EXISTS idx_receivable_receipts_one_active_per_payment
  ON public.receivable_receipts(payment_id)
  WHERE status = 'emitido' AND payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_receivable_receipts_one_active_legacy
  ON public.receivable_receipts(receivable_id)
  WHERE status = 'emitido' AND payment_id IS NULL;
