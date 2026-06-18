-- Fix generate_contract_receivables to populate receivable_rooms
-- and backfill existing receivables that are missing entries

-- 1. Replace function to insert into receivable_rooms after each receivable
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
  new_receivable_id uuid;
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
      VALUES ('contrato', c.id, c.professional_id, resolved_room_id, cursor_month, due, c.monthly_value)
      RETURNING id INTO new_receivable_id;

      -- Populate receivable_rooms from contract_schedules (all rooms)
      INSERT INTO receivable_rooms (receivable_id, room_id)
      SELECT new_receivable_id, cs.room_id
        FROM contract_schedules cs
       WHERE cs.contract_id = _contract_id
         AND cs.room_id IS NOT NULL
       GROUP BY cs.room_id
      ON CONFLICT (receivable_id, room_id) DO NOTHING;

      -- Also cover legacy contracts that use contracts.room_id directly
      IF resolved_room_id IS NOT NULL THEN
        INSERT INTO receivable_rooms (receivable_id, room_id)
        VALUES (new_receivable_id, resolved_room_id)
        ON CONFLICT (receivable_id, room_id) DO NOTHING;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.receivable_rooms WHERE receivable_id = new_receivable_id
      ) THEN
        RAISE EXCEPTION 'Falha ao vincular salas ao recebível %. Operação revertida.', new_receivable_id;
      END IF;

      inserted_count := inserted_count + 1;
    END IF;

    cursor_month := (cursor_month + INTERVAL '1 month')::date;
  END LOOP;

  RETURN inserted_count;
END;
$function$;

-- 2. Backfill receivable_rooms for existing contract receivables
INSERT INTO public.receivable_rooms (receivable_id, room_id)
SELECT DISTINCT r.id, cs.room_id
  FROM public.receivables r
  JOIN public.contract_schedules cs ON cs.contract_id = r.contract_id
 WHERE r.kind = 'contrato'
   AND r.contract_id IS NOT NULL
   AND cs.room_id IS NOT NULL
ON CONFLICT (receivable_id, room_id) DO NOTHING;

-- Backfill from receivables.room_id for rows not covered by schedules
INSERT INTO public.receivable_rooms (receivable_id, room_id)
SELECT r.id, r.room_id
  FROM public.receivables r
 WHERE r.kind = 'contrato'
   AND r.room_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.receivable_rooms rr WHERE rr.receivable_id = r.id
   )
ON CONFLICT (receivable_id, room_id) DO NOTHING;
