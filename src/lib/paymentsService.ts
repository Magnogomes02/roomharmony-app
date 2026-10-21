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
 * a partir dos pagamentos ativos, no banco (recompute_receivable_summary).
 */
export async function recomputeReceivableSummary(receivableId: string): Promise<void> {
  const { error } = await supabase.rpc("recompute_receivable_summary", {
    _receivable_id: receivableId,
  });
  if (error) throw error;
}

export interface RegisterPaymentInput {
  receivableId: string;
  amount: number;
  paidAt: string; // YYYY-MM-DD
  paymentMethod: string;
  attachmentPath?: string | null;
  notes?: string | null;
  /** Obrigatória quando o pagamento não quita o saldo. */
  remainingDueDate?: string | null;
  remainingDueReason?: string | null;
  /** Destino do excedente em cobranças de contrato; avulsos sempre viram taxa. */
  overpaymentAction?: "credit" | "fee" | null;
}

/**
 * Registra a baixa em uma única transação no banco (register_receivable_payment):
 * pagamento, saldo restante ou excedente (crédito/taxa), status e auditoria.
 * Se qualquer parte falhar, nada é gravado.
 */
export async function registerPayment(input: RegisterPaymentInput): Promise<{ paymentId: string }> {
  const { data, error } = await supabase.rpc("register_receivable_payment", {
    _receivable_id: input.receivableId,
    _amount: input.amount,
    _paid_at: input.paidAt,
    _payment_method: input.paymentMethod,
    _attachment_path: input.attachmentPath ?? undefined,
    _notes: input.notes ?? undefined,
    _remaining_due_date: input.remainingDueDate ?? undefined,
    _remaining_due_reason: input.remainingDueReason ?? undefined,
    _overpayment_action: input.overpaymentAction ?? undefined,
  });
  if (error) throw error;
  const paymentId = (data as { payment_id?: string } | null)?.payment_id;
  if (!paymentId) throw new Error("Falha ao registrar pagamento");
  return { paymentId };
}

/**
 * Estorna um pagamento e cancela o recibo emitido para ele, na mesma
 * transação (reverse_receivable_payment). Pagamentos com crédito ou taxa de
 * excedente continuam bloqueados.
 */
export async function reversePayment(paymentId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("reverse_receivable_payment", {
    _payment_id: paymentId,
    _reason: reason,
  });
  if (error) throw error;
}

/**
 * Cancela o recebível. "cobranca_errada" estorna todos os pagamentos ativos e
 * cancela os recibos; "perda_contrato" preserva o que já foi recebido.
 */
export async function cancelReceivable(
  receivableId: string,
  cancelType: "perda_contrato" | "cobranca_errada",
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc("cancel_receivable", {
    _receivable_id: receivableId,
    _cancel_type: cancelType,
    _reason: reason,
  });
  if (error) throw error;
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
