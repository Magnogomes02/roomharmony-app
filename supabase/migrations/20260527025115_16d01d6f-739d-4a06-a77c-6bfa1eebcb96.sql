
CREATE OR REPLACE FUNCTION public.mark_overdue_receivables()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE receivables
     SET status = 'atrasado',
         updated_at = now()
   WHERE status = 'a_receber'
     AND due_date < CURRENT_DATE;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_contract_receivables(_contract_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Resolve a sala efetiva: se o contrato não tiver sala, buscar na grade.
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
    INSERT INTO receivables (kind, contract_id, professional_id, room_id, reference_month, due_date, amount_due)
    VALUES ('contrato', c.id, c.professional_id, resolved_room_id, cursor_month, due, c.monthly_value)
    ON CONFLICT (contract_id, reference_month) DO NOTHING;
    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    cursor_month := (cursor_month + INTERVAL '1 month')::date;
  END LOOP;

  RETURN inserted_count;
END;
$$;
