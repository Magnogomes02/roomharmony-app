import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { getMonthIndexFromDateOnly, getYearFromDateOnly } from "@/lib/dateOnly";

export interface MonthlyFinancialSummary {
  month: string; // YYYY-MM
  monthLabel: string;
  expected: number;
  received: number;
  receivable: number;
  overdue: number;
  pending: number;
  lost: number;
  receivedRate: number;
  overdueRate: number;
  lossRate: number;
  accumulatedReceived: number;
  expensesPlanned: number;
  expensesPaid: number;
  resultado: number;
}

export interface AnnualFinancialSummary {
  expected: number;
  received: number;
  receivable: number;
  overdue: number;
  pending: number;
  lost: number;
  receivedRate: number;
  overdueRate: number;
  lossRate: number;
  averageMonthlyReceived: number;
  bestMonth: string | null;
  expensesPlanned: number;
  expensesPaid: number;
  resultado: number;
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
  cancel_type: string | null;
}

interface PayableRow {
  reference_month: string | null;
  due_date: string;
  amount_due: number | string | null;
  amount_paid: number | string | null;
  status: "a_pagar" | "parcial" | "pago" | "atrasado" | "cancelado";
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
  const [recRes, payRes] = await Promise.all([
    supabase
      .from("receivables")
      .select("reference_month,due_date,amount_due,amount_paid,status,cancel_type")
      .gte("reference_month", start)
      .lte("reference_month", end),
    supabase
      .from("payables")
      .select("reference_month,due_date,amount_due,amount_paid,status")
      .neq("status", "cancelado")
      .gte("due_date", start)
      .lte("due_date", end),
  ]);
  if (recRes.error) throw recRes.error;

  const rows = (recRes.data ?? []) as ReceivableRow[];
  const payRows = (payRes.data ?? []) as PayableRow[];

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
      lost: 0,
      receivedRate: 0,
      overdueRate: 0,
      lossRate: 0,
      accumulatedReceived: 0,
      expensesPlanned: 0,
      expensesPaid: 0,
      resultado: 0,
    };
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const r of rows) {
    const refYear = getYearFromDateOnly(r.reference_month);
    if (refYear !== year) continue;
    const idx = getMonthIndexFromDateOnly(r.reference_month);
    const bucket = monthly[idx];
    if (!bucket) continue;

    // cobrança gerada errada não entra em previsto/recebido/perda
    if (r.status === "cancelado" && r.cancel_type === "cobranca_errada") continue;

    const due = num(r.amount_due);
    const paid = num(r.amount_paid);
    bucket.expected += due;

    // pagamento parcial conta como recebido
    if (paid > 0) bucket.received += Math.min(paid, due);

    if (r.status === "cancelado") {
      // perda = saldo aberto (perda_contrato é o único cenário restante)
      const saldo = Math.max(due - paid, 0);
      bucket.lost += saldo;
      continue;
    }

    const saldo = Math.max(due - paid, 0);
    if (saldo > 0) {
      const dueDate = new Date(r.due_date + "T12:00:00");
      if (dueDate < today) bucket.overdue += saldo;
      else bucket.receivable += saldo;
    }
  }

  // Aggregate payables by month (reference_month preferred, fallback to due_date)
  for (const p of payRows) {
    const dateStr = p.reference_month ?? p.due_date;
    if (!dateStr) continue;
    const refYear = getYearFromDateOnly(dateStr);
    if (refYear !== year) continue;
    const idx = getMonthIndexFromDateOnly(dateStr);
    const bucket = monthly[idx];
    if (!bucket) continue;
    bucket.expensesPlanned += num(p.amount_due);
    bucket.expensesPaid += num(p.amount_paid);
  }

  let acc = 0;
  for (const m of monthly) {
    m.pending = m.receivable + m.overdue;
    m.receivedRate = safeRate(m.received, m.expected);
    m.overdueRate = safeRate(m.overdue, m.expected);
    m.lossRate = safeRate(m.lost, m.expected);
    acc += m.received;
    m.accumulatedReceived = acc;
    m.resultado = m.received - m.expensesPaid;
  }

  const totals: AnnualFinancialSummary = {
    expected: monthly.reduce((s, m) => s + m.expected, 0),
    received: monthly.reduce((s, m) => s + m.received, 0),
    receivable: monthly.reduce((s, m) => s + m.receivable, 0),
    overdue: monthly.reduce((s, m) => s + m.overdue, 0),
    pending: 0,
    lost: monthly.reduce((s, m) => s + m.lost, 0),
    receivedRate: 0,
    overdueRate: 0,
    lossRate: 0,
    averageMonthlyReceived: 0,
    bestMonth: null,
    expensesPlanned: monthly.reduce((s, m) => s + m.expensesPlanned, 0),
    expensesPaid: monthly.reduce((s, m) => s + m.expensesPaid, 0),
    resultado: 0,
  };
  totals.pending = totals.receivable + totals.overdue;
  totals.resultado = totals.received - totals.expensesPaid;
  totals.receivedRate = safeRate(totals.received, totals.expected);
  totals.overdueRate = safeRate(totals.overdue, totals.expected);
  totals.lossRate = safeRate(totals.lost, totals.expected);
  const monthsWithExpected = monthly.filter((m) => m.expected > 0).length || 1;
  totals.averageMonthlyReceived = totals.received / monthsWithExpected;
  const best = monthly.reduce<MonthlyFinancialSummary | null>(
    (acc2, m) => (!acc2 || m.received > acc2.received ? m : acc2),
    null,
  );
  totals.bestMonth = best && best.received > 0 ? best.monthLabel : null;

  return { year, monthlyRows: monthly, annualTotals: totals };
}
