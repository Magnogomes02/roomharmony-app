
-- ============================================================
-- SECURITY HARDENING
-- ============================================================

-- 1. professionals: restrict broad read
DROP POLICY IF EXISTS "professionals read auth" ON public.professionals;

CREATE POLICY "professionals gestor read"
  ON public.professionals FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'gestor'::app_role));

CREATE POLICY "professionals visualizador read"
  ON public.professionals FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'visualizador'::app_role));

CREATE POLICY "professionals self read"
  ON public.professionals FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.professional_id = professionals.id
  ));

-- 2. contract_attachments: restrict broad read
DROP POLICY IF EXISTS "attachments read auth" ON public.contract_attachments;

CREATE POLICY "attachments gestor read"
  ON public.contract_attachments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'gestor'::app_role));

CREATE POLICY "attachments visualizador read"
  ON public.contract_attachments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'visualizador'::app_role));

CREATE POLICY "attachments professional read own"
  ON public.contract_attachments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.professional_id = contract_attachments.professional_id
  ));

-- 3. storage.objects: contract-attachments bucket — restrict SELECT
DROP POLICY IF EXISTS "contract attachments read auth" ON storage.objects;

CREATE POLICY "contract attachments gestor read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'contract-attachments' AND public.has_role(auth.uid(), 'gestor'::app_role));

CREATE POLICY "contract attachments visualizador read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'contract-attachments' AND public.has_role(auth.uid(), 'visualizador'::app_role));

-- Professional can read files under their own professional_id folder
CREATE POLICY "contract attachments professional read own"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'contract-attachments'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.professional_id)::text = (storage.foldername(name))[1]
    )
  );

-- Professional can read their own receipts (path: receipts/{receivable_id}/...)
CREATE POLICY "contract attachments professional read receipts"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'contract-attachments'
    AND (storage.foldername(name))[1] = 'receipts'
    AND EXISTS (
      SELECT 1
      FROM public.receivables r
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE r.id::text = (storage.foldername(name))[2]
        AND p.professional_id = r.professional_id
    )
  );

-- 4. contract_schedules: restrict broad read
DROP POLICY IF EXISTS "schedules read auth" ON public.contract_schedules;

CREATE POLICY "schedules gestor read"
  ON public.contract_schedules FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'gestor'::app_role));

CREATE POLICY "schedules visualizador read"
  ON public.contract_schedules FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'visualizador'::app_role));

CREATE POLICY "schedules professional read own"
  ON public.contract_schedules FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.contracts c
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE c.id = contract_schedules.contract_id
      AND p.professional_id = c.professional_id
  ));

-- 5. booking_conflicts: restrict to gestor / visualizador / involved professional
DROP POLICY IF EXISTS "conflicts read auth" ON public.booking_conflicts;

CREATE POLICY "conflicts gestor read"
  ON public.booking_conflicts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'gestor'::app_role));

CREATE POLICY "conflicts visualizador read"
  ON public.booking_conflicts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'visualizador'::app_role));

CREATE POLICY "conflicts professional read own"
  ON public.booking_conflicts FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.bookings b
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE (b.id = booking_conflicts.booking_id_a OR b.id = booking_conflicts.booking_id_b)
      AND p.professional_id = b.professional_id
  ));

-- 6. contracts: prevent professionals from updating non-signature columns
CREATE OR REPLACE FUNCTION public.enforce_contract_professional_sign_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Gestores may update anything
  IF public.has_role(auth.uid(), 'gestor'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Non-gestores (e.g. professionals signing their own contract) may
  -- only modify signature-related columns. Any change to other columns
  -- is rejected to prevent privilege escalation.
  IF NEW.professional_id IS DISTINCT FROM OLD.professional_id
     OR NEW.room_id IS DISTINCT FROM OLD.room_id
     OR NEW.start_date IS DISTINCT FROM OLD.start_date
     OR NEW.end_date IS DISTINCT FROM OLD.end_date
     OR NEW.monthly_value IS DISTINCT FROM OLD.monthly_value
     OR NEW.due_day IS DISTINCT FROM OLD.due_day
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.template_id IS DISTINCT FROM OLD.template_id
     OR NEW.locador_name IS DISTINCT FROM OLD.locador_name
     OR NEW.extra_clauses IS DISTINCT FROM OLD.extra_clauses
     OR NEW.notes IS DISTINCT FROM OLD.notes
  THEN
    RAISE EXCEPTION 'Apenas gestores podem alterar dados contratuais. Profissionais só podem assinar.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_contract_professional_sign_scope ON public.contracts;
CREATE TRIGGER trg_enforce_contract_professional_sign_scope
  BEFORE UPDATE ON public.contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_contract_professional_sign_scope();

-- 7. Revoke EXECUTE on SECURITY DEFINER functions that should not be RPC-callable
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_contract_activated() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_overdue_receivables() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_contract_receivables(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_contract_professional_sign_scope() FROM anon, authenticated;

-- regenerate_contract_receivables is called from the app — restrict to gestor inside the function
CREATE OR REPLACE FUNCTION public.regenerate_contract_receivables(_contract_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'gestor'::app_role) THEN
    RAISE EXCEPTION 'Apenas gestores podem regerar parcelas.' USING ERRCODE = '42501';
  END IF;
  RETURN public.generate_contract_receivables(_contract_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.regenerate_contract_receivables(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.regenerate_contract_receivables(uuid) TO authenticated;
