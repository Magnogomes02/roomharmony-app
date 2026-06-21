import { startOfMonth, endOfMonth, getDaysInMonth } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toDateOnlyString } from "@/lib/dateOnly";

export type PayableStatus = "a_pagar" | "parcial" | "pago" | "atrasado" | "cancelado";

// Recalcula due_date para um reference_month (YYYY-MM-01) dado um novo dia de
// recorrência, espelhando o mesmo clamp usado em generateRecurringForMonth.
export function buildDueDateForMonth(referenceMonth: string, day: number): string {
  const [yearStr, monthStr] = referenceMonth.slice(0, 7).split("-");
  const year = Number(yearStr);
  const monthIdx = Number(monthStr) - 1;
  const clampedDay = Math.min(day, getDaysInMonth(new Date(year, monthIdx)));
  return `${yearStr}-${monthStr}-${String(clampedDay).padStart(2, "0")}`;
}

interface PayableStatusInput {
  status: string;
  amount_due: number;
  amount_paid: number | null;
  due_date: string;
  credit_applied_amount?: number | null;
  remaining_due_date?: string | null;
}

export function computeEffectiveStatus(p: PayableStatusInput): PayableStatus {
  if (p.status === "cancelado") return "cancelado";
  const paid = Number(p.amount_paid ?? 0);
  const credit = Number(p.credit_applied_amount ?? 0);
  const due = Number(p.amount_due);
  const effectivePaid = paid + credit;
  if (effectivePaid >= due) return "pago";
  const today = toDateOnlyString(new Date());
  if (effectivePaid > 0) {
    const refDate = p.remaining_due_date || p.due_date;
    if (refDate < today) return "atrasado";
    return "parcial";
  }
  // sem pagamento/crédito
  if (p.due_date < today) return "atrasado";
  return "a_pagar";
}

// Auto-generates recurring payable instances for `month` if they don't exist yet.
// Templates are recorrentes with parent_payable_id = null (the originating entry).
// Only generates from the template's own reference_month forward (never backfills earlier months).
export async function generateRecurringForMonth(month: Date): Promise<void> {
  const monthStart = toDateOnlyString(startOfMonth(month));
  const monthEnd = toDateOnlyString(endOfMonth(month));
  const year = month.getFullYear();
  const monthIdx = month.getMonth();

  const { data: templates, error: tplErr } = await supabase
    .from("payables")
    .select("id,description,supplier,category,amount_due,recurrence_day,notes,kind,status,reference_month")
    .eq("kind", "recorrente")
    .is("parent_payable_id", null)
    .neq("status", "cancelado")
    .lte("reference_month", monthStart);
  if (tplErr) throw tplErr;
  if (!templates || templates.length === 0) return;

  const { data: existing, error: exErr } = await supabase
    .from("payables")
    .select("parent_payable_id")
    .gte("reference_month", monthStart)
    .lte("reference_month", monthEnd)
    .not("parent_payable_id", "is", null);
  if (exErr) throw exErr;
  const existingParentIds = new Set((existing ?? []).map((e) => e.parent_payable_id));

  const toInsert = templates
    .filter((t) => !existingParentIds.has(t.id))
    .map((t) => {
      const day = Math.min(t.recurrence_day ?? 1, getDaysInMonth(new Date(year, monthIdx)));
      const due = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return {
        kind: "recorrente" as const,
        description: t.description,
        supplier: t.supplier,
        category: t.category,
        amount_due: t.amount_due,
        recurrence_day: t.recurrence_day,
        notes: t.notes,
        due_date: due,
        reference_month: monthStart,
        parent_payable_id: t.id,
      };
    });

  if (toInsert.length > 0) {
    // Insere uma a uma para não abortar tudo caso o índice único parcial dispare por concorrência.
    for (const row of toInsert) {
      const { error } = await supabase.from("payables").insert(row);
      if (error && !/duplicate key|unique constraint/i.test(error.message)) {
        throw error;
      }
    }
  }
}

interface RecurringTemplate {
  id: string;
  description: string;
  supplier: string | null;
  category: string | null;
  amount_due: number;
  recurrence_day: number | null;
  notes: string | null;
  due_date: string;
  reference_month: string;
}

// Garante que todas as instâncias mensais faltantes de contas recorrentes
// existam para o ano informado, respeitando o reference_month inicial de
// cada modelo (nunca gera meses anteriores ao início da recorrência) e sem
// duplicar instâncias já existentes. Não altera contas já geradas, pagas,
// parciais, canceladas ou avulsas.
export async function generateRecurringForYear(year: number): Promise<void> {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const { data: templates, error: tplErr } = await supabase
    .from("payables")
    .select("id,description,supplier,category,amount_due,recurrence_day,notes,due_date,reference_month")
    .eq("kind", "recorrente")
    .is("parent_payable_id", null)
    .neq("status", "cancelado")
    .lte("reference_month", yearEnd);
  if (tplErr) throw tplErr;
  const activeTemplates = (templates ?? []) as RecurringTemplate[];
  if (activeTemplates.length === 0) return;

  const { data: existing, error: exErr } = await supabase
    .from("payables")
    .select("parent_payable_id,reference_month")
    .gte("reference_month", yearStart)
    .lte("reference_month", yearEnd)
    .not("parent_payable_id", "is", null);
  if (exErr) throw exErr;
  const existingKeys = new Set(
    (existing ?? []).map((e) => `${e.parent_payable_id}|${e.reference_month}`),
  );

  const toInsert: {
    kind: "recorrente";
    description: string;
    supplier: string | null;
    category: string | null;
    amount_due: number;
    recurrence_day: number | null;
    notes: string | null;
    due_date: string;
    reference_month: string;
    parent_payable_id: string;
  }[] = [];

  for (const t of activeTemplates) {
    for (let monthIdx = 0; monthIdx < 12; monthIdx++) {
      const referenceMonth = `${year}-${String(monthIdx + 1).padStart(2, "0")}-01`;
      if (referenceMonth < t.reference_month) continue; // antes do início da recorrência
      const key = `${t.id}|${referenceMonth}`;
      if (existingKeys.has(key)) continue;

      let day = t.recurrence_day;
      if (!day) {
        const derivedDay = Number(t.due_date?.slice(8, 10));
        if (derivedDay) day = derivedDay;
      }
      if (!day) {
        console.warn(
          `[payablesStatus] modelo ${t.id} sem recurrence_day determinável — pulando ${referenceMonth}`,
        );
        continue;
      }
      day = Math.min(day, 28); // mesmo limite já aplicado na criação manual do modelo
      const clampedDay = Math.min(day, getDaysInMonth(new Date(year, monthIdx)));
      const dueDate = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;

      toInsert.push({
        kind: "recorrente",
        description: t.description,
        supplier: t.supplier,
        category: t.category,
        amount_due: t.amount_due,
        recurrence_day: day,
        notes: t.notes,
        due_date: dueDate,
        reference_month: referenceMonth,
        parent_payable_id: t.id,
      });
      existingKeys.add(key);
    }
  }

  if (toInsert.length === 0) return;

  for (const row of toInsert) {
    const { error } = await supabase.from("payables").insert(row);
    if (error && !/duplicate key|unique constraint/i.test(error.message)) {
      throw error;
    }
  }
}
