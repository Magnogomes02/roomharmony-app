import { useCallback, useEffect, useMemo, useState } from "react";
import { format, startOfMonth, endOfMonth, addMonths, setDate, getDaysInMonth } from "date-fns";
import {
  Plus,
  Search,
  Check,
  Ban,
  Undo2,
  History,
  TrendingDown,
  Pencil,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { MonthNavigator } from "@/components/period/MonthNavigator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { toDateOnlyString, parseDateOnlyLocal } from "@/lib/dateOnly";
import {
  computeEffectiveStatus,
  generateRecurringForYear,
  buildDueDateForMonth,
  increaseRecurringAmount,
  type PayableStatus,
} from "@/lib/payablesStatus";
import {
  createCreditApplication,
  applyPendingCredits,
  paymentHasOverpaymentTreatment,
} from "@/lib/creditApplications";
import {
  applyPayableInstallmentCreditFromLastInstallment,
  type ApplyInstallmentCreditResult,
} from "@/lib/installmentCredits";
import type { Json } from "@/integrations/supabase/types";

interface Payable {
  id: string;
  kind: "recorrente" | "avulso";
  description: string;
  amount_due: number;
  amount_paid: number;
  due_date: string;
  reference_month: string;
  status: PayableStatus;
  recurrence_day: number | null;
  parent_payable_id: string | null;
  supplier: string | null;
  category: string | null;
  notes: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
  created_at: string;
  credit_applied_amount: number | null;
  remaining_due_date: string | null;
  installment_group_id: string | null;
  installment_number: number | null;
  installment_total: number | null;
}

// Divide um valor total em N parcelas usando centavos para evitar erro de
// arredondamento; a última parcela recebe o resto da divisão inteira.
function computeInstallmentAmounts(totalAmount: number, count: number): number[] {
  const totalCents = Math.round(totalAmount * 100);
  const baseCents = Math.floor(totalCents / count);
  const remainder = totalCents - baseCents * count;
  const amounts: number[] = [];
  for (let i = 0; i < count; i++) {
    const cents = i < count - 1 ? baseCents : baseCents + remainder;
    amounts.push(cents / 100);
  }
  return amounts;
}

// Calcula o vencimento da parcela `installmentIndex` (0-based) a partir da
// primeira parcela, preservando o dia original e usando o último dia válido
// do mês quando o dia não existir (ex.: dia 31 em mês com 30 dias).
function computeInstallmentDueDate(firstDueDate: string, installmentIndex: number): string {
  const first = parseDateOnlyLocal(firstDueDate);
  const targetMonth = addMonths(first, installmentIndex);
  const day = Math.min(first.getDate(), getDaysInMonth(targetMonth));
  return toDateOnlyString(setDate(targetMonth, day));
}

interface PayablePayment {
  id: string;
  payable_id: string;
  amount: number;
  paid_at: string;
  payment_method: string | null;
  notes: string | null;
  status: "ativo" | "estornado";
  reversed_at: string | null;
  reverse_reason: string | null;
}

function brl(v: number) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const STATUS_LABELS: Record<PayableStatus, string> = {
  a_pagar: "A pagar",
  parcial: "Parcial",
  pago: "Pago",
  atrasado: "Em atraso",
  cancelado: "Cancelado",
};

const STATUS_VARIANT: Record<PayableStatus, "default" | "secondary" | "destructive" | "outline"> = {
  a_pagar: "outline",
  parcial: "secondary",
  pago: "default",
  atrasado: "destructive",
  cancelado: "secondary",
};

const PAYMENT_METHODS = ["Pix", "Transferência", "Boleto", "Dinheiro", "Cartão", "Outro"];

const emptyForm = {
  kind: "avulso" as "recorrente" | "avulso",
  description: "",
  supplier: "",
  category: "",
  amount_due: "",
  due_date: "",
  recurrence_day: "",
  notes: "",
  parcelado: false,
  installments_count: "",
};

export function PayablesPanel() {
  const { role } = useAuth();
  const canEdit = role === "gestor";

  const [monthRef, setMonthRef] = useState(() => startOfMonth(new Date()));
  const [items, setItems] = useState<Payable[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<PayableStatus | "all">("all");

  // Modals
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState(emptyForm);
  const [savingNew, setSavingNew] = useState(false);

  const [payOpen, setPayOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<Payable | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [payRemainingDueDate, setPayRemainingDueDate] = useState("");
  const [payRemainingDueReason, setPayRemainingDueReason] = useState("");
  const [payOverpaymentAction, setPayOverpaymentAction] = useState<
    "credit" | "increase" | "fee" | "installment_credit_last" | ""
  >("");
  const [savingPay, setSavingPay] = useState(false);

  const [histOpen, setHistOpen] = useState(false);
  const [histTarget, setHistTarget] = useState<Payable | null>(null);
  const [histPayments, setHistPayments] = useState<PayablePayment[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Payable | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelScope, setCancelScope] = useState<"current" | "future">("current");
  const [savingCancel, setSavingCancel] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Payable | null>(null);
  const [editScope, setEditScope] = useState<"current" | "future">("current");
  const [editForm, setEditForm] = useState({
    description: "", supplier: "", category: "", amount_due: "", due_date: "", recurrence_day: "", notes: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Payable | null>(null);
  const [deleteScope, setDeleteScope] = useState<"current" | "future">("current");
  const [deleteConfirmChecked, setDeleteConfirmChecked] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await generateRecurringForYear(monthRef.getFullYear());
    } catch (err) {
      console.warn("generateRecurringForYear falhou", err);
      toast.warning("Não foi possível gerar todas as recorrências do ano.");
    }
    try {
      await applyPendingCredits("payable");
    } catch (err) {
      console.warn("applyPendingCredits(payable) falhou", err);
    }
    const monthStart = toDateOnlyString(startOfMonth(monthRef));
    const monthEnd = toDateOnlyString(endOfMonth(monthRef));
    // Oculta o "modelo" da recorrência (kind=recorrente AND parent_payable_id IS NULL).
    // Mostra: avulsos OU instâncias mensais (parent_payable_id NOT NULL).
    const { data, error } = await supabase
      .from("payables")
      .select("*")
      .gte("reference_month", monthStart)
      .lte("reference_month", monthEnd)
      .or("kind.eq.avulso,parent_payable_id.not.is.null")
      .order("due_date");
    if (error) toast.error("Erro ao carregar contas", { description: error.message });
    setItems((data ?? []) as Payable[]);
    setLoading(false);
  }, [monthRef]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter((p) => {
      const eff = computeEffectiveStatus(p);
      if (statusFilter !== "all" && eff !== statusFilter) return false;
      if (!q) return true;
      return (
        p.description.toLowerCase().includes(q) ||
        (p.supplier ?? "").toLowerCase().includes(q) ||
        (p.category ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, search, statusFilter]);

  const summary = useMemo(() => {
    let aPagar = 0, pago = 0, atrasado = 0;
    for (const p of items) {
      const eff = computeEffectiveStatus(p);
      const remaining = Math.max(
        Number(p.amount_due) - Number(p.amount_paid ?? 0) - Number(p.credit_applied_amount ?? 0),
        0,
      );
      if (eff === "a_pagar" || eff === "parcial") aPagar += remaining;
      else if (eff === "pago") pago += Number(p.amount_paid ?? p.amount_due);
      else if (eff === "atrasado") atrasado += remaining;
    }
    return { aPagar, pago, atrasado };
  }, [items]);

  // Retorna true/false (em vez de lançar) para não alterar o comportamento dos
  // fluxos já existentes que chamam logAudit em modo "melhor esforço" (criar,
  // editar, cancelar, excluir). Só os fluxos de pagamento excedente checam o
  // retorno e avisam o usuário explicitamente em caso de falha (Correção 4).
  async function logAudit(action: string, entityId: string, metadata?: Json): Promise<boolean> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { error } = await supabase.from("audit_logs").insert({
      actor_id: user.id, action, entity_type: "payable",
      entity_id: entityId, metadata: metadata ?? null,
    });
    if (error) {
      console.error("[PayablesPanel] falha ao registrar auditoria", action, error);
      return false;
    }
    return true;
  }

  async function saveNew(e: React.FormEvent) {
    e.preventDefault();
    if (!newForm.description.trim()) return toast.error("Descrição é obrigatória");
    if (!newForm.amount_due || Number(newForm.amount_due) <= 0) return toast.error("Valor inválido");
    if (!newForm.due_date) return toast.error("Data de vencimento é obrigatória");

    const isInstallmentNew = newForm.kind === "avulso" && newForm.parcelado;
    if (isInstallmentNew) {
      const count = Number(newForm.installments_count);
      if (!count || count <= 1) return toast.error("Quantidade de parcelas deve ser maior que 1");
      setSavingNew(true);
      const { data: { user } } = await supabase.auth.getUser();
      const totalAmount = Number(newForm.amount_due);
      const firstDueDate = newForm.due_date;
      const amounts = computeInstallmentAmounts(totalAmount, count);

      const { data: group, error: groupErr } = await supabase
        .from("payable_installment_groups")
        .insert({
          description: newForm.description.trim(),
          supplier: newForm.supplier.trim() || null,
          category: newForm.category.trim() || null,
          total_amount: totalAmount,
          installments_count: count,
          first_due_date: firstDueDate,
          notes: newForm.notes.trim() || null,
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (groupErr || !group) {
        setSavingNew(false);
        return toast.error("Erro ao criar parcelamento", { description: groupErr?.message });
      }

      const rows = amounts.map((amt, idx) => {
        const dueDate = computeInstallmentDueDate(firstDueDate, idx);
        return {
          kind: "avulso" as const,
          description: newForm.description.trim(),
          supplier: newForm.supplier.trim() || null,
          category: newForm.category.trim() || null,
          amount_due: amt,
          due_date: dueDate,
          reference_month: dueDate.slice(0, 7) + "-01",
          notes: newForm.notes.trim() || null,
          installment_group_id: group.id,
          installment_number: idx + 1,
          installment_total: count,
          parent_payable_id: null,
          recurrence_day: null,
        };
      });

      const { data: inserted, error: insErr } = await supabase.from("payables").insert(rows).select("id");
      setSavingNew(false);
      if (insErr) {
        return toast.error("Erro ao criar parcelas", { description: insErr.message });
      }
      toast.success(`Parcelamento criado: ${count} parcela(s)`);
      setNewOpen(false);
      setNewForm(emptyForm);
      await logAudit("payable.installment_group_create", group.id, {
        description: newForm.description.trim(),
        total_amount: totalAmount,
        installments_count: count,
        first_due_date: firstDueDate,
      });
      const createdIds = (inserted ?? []).map((r) => r.id);
      await Promise.all(
        createdIds.map((id, idx) =>
          logAudit("payable.installment_create", id, {
            installment_group_id: group.id,
            installment_number: idx + 1,
            installment_total: count,
            amount_due: amounts[idx],
          }),
        ),
      );
      load();
      return;
    }

    let recurrenceDay: number | null = newForm.recurrence_day ? Number(newForm.recurrence_day) : null;
    if (newForm.kind === "recorrente") {
      if (!recurrenceDay) {
        // Deriva do dia do due_date (evita cair em dia 01 sem o usuário perceber).
        const day = Number(newForm.due_date.slice(8, 10));
        if (!day) return toast.error("Não foi possível determinar o dia de vencimento da recorrência.");
        recurrenceDay = Math.min(day, 28);
      }
    }
    setSavingNew(true);
    const referenceMonth = newForm.due_date.slice(0, 7) + "-01";
    const payload = {
      kind: newForm.kind,
      description: newForm.description.trim(),
      supplier: newForm.supplier.trim() || null,
      category: newForm.category.trim() || null,
      amount_due: Number(newForm.amount_due),
      due_date: newForm.due_date,
      reference_month: referenceMonth,
      recurrence_day: recurrenceDay,
      notes: newForm.notes.trim() || null,
    };
    const { data, error } = await supabase.from("payables").insert(payload).select("id").single();
    setSavingNew(false);
    if (error) return toast.error("Erro ao salvar", { description: error.message });
    toast.success("Conta criada");
    setNewOpen(false);
    setNewForm(emptyForm);
    await logAudit("payable.create", data.id, payload);
    load();
  }

  function openPay(p: Payable) {
    setPayTarget(p);
    const remaining = Math.max(
      Number(p.amount_due) - Number(p.amount_paid ?? 0) - Number(p.credit_applied_amount ?? 0),
      0,
    );
    setPayAmount(String(remaining.toFixed(2)));
    setPayMethod("");
    setPayNotes("");
    setPayRemainingDueDate("");
    setPayRemainingDueReason("");
    setPayOverpaymentAction("");
    setPayOpen(true);
  }

  async function savePay(e: React.FormEvent) {
    e.preventDefault();
    if (!payTarget) return;
    const amount = Number(payAmount);
    if (!amount || amount <= 0) return toast.error("Valor inválido");
    const due = Number(payTarget.amount_due);
    const credit = Number(payTarget.credit_applied_amount ?? 0);
    const alreadyPaid = Number(payTarget.amount_paid ?? 0);
    const newPaid = alreadyPaid + amount;
    const newEffectivePaid = newPaid + credit;
    const isPartial = newEffectivePaid < due - 0.001;
    const overpaidAmount = Math.max(newEffectivePaid - due, 0);
    if (isPartial && !payRemainingDueDate) {
      return toast.error("Informe a nova data de vencimento do saldo restante.");
    }
    const isInstallment = payTarget.kind === "avulso" && !!payTarget.installment_group_id;
    const overpaymentAction: "credit" | "increase" | "fee" | "installment_credit_last" | "" =
      overpaidAmount > 0.001
        ? payTarget.kind === "avulso"
          ? (isInstallment ? payOverpaymentAction : "fee")
          : payOverpaymentAction
        : "";
    if (overpaidAmount > 0.001 && !overpaymentAction) {
      return toast.error("Selecione o destino do excedente.");
    }
    setSavingPay(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: pay, error: payErr } = await supabase
      .from("payable_payments")
      .insert({
        payable_id: payTarget.id,
        amount,
        payment_method: payMethod || null,
        notes: payNotes.trim() || null,
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    if (payErr) { setSavingPay(false); return toast.error("Erro ao registrar pagamento", { description: payErr.message }); }

    if (overpaymentAction === "installment_credit_last") {
      if (!payTarget.installment_group_id || payTarget.installment_number == null) {
        setSavingPay(false);
        return toast.error("Esta conta não pertence a um parcelamento válido.");
      }
      const { error: updErr } = await supabase
        .from("payables")
        .update({
          amount_paid: newPaid,
          status: "pago",
          remaining_due_date: null,
          remaining_due_updated_at: new Date().toISOString(),
          remaining_due_updated_by: user?.id ?? null,
          remaining_due_reason: null,
        })
        .eq("id", payTarget.id);
      if (updErr) {
        setSavingPay(false);
        return toast.error("Pagamento registrado mas falhou ao atualizar conta", { description: updErr.message });
      }

      let creditResult: ApplyInstallmentCreditResult | null = null;
      let creditOk = true;
      try {
        creditResult = await applyPayableInstallmentCreditFromLastInstallment({
          sourcePayableId: payTarget.id,
          sourcePaymentId: pay.id,
          installmentGroupId: payTarget.installment_group_id,
          sourceInstallmentNumber: payTarget.installment_number,
          amount: overpaidAmount,
          reason: payNotes.trim() || null,
          createdBy: user?.id ?? null,
        });
      } catch (err) {
        creditOk = false;
        console.error("applyPayableInstallmentCreditFromLastInstallment falhou", err);
      }
      setSavingPay(false);

      const auditOk1 = await logAudit("payable.payment_create", payTarget.id, { payment_id: pay.id, amount, payment_method: payMethod });
      const auditOk2 = await logAudit("payable.installment_overpayment_credit_last", payTarget.id, {
        installment_group_id: payTarget.installment_group_id,
        source_payable_id: payTarget.id,
        source_payment_id: pay.id,
        source_installment_number: payTarget.installment_number,
        overpaid_amount: overpaidAmount,
        applied_targets: creditResult?.appliedTargets.map((t) => ({
          payable_id: t.payableId,
          installment_number: t.installmentNumber,
          amount_applied: t.amountApplied,
        })) ?? [],
        remaining_unapplied_amount: creditResult?.remainingUnapplied ?? overpaidAmount,
      });

      if (!creditOk) {
        toast.error(
          "Pagamento registrado, mas falhou ao abater o excedente das últimas parcelas. Verifique manualmente e ajuste o saldo das parcelas finais.",
        );
      } else if (creditResult && creditResult.remainingUnapplied > 0.001) {
        toast.warning(
          `Pagamento registrado. Apenas ${brl(creditResult.appliedTotal)} do excedente pôde ser abatido nas parcelas futuras (saldo insuficiente nas parcelas restantes). Ajuste manualmente os ${brl(creditResult.remainingUnapplied)} restantes ou aplique taxa adicional.`,
        );
      } else if (!auditOk1 || !auditOk2) {
        toast.warning(
          "Pagamento e crédito registrados, mas a auditoria deste excedente falhou. O crédito já protege este pagamento contra estorno automático, mas registre o ocorrido manualmente se necessário.",
        );
      } else {
        toast.success("Pagamento registrado. Excedente abatido das últimas parcelas do parcelamento.");
      }
      setPayOpen(false);
      load();
      return;
    }

    if (overpaymentAction === "credit") {
      const { error: updErr } = await supabase
        .from("payables")
        .update({
          amount_paid: newPaid,
          status: "pago",
          remaining_due_date: null,
          remaining_due_updated_at: new Date().toISOString(),
          remaining_due_updated_by: user?.id ?? null,
          remaining_due_reason: null,
        })
        .eq("id", payTarget.id);
      setSavingPay(false);
      if (updErr) return toast.error("Pagamento registrado mas falhou ao atualizar conta", { description: updErr.message });
      let creditOk = true;
      try {
        await createCreditApplication({
          module: "payable",
          sourceItemId: payTarget.id,
          sourcePaymentId: pay.id,
          amount: overpaidAmount,
          reason: payNotes.trim() || null,
          createdBy: user?.id ?? null,
        });
      } catch (err) {
        creditOk = false;
        console.error("createCreditApplication falhou", err);
      }
      if (creditOk) {
        try {
          await applyPendingCredits("payable");
        } catch (err) {
          console.warn("applyPendingCredits(payable) falhou", err);
        }
      }
      const auditOk1 = await logAudit("payable.payment_create", payTarget.id, { payment_id: pay.id, amount, payment_method: payMethod });
      const auditOk2 = await logAudit("payable.overpayment_credit_next", payTarget.id, {
        payment_id: pay.id, amount_due_before: due, payment_amount: amount, amount_paid_after: newPaid,
        overpaid_amount: overpaidAmount, overpayment_action: "credit",
      });
      if (!creditOk) {
        toast.error(
          "Pagamento registrado, mas falhou ao registrar o crédito para a próxima conta. Verifique manualmente e ajuste o saldo da próxima conta.",
        );
      } else if (!auditOk1 || !auditOk2) {
        toast.warning(
          "Pagamento e crédito registrados, mas a auditoria deste excedente falhou. O crédito já protege este pagamento contra estorno automático, mas registre o ocorrido manualmente se necessário.",
        );
      } else {
        toast.success("Pagamento registrado. Excedente reservado como crédito para a próxima conta.");
      }
      setPayOpen(false);
      load();
      return;
    }

    if (overpaymentAction === "increase") {
      const { error: updErr } = await supabase
        .from("payables")
        .update({
          amount_due: newEffectivePaid,
          amount_paid: newPaid,
          status: "pago",
          remaining_due_date: null,
          remaining_due_updated_at: new Date().toISOString(),
          remaining_due_updated_by: user?.id ?? null,
          remaining_due_reason: null,
        })
        .eq("id", payTarget.id);
      if (updErr) { setSavingPay(false); return toast.error("Pagamento registrado mas falhou ao atualizar conta", { description: updErr.message }); }
      let affectedFutureCount = 0;
      let increaseOk = true;
      try {
        const res = await increaseRecurringAmount(
          { id: payTarget.id, parent_payable_id: payTarget.parent_payable_id, reference_month: payTarget.reference_month },
          newEffectivePaid,
        );
        affectedFutureCount = res.affectedFutureCount;
      } catch (err) {
        increaseOk = false;
        toast.warning("Pagamento registrado, mas falhou ao atualizar o modelo/próximas contas.", {
          description: err instanceof Error ? err.message : String(err),
        });
      }
      setSavingPay(false);
      const auditOk1 = await logAudit("payable.payment_create", payTarget.id, { payment_id: pay.id, amount, payment_method: payMethod });
      const auditOk2 = await logAudit("payable.overpayment_recurring_amount_increase", payTarget.id, {
        payment_id: pay.id, amount_due_before: due, amount_due_after: newEffectivePaid, payment_amount: amount,
        amount_paid_after: newPaid, overpaid_amount: overpaidAmount, overpayment_action: "increase",
        affected_future_count: affectedFutureCount,
      });
      if (!auditOk1 || !auditOk2) {
        toast.warning(
          "Pagamento registrado, mas a auditoria deste excedente falhou. O estorno automático deste pagamento pode não ficar bloqueado — verifique manualmente se necessário.",
        );
      } else if (increaseOk) {
        toast.success("Pagamento registrado. Valor da recorrência atualizado.");
      }
      setPayOpen(false);
      load();
      return;
    }

    const newAmountDue = overpaymentAction === "fee" ? due + overpaidAmount : due;
    const newStatus: PayableStatus = newEffectivePaid >= newAmountDue - 0.001 ? "pago" : "parcial";
    const { error: updErr } = await supabase
      .from("payables")
      .update({
        amount_due: newAmountDue,
        amount_paid: newPaid,
        status: newStatus,
        remaining_due_date: isPartial ? payRemainingDueDate : null,
        remaining_due_updated_at: new Date().toISOString(),
        remaining_due_updated_by: user?.id ?? null,
        remaining_due_reason: isPartial ? (payRemainingDueReason || null) : null,
      })
      .eq("id", payTarget.id);
    setSavingPay(false);
    if (updErr) return toast.error("Pagamento registrado mas falhou ao atualizar conta", { description: updErr.message });
    const auditOkCreate = await logAudit("payable.payment_create", payTarget.id, { payment_id: pay.id, amount, payment_method: payMethod });
    let auditOkFee = true;
    if (overpaymentAction === "fee") {
      auditOkFee = await logAudit(
        isInstallment ? "payable.installment_overpayment_current_fee" : "payable.overpayment_current_fee",
        payTarget.id,
        {
          payment_id: pay.id, amount_due_before: due, amount_due_after: newAmountDue, payment_amount: amount,
          amount_paid_after: newPaid, overpaid_amount: overpaidAmount, overpayment_action: "fee",
          installment_group_id: payTarget.installment_group_id,
        },
      );
    }
    if (isPartial) {
      await logAudit("payable.partial_remaining_due_set", payTarget.id, {
        payment_id: pay.id,
        remaining_due_date: payRemainingDueDate,
        reason: payRemainingDueReason || null,
      });
    }
    if (overpaymentAction === "fee" && (!auditOkCreate || !auditOkFee)) {
      toast.warning(
        "Pagamento registrado e taxa aplicada, mas a auditoria deste excedente falhou. O estorno automático deste pagamento pode não ficar bloqueado — verifique manualmente se necessário.",
      );
    } else {
      toast.success("Pagamento registrado");
    }
    setPayOpen(false);
    load();
  }

  async function openHistory(p: Payable) {
    setHistTarget(p);
    setHistPayments([]);
    setHistOpen(true);
    setLoadingHist(true);
    const { data } = await supabase
      .from("payable_payments")
      .select("*")
      .eq("payable_id", p.id)
      .order("paid_at", { ascending: false });
    setHistPayments((data ?? []) as PayablePayment[]);
    setLoadingHist(false);
  }

  async function reversePayment(payment: PayablePayment) {
    if (!histTarget) return;
    if (await paymentHasOverpaymentTreatment("payable", payment.id)) {
      toast.error(
        "Este pagamento possui tratamento de excedente. Estorne manualmente o crédito/ajuste antes de estornar o pagamento.",
      );
      return;
    }
    const reason = window.prompt("Motivo do estorno:");
    if (reason === null) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("payable_payments")
      .update({
        status: "estornado",
        reversed_at: new Date().toISOString(),
        reversed_by: user?.id ?? null,
        reverse_reason: reason || "Estorno",
      })
      .eq("id", payment.id);
    if (error) return toast.error("Erro ao estornar", { description: error.message });

    // Recompute amount_paid from active payments
    const { data: actives } = await supabase
      .from("payable_payments")
      .select("amount")
      .eq("payable_id", histTarget.id)
      .eq("status", "ativo");
    const totalPaid = (actives ?? []).reduce((s, r) => s + Number(r.amount), 0);
    const newStatus: PayableStatus = totalPaid <= 0 ? "a_pagar" : totalPaid >= Number(histTarget.amount_due) - 0.001 ? "pago" : "parcial";
    await supabase.from("payables").update({ amount_paid: totalPaid, status: newStatus }).eq("id", histTarget.id);

    toast.success("Estorno registrado");
    await logAudit("payable.payment_reverse", histTarget.id, { payment_id: payment.id, reason });
    openHistory(histTarget);
    load();
  }

  function hasPaymentRisk(p: Payable): boolean {
    return p.status === "pago" || p.status === "parcial" || Number(p.amount_paid) > 0;
  }

  // Para parcelas avulsas, bloqueia edição/cancelamento/exclusão também quando
  // já recebeu crédito de outra parcela (mesmo sem pagamento próprio nem
  // mudança de status), conforme regra exigida só para parcelamento.
  function hasInstallmentRisk(p: Payable): boolean {
    return hasPaymentRisk(p) || Number(p.credit_applied_amount ?? 0) > 0;
  }

  function monthYearLabel(referenceMonth: string): string {
    return `${referenceMonth.slice(5, 7)}/${referenceMonth.slice(0, 4)}`;
  }

  function openCancel(p: Payable) {
    setCancelTarget(p);
    setCancelReason("");
    setCancelScope("current");
    setCancelOpen(true);
  }

  async function saveCancel(e: React.FormEvent) {
    e.preventDefault();
    if (!cancelTarget) return;
    const isRecurring = cancelTarget.kind === "recorrente";
    const isInstallment = cancelTarget.kind === "avulso" && !!cancelTarget.installment_group_id;
    if (isInstallment && hasInstallmentRisk(cancelTarget)) {
      return toast.error(
        "Esta parcela já possui pagamento ou crédito aplicado. Cancelamento bloqueado para preservar o histórico financeiro.",
      );
    }
    if (isRecurring && !cancelReason.trim()) {
      return toast.error("Informe o motivo do cancelamento.");
    }
    setSavingCancel(true);
    const { data: { user } } = await supabase.auth.getUser();

    if ((!isRecurring && !isInstallment) || cancelScope === "current") {
      const { error } = await supabase
        .from("payables")
        .update({
          status: "cancelado",
          cancel_reason: cancelReason.trim() || null,
          cancelled_at: new Date().toISOString(),
          cancelled_by: user?.id ?? null,
        })
        .eq("id", cancelTarget.id);
      setSavingCancel(false);
      if (error) return toast.error("Erro ao cancelar", { description: error.message });
      toast.success("Conta cancelada");
      setCancelOpen(false);
      await logAudit(
        isRecurring ? "payable.recurring_cancel_current" : isInstallment ? "payable.installment_cancel_current" : "payable.cancel",
        cancelTarget.id,
        {
          selected_payable_id: cancelTarget.id,
          model_payable_id: cancelTarget.parent_payable_id,
          installment_group_id: cancelTarget.installment_group_id,
          scope: "current",
          reference_month: cancelTarget.reference_month,
          reason: cancelReason.trim() || null,
        },
      );
      load();
      return;
    }

    if (isInstallment && cancelTarget.installment_group_id) {
      // scope === "future": cancela parcelas em aberto (sem pagamento/crédito) a partir desta
      const { data: candidates, error: candErr } = await supabase
        .from("payables")
        .select("id,status,amount_paid,credit_applied_amount")
        .eq("installment_group_id", cancelTarget.installment_group_id)
        .gte("installment_number", cancelTarget.installment_number ?? 0);
      if (candErr) {
        setSavingCancel(false);
        return toast.error("Erro ao buscar parcelamento", { description: candErr.message });
      }
      const rows = candidates ?? [];
      const toCancel = rows.filter(
        (c) => (c.status === "a_pagar" || c.status === "atrasado") && Number(c.amount_paid) === 0 && Number(c.credit_applied_amount ?? 0) === 0,
      );
      const preserved = rows.length - toCancel.length;

      if (toCancel.length > 0) {
        const { error: updErr } = await supabase
          .from("payables")
          .update({
            status: "cancelado",
            cancel_reason: cancelReason.trim() || null,
            cancelled_at: new Date().toISOString(),
            cancelled_by: user?.id ?? null,
          })
          .in("id", toCancel.map((c) => c.id));
        if (updErr) {
          setSavingCancel(false);
          return toast.error("Erro ao cancelar parcelas", { description: updErr.message });
        }
      }
      setSavingCancel(false);
      toast.success("Parcelas canceladas", {
        description: `${toCancel.length} parcela(s) em aberto foram canceladas. ${preserved} parcela(s) paga(s)/parcial(is)/com crédito foram preservadas.`,
      });
      setCancelOpen(false);
      await logAudit("payable.installment_cancel_future", cancelTarget.id, {
        selected_payable_id: cancelTarget.id,
        installment_group_id: cancelTarget.installment_group_id,
        scope: "future",
        affected_count: toCancel.length,
        preserved_count: preserved,
        reason: cancelReason.trim() || null,
      });
      load();
      return;
    }

    // scope === "future": cancela instâncias futuras sem pagamento + o modelo
    const modelId = cancelTarget.parent_payable_id ?? cancelTarget.id;
    const { data: candidates, error: candErr } = await supabase
      .from("payables")
      .select("id,status,amount_paid")
      .eq("parent_payable_id", modelId)
      .gte("reference_month", cancelTarget.reference_month);
    if (candErr) {
      setSavingCancel(false);
      return toast.error("Erro ao buscar recorrência", { description: candErr.message });
    }
    const rows = candidates ?? [];
    const toCancel = rows.filter((c) => (c.status === "a_pagar" || c.status === "atrasado") && Number(c.amount_paid) === 0);
    const skippedPaid = rows.filter((c) => c.status === "pago").length;
    const skippedPartial = rows.filter((c) => c.status === "parcial").length;

    if (toCancel.length > 0) {
      const { error: updErr } = await supabase
        .from("payables")
        .update({
          status: "cancelado",
          cancel_reason: cancelReason.trim(),
          cancelled_at: new Date().toISOString(),
          cancelled_by: user?.id ?? null,
        })
        .in("id", toCancel.map((c) => c.id));
      if (updErr) {
        setSavingCancel(false);
        return toast.error("Erro ao cancelar recorrência", { description: updErr.message });
      }
    }

    await supabase
      .from("payables")
      .update({
        status: "cancelado",
        cancel_reason: `Recorrência cancelada a partir de ${monthYearLabel(cancelTarget.reference_month)}: ${cancelReason.trim()}`,
        cancelled_at: new Date().toISOString(),
        cancelled_by: user?.id ?? null,
      })
      .eq("id", modelId);

    setSavingCancel(false);
    toast.success("Recorrência cancelada", {
      description: `${toCancel.length} conta(s) futuras foram canceladas. ${skippedPaid + skippedPartial} conta(s) pagas/parciais foram preservadas e devem ser tratadas manualmente, se necessário.`,
    });
    setCancelOpen(false);
    await logAudit("payable.recurring_cancel_future", cancelTarget.id, {
      selected_payable_id: cancelTarget.id,
      model_payable_id: modelId,
      scope: "future",
      reference_month: cancelTarget.reference_month,
      affected_count: toCancel.length,
      skipped_paid_count: skippedPaid,
      skipped_partial_count: skippedPartial,
      reason: cancelReason.trim(),
    });
    load();
  }

  function openEdit(p: Payable) {
    const isInstallment = p.kind === "avulso" && !!p.installment_group_id;
    const risky = isInstallment ? hasInstallmentRisk(p) : hasPaymentRisk(p);
    if (risky) {
      toast.error(
        isInstallment
          ? "Esta parcela já possui pagamento ou crédito aplicado. Edição de valor/vencimento bloqueada para preservar o histórico financeiro."
          : "Esta conta já possui pagamento registrado. Para preservar o histórico financeiro, edite manualmente apenas campos não financeiros ou estorne o pagamento antes de alterar valor/vencimento.",
      );
      return;
    }
    setEditTarget(p);
    setEditScope("current");
    setEditForm({
      description: p.description,
      supplier: p.supplier ?? "",
      category: p.category ?? "",
      amount_due: String(p.amount_due),
      due_date: p.due_date,
      recurrence_day: p.recurrence_day ? String(p.recurrence_day) : "",
      notes: p.notes ?? "",
    });
    setEditOpen(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    if (!editForm.description.trim()) return toast.error("Descrição é obrigatória");
    if (!editForm.amount_due || Number(editForm.amount_due) <= 0) return toast.error("Valor inválido");
    if (!editForm.due_date) return toast.error("Vencimento é obrigatório");
    const isInstallment = editTarget.kind === "avulso" && !!editTarget.installment_group_id;
    const riskyEdit = isInstallment ? hasInstallmentRisk(editTarget) : hasPaymentRisk(editTarget);
    if (riskyEdit) {
      return toast.error(
        isInstallment
          ? "Esta parcela já possui pagamento ou crédito aplicado. Edição bloqueada."
          : "Esta conta já possui pagamento registrado. Edição bloqueada.",
      );
    }

    setSavingEdit(true);
    const isRecurring = editTarget.kind === "recorrente";
    const recurrenceDay = editForm.recurrence_day ? Math.min(Number(editForm.recurrence_day), 28) : null;
    const baseFields = {
      description: editForm.description.trim(),
      supplier: editForm.supplier.trim() || null,
      category: editForm.category.trim() || null,
      notes: editForm.notes.trim() || null,
    };
    const changedFields = ["description", "supplier", "category", "notes", "amount_due", "due_date", "recurrence_day"];

    if (isInstallment && editScope === "future" && editTarget.installment_group_id) {
      const { data: candidates, error: candErr } = await supabase
        .from("payables")
        .select("id,status,amount_paid,credit_applied_amount")
        .eq("installment_group_id", editTarget.installment_group_id)
        .gte("installment_number", editTarget.installment_number ?? 0);
      if (candErr) {
        setSavingEdit(false);
        return toast.error("Erro ao buscar parcelamento", { description: candErr.message });
      }
      const rows = candidates ?? [];
      const editable = rows.filter(
        (c) => (c.status === "a_pagar" || c.status === "atrasado") && Number(c.amount_paid) === 0 && Number(c.credit_applied_amount ?? 0) === 0,
      );
      const preserved = rows.length - editable.length;

      for (const inst of editable) {
        const isCurrent = inst.id === editTarget.id;
        const { error: instErr } = await supabase
          .from("payables")
          .update({
            ...baseFields,
            amount_due: Number(editForm.amount_due),
            ...(isCurrent ? { due_date: editForm.due_date } : {}),
          })
          .eq("id", inst.id);
        if (instErr) console.warn("[PayablesPanel] falha ao atualizar parcela", inst.id, instErr);
      }

      setSavingEdit(false);
      toast.success("Parcelas atualizadas", {
        description: `${editable.length} parcela(s) em aberto foram alteradas. ${preserved} parcela(s) paga(s)/parcial(is)/com crédito foram preservadas.`,
      });
      setEditOpen(false);
      await logAudit("payable.installment_edit_future", editTarget.id, {
        selected_payable_id: editTarget.id,
        installment_group_id: editTarget.installment_group_id,
        scope: "future",
        changed_fields: changedFields,
        affected_count: editable.length,
        preserved_count: preserved,
      });
      load();
      return;
    }

    if (!isRecurring || editScope === "current") {
      const { error } = await supabase
        .from("payables")
        .update({
          ...baseFields,
          amount_due: Number(editForm.amount_due),
          due_date: editForm.due_date,
          recurrence_day: recurrenceDay,
        })
        .eq("id", editTarget.id);
      setSavingEdit(false);
      if (error) return toast.error("Erro ao salvar", { description: error.message });
      toast.success("Conta atualizada");
      setEditOpen(false);
      await logAudit(
        isRecurring ? "payable.recurring_edit_current" : isInstallment ? "payable.installment_edit_current" : "payable.edit",
        editTarget.id,
        {
          selected_payable_id: editTarget.id,
          model_payable_id: editTarget.parent_payable_id,
          installment_group_id: editTarget.installment_group_id,
          scope: "current",
          reference_month: editTarget.reference_month,
          changed_fields: changedFields,
        },
      );
      load();
      return;
    }

    // scope === "future": atualiza o modelo + instâncias futuras sem pagamento
    const modelId = editTarget.parent_payable_id ?? editTarget.id;
    const { error: modelErr } = await supabase
      .from("payables")
      .update({ ...baseFields, amount_due: Number(editForm.amount_due), recurrence_day: recurrenceDay })
      .eq("id", modelId);
    if (modelErr) {
      setSavingEdit(false);
      return toast.error("Erro ao atualizar modelo da recorrência", { description: modelErr.message });
    }

    const { data: candidates, error: candErr } = await supabase
      .from("payables")
      .select("id,status,amount_paid,reference_month")
      .eq("parent_payable_id", modelId)
      .gte("reference_month", editTarget.reference_month);
    if (candErr) {
      setSavingEdit(false);
      return toast.error("Erro ao buscar recorrência", { description: candErr.message });
    }
    const rows = candidates ?? [];
    const editable = rows.filter((c) => (c.status === "a_pagar" || c.status === "atrasado") && Number(c.amount_paid) === 0);
    const skippedPaid = rows.filter((c) => c.status === "pago").length;
    const skippedPartial = rows.filter((c) => c.status === "parcial").length;

    for (const inst of editable) {
      const newDue = recurrenceDay ? buildDueDateForMonth(inst.reference_month, recurrenceDay) : editForm.due_date;
      const { error: instErr } = await supabase
        .from("payables")
        .update({ ...baseFields, amount_due: Number(editForm.amount_due), due_date: newDue, recurrence_day: recurrenceDay })
        .eq("id", inst.id);
      if (instErr) console.warn("[PayablesPanel] falha ao atualizar instância", inst.id, instErr);
    }

    setSavingEdit(false);
    toast.success("Recorrência atualizada", {
      description: `${editable.length} conta(s) futuras foram alteradas. ${skippedPaid + skippedPartial} conta(s) paga(s)/parcial(is) foram preservadas.`,
    });
    setEditOpen(false);
    await logAudit("payable.recurring_edit_future", editTarget.id, {
      selected_payable_id: editTarget.id,
      model_payable_id: modelId,
      scope: "future",
      reference_month: editTarget.reference_month,
      changed_fields: changedFields,
      affected_count: editable.length,
      skipped_paid_count: skippedPaid,
      skipped_partial_count: skippedPartial,
    });
    load();
  }

  function openDelete(p: Payable) {
    setDeleteTarget(p);
    setDeleteScope("current");
    setDeleteConfirmChecked(false);
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const isRecurring = deleteTarget.kind === "recorrente";
    const isInstallment = deleteTarget.kind === "avulso" && !!deleteTarget.installment_group_id;

    if ((!isRecurring && !isInstallment) || deleteScope === "current") {
      if (isInstallment) {
        if (hasInstallmentRisk(deleteTarget)) {
          toast.error(
            "Esta parcela já possui pagamento ou crédito aplicado. Exclusão bloqueada para preservar o histórico financeiro.",
          );
          return;
        }
      } else if (hasPaymentRisk(deleteTarget) && !deleteConfirmChecked) {
        toast.error("Confirme que entende que o histórico de pagamento será apagado.");
        return;
      }
      setDeleting(true);
      const { error } = await supabase.from("payables").delete().eq("id", deleteTarget.id);
      setDeleting(false);
      if (error) return toast.error("Erro ao excluir", { description: error.message });
      toast.success("Conta excluída");
      setDeleteOpen(false);
      await logAudit(
        isRecurring ? "payable.recurring_delete_current" : isInstallment ? "payable.installment_delete_current" : "payable.delete_current",
        deleteTarget.id,
        {
          selected_payable_id: deleteTarget.id,
          model_payable_id: deleteTarget.parent_payable_id,
          installment_group_id: deleteTarget.installment_group_id,
          scope: "current",
          had_payment: hasPaymentRisk(deleteTarget),
        },
      );
      load();
      return;
    }

    if (isInstallment && deleteTarget.installment_group_id) {
      setDeleting(true);
      const { data: candidates, error: candErr } = await supabase
        .from("payables")
        .select("id,status,amount_paid,credit_applied_amount")
        .eq("installment_group_id", deleteTarget.installment_group_id)
        .gte("installment_number", deleteTarget.installment_number ?? 0);
      if (candErr) {
        setDeleting(false);
        return toast.error("Erro ao buscar parcelamento", { description: candErr.message });
      }
      const rows = candidates ?? [];
      const deletable = rows.filter(
        (c) =>
          Number(c.amount_paid) === 0 &&
          Number(c.credit_applied_amount ?? 0) === 0 &&
          (c.status === "a_pagar" || c.status === "atrasado" || c.status === "cancelado"),
      );
      const preserved = rows.length - deletable.length;

      if (deletable.length > 0) {
        const { error: delErr } = await supabase.from("payables").delete().in("id", deletable.map((c) => c.id));
        if (delErr) {
          setDeleting(false);
          return toast.error("Erro ao excluir parcelas", { description: delErr.message });
        }
      }
      setDeleting(false);
      toast.success("Exclusão concluída", {
        description: `${deletable.length} parcela(s) sem pagamento/crédito foram excluídas. ${preserved} parcela(s) paga(s)/parcial(is)/com crédito foram preservadas.`,
      });
      setDeleteOpen(false);
      await logAudit("payable.installment_delete_future", deleteTarget.id, {
        selected_payable_id: deleteTarget.id,
        installment_group_id: deleteTarget.installment_group_id,
        scope: "future",
        affected_count: deletable.length,
        preserved_count: preserved,
      });
      load();
      return;
    }

    // scope === "future": exclui instâncias futuras sem pagamento + cancela o modelo
    setDeleting(true);
    const modelId = deleteTarget.parent_payable_id ?? deleteTarget.id;
    const { data: candidates, error: candErr } = await supabase
      .from("payables")
      .select("id,status,amount_paid")
      .eq("parent_payable_id", modelId)
      .gte("reference_month", deleteTarget.reference_month);
    if (candErr) {
      setDeleting(false);
      return toast.error("Erro ao buscar recorrência", { description: candErr.message });
    }
    const rows = candidates ?? [];
    const deletable = rows.filter(
      (c) => Number(c.amount_paid) === 0 && (c.status === "a_pagar" || c.status === "atrasado" || c.status === "cancelado"),
    );
    const skippedPaid = rows.filter((c) => c.status === "pago").length;
    const skippedPartial = rows.filter((c) => c.status === "parcial").length;

    if (deletable.length > 0) {
      const { error: delErr } = await supabase.from("payables").delete().in("id", deletable.map((c) => c.id));
      if (delErr) {
        setDeleting(false);
        return toast.error("Erro ao excluir recorrência", { description: delErr.message });
      }
    }

    const { data: { user } } = await supabase.auth.getUser();
    await supabase
      .from("payables")
      .update({
        status: "cancelado",
        cancel_reason: "Recorrência excluída (instâncias futuras sem pagamento removidas)",
        cancelled_at: new Date().toISOString(),
        cancelled_by: user?.id ?? null,
      })
      .eq("id", modelId);

    setDeleting(false);
    toast.success("Exclusão concluída", {
      description: `${deletable.length} conta(s) sem pagamento foram excluídas. ${skippedPaid + skippedPartial} conta(s) pagas/parciais foram preservadas e só podem ser excluídas manualmente.`,
    });
    setDeleteOpen(false);
    await logAudit("payable.recurring_delete_future", deleteTarget.id, {
      selected_payable_id: deleteTarget.id,
      model_payable_id: modelId,
      scope: "future",
      affected_count: deletable.length,
      skipped_paid_count: skippedPaid,
      skipped_partial_count: skippedPartial,
    });
    load();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-muted-foreground">Despesas e obrigações financeiras da clínica.</p>
        </div>
        {canEdit && (
          <Button onClick={() => { setNewForm(emptyForm); setNewOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Nova conta
          </Button>
        )}
      </div>

      {/* Month navigator */}
      <MonthNavigator value={monthRef} onChange={setMonthRef} />

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">A pagar</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-serif text-2xl text-warning">{loading ? "—" : brl(summary.aPagar)}</p>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pago</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-serif text-2xl text-success">{loading ? "—" : brl(summary.pago)}</p>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
              <TrendingDown className="h-3.5 w-3.5" /> Em atraso
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-serif text-2xl text-destructive">{loading ? "—" : brl(summary.atrasado)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters + table */}
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar descrição, fornecedor..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as PayableStatus | "all")}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {(Object.keys(STATUS_LABELS) as PayableStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Pago</TableHead>
                  {canEdit && <TableHead className="text-right">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={canEdit ? 8 : 7} className="py-8 text-center text-muted-foreground">Carregando…</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={canEdit ? 8 : 7} className="py-8 text-center text-muted-foreground">Nenhuma conta encontrada.</TableCell></TableRow>
                ) : filtered.map((p) => {
                  const eff = computeEffectiveStatus(p);
                  return (
                    <TableRow key={p.id} className={eff === "cancelado" ? "opacity-50" : ""}>
                      <TableCell className="font-medium">
                        <div>{p.description}</div>
                        {p.kind === "recorrente" && (
                          <span className="text-[10px] text-muted-foreground">
                            Recorrente · dia {p.recurrence_day ?? "—"}
                            {p.parent_payable_id === null && " · modelo"}
                          </span>
                        )}
                        {p.installment_group_id && (
                          <span className="block text-[10px] text-muted-foreground">
                            Parcela {p.installment_number}/{p.installment_total}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.supplier ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.category ?? "—"}</TableCell>
                      <TableCell className="text-sm">{p.due_date ? format(new Date(p.due_date + "T12:00:00"), "dd/MM/yyyy") : "—"}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[eff]}>{STATUS_LABELS[eff]}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{brl(p.amount_due)}</TableCell>
                      <TableCell className="text-right">{brl(p.amount_paid)}</TableCell>
                      {canEdit && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon" variant="ghost"
                              title="Histórico de pagamentos"
                              onClick={() => openHistory(p)}
                            >
                              <History className="h-4 w-4" />
                            </Button>
                            {eff !== "cancelado" && eff !== "pago" && (
                              <Button
                                size="icon" variant="ghost"
                                title="Registrar pagamento"
                                onClick={() => openPay(p)}
                              >
                                <Check className="h-4 w-4 text-success" />
                              </Button>
                            )}
                            {eff !== "cancelado" && (
                              <Button
                                size="icon" variant="ghost"
                                title="Editar conta"
                                onClick={() => openEdit(p)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            {eff !== "cancelado" && (
                              <Button
                                size="icon" variant="ghost"
                                title="Cancelar conta"
                                onClick={() => openCancel(p)}
                              >
                                <Ban className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                            <Button
                              size="icon" variant="ghost"
                              title="Excluir conta"
                              onClick={() => openDelete(p)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Modal: nova conta */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Nova conta a pagar</DialogTitle>
            <DialogDescription>Registre uma despesa avulsa ou recorrente.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveNew} className="space-y-4">
            <div className="space-y-2">
              <Label>Tipo *</Label>
              <Select value={newForm.kind} onValueChange={(v) => setNewForm({ ...newForm, kind: v as "avulso" | "recorrente" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="avulso">Avulso</SelectItem>
                  <SelectItem value="recorrente">Recorrente</SelectItem>
                </SelectContent>
              </Select>
              {newForm.kind === "recorrente" && (
                <p className="text-xs text-muted-foreground">
                  O dia de recorrência será o mesmo dia do vencimento informado abaixo.
                </p>
              )}
            </div>
            {newForm.kind === "avulso" && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="new-parcelado"
                  checked={newForm.parcelado}
                  onCheckedChange={(v) => setNewForm({ ...newForm, parcelado: v === true })}
                />
                <Label htmlFor="new-parcelado" className="cursor-pointer font-normal">Parcelar esta despesa</Label>
              </div>
            )}
            <div className="space-y-2">
              <Label>Descrição *</Label>
              <Input required maxLength={200} value={newForm.description}
                onChange={(e) => setNewForm({ ...newForm, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Fornecedor</Label>
                <Input maxLength={100} value={newForm.supplier}
                  onChange={(e) => setNewForm({ ...newForm, supplier: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Input maxLength={80} placeholder="ex: Aluguel, Utilities…" value={newForm.category}
                  onChange={(e) => setNewForm({ ...newForm, category: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{newForm.parcelado ? "Valor total (R$) *" : "Valor (R$) *"}</Label>
                <Input type="number" min={0.01} step={0.01} required value={newForm.amount_due}
                  onChange={(e) => setNewForm({ ...newForm, amount_due: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>{newForm.parcelado ? "Data da primeira parcela *" : "Vencimento *"}</Label>
                <Input type="date" required value={newForm.due_date}
                  onChange={(e) => setNewForm({ ...newForm, due_date: e.target.value })} />
              </div>
            </div>
            {newForm.parcelado && (
              <div className="space-y-2">
                <Label>Quantidade de parcelas *</Label>
                <Input type="number" min={2} step={1} required value={newForm.installments_count}
                  onChange={(e) => setNewForm({ ...newForm, installments_count: e.target.value })} />
                {Number(newForm.amount_due) > 0 && Number(newForm.installments_count) > 1 && (
                  <p className="text-xs text-muted-foreground">
                    {newForm.installments_count}x de {brl(computeInstallmentAmounts(Number(newForm.amount_due), Number(newForm.installments_count))[0])}
                    {" "}(última parcela: {brl(computeInstallmentAmounts(Number(newForm.amount_due), Number(newForm.installments_count)).at(-1) ?? 0)})
                  </p>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea rows={2} maxLength={500} value={newForm.notes}
                onChange={(e) => setNewForm({ ...newForm, notes: e.target.value })} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={savingNew}>{savingNew ? "Salvando…" : "Salvar"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: registrar pagamento */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">Registrar pagamento</DialogTitle>
            <DialogDescription>{payTarget?.description}</DialogDescription>
          </DialogHeader>
          <form onSubmit={savePay} className="space-y-4">
            {payTarget && (
              <div className="rounded-lg border bg-card/50 p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Total:</span><span>{brl(payTarget.amount_due)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Já pago:</span><span>{brl(payTarget.amount_paid)}</span></div>
                {Number(payTarget.credit_applied_amount ?? 0) > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Crédito aplicado:</span><span>{brl(payTarget.credit_applied_amount ?? 0)}</span></div>
                )}
                <div className="flex justify-between font-medium"><span>Saldo:</span><span>{brl(Math.max(Number(payTarget.amount_due) - Number(payTarget.amount_paid) - Number(payTarget.credit_applied_amount ?? 0), 0))}</span></div>
              </div>
            )}
            <div className="space-y-2">
              <Label>Valor a pagar (R$) *</Label>
              <Input type="number" min={0.01} step={0.01} required value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)} />
            </div>
            {payTarget &&
              Number(payAmount || 0) + Number(payTarget.amount_paid ?? 0) + Number(payTarget.credit_applied_amount ?? 0) <
                Number(payTarget.amount_due) - 0.001 && (
                <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                  <p className="text-sm font-medium">
                    Pagamento parcial — informe a nova data de vencimento do saldo restante.
                  </p>
                  <div className="space-y-2">
                    <Label>Nova data de vencimento do saldo *</Label>
                    <Input type="date" value={payRemainingDueDate}
                      onChange={(e) => setPayRemainingDueDate(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Motivo (opcional)</Label>
                    <Input value={payRemainingDueReason}
                      onChange={(e) => setPayRemainingDueReason(e.target.value)} />
                  </div>
                </div>
              )}
            {payTarget &&
              Number(payAmount || 0) + Number(payTarget.amount_paid ?? 0) + Number(payTarget.credit_applied_amount ?? 0) >
                Number(payTarget.amount_due) + 0.001 && (
                <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                  <p className="text-sm font-medium">
                    {payTarget.installment_group_id ? "Pagamento maior que o valor da parcela" : "Pagamento maior que o valor da conta"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Foi identificado um pagamento maior que o saldo {payTarget.installment_group_id ? "da parcela" : "da conta"}. Como deseja tratar o excedente?
                  </p>
                  {payTarget.kind === "avulso" && payTarget.installment_group_id ? (
                    <RadioGroup value={payOverpaymentAction} onValueChange={(v) => setPayOverpaymentAction(v as typeof payOverpaymentAction)}>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="installment_credit_last" id="po-installment-credit" />
                        <Label htmlFor="po-installment-credit" className="font-normal cursor-pointer">Abater das últimas parcelas do parcelamento</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="fee" id="po-installment-fee" />
                        <Label htmlFor="po-installment-fee" className="font-normal cursor-pointer">Taxa adicional apenas para esta parcela</Label>
                      </div>
                    </RadioGroup>
                  ) : payTarget.kind === "avulso" ? (
                    <p className="text-sm">
                      O excedente será adicionado como taxa adicional apenas para esta conta.
                    </p>
                  ) : (
                    <RadioGroup value={payOverpaymentAction} onValueChange={(v) => setPayOverpaymentAction(v as typeof payOverpaymentAction)}>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="credit" id="po-credit" />
                        <Label htmlFor="po-credit" className="font-normal cursor-pointer">Crédito para a próxima conta</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="increase" id="po-increase" />
                        <Label htmlFor="po-increase" className="font-normal cursor-pointer">Aumento do valor real da recorrência</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="fee" id="po-fee" />
                        <Label htmlFor="po-fee" className="font-normal cursor-pointer">Taxa adicional apenas para esta conta</Label>
                      </div>
                    </RadioGroup>
                  )}
                </div>
              )}
            <div className="space-y-2">
              <Label>Forma de pagamento</Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea rows={2} value={payNotes} onChange={(e) => setPayNotes(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPayOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={savingPay}>{savingPay ? "Salvando…" : "Confirmar"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: histórico de pagamentos */}
      <Dialog open={histOpen} onOpenChange={setHistOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">Histórico de pagamentos</DialogTitle>
            <DialogDescription>{histTarget?.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {loadingHist ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Carregando…</p>
            ) : histPayments.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Nenhum pagamento registrado.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead>Status</TableHead>
                    {canEdit && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {histPayments.map((pay) => (
                    <TableRow key={pay.id} className={pay.status === "estornado" ? "opacity-50 line-through" : ""}>
                      <TableCell className="text-sm">{format(new Date(pay.paid_at), "dd/MM/yyyy HH:mm")}</TableCell>
                      <TableCell>{brl(pay.amount)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{pay.payment_method ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={pay.status === "estornado" ? "secondary" : "default"}>
                          {pay.status === "estornado" ? "Estornado" : "Ativo"}
                        </Badge>
                      </TableCell>
                      {canEdit && (
                        <TableCell>
                          {pay.status === "ativo" && (
                            <Button size="icon" variant="ghost" title="Estornar" onClick={() => reversePayment(pay)}>
                              <Undo2 className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: cancelar conta */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">
              {cancelTarget?.kind === "recorrente"
                ? "Cancelar conta recorrente"
                : cancelTarget?.installment_group_id
                  ? "Cancelar parcela"
                  : "Cancelar conta"}
            </DialogTitle>
            <DialogDescription>
              {cancelTarget?.kind === "recorrente"
                ? "Esta conta pertence a uma recorrência. Escolha se deseja cancelar apenas esta conta ou esta e as próximas recorrências."
                : cancelTarget?.installment_group_id
                  ? "Esta conta pertence a um parcelamento. Escolha se deseja cancelar apenas esta parcela ou esta e as próximas parcelas em aberto."
                  : cancelTarget?.description}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveCancel} className="space-y-4">
            {cancelTarget?.kind === "recorrente" && cancelTarget.parent_payable_id === null && (
              <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
                Este é o modelo desta recorrência. Cancelar impede a geração automática nos próximos meses. As instâncias já criadas não são afetadas.
              </p>
            )}
            {cancelTarget?.kind === "recorrente" && (
              <RadioGroup value={cancelScope} onValueChange={(v) => setCancelScope(v as "current" | "future")}>
                <Label className="flex items-center gap-2 rounded-md border p-2 cursor-pointer">
                  <RadioGroupItem value="current" /> Cancelar apenas esta conta
                </Label>
                <Label className="flex items-center gap-2 rounded-md border p-2 cursor-pointer">
                  <RadioGroupItem value="future" /> Cancelar esta e as próximas recorrências
                </Label>
              </RadioGroup>
            )}
            {!!cancelTarget?.installment_group_id && (
              <RadioGroup value={cancelScope} onValueChange={(v) => setCancelScope(v as "current" | "future")}>
                <Label className="flex items-center gap-2 rounded-md border p-2 cursor-pointer">
                  <RadioGroupItem value="current" /> Cancelar apenas esta parcela
                </Label>
                <Label className="flex items-center gap-2 rounded-md border p-2 cursor-pointer">
                  <RadioGroupItem value="future" /> Cancelar esta e as próximas parcelas em aberto
                </Label>
              </RadioGroup>
            )}
            {((cancelTarget?.kind === "recorrente" && cancelScope === "future") ||
              (!!cancelTarget?.installment_group_id && cancelScope === "future")) && (
              <p className="text-xs text-muted-foreground">
                Contas/parcelas pagas, parciais ou com crédito aplicado não serão alteradas em lote.
              </p>
            )}
            <div className="space-y-2">
              <Label>Motivo {cancelTarget?.kind === "recorrente" ? "*" : "(opcional)"}</Label>
              <Textarea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCancelOpen(false)}>Voltar</Button>
              <Button type="submit" variant="destructive" disabled={savingCancel}>
                {savingCancel ? "Cancelando…" : "Confirmar cancelamento"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: editar conta */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">
              {editTarget?.kind === "recorrente"
                ? "Editar conta recorrente"
                : editTarget?.installment_group_id
                  ? "Editar parcela"
                  : "Editar conta"}
            </DialogTitle>
            <DialogDescription>
              {editTarget?.kind === "recorrente"
                ? "Esta conta pertence a uma recorrência. Escolha se deseja editar apenas esta conta ou esta e as próximas recorrências."
                : editTarget?.installment_group_id
                  ? "Esta conta pertence a um parcelamento. Escolha se deseja editar apenas esta parcela ou esta e as próximas parcelas em aberto."
                  : editTarget?.description}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="space-y-4">
            {editTarget?.kind === "recorrente" && (
              <RadioGroup value={editScope} onValueChange={(v) => setEditScope(v as "current" | "future")}>
                <Label className="flex items-center gap-2 rounded-md border p-2 cursor-pointer">
                  <RadioGroupItem value="current" /> Editar apenas esta conta
                </Label>
                <Label className="flex items-center gap-2 rounded-md border p-2 cursor-pointer">
                  <RadioGroupItem value="future" /> Editar esta e as próximas recorrências
                </Label>
              </RadioGroup>
            )}
            {!!editTarget?.installment_group_id && (
              <RadioGroup value={editScope} onValueChange={(v) => setEditScope(v as "current" | "future")}>
                <Label className="flex items-center gap-2 rounded-md border p-2 cursor-pointer">
                  <RadioGroupItem value="current" /> Editar apenas esta parcela
                </Label>
                <Label className="flex items-center gap-2 rounded-md border p-2 cursor-pointer">
                  <RadioGroupItem value="future" /> Editar esta e as próximas parcelas em aberto
                </Label>
              </RadioGroup>
            )}
            {((editTarget?.kind === "recorrente" && editScope === "future") ||
              (!!editTarget?.installment_group_id && editScope === "future")) && (
              <p className="text-xs text-muted-foreground">
                Contas/parcelas pagas, parciais ou com crédito aplicado não serão alteradas em lote.
                {editTarget?.installment_group_id && " O vencimento das próximas parcelas não é recalculado."}
              </p>
            )}
            <div className="space-y-2">
              <Label>Descrição *</Label>
              <Input required maxLength={200} value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Fornecedor</Label>
                <Input maxLength={100} value={editForm.supplier}
                  onChange={(e) => setEditForm({ ...editForm, supplier: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Input maxLength={80} value={editForm.category}
                  onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Valor (R$) *</Label>
                <Input type="number" min={0.01} step={0.01} required value={editForm.amount_due}
                  onChange={(e) => setEditForm({ ...editForm, amount_due: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Vencimento *</Label>
                <Input type="date" required value={editForm.due_date}
                  onChange={(e) => setEditForm({ ...editForm, due_date: e.target.value })} />
              </div>
            </div>
            {editTarget?.kind === "recorrente" && (
              <div className="space-y-2">
                <Label>Dia de recorrência</Label>
                <Input type="number" min={1} max={28} placeholder="ex: 10" value={editForm.recurrence_day}
                  onChange={(e) => setEditForm({ ...editForm, recurrence_day: e.target.value })} />
                {editScope === "future" && (
                  <p className="text-xs text-muted-foreground">
                    Se alterado, o vencimento das próximas instâncias é recalculado automaticamente para este dia.
                  </p>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea rows={2} maxLength={500} value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={savingEdit}>{savingEdit ? "Salvando…" : "Salvar"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: excluir conta */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">
              {deleteTarget?.kind === "recorrente"
                ? "Excluir conta recorrente"
                : deleteTarget?.installment_group_id
                  ? "Excluir parcela"
                  : "Excluir conta"}
            </DialogTitle>
            <DialogDescription>{deleteTarget?.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {deleteTarget?.kind === "recorrente" && (
              <>
                <p className="text-sm text-muted-foreground">
                  Esta conta pertence a uma recorrência. Escolha se deseja excluir apenas esta conta ou esta e as próximas recorrências.
                </p>
                <RadioGroup value={deleteScope} onValueChange={(v) => setDeleteScope(v as "current" | "future")}>
                  <Label className="flex items-center gap-2 rounded-md border p-2 cursor-pointer">
                    <RadioGroupItem value="current" /> Excluir apenas esta conta
                  </Label>
                  <Label className="flex items-center gap-2 rounded-md border p-2 cursor-pointer">
                    <RadioGroupItem value="future" /> Excluir esta e as próximas recorrências
                  </Label>
                </RadioGroup>
                {deleteScope === "future" && (
                  <p className="text-xs text-muted-foreground">
                    Contas pagas ou parcialmente pagas não serão alteradas em lote — só podem ser excluídas manualmente.
                  </p>
                )}
              </>
            )}
            {!!deleteTarget?.installment_group_id && (
              <>
                <p className="text-sm text-muted-foreground">
                  Esta conta pertence a um parcelamento. Escolha se deseja excluir apenas esta parcela ou esta e as próximas parcelas em aberto.
                </p>
                <RadioGroup value={deleteScope} onValueChange={(v) => setDeleteScope(v as "current" | "future")}>
                  <Label className="flex items-center gap-2 rounded-md border p-2 cursor-pointer">
                    <RadioGroupItem value="current" /> Excluir apenas esta parcela
                  </Label>
                  <Label className="flex items-center gap-2 rounded-md border p-2 cursor-pointer">
                    <RadioGroupItem value="future" /> Excluir esta e as próximas parcelas em aberto
                  </Label>
                </RadioGroup>
                {deleteScope === "future" && (
                  <p className="text-xs text-muted-foreground">
                    Parcelas pagas, parciais ou com crédito aplicado não serão alteradas em lote — preservadas para manter o histórico.
                  </p>
                )}
                {deleteScope === "current" && hasInstallmentRisk(deleteTarget) && (
                  <p className="text-sm text-destructive-foreground rounded-md border border-destructive/40 bg-destructive/10 p-3">
                    Esta parcela já possui pagamento ou crédito aplicado. A exclusão será bloqueada para preservar o histórico financeiro.
                  </p>
                )}
              </>
            )}
            {!deleteTarget?.installment_group_id && (deleteScope === "current" || deleteTarget?.kind !== "recorrente") && deleteTarget && hasPaymentRisk(deleteTarget) && (
              <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
                <p className="text-sm text-destructive-foreground">
                  Esta conta possui pagamento registrado. Excluir apagará o histórico desta conta e seus pagamentos. Deseja continuar?
                </p>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="delete-confirm-checked"
                    checked={deleteConfirmChecked}
                    onCheckedChange={(v) => setDeleteConfirmChecked(v === true)}
                  />
                  <Label htmlFor="delete-confirm-checked" className="cursor-pointer text-sm font-normal">
                    Entendo que isso vai apagar o histórico de pagamento
                  </Label>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>Cancelar</Button>
            <Button
              type="button" variant="destructive" disabled={deleting}
              onClick={confirmDelete}
            >
              {deleting ? "Excluindo…" : "Confirmar exclusão"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
