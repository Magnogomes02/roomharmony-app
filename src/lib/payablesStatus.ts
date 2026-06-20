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
}

export function computeEffectiveStatus(p: PayableStatusInput): PayableStatus {
  if (p.status === "cancelado") return "cancelado";
  if (p.status === "pago") return "pago";
  const paid = Number(p.amount_paid ?? 0);
  const due = Number(p.amount_due);
  if (paid >= due) return "pago";
  if (paid > 0) return "parcial";
  const today = toDateOnlyString(new Date());
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
