
-- 1. app_admins table (owner emails)
CREATE TABLE IF NOT EXISTS public.app_admins (
  email text PRIMARY KEY,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.app_admins TO authenticated;
GRANT ALL ON public.app_admins TO service_role;

ALTER TABLE public.app_admins ENABLE ROW LEVEL SECURITY;

-- only authenticated owners can see the list; nobody can write from client
DROP POLICY IF EXISTS "app_admins owner read" ON public.app_admins;
CREATE POLICY "app_admins owner read" ON public.app_admins
  FOR SELECT TO authenticated
  USING (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- 2. Seed the principal owner email
INSERT INTO public.app_admins (email, active)
VALUES ('gestor@versaosaude.com', true)
ON CONFLICT (email) DO UPDATE SET active = true;

-- 3. is_owner_admin()
CREATE OR REPLACE FUNCTION public.is_owner_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_admins a
    WHERE lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      AND a.active = true
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_owner_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_owner_admin() TO authenticated, service_role;

-- 4. Update has_role to short-circuit for owner admins
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (
      _user_id = auth.uid()
      AND _role = 'gestor'::app_role
      AND public.is_owner_admin()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _user_id AND role = _role
    );
$$;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;

-- 5. ensure_owner_access() RPC: self-heal the owner profile + gestor role
CREATE OR REPLACE FUNCTION public.ensure_owner_access()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_is_owner boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.app_admins a
    WHERE lower(a.email) = v_email AND a.active = true
  ) INTO v_is_owner;

  IF NOT v_is_owner THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_owner', 'email', v_email);
  END IF;

  -- ensure profile exists (do not overwrite role/data beyond email/full_name)
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (v_uid, coalesce(auth.jwt() ->> 'full_name', v_email), v_email)
  ON CONFLICT (id) DO NOTHING;

  -- ensure gestor role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_uid, 'gestor'::app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'is_owner', true, 'role', 'gestor');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_owner_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_owner_access() TO authenticated;

-- 6. Make sure user_roles unique constraint exists for ON CONFLICT to work
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_roles_user_id_role_key'
  ) THEN
    ALTER TABLE public.user_roles
      ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);
  END IF;
END $$;

-- 7. Belt-and-suspenders: make sure handle_new_user does NOT downgrade an existing owner role.
--    (Current trigger inserts visualizador on signup; for the owner, ensure_owner_access fixes it post-login.
--     We just guard against duplicate inserts breaking signup if user already exists.)
