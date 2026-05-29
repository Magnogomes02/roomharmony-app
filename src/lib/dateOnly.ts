/**
 * Helpers para datas "date-only" (YYYY-MM-DD).
 *
 * O problema: `new Date("2026-06-01")` é interpretado como UTC midnight.
 * No fuso do Brasil (UTC-3) isso vira 31/05/2026 21:00, e qualquer
 * `.toLocaleDateString("pt-BR")` exibe o dia anterior.
 *
 * A solução é parsear a string como horário LOCAL ao meio-dia, evitando
 * tanto o deslocamento de fuso quanto efeitos de horário de verão.
 */

export function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function parseDateOnlyLocal(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function formatDateOnlyBR(value?: string | null): string {
  if (!value) return "";
  const d = parseDateOnlyLocal(value);
  return d.toLocaleDateString("pt-BR");
}

export function formatDateTimeBR(value?: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("pt-BR");
}

export function formatAnyDateBR(value?: string | null): string {
  if (!value) return "";
  return isDateOnly(value) ? formatDateOnlyBR(value) : formatDateTimeBR(value);
}

export function getMonthIndexFromDateOnly(value: string): number {
  const [, month] = value.slice(0, 10).split("-").map(Number);
  return month - 1;
}

export function getYearFromDateOnly(value: string): number {
  const [year] = value.slice(0, 10).split("-").map(Number);
  return year;
}

export function toDateOnlyString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
