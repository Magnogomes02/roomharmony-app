
-- Public bucket for clinic branding (logo)
insert into storage.buckets (id, name, public)
values ('clinic-assets', 'clinic-assets', true)
on conflict (id) do nothing;

-- Policies: anyone can read; only gestor can write
create policy "clinic-assets public read"
on storage.objects for select
using (bucket_id = 'clinic-assets');

create policy "clinic-assets gestor insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'clinic-assets' and public.has_role(auth.uid(), 'gestor'));

create policy "clinic-assets gestor update"
on storage.objects for update to authenticated
using (bucket_id = 'clinic-assets' and public.has_role(auth.uid(), 'gestor'));

create policy "clinic-assets gestor delete"
on storage.objects for delete to authenticated
using (bucket_id = 'clinic-assets' and public.has_role(auth.uid(), 'gestor'));
