-- =====================================================================
-- RESET DE DADOS FINANCEIROS DE TESTE  (DEV / HOMOLOGAÇÃO APENAS)
-- =====================================================================
-- ATENÇÃO: este script apaga dados operacionais. NÃO rodar em produção.
-- Executar manualmente quando o gestor quiser zerar a base de testes.
--
-- Apaga:
--   - recibos (receivable_receipts)
--   - recebíveis (receivables)
--   - conflitos e reservas (booking_conflicts, bookings)
--
-- Preserva:
--   - profiles, user_roles, settings
--   - professionals, rooms
--   - contracts e contract_schedules
-- =====================================================================

TRUNCATE TABLE public.receivable_receipts RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.receivables RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.booking_conflicts RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.bookings RESTART IDENTITY CASCADE;
