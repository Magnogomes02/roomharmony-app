import { supabase } from "@/integrations/supabase/client";

export type CreditModule = "receivable" | "payable";

export interface CreateCreditApplicationInput {
  module: CreditModule;
  sourceItemId: string;
  sourcePaymentId: string | null;
  amount: number;
  reason: string | null;
  createdBy: string | null;
}

/**
 * Registra um crédito pendente gerado por pagamento excedente. O alvo
 * (próxima conta/cobrança) não é fixado aqui — é resolvido depois por
 * applyPendingCredits, pois a próxima instância pode ainda não existir.
 */
export async function createCreditApplication(input: CreateCreditApplicationInput): Promise<string> {
  const { data, error } = await supabase
    .from("financial_credit_applications")
    .insert({
      module: input.module,
      source_item_id: input.sourceItemId,
      source_payment_id: input.sourcePaymentId,
      amount: input.amount,
      status: "pending",
      reason: input.reason,
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Falha ao registrar crédito");
  return data.id;
}

/**
 * Tenta aplicar todos os créditos pendentes de um módulo às próximas
 * contas/cobranças já geradas. Chamada após cada geração de recorrências
 * (mesmo padrão lazy/on-load já usado no projeto, sem job em background).
 * Não altera amount_paid do alvo (crédito nunca é contado como dinheiro novo).
 */
export async function applyPendingCredits(module: CreditModule): Promise<void> {
  const { data: pending, error } = await supabase
    .from("financial_credit_applications")
    .select("id, source_item_id, amount")
    .eq("module", module)
    .eq("status", "pending")
    .is("target_item_id", null);
  if (error) throw error;
  if (!pending || pending.length === 0) return;

  const table = module === "payable" ? "payables" : "receivables";
  const scopeCol = module === "payable" ? "parent_payable_id" : "contract_id";
  const openStatuses = module === "payable" ? ["a_pagar", "atrasado"] : ["a_receber", "atrasado"];

  for (const credit of pending) {
    const { data: source } = await supabase
      .from(table)
      .select(`reference_month, ${scopeCol}`)
      .eq("id", credit.source_item_id)
      .single();
    const scopeId = (source as Record<string, unknown> | null)?.[scopeCol] as string | null | undefined;
    if (!source || !scopeId) continue; // avulso ou sem vínculo: não há "próxima" instância

    const { data: candidates } = await supabase
      .from(table)
      .select("id, amount_paid, credit_applied_amount")
      .eq(scopeCol, scopeId)
      .gt("reference_month", (source as { reference_month: string }).reference_month)
      .in("status", openStatuses)
      .order("reference_month", { ascending: true })
      .limit(1);
    const target = candidates?.[0] as { id: string; amount_paid: number | null; credit_applied_amount: number | null } | undefined;
    if (!target) continue;

    const newCredit = Number(target.credit_applied_amount ?? 0) + Number(credit.amount);
    const { error: updTargetErr } = await supabase
      .from(table)
      .update({ credit_applied_amount: newCredit })
      .eq("id", target.id);
    if (updTargetErr) continue;

    await supabase
      .from("financial_credit_applications")
      .update({ target_item_id: target.id, status: "applied", applied_at: new Date().toISOString() })
      .eq("id", credit.id);
  }
}

/**
 * Verifica se um pagamento já teve algum tratamento de excedente registrado
 * em auditoria (crédito, taxa atual ou aumento real). Usado para bloquear
 * estorno automático com segurança (Regra 11).
 */
export async function paymentHasOverpaymentTreatment(
  entityType: "receivable" | "payable",
  paymentId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id")
    .eq("entity_type", entityType)
    .like("action", "%overpayment%")
    .filter("metadata->>payment_id", "eq", paymentId)
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}
