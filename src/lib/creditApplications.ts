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
 * Aplica os créditos pendentes de um módulo às próximas contas/cobranças já
 * geradas (apply_pending_credits). Roda no banco com bloqueio de linha, então
 * duas abas ou dois carregamentos simultâneos nunca aplicam o mesmo crédito
 * duas vezes. Para quem não é gestor, não faz nada.
 * Não altera amount_paid do alvo (crédito nunca é contado como dinheiro novo).
 */
export async function applyPendingCredits(module: CreditModule): Promise<void> {
  const { error } = await supabase.rpc("apply_pending_credits", { _module: module });
  if (error) throw error;
}

/**
 * Verifica se um pagamento já teve algum tratamento de excedente registrado:
 * por auditoria (taxa atual / aumento real / crédito) ou por uma linha em
 * financial_credit_applications vinculada a esse pagamento (cobre o caso de
 * crédito mesmo que a auditoria tenha falhado silenciosamente). Usado para
 * bloquear estorno automático com segurança (Regra 11).
 */
export async function paymentHasOverpaymentTreatment(
  entityType: "receivable" | "payable",
  paymentId: string,
): Promise<boolean> {
  const [auditRes, creditRes] = await Promise.all([
    supabase
      .from("audit_logs")
      .select("id")
      .eq("entity_type", entityType)
      .like("action", "%overpayment%")
      .filter("metadata->>payment_id", "eq", paymentId)
      .limit(1),
    supabase
      .from("financial_credit_applications")
      .select("id")
      .eq("module", entityType)
      .eq("source_payment_id", paymentId)
      .in("status", ["pending", "applied"])
      .limit(1),
  ]);
  if ((auditRes.data ?? []).length > 0) return true;
  if ((creditRes.data ?? []).length > 0) return true;
  return false;
}
