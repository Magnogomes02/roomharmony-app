alter table public.rooms add column if not exists color_hex text;
alter table public.rooms add column if not exists sort_order integer;
alter table public.professionals add column if not exists color_hex text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'rooms_color_hex_format') then
    alter table public.rooms add constraint rooms_color_hex_format
      check (color_hex is null or color_hex ~ '^#[0-9A-Fa-f]{6}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'professionals_color_hex_format') then
    alter table public.professionals add constraint professionals_color_hex_format
      check (color_hex is null or color_hex ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end $$;

create index if not exists idx_rooms_sort_order_name on public.rooms (sort_order, name);