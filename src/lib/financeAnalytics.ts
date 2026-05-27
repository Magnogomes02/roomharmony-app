import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export interface MonthlyFinancialSummary {
  month: string; // YYYY-MM
  monthLabel: string;
  expected: number;
  received: number;
  receivable: number;
  overdue: number;
  pending: number;
  receivedRate: number;
  overdueRate: number;
  accumulatedReceived: number;
}

export interface AnnualFinancialSummary {
  expected: number;
  received: number;
  receivable: number;
  overdue: number;
  pending: number;
  receivedRate: number;
  overdueRate: number;
  averageMonthlyReceived: number;
  bestMonth: string | null;
}

export interface AnnualFinancialResult {
  year: number;
  monthlyRows: MonthlyFinancialSummary[];
  annualTotals: AnnualFinancialSummary;
}

interface ReceivableRow {
  reference_month: string;
  due_date: string;
  amount_due: number | string | null;
  amount_paid: number | string | null;
  status: "a_receber" | "recebido" | "atrasado" | "cancelado";
}

function num(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function safeRate(numer: number, denom: number): number {
  if (!denom) return 0;
  return numer / denom;
}

export async function loadAnnualFinancialSummary(year: number): Promise<AnnualFinancialResult> {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const { data, error } = await supabase
    .from("receivables")
    .select("reference_month,due_date,amount_due,amount_paid,status")
    .gte("reference_month", start)
    .lte("reference_month", end);
  if (error) throw error;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows = (data ?? []) as ReceivableRow[];

  // Initialize 12 months
  const monthly: MonthlyFinancialSummary[] = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(year, i, 1);
    return {
      month: format(d, "yyyy-MM"),
      monthLabel: format(d, "MMM", { locale: ptBR }).replace(".", ""),
      expected: 0,
      received: 0,
      receivable: 0,
      overdue: 0,
      pending: 0,
      receivedRate: 0,
      overdueRate: 0,
      accumulatedReceived: 0,
    };
  });

  for (const r of rows) {
    if (r.status === "cancelado") continue;
    const ref = new Date(r.reference_month);
    if (ref.getFullYear() !== year) continue;
    const idx = ref.getMonth();
    const bucket = monthly[idx];
    if (!bucket) continue;
    const due = num(r.amount_due);
    const paid = num(r.amount_paid);
    bucket.expected += due;
    if (r.status === "recebido") {
      bucket.received += paid || due;
    } else if (r.status === "atrasado") {
      bucket.overdue += due;
    } else if (r.status === "a_receber") {
      const dd = new Date(r.due_date);
      if (dd < today) bucket.overdue += due;
      else bucket.receivable += due;
    }
  }

  let acc = 0;
  for (const m of monthly) {
    m.pending = m.receivable + m.overdue;
    m.receivedRate = safeRate(m.received, m.expected);
    m.overdueRate = safeRate(m.overdue, m.expected);
    acc += m.received;
    m.accumulatedReceived = acc;
  }

  const totals: AnnualFinancialSummary = {
    expected: monthly.reduce((s, m) => s + m.expected, 0),
    received: monthly.reduce((s, m) => s + m.received, 0),
    receivable: monthly.reduce((s, m) => s + m.receivable, 0),
    overdue: monthly.reduce((s, m) => s + m.overdue, 0),
    pending: 0,
    receivedRate: 0,
    overdueRate: 0,
    averageMonthlyReceived: 0,
    bestMonth: null,
  };
  totals.pending = totals.receivable + totals.overdue;
  totals.receivedRate = safeRate(totals.received, totals.expected);
  totals.overdueRate = safeRate(totals.overdue, totals.expected);
  const monthsWithExpected = monthly.filter((m) => m.expected > 0).length || 1;
  totals.averageMonthlyReceived = totals.received / monthsWithExpected;
  const best = monthly.reduce<MonthlyFinancialSummary | null>(
    (acc2, m) => (!acc2 || m.received > acc2.received ? m : acc2),
    null,
  );
  totals.bestMonth = best && best.received > 0 ? best.monthLabel : null;

  return { year, monthlyRows: monthly, annualTotals: totals };
}
