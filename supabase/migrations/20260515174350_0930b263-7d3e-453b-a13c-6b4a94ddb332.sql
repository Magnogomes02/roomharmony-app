
drop policy if exists "audit insert auth" on public.audit_logs;
create policy "audit insert self" on public.audit_logs for insert to authenticated
  with check (actor_id = auth.uid());
