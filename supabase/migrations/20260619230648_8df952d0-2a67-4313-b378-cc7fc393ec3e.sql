CREATE UNIQUE INDEX IF NOT EXISTS idx_payables_unique_recurrence_month
ON public.payables(parent_payable_id, reference_month)
WHERE parent_payable_id IS NOT NULL;