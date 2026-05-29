
-- Postgres grants EXECUTE to PUBLIC by default. Revoking from anon/authenticated
-- alone is not enough; we must also revoke from PUBLIC for the linter and
-- runtime exposure to be fully closed.

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.on_contract_activated() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_overdue_receivables() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_contract_receivables(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_contract_professional_sign_scope() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;

-- regenerate_contract_receivables is intentionally callable by signed-in users
-- (with an in-function gestor check), so we keep it granted to authenticated only.
REVOKE EXECUTE ON FUNCTION public.regenerate_contract_receivables(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regenerate_contract_receivables(uuid) TO authenticated;
