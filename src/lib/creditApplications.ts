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

interface PendingCreditRow {
  id: string;
  source_item_id: string;
  source_payment_id: string | null;
  amount: number;
  reason: string | null;
  created_by: string | null;
}

interface TargetRow {
  id: string;
  amount_due: number;
  amount_paid: number | null;
  credit_applied_amount: number | null;
}

/**
 * Aplica um único crédito pendente, percorrendo as próximas contas/cobranças
 * em ordem de reference_month e limitando cada aplicação ao saldo aberto do
 * alvo (amount_due - amount_paid - credit_applied_amount). Se o crédito for
 * maior que o saldo do alvo, o excedente é repassado para uma nova linha
 * "pending" (mesma origem) em vez de se perder, e a função continua tentando
 * aplicar esse restante aos próximos alvos já carregados nesta mesma chamada.
 */
async function applyOneCredit(
  table: "payables" | "receivables",
  scopeCol: "parent_payable_id" | "contract_id",
  openStatuses: string[],
  credit: PendingCreditRow,
): Promise<void> {
  const { data: source } = await supabase
    .from(table)
    .select(`reference_month, ${scopeCol}`)
    .eq("id", credit.source_item_id)
    .single();
  const sourceRow = source as unknown as Record<string, unknown> | null;
  const scopeId = sourceRow?.[scopeCol] as string | null | undefined;
  const sourceReferenceMonth = sourceRow?.reference_month as string | undefined;
  if (!sourceRow || !scopeId || !sourceReferenceMonth) return; // avulso ou sem vínculo: não há "próxima" instância

  // .eq com nome de coluna dinâmico: scopeCol é "parent_payable_id" para payables
  // e "contract_id" para receivables, mas o TS não consegue provar essa
  // correlação genericamente entre as duas tabelas (cada uma só aceita uma
  // das duas colunas). O par table/scopeCol é montado de forma fixa por
  // módulo logo acima do loop, nunca cruzado — comportamento correto em
  // runtime, só o overload de tipos do PostgREST não modela esse caso.
  const { data: candidates } = await (supabase.from(table) as ReturnType<typeof supabase.from>)
    .select("id, amount_due, amount_paid, credit_applied_amount")
    .eq(scopeCol, scopeId)
    .gt("reference_month", sourceReferenceMonth)
    .in("status", openStatuses)
    .order("reference_month", { ascending: true });

  let remaining = Number(credit.amount);
  let currentCreditId = credit.id;

  for (const target of (candidates ?? []) as unknown as TargetRow[]) {
    if (remaining <= 0.001) break;

    const targetRemaining = Math.max(
      Number(target.amount_due) - Number(target.amount_paid ?? 0) - Number(target.credit_applied_amount ?? 0),
      0,
    );
    if (targetRemaining <= 0) continue; // alvo já quitado (pagamento ou outro crédito) — tenta o próximo

    const amountToApply = Math.min(remaining, targetRemaining);
    const newCredit = Number(target.credit_applied_amount ?? 0) + amountToApply;
    const { error: updTargetErr } = await supabase
      .from(table)
      .update({ credit_applied_amount: newCredit })
      .eq("id", target.id);
    if (updTargetErr) continue; // não conseguiu aplicar neste alvo — tenta o próximo, sem consumir o crédito

    remaining -= amountToApply;

    if (remaining <= 0.001) {
      // crédito (ou o que restava dele) coube inteiro neste alvo
      await supabase
        .from("financial_credit_applications")
        .update({
          target_item_id: target.id,
          status: "applied",
          applied_at: new Date().toISOString(),
          amount: amountToApply,
        })
        .eq("id", currentCreditId);
      return;
    }

    // aplicação parcial: fecha a linha atual com o valor usado neste alvo e
    // cria uma nova linha "pending" com o restante, preservando origem e
    // rastreabilidade, para tentar aplicar nos próximos alvos já carregados.
    await supabase
      .from("financial_credit_applications")
      .update({
        target_item_id: target.id,
        status: "applied",
        applied_at: new Date().toISOString(),
        amount: amountToApply,
      })
      .eq("id", currentCreditId);

    const { data: newRow, error: insErr } = await supabase
      .from("financial_credit_applications")
      .insert({
        module: table === "payables" ? "payable" : "receivable",
        source_item_id: credit.source_item_id,
        source_payment_id: credit.source_payment_id,
        amount: remaining,
        status: "pending",
        reason: credit.reason,
        created_by: credit.created_by,
        metadata: {
          split_from: currentCreditId,
          note: "Saldo remanescente de aplicação parcial de crédito",
        },
      })
      .select("id")
      .single();
    if (insErr || !newRow) return; // mantém o que já foi aplicado; o restante fica preso nesta linha já fechada — não deveria ocorrer (insert simples), mas evita perder o valor já consumido
    currentCreditId = newRow.id;
  }
  // candidatos da consulta atual se esgotaram, mas ainda há saldo de crédito:
  // a linha "pending" (currentCreditId) permanece como está, para ser
  // retomada na próxima execução, quando uma nova conta/cobrança existir.
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
    .select("id, source_item_id, source_payment_id, amount, reason, created_by")
    .eq("module", module)
    .eq("status", "pending")
    .is("target_item_id", null);
  if (error) throw error;
  if (!pending || pending.length === 0) return;

  const table = module === "payable" ? "payables" : "receivables";
  const scopeCol = module === "payable" ? "parent_payable_id" : "contract_id";
  const openStatuses = module === "payable" ? ["a_pagar", "atrasado"] : ["a_receber", "atrasado"];

  for (const credit of pending as PendingCreditRow[]) {
    await applyOneCredit(table, scopeCol, openStatuses, credit);
  }
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
