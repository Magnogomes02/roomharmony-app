-- 1.1 Remove unique constraints on (contract_id, reference_month)
do $$
declare
  cname text;
begin
  for cname in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'receivables'
      and con.contype = 'u'
      and (
        select array_agg(att.attname::text order by att.attname::text)
        from unnest(con.conkey) as cols(attnum)
        join pg_attribute att on att.attrelid = rel.oid and att.attnum = cols.attnum
      ) = array['contract_id', 'reference_month']::text[]
  loop
    execute format('alter table public.receivables drop constraint if exists %I', cname);
  end loop;
end $$;

do $$
declare
  iname text;
begin
  for iname in
    select i.relname
    from pg_index ix
    join pg_class i on i.oid = ix.indexrelid
    join pg_class t on t.oid = ix.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'receivables'
      and ix.indisunique = true
      and not exists (
        select 1 from pg_constraint c where c.conindid = ix.indexrelid
      )
      and (
        select array_agg(a.attname::text order by a.attname::text)
        from unnest(ix.indkey) with ordinality as k(attnum, ord)
        join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
      ) = array['contract_id', 'reference_month']::text[]
  loop
    execute format('drop index if exists public.%I', iname);
  end loop;
end $$;

-- 1.2 status parcial
do $$
declare
  cname text;
begin
  for cname in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'receivables'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.receivables drop constraint if exists %I', cname);
  end loop;
end $$;

alter table public.receivables
  add constraint receivables_status_check
  check (status in ('a_receber', 'parcial', 'recebido', 'atrasado', 'cancelado'));

-- 1.3 generate_contract_receivables sem ON CONFLICT
CREATE OR REPLACE FUNCTION public.generate_contract_receivables(_contract_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c record;
  cursor_month date;
  last_month date;
  due date;
  inserted_count integer := 0;
  schedule_room_id uuid;
  distinct_rooms integer;
  resolved_room_id uuid;
BEGIN
  SELECT * INTO c FROM contracts WHERE id = _contract_id;
  IF NOT FOUND OR c.monthly_value IS NULL OR c.monthly_value <= 0 THEN
    RETURN 0;
  END IF;

  IF c.room_id IS NOT NULL THEN
    resolved_room_id := c.room_id;
  ELSE
    SELECT COUNT(DISTINCT room_id)
      INTO distinct_rooms
      FROM contract_schedules
     WHERE contract_id = _contract_id
       AND room_id IS NOT NULL;

    IF distinct_rooms = 1 THEN
      SELECT room_id
        INTO schedule_room_id
        FROM contract_schedules
       WHERE contract_id = _contract_id
         AND room_id IS NOT NULL
       LIMIT 1;
      resolved_room_id := schedule_room_id;
    ELSE
      resolved_room_id := NULL;
    END IF;
  END IF;

  cursor_month := date_trunc('month', c.start_date)::date;
  IF c.end_date IS NOT NULL THEN
    last_month := date_trunc('month', c.end_date)::date;
  ELSE
    last_month := date_trunc('month', (CURRENT_DATE + INTERVAL '12 months'))::date;
  END IF;

  WHILE cursor_month <= last_month LOOP
    due := (cursor_month + (LEAST(c.due_day, 28) - 1) * INTERVAL '1 day')::date;

    IF NOT EXISTS (
      SELECT 1 FROM public.receivables r
       WHERE r.contract_id = c.id
         AND r.reference_month = cursor_month
    ) THEN
      INSERT INTO receivables (kind, contract_id, professional_id, room_id, reference_month, due_date, amount_due)
      VALUES ('contrato', c.id, c.professional_id, resolved_room_id, cursor_month, due, c.monthly_value);
      inserted_count := inserted_count + 1;
    END IF;

    cursor_month := (cursor_month + INTERVAL '1 month')::date;
  END LOOP;

  RETURN inserted_count;
END;
$function$;

-- 1.4 receivable_rooms
CREATE TABLE IF NOT EXISTS public.receivable_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receivable_id uuid NOT NULL REFERENCES public.receivables(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (receivable_id, room_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.receivable_rooms TO authenticated;
GRANT ALL ON public.receivable_rooms TO service_role;

ALTER TABLE public.receivable_rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "receivable_rooms gestor all"
  ON public.receivable_rooms FOR ALL
  USING (public.has_role(auth.uid(), 'gestor'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'gestor'::app_role));

CREATE POLICY "receivable_rooms visualizador read"
  ON public.receivable_rooms FOR SELECT
  USING (public.has_role(auth.uid(), 'visualizador'::app_role));

CREATE POLICY "receivable_rooms professional read own"
  ON public.receivable_rooms FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.receivables rec
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE rec.id = receivable_rooms.receivable_id
      AND p.professional_id = rec.professional_id
  ));

CREATE INDEX IF NOT EXISTS idx_receivable_rooms_receivable
  ON public.receivable_rooms(receivable_id);
CREATE INDEX IF NOT EXISTS idx_receivable_rooms_room
  ON public.receivable_rooms(room_id);

-- 1.5 snapshot salas no recibo
ALTER TABLE public.receivable_receipts
  ADD COLUMN IF NOT EXISTS room_names_snapshot text;
