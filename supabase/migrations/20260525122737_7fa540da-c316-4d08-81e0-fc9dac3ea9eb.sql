-- Sala deixa de ser obrigatória no contrato (grade multi-sala assume)
ALTER TABLE public.contracts ALTER COLUMN room_id DROP NOT NULL;

-- Índice para detecção rápida de conflitos por sala/janela
CREATE INDEX IF NOT EXISTS idx_bookings_room_time ON public.bookings (room_id, start_at, end_at) WHERE status <> 'cancelada';

-- Unicidade para evitar duplicar geração de uma mesma ocorrência (contrato + sala + início)
CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_contract_room_start
  ON public.bookings (contract_id, room_id, start_at)
  WHERE contract_id IS NOT NULL;

-- Unicidade para evitar duplicar registro de conflito entre o mesmo par
CREATE UNIQUE INDEX IF NOT EXISTS uq_conflict_pair
  ON public.booking_conflicts (LEAST(booking_id_a, booking_id_b), GREATEST(booking_id_a, booking_id_b));
