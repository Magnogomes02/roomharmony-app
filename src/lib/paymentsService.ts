import { supabase } from "@/integrations/supabase/client";
import { parseDateOnlyLocal, toDateOnlyString } from "@/lib/dateOnly";

export type PaymentStatus = "ativo" | "estornado" | "cancelado";

export interface ReceivablePayment {
  id: string;
  receivable_id: string;
  amount: number;
  paid_at: string;
  payment_method: string | null;
  attachment_path: string | null;
  notes: string | null;
  status: PaymentStatus;
  created_by: string | null;
  created_at: string;
  reversed_at: string | null;
  reversed_by: string | null;
  reverse_reason: string | null;
}

export interface ReceivableLikeFull {
  status: string;
  due_date: string;
  amount_due: number | string;
  amount_paid: number | string | null;
  cancel_type?: string | null;
  credit_applied_amount?: number | string | null;
  remaining_due_date?: string | null;
}

export type EffectiveStatus = "a_receber" | "parcial" | "recebido" | "atrasado" | "cancelado";

export function computeEffectiveStatus(r: ReceivableLikeFull): EffectiveStatus {
  if (r.status === "cancelado") return "cancelado";
  const due = Number(r.amount_due) || 0;
  const paid = Number(r.amount_paid) || 0;
  const credit = Number(r.credit_applied_amount) || 0;
  const effectivePaid = paid + credit;
  if (effectivePaid >= due && due > 0) return "recebido";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (effectivePaid > 0 && effectivePaid < due) {
    const refDate = parseDateOnlyLocal(r.remaining_due_date || r.due_date);
    refDate.setHours(0, 0, 0, 0);
    if (refDate < today) return "atrasado";
    return "parcial";
  }
  // sem pagamento/crédito
  const dueDate = parseDateOnlyLocal(r.due_date);
  dueDate.setHours(0, 0, 0, 0);
  if (dueDate < today) return "atrasado";
  return "a_receber";
}

export async function getActivePaymentsForReceivables(
  receivableIds: string[],
): Promise<Map<string, ReceivablePayment[]>> {
  const out = new Map<string, ReceivablePayment[]>();
  if (receivableIds.length === 0) return out;
  const { data, error } = await supabase
    .from("receivable_payments")
    .select("*")
    .in("receivable_id", receivableIds)
    .order("paid_at", { ascending: true });
  if (error) throw error;
  for (const p of (data ?? []) as ReceivablePayment[]) {
    const arr = out.get(p.receivable_id) ?? [];
    arr.push(p);
    out.set(p.receivable_id, arr);
  }
  return out;
}

export async function getAllPaymentsForReceivable(
  receivableId: string,
): Promise<ReceivablePayment[]> {
  const { data, error } = await supabase
    .from("receivable_payments")
    .select("*")
    .eq("receivable_id", receivableId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ReceivablePayment[];
}

/**
 * Recalcula campos resumo do recebível (amount_paid, paid_at, payment_method, status)
 * a partir dos pagamentos ativos. Não toca em recebíveis cancelados.
 */
export async function recomputeReceivableSummary(receivableId: string): Promise<void> {
  const { data: rec, error: recErr } = await supabase
    .from("receivables")
    .select("amount_due, status, due_date, cancel_type, credit_applied_amount, remaining_due_date")
    .eq("id", receivableId)
    .single();
  if (recErr || !rec) throw recErr ?? new Error("Recebível não encontrado");

  const { data: payments, error: payErr } = await supabase
    .from("receivable_payments")
    .select("amount, paid_at, payment_method, status")
    .eq("receivable_id", receivableId)
    .eq("status", "ativo")
    .order("paid_at", { ascending: false });
  if (payErr) throw payErr;

  const actives = (payments ?? []) as Pick<
    ReceivablePayment,
    "amount" | "paid_at" | "payment_method" | "status"
  >[];
  const totalPaid = actives.reduce((s, p) => s + Number(p.amount), 0);
  const last = actives[0] ?? null;

  // se cancelado, preserva status cancelado mas ainda atualiza amount_paid
  let newStatus: string = rec.status;
  if (rec.status !== "cancelado") {
    newStatus = computeEffectiveStatus({
      status: "a_receber",
      due_date: rec.due_date,
      amount_due: rec.amount_due,
      amount_paid: totalPaid,
      cancel_type: rec.cancel_type,
      credit_applied_amount: rec.credit_applied_amount,
      remaining_due_date: rec.remaining_due_date,
    });
  }

  await supabase
    .from("receivables")
    .update({
      amount_paid: totalPaid > 0 ? totalPaid : null,
      paid_at: last ? new Date(last.paid_at).toISOString() : null,
      payment_method: last?.payment_method ?? null,
      status: newStatus as "a_receber" | "parcial" | "recebido" | "atrasado" | "cancelado",
    })
    .eq("id", receivableId);
}


export interface CreatePaymentInput {
  receivableId: string;
  amount: number;
  paidAt: string; // YYYY-MM-DD
  paymentMethod: string | null;
  attachmentPath?: string | null;
  notes?: string | null;
}

/**
 * Define (ou limpa) a nova data de vencimento do saldo restante de um
 * recebível após um pagamento parcial. due_date original nunca é alterado.
 */
export async function setRemainingDue(
  receivableId: string,
  params: { remainingDueDate: string | null; reason: string | null },
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("receivables")
    .update({
      remaining_due_date: params.remainingDueDate,
      remaining_due_updated_at: new Date().toISOString(),
      remaining_due_updated_by: user?.id ?? null,
      remaining_due_reason: params.reason,
    })
    .eq("id", receivableId);
  if (error) throw error;
}

export async function createPayment(input: CreatePaymentInput): Promise<ReceivablePayment> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("receivable_payments")
    .insert({
      receivable_id: input.receivableId,
      amount: input.amount,
      paid_at: input.paidAt,
      payment_method: input.paymentMethod,
      attachment_path: input.attachmentPath ?? null,
      notes: input.notes ?? null,
      status: "ativo",
      created_by: user?.id ?? null,
    })
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("Falha ao criar pagamento");
  await recomputeReceivableSummary(input.receivableId);
  return data as ReceivablePayment;
}

export async function reversePayment(paymentId: string, reason: string): Promise<void> {
  const { data: pay, error: getErr } = await supabase
    .from("receivable_payments")
    .select("receivable_id, status")
    .eq("id", paymentId)
    .single();
  if (getErr || !pay) throw getErr ?? new Error("Pagamento não encontrado");
  if (pay.status !== "ativo") throw new Error("Pagamento não está ativo.");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("receivable_payments")
    .update({
      status: "estornado",
      reversed_at: new Date().toISOString(),
      reversed_by: user?.id ?? null,
      reverse_reason: reason,
    })
    .eq("id", paymentId);
  if (error) throw error;
  await recomputeReceivableSummary(pay.receivable_id);
}

/**
 * Verifica se existe recebível duplicado (mesmo prof/contract/mês).
 */
export async function findDuplicateReceivables(args: {
  professional_id: string;
  contract_id: string | null;
  reference_month: string; // YYYY-MM-01
}): Promise<
  Array<{
    id: string;
    amount_due: number;
    status: string;
    due_date: string;
    reference_month: string;
  }>
> {
  let q = supabase
    .from("receivables")
    .select("id, amount_due, status, due_date, reference_month")
    .eq("professional_id", args.professional_id)
    .eq("reference_month", args.reference_month);
  if (args.contract_id) q = q.eq("contract_id", args.contract_id);
  else q = q.is("contract_id", null);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Array<{
    id: string;
    amount_due: number;
    status: string;
    due_date: string;
    reference_month: string;
  }>;
}

export function buildDueDate(year: number, monthIdx0: number, dueDay: number): string {
  // mesma regra do generate_contract_receivables: limita a 28 para evitar mês curto
  const safeDay = Math.min(Math.max(dueDay, 1), 28);
  const d = new Date(year, monthIdx0, safeDay, 12, 0, 0, 0);
  return toDateOnlyString(d);
}

export const MONTHS_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
