import { supabase } from "@/integrations/supabase/client";

interface InstallmentTargetRow {
  id: string;
  installment_number: number;
  amount_due: number;
  amount_paid: number | null;
  credit_applied_amount: number | null;
  status: string;
}

export interface ApplyInstallmentCreditArgs {
  sourcePayableId: string;
  sourcePaymentId: string | null;
  installmentGroupId: string;
  sourceInstallmentNumber: number;
  amount: number;
  reason: string | null;
  createdBy: string | null;
}

export interface ApplyInstallmentCreditResult {
  appliedTotal: number;
  remainingUnapplied: number;
  appliedTargets: { payableId: string; installmentNumber: number; amountApplied: number }[];
}

/**
 * Aplica o excedente de pagamento de uma parcela avulsa parcelada nas
 * parcelas finais do mesmo grupo (da última para a primeira em aberto),
 * em vez de na próxima parcela. Nunca usa parent_payable_id/applyPendingCredits
 * (exclusivos de recorrência) — o vínculo aqui é só installment_group_id.
 */
export async function applyPayableInstallmentCreditFromLastInstallment(
  args: ApplyInstallmentCreditArgs,
): Promise<ApplyInstallmentCreditResult> {
  const { data: candidates, error } = await supabase
    .from("payables")
    .select("id, installment_number, amount_due, amount_paid, credit_applied_amount, status")
    .eq("installment_group_id", args.installmentGroupId)
    .gt("installment_number", args.sourceInstallmentNumber)
    .neq("status", "cancelado")
    .order("installment_number", { ascending: false });
  if (error) throw error;

  let remaining = Number(args.amount);
  const appliedTargets: ApplyInstallmentCreditResult["appliedTargets"] = [];

  for (const target of (candidates ?? []) as InstallmentTargetRow[]) {
    if (remaining <= 0.001) break;
    const targetRemaining = Math.max(
      Number(target.amount_due) - Number(target.amount_paid ?? 0) - Number(target.credit_applied_amount ?? 0),
      0,
    );
    if (targetRemaining <= 0) continue; // parcela já quitada (pagamento ou outro crédito) — tenta a anterior

    const amountToApply = Math.min(remaining, targetRemaining);
    const newCredit = Number(target.credit_applied_amount ?? 0) + amountToApply;
    const { error: updErr } = await supabase
      .from("payables")
      .update({ credit_applied_amount: newCredit })
      .eq("id", target.id);
    if (updErr) continue; // não conseguiu aplicar neste alvo — tenta o próximo, sem consumir o crédito

    const { error: insErr } = await supabase.from("financial_credit_applications").insert({
      module: "payable",
      source_item_id: args.sourcePayableId,
      source_payment_id: args.sourcePaymentId,
      target_item_id: target.id,
      amount: amountToApply,
      status: "applied",
      applied_at: new Date().toISOString(),
      reason: args.reason,
      created_by: args.createdBy,
      metadata: {
        type: "payable_installment_last_to_first_credit",
        installment_group_id: args.installmentGroupId,
        source_installment_number: args.sourceInstallmentNumber,
        target_installment_number: target.installment_number,
      },
    });
    if (insErr) {
      // Reverte o credit_applied_amount já gravado para não perder rastreabilidade
      // (sem o registro em financial_credit_applications o crédito ficaria "invisível").
      await supabase
        .from("payables")
        .update({ credit_applied_amount: Number(target.credit_applied_amount ?? 0) })
        .eq("id", target.id);
      continue;
    }

    remaining -= amountToApply;
    appliedTargets.push({
      payableId: target.id,
      installmentNumber: target.installment_number,
      amountApplied: amountToApply,
    });
  }

  return {
    appliedTotal: Number(args.amount) - remaining,
    remainingUnapplied: Math.max(remaining, 0),
    appliedTargets,
  };
}
