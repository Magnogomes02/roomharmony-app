
-- ============ ENUMS ============
create type public.app_role as enum ('gestor', 'profissional', 'visualizador');

-- ============ PROFILES ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  professional_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- ============ USER ROLES ============
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique(user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

-- ============ TRIGGER: NEW USER ============
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email
  );
  insert into public.user_roles (user_id, role) values (new.id, 'visualizador');
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ============ UPDATED_AT HELPER ============
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

-- ============ PROFESSIONALS ============
create table public.professionals (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  cpf text,
  registry text,
  specialty text,
  phone text,
  email text,
  address text,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.professionals enable row level security;
create trigger trg_professionals_updated before update on public.professionals
  for each row execute function public.set_updated_at();

-- ============ ROOMS ============
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  capacity integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rooms enable row level security;
create trigger trg_rooms_updated before update on public.rooms
  for each row execute function public.set_updated_at();

-- ============ CONTRACTS ============
create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete restrict,
  room_id uuid not null references public.rooms(id) on delete restrict,
  start_date date not null,
  end_date date,
  monthly_value numeric(10,2) not null default 0,
  status text not null default 'rascunho',
  notes text,
  extra_clauses text,
  signed_at timestamptz,
  signed_by_name text,
  signature_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.contracts enable row level security;
create trigger trg_contracts_updated before update on public.contracts
  for each row execute function public.set_updated_at();

-- ============ CONTRACT SCHEDULES ============
create table public.contract_schedules (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  weekday integer not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  room_id uuid not null references public.rooms(id) on delete restrict,
  created_at timestamptz not null default now()
);
alter table public.contract_schedules enable row level security;

-- ============ BOOKINGS ============
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid references public.contracts(id) on delete set null,
  professional_id uuid not null references public.professionals(id) on delete restrict,
  room_id uuid not null references public.rooms(id) on delete restrict,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'ativa',
  source text not null default 'recorrencia',
  reallocated_from uuid references public.bookings(id),
  reallocated_to uuid references public.bookings(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.bookings enable row level security;
create trigger trg_bookings_updated before update on public.bookings
  for each row execute function public.set_updated_at();

-- ============ BOOKING CONFLICTS ============
create table public.booking_conflicts (
  id uuid primary key default gen_random_uuid(),
  booking_id_a uuid not null references public.bookings(id) on delete cascade,
  booking_id_b uuid not null references public.bookings(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete restrict,
  status text not null default 'pendente',
  resolution_notes text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.booking_conflicts enable row level security;

-- ============ SETTINGS ============
create table public.settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.settings enable row level security;

-- ============ AUDIT LOGS ============
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);
alter table public.audit_logs enable row level security;

-- ============ NOTIFICATION QUEUE ============
create table public.notification_queue (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  recipient text not null,
  subject text,
  message text not null,
  status text not null default 'pendente',
  metadata jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.notification_queue enable row level security;

-- ============ RLS POLICIES ============

-- profiles: usuário vê o próprio; gestor vê todos
create policy "profiles self read" on public.profiles for select using (auth.uid() = id);
create policy "profiles gestor read" on public.profiles for select using (public.has_role(auth.uid(), 'gestor'));
create policy "profiles self update" on public.profiles for update using (auth.uid() = id);
create policy "profiles gestor update" on public.profiles for update using (public.has_role(auth.uid(), 'gestor'));

-- user_roles: gestor lê e gerencia; usuário vê o próprio
create policy "roles self read" on public.user_roles for select using (auth.uid() = user_id);
create policy "roles gestor all" on public.user_roles for all
  using (public.has_role(auth.uid(), 'gestor'))
  with check (public.has_role(auth.uid(), 'gestor'));

-- professionals: leitura para autenticados; escrita só gestor
create policy "professionals read auth" on public.professionals for select to authenticated using (true);
create policy "professionals gestor write" on public.professionals for all
  using (public.has_role(auth.uid(), 'gestor'))
  with check (public.has_role(auth.uid(), 'gestor'));

-- rooms: leitura autenticada; escrita só gestor
create policy "rooms read auth" on public.rooms for select to authenticated using (true);
create policy "rooms gestor write" on public.rooms for all
  using (public.has_role(auth.uid(), 'gestor'))
  with check (public.has_role(auth.uid(), 'gestor'));

-- contracts: gestor tudo; profissional vê e assina os seus
create policy "contracts gestor all" on public.contracts for all
  using (public.has_role(auth.uid(), 'gestor'))
  with check (public.has_role(auth.uid(), 'gestor'));
create policy "contracts professional read" on public.contracts for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.professional_id = contracts.professional_id)
);
create policy "contracts professional sign" on public.contracts for update using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.professional_id = contracts.professional_id)
);
create policy "contracts visualizador read" on public.contracts for select using (public.has_role(auth.uid(), 'visualizador'));

-- contract_schedules: gestor tudo; demais leem
create policy "schedules read auth" on public.contract_schedules for select to authenticated using (true);
create policy "schedules gestor write" on public.contract_schedules for all
  using (public.has_role(auth.uid(), 'gestor'))
  with check (public.has_role(auth.uid(), 'gestor'));

-- bookings: gestor tudo; profissional vê os seus; visualizador lê
create policy "bookings gestor all" on public.bookings for all
  using (public.has_role(auth.uid(), 'gestor'))
  with check (public.has_role(auth.uid(), 'gestor'));
create policy "bookings professional read" on public.bookings for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.professional_id = bookings.professional_id)
);
create policy "bookings visualizador read" on public.bookings for select using (public.has_role(auth.uid(), 'visualizador'));

-- booking_conflicts: gestor tudo; outros leem
create policy "conflicts read auth" on public.booking_conflicts for select to authenticated using (true);
create policy "conflicts gestor write" on public.booking_conflicts for all
  using (public.has_role(auth.uid(), 'gestor'))
  with check (public.has_role(auth.uid(), 'gestor'));

-- settings: leitura autenticada; escrita só gestor
create policy "settings read auth" on public.settings for select to authenticated using (true);
create policy "settings gestor write" on public.settings for all
  using (public.has_role(auth.uid(), 'gestor'))
  with check (public.has_role(auth.uid(), 'gestor'));

-- audit_logs: gestor lê; qualquer autenticado pode inserir (sistema)
create policy "audit gestor read" on public.audit_logs for select using (public.has_role(auth.uid(), 'gestor'));
create policy "audit insert auth" on public.audit_logs for insert to authenticated with check (true);

-- notification_queue: gestor lê e gerencia
create policy "notif gestor all" on public.notification_queue for all
  using (public.has_role(auth.uid(), 'gestor'))
  with check (public.has_role(auth.uid(), 'gestor'));

-- ============ SEED: ROOMS ============
insert into public.rooms (name, description, capacity) values
  ('Sala 01', 'Sala equipada para atendimentos clínicos individuais', 2),
  ('Sala 02', 'Sala ampla para fisioterapia e reabilitação', 4),
  ('Sala 03', 'Sala reservada para consultas de nutrição', 2);

-- ============ SEED: PROFESSIONALS ============
insert into public.professionals (full_name, cpf, registry, specialty, phone, email, active) values
  ('Dra. Ana Costa', '111.222.333-44', 'CRP 06/12345', 'Psicologia', '(81) 90000-0001', 'ana.costa@versaosaude.com', true),
  ('Dr. Bruno Lima', '222.333.444-55', 'CREFITO 8/1234-F', 'Fisioterapia', '(81) 90000-0002', 'bruno.lima@versaosaude.com', true),
  ('Dra. Carla Mendes', '333.444.555-66', 'CRN 6789', 'Nutrição', '(81) 90000-0003', 'carla.mendes@versaosaude.com', true);

-- ============ SEED: SETTINGS ============
insert into public.settings (key, value) values
  ('system', jsonb_build_object(
    'timezone', 'America/Recife',
    'schedule_window_days', 60,
    'business_start', '07:00',
    'business_end', '21:00',
    'notify_email', true,
    'notify_telegram', false,
    'manual_dst_adjust', false
  ));

-- ============ SEED: USUÁRIOS DEMO ============
do $$
declare
  v_gestor uuid := gen_random_uuid();
  v_prof   uuid := gen_random_uuid();
  v_view   uuid := gen_random_uuid();
  v_prof_pro uuid;
begin
  select id into v_prof_pro from public.professionals where email = 'ana.costa@versaosaude.com' limit 1;

  -- Gestor
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data, raw_app_meta_data, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_gestor, 'authenticated', 'authenticated', 'gestor@versaosaude.com', crypt('senha123', gen_salt('bf')), now(), now(), now(), jsonb_build_object('full_name','Gestor Demo'), jsonb_build_object('provider','email','providers',array['email']), '', '', '', '');
  insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_gestor, jsonb_build_object('sub', v_gestor::text, 'email', 'gestor@versaosaude.com', 'email_verified', true), 'email', v_gestor::text, now(), now(), now());
  delete from public.user_roles where user_id = v_gestor;
  insert into public.user_roles (user_id, role) values (v_gestor, 'gestor');

  -- Profissional (vinculado a Dra. Ana)
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data, raw_app_meta_data, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_prof, 'authenticated', 'authenticated', 'profissional@versaosaude.com', crypt('senha123', gen_salt('bf')), now(), now(), now(), jsonb_build_object('full_name','Dra. Ana Costa'), jsonb_build_object('provider','email','providers',array['email']), '', '', '', '');
  insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_prof, jsonb_build_object('sub', v_prof::text, 'email', 'profissional@versaosaude.com', 'email_verified', true), 'email', v_prof::text, now(), now(), now());
  delete from public.user_roles where user_id = v_prof;
  insert into public.user_roles (user_id, role) values (v_prof, 'profissional');
  update public.profiles set professional_id = v_prof_pro where id = v_prof;

  -- Visualizador
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data, raw_app_meta_data, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_view, 'authenticated', 'authenticated', 'visualizador@versaosaude.com', crypt('senha123', gen_salt('bf')), now(), now(), now(), jsonb_build_object('full_name','Visualizador Demo'), jsonb_build_object('provider','email','providers',array['email']), '', '', '', '');
  insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_view, jsonb_build_object('sub', v_view::text, 'email', 'visualizador@versaosaude.com', 'email_verified', true), 'email', v_view::text, now(), now(), now());
  -- já tem role visualizador padrão
end $$;
