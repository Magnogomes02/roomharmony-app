
-- 1. Define search_path explícito em set_updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin new.updated_at = now(); return new; end;
$$;

-- 2. Restringir execução das funções SECURITY DEFINER
revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- 3. Política de assinatura: adiciona WITH CHECK restritivo
drop policy if exists "contracts professional sign" on public.contracts;
create policy "contracts professional sign" on public.contracts for update
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.professional_id = contracts.professional_id)
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.professional_id = contracts.professional_id)
  );
