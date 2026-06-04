import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { format, parseISO, startOfMonth, endOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Check,
  Pencil,
  Trash2,
  RefreshCw,
  Undo2,
  Search,
  Paperclip,
  Download,
  FileText,
  Ban,
  Plus,
  XCircle,
  History,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import {
  createReceiptForReceivable,
  cancelReceiptForReceivable,
  cancelReceiptById,
  downloadReceipt,
  getReceiptsByReceivableIds,
  getReceiptsByPaymentIds,
  type ReceiptRow,
} from "@/lib/receiptService";
import { FinancialAnalysisPanel } from "@/components/finance/FinancialAnalysisPanel";
import {
  computeEffectiveStatus,
  createPayment,
  reversePayment,
  recomputeReceivableSummary,
  getActivePaymentsForReceivables,
  getAllPaymentsForReceivable,
  findDuplicateReceivables,
  buildDueDate,
  MONTHS_PT,
  type ReceivablePayment,
  type EffectiveStatus,
} from "@/lib/paymentsService";
import { toDateOnlyString } from "@/lib/dateOnly";

export const Route = createFileRoute("/_app/financeiro")({
  component: FinanceiroPage,
});

interface Receivable {
  id: string;
  kind: "contrato" | "avulso";
  contract_id: string | null;
  booking_id: string | null;
  professional_id: string;
  room_id: string | null;
  reference_month: string;
  due_date: string;
  amount_due: number;
  amount_paid: number | null;
  paid_at: string | null;
  payment_method: string | null;
  notes: string | null;
  attachment_path: string | null;
  status: "a_receber" | "parcial" | "recebido" | "atrasado" | "cancelado";
  cancel_type: string | null;
  cancel_reason: string | null;
}


interface ProfessionalLite {
  id: string;
  full_name: string;
}
interface RoomLite {
  id: string;
  name: string;
}
interface ContractLite {
  id: string;
  professional_id: string;
  status: string;
  start_date: string;
  end_date: string | null;
  monthly_value: number;
  due_day: number;
  room_id: string | null;
}

const PAYMENT_METHODS = ["PIX", "Dinheiro", "Transferência", "Cartão", "Boleto"];

const STATUS_LABEL: Record<EffectiveStatus, string> = {
  a_receber: "A receber",
  parcial: "Parcial",
  recebido: "Recebido",
  atrasado: "Atrasado",
  cancelado: "Cancelado",
};

const STATUS_VARIANT: Record<EffectiveStatus, "default" | "secondary" | "destructive" | "outline"> =
  {
    a_receber: "secondary",
    parcial: "secondary",
    recebido: "default",
    atrasado: "destructive",
    cancelado: "outline",
  };

function brl(v: number | null | undefined) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function FinanceiroPage() {
  const { role } = useAuth();
  const canEdit = role === "gestor";

  const [rows, setRows] = useState<Receivable[]>([]);
  const [profs, setProfs] = useState<ProfessionalLite[]>([]);
  const [rooms, setRooms] = useState<RoomLite[]>([]);
  const [contracts, setContracts] = useState<ContractLite[]>([]);
  const [loading, setLoading] = useState(true);

  const [monthRef, setMonthRef] = useState<Date>(startOfMonth(new Date()));
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "contrato" | "avulso">("all");
  const [tab, setTab] = useState<EffectiveStatus | "perda" | "errada" | "todos">("a_receber");
  const [financeView, setFinanceView] = useState<"recebiveis" | "analise">("recebiveis");

  // payments + receipts + rooms maps
  const [paymentsByRec, setPaymentsByRec] = useState<Map<string, ReceivablePayment[]>>(new Map());
  const [receiptsByRec, setReceiptsByRec] = useState<Map<string, ReceiptRow>>(new Map());
  const [receiptsByPayment, setReceiptsByPayment] = useState<Map<string, ReceiptRow>>(new Map());
  const [roomsByRec, setRoomsByRec] = useState<Map<string, string[]>>(new Map());


  // pay dialog
  const [payOpen, setPayOpen] = useState(false);
  const [payRow, setPayRow] = useState<Receivable | null>(null);
  const [payForm, setPayForm] = useState({
    amount_paid: "",
    paid_at: toDateOnlyString(new Date()),
    payment_method: "PIX",
    notes: "",
  });
  const [payFile, setPayFile] = useState<File | null>(null);
  const [paying, setPaying] = useState(false);
  const [generateReceiptAfterPay, setGenerateReceiptAfterPay] = useState(true);

  // edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState<Receivable | null>(null);
  const [editForm, setEditForm] = useState({ amount_due: "", due_date: "", notes: "" });

  // estorno dialog
  const [revOpen, setRevOpen] = useState(false);
  const [revRow, setRevRow] = useState<Receivable | null>(null);
  const [revPayments, setRevPayments] = useState<ReceivablePayment[]>([]);
  const [revSelected, setRevSelected] = useState<string>("");
  const [revReason, setRevReason] = useState("");

  // cancel-typed dialog
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelRow, setCancelRow] = useState<Receivable | null>(null);
  const [cancelType, setCancelType] = useState<"perda_contrato" | "cobranca_errada">(
    "perda_contrato",
  );
  const [cancelReason, setCancelReason] = useState("");

  // history dialog
  const [histOpen, setHistOpen] = useState(false);
  const [histRow, setHistRow] = useState<Receivable | null>(null);
  const [histPayments, setHistPayments] = useState<ReceivablePayment[]>([]);

  // novo recebível dialog
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState({
    professional_id: "",
    contract_id: "",
    kind: "avulso" as "contrato" | "avulso",
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    due_date: "",
    amount_due: "",
    notes: "",
  });
  const [newRoomIds, setNewRoomIds] = useState<string[]>([]);
  const [yearReceivables, setYearReceivables] = useState<Receivable[]>([]);
  const [monthsChecked, setMonthsChecked] = useState<Record<number, boolean>>({});
  const [savingNew, setSavingNew] = useState(false);


  const load = useCallback(async () => {
    setLoading(true);
    try {
      await supabase.rpc("mark_overdue_receivables");
    } catch (e) {
      console.warn("[financeiro] mark_overdue_receivables falhou", e);
    }
    const monthStart = startOfMonth(monthRef);
    const monthEnd = endOfMonth(monthRef);
    const [{ data: rec, error }, p, r, c] = await Promise.all([
      supabase
        .from("receivables")
        .select("*")
        .gte("due_date", toDateOnlyString(monthStart))
        .lte("due_date", toDateOnlyString(monthEnd))
        .order("due_date"),
      supabase.from("professionals").select("id,full_name").order("full_name"),
      supabase.from("rooms").select("id,name"),
      supabase
        .from("contracts")
        .select("id,professional_id,status,start_date,end_date,monthly_value,due_day,room_id"),
    ]);
    if (error) toast.error("Erro ao carregar", { description: error.message });
    const list = (rec as Receivable[]) ?? [];
    setRows(list);
    setProfs((p.data ?? []) as ProfessionalLite[]);
    setRooms((r.data ?? []) as RoomLite[]);
    setContracts((c.data ?? []) as ContractLite[]);

    const ids = list.map((x) => x.id);
    const payments = await getActivePaymentsForReceivables(ids);
    setPaymentsByRec(payments);
    const allPaymentIds = Array.from(payments.values())
      .flat()
      .map((x) => x.id);
    const [recRecs, payRecs] = await Promise.all([
      getReceiptsByReceivableIds(ids),
      getReceiptsByPaymentIds(allPaymentIds),
    ]);
    setReceiptsByRec(recRecs);
    setReceiptsByPayment(payRecs);
    setLoading(false);
  }, [monthRef]);

  useEffect(() => {
    load();
  }, [load]);

  const profMap = useMemo(() => new Map(profs.map((p) => [p.id, p.full_name])), [profs]);
  const roomMap = useMemo(() => new Map(rooms.map((r) => [r.id, r.name])), [rooms]);

  function effectiveOf(r: Receivable): EffectiveStatus {
    return computeEffectiveStatus({
      status: r.status,
      due_date: r.due_date,
      amount_due: r.amount_due,
      amount_paid: r.amount_paid,
      cancel_type: r.cancel_type,
    });
  }

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const effective = effectiveOf(row);
      if (tab === "perda") {
        if (!(row.status === "cancelado" && row.cancel_type === "perda_contrato")) return false;
      } else if (tab === "errada") {
        if (!(row.status === "cancelado" && row.cancel_type === "cobranca_errada")) return false;
      } else if (tab !== "todos") {
        if (tab === "cancelado") {
          if (effective !== "cancelado") return false;
        } else if (effective !== tab) return false;
      }
      if (kindFilter !== "all" && row.kind !== kindFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const profName = profMap.get(row.professional_id) ?? "";
        if (!profName.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, tab, kindFilter, search, profMap]);

  const totals = useMemo(() => {
    const sum = { a_receber: 0, recebido: 0, atrasado: 0, lost: 0, parcial: 0 };
    for (const r of rows) {
      if (r.status === "cancelado") {
        if (r.cancel_type === "perda_contrato") {
          const saldo = Math.max(Number(r.amount_due) - Number(r.amount_paid ?? 0), 0);
          sum.lost += saldo;
        }
        continue;
      }
      const due = Number(r.amount_due);
      const paid = Number(r.amount_paid ?? 0);
      const eff = effectiveOf(r);
      if (paid > 0) sum.recebido += Math.min(paid, due);
      const saldo = Math.max(due - paid, 0);
      if (saldo > 0) {
        if (eff === "atrasado") sum.atrasado += saldo;
        else sum.a_receber += saldo;
      }
      if (eff === "parcial") sum.parcial += saldo;
    }
    return sum;
  }, [rows]);

  async function audit(
    action: string,
    entity_id: string | null,
    metadata: Record<string, unknown>,
  ) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("audit_logs").insert({
      actor_id: user.id,
      action,
      entity_type: "receivable",
      entity_id,
      metadata: metadata as never,
    });
  }

  function openPay(r: Receivable) {
    setGenerateReceiptAfterPay(true);
    setPayRow(r);
    const saldo = Math.max(Number(r.amount_due) - Number(r.amount_paid ?? 0), 0);
    setPayForm({
      amount_paid: String(saldo > 0 ? saldo : r.amount_due),
      paid_at: toDateOnlyString(new Date()),
      payment_method: "PIX",
      notes: "",
    });
    setPayFile(null);
    setPayOpen(true);
  }

  async function confirmPay() {
    if (!payRow) return;
    const amount = Number(payForm.amount_paid);
    if (!(amount > 0)) {
      toast.error("Valor pago deve ser maior que zero.");
      return;
    }
    setPaying(true);
    let attachment_path: string | null = null;
    if (payFile) {
      const path = `receivables/${payRow.id}/${Date.now()}-${payFile.name}`;
      const up = await supabase.storage.from("contract-attachments").upload(path, payFile);
      if (up.error) {
        setPaying(false);
        toast.error("Erro no upload do comprovante", { description: up.error.message });
        return;
      }
      attachment_path = path;
    }
    try {
      const payment = await createPayment({
        receivableId: payRow.id,
        amount,
        paidAt: payForm.paid_at,
        paymentMethod: payForm.payment_method,
        attachmentPath: attachment_path,
        notes: payForm.notes || null,
      });
      await audit("receivable.payment_create", payRow.id, {
        payment_id: payment.id,
        amount,
        method: payForm.payment_method,
      });
      if (generateReceiptAfterPay) {
        try {
          await createReceiptForReceivable(payRow.id, payment.id);
          toast.success("Pagamento registrado e recibo gerado");
        } catch (e) {
          toast.warning("Pagamento registrado, mas não foi possível gerar o recibo", {
            description: e instanceof Error ? e.message : String(e),
          });
        }
      } else {
        toast.success("Pagamento registrado");
      }
      setPayOpen(false);
      load();
    } catch (e) {
      toast.error("Erro ao registrar pagamento", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPaying(false);
    }
  }

  async function openRevert(r: Receivable) {
    const actives = paymentsByRec.get(r.id)?.filter((p) => p.status === "ativo") ?? [];
    if (actives.length === 0) {
      // legacy: paid via old flow (no payment row)
      if (!confirm("Estornar este pagamento? O recibo emitido (se houver) será cancelado.")) return;
      try {
        await cancelReceiptForReceivable(r.id, "Pagamento estornado");
      } catch (e) {
        console.warn("[revertPay] cancel receipt", e);
      }
      const { error } = await supabase
        .from("receivables")
        .update({ status: "a_receber", amount_paid: null, paid_at: null, payment_method: null })
        .eq("id", r.id);
      if (error) return toast.error("Erro", { description: error.message });
      await audit("receivable.payment_reverse", r.id, { legacy: true });
      toast.success("Pagamento estornado");
      load();
      return;
    }
    setRevRow(r);
    setRevPayments(actives);
    setRevSelected(actives.length === 1 ? actives[0].id : "");
    setRevReason("");
    setRevOpen(true);
  }

  async function confirmRevert() {
    if (!revRow || !revSelected || !revReason.trim()) {
      toast.error("Selecione um pagamento e informe o motivo.");
      return;
    }
    try {
      const recibo = receiptsByPayment.get(revSelected);
      if (recibo) {
        await cancelReceiptById(recibo.id, `Estorno do pagamento: ${revReason.trim()}`);
      }
      await reversePayment(revSelected, revReason.trim());
      await audit("receivable.payment_reverse", revRow.id, {
        payment_id: revSelected,
        reason: revReason.trim(),
        receipt_id: recibo?.id ?? null,
      });
      toast.success("Pagamento estornado");
      setRevOpen(false);
      load();
    } catch (e) {
      toast.error("Erro ao estornar", { description: e instanceof Error ? e.message : String(e) });
    }
  }

  function openCancel(r: Receivable) {
    setCancelRow(r);
    setCancelType("perda_contrato");
    setCancelReason("");
    setCancelOpen(true);
  }

  async function confirmCancel() {
    if (!cancelRow || !cancelReason.trim()) {
      toast.error("Informe o motivo do cancelamento.");
      return;
    }
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      // cancel all active payments + receipts when "cobranca_errada"
      if (cancelType === "cobranca_errada") {
        const actives = paymentsByRec.get(cancelRow.id)?.filter((p) => p.status === "ativo") ?? [];
        for (const p of actives) {
          const r = receiptsByPayment.get(p.id);
          if (r) await cancelReceiptById(r.id, `Cobrança errada: ${cancelReason.trim()}`);
          await reversePayment(p.id, `Cobrança errada: ${cancelReason.trim()}`);
        }
        // legacy receipt at receivable level
        const legacy = receiptsByRec.get(cancelRow.id);
        if (legacy && !legacy.payment_id) {
          await cancelReceiptById(legacy.id, `Cobrança errada: ${cancelReason.trim()}`);
        }
      }
      const { error } = await supabase
        .from("receivables")
        .update({
          status: "cancelado",
          cancel_type: cancelType,
          cancel_reason: cancelReason.trim(),
          cancelled_at: new Date().toISOString(),
          cancelled_by: user?.id ?? null,
        })
        .eq("id", cancelRow.id);
      if (error) throw error;
      await audit(
        cancelType === "perda_contrato"
          ? "receivable.cancel_as_loss"
          : "receivable.cancel_as_wrong_charge",
        cancelRow.id,
        { cancel_type: cancelType, reason: cancelReason.trim() },
      );
      toast.success("Recebível cancelado");
      setCancelOpen(false);
      load();
    } catch (e) {
      toast.error("Erro ao cancelar", { description: e instanceof Error ? e.message : String(e) });
    }
  }

  async function openHistory(r: Receivable) {
    setHistRow(r);
    const all = await getAllPaymentsForReceivable(r.id);
    setHistPayments(all);
    setHistOpen(true);
  }

  function openEdit(r: Receivable) {
    if (receiptsByRec.has(r.id)) {
      alert(
        "Este recebível possui recibo emitido. Alterar valor/vencimento não altera o recibo já emitido.",
      );
    }
    setEditRow(r);
    setEditForm({
      amount_due: String(r.amount_due),
      due_date: r.due_date,
      notes: r.notes ?? "",
    });
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!editRow) return;
    const { error } = await supabase
      .from("receivables")
      .update({
        amount_due: Number(editForm.amount_due),
        due_date: editForm.due_date,
        notes: editForm.notes || null,
      })
      .eq("id", editRow.id);
    if (error) return toast.error("Erro", { description: error.message });
    await recomputeReceivableSummary(editRow.id);
    await audit("receivable.edit", editRow.id, {});
    toast.success("Parcela atualizada");
    setEditOpen(false);
    load();
  }

  async function removeRow(r: Receivable) {
    if (receiptsByRec.has(r.id)) {
      toast.error(
        "Este recebível possui recibo emitido. Cancele o recibo ou estorne o pagamento antes de excluir.",
      );
      return;
    }
    if (!confirm("Excluir esta parcela? Esta ação não pode ser desfeita.")) return;
    const { error } = await supabase.from("receivables").delete().eq("id", r.id);
    if (error) return toast.error("Erro", { description: error.message });
    await audit("receivable.delete", r.id, {});
    toast.success("Parcela excluída");
    load();
  }

  async function handleGenerateReceipt(r: Receivable) {
    // novo modo: gera recibo para o primeiro pagamento ativo sem recibo
    const actives = paymentsByRec.get(r.id)?.filter((p) => p.status === "ativo") ?? [];
    const target = actives.find((p) => !receiptsByPayment.has(p.id));
    try {
      if (target) {
        await createReceiptForReceivable(r.id, target.id);
      } else {
        // legacy fallback (no payments table)
        await createReceiptForReceivable(r.id);
      }
      toast.success("Recibo gerado");
      load();
    } catch (e) {
      toast.error("Erro ao gerar recibo", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function handleDownloadReceipt(r: Receivable) {
    const rc = receiptsByRec.get(r.id);
    if (!rc) {
      // try any payment receipt
      const actives = paymentsByRec.get(r.id) ?? [];
      const first = actives.map((p) => receiptsByPayment.get(p.id)).find(Boolean);
      if (!first) return;
      try {
        await downloadReceipt(first);
      } catch (e) {
        toast.error("Erro ao baixar recibo", {
          description: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }
    try {
      await downloadReceipt(rc);
    } catch (e) {
      toast.error("Erro ao baixar recibo", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function handleCancelReceipt(r: Receivable) {
    const rc = receiptsByRec.get(r.id);
    if (!rc) return;
    const reason = prompt("Motivo do cancelamento do recibo:");
    if (!reason || !reason.trim()) return;
    try {
      await cancelReceiptById(rc.id, reason.trim());
      toast.success("Recibo cancelado");
      load();
    } catch (e) {
      toast.error("Erro ao cancelar recibo", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function regenerateContract(contractId: string) {
    const { data, error } = await supabase.rpc("regenerate_contract_receivables", {
      _contract_id: contractId,
    });
    if (error) return toast.error("Erro ao regerar", { description: error.message });
    toast.success(`Regerado`, { description: `${data ?? 0} parcela(s) criadas.` });
    load();
  }

  async function downloadAttachment(path: string) {
    try {
      const { data, error } = await supabase.storage.from("contract-attachments").download(path);
      if (error || !data) {
        toast.error("Não foi possível baixar o arquivo. Verifique permissões ou tente novamente.");
        return;
      }
      const fileName = path.split("/").pop() || "comprovante";
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Não foi possível baixar o arquivo. Verifique permissões ou tente novamente.");
    }
  }

  function shiftMonth(delta: number) {
    const d = new Date(monthRef);
    d.setMonth(d.getMonth() + delta);
    setMonthRef(startOfMonth(d));
  }

  // ============== Novo recebível ==============
  function openNewReceivable() {
    const now = new Date();
    setNewForm({
      professional_id: "",
      contract_id: "",
      kind: "avulso",
      year: now.getFullYear(),
      month: now.getMonth(),
      due_date: "",
      amount_due: "",
      notes: "",
    });
    setNewRoomIds([]);
    setYearReceivables([]);
    setMonthsChecked({});
    setNewOpen(true);
  }


  const contractsForProf = useMemo(
    () => contracts.filter((c) => c.professional_id === newForm.professional_id),
    [contracts, newForm.professional_id],
  );

  const selectedContract = useMemo(
    () => contracts.find((c) => c.id === newForm.contract_id) ?? null,
    [contracts, newForm.contract_id],
  );

  // when contract changes, autofill + load rooms from contract_schedules
  useEffect(() => {
    if (!selectedContract) return;
    const dueDay = selectedContract.due_day || 5;
    const due = buildDueDate(newForm.year, newForm.month, dueDay);
    setNewForm((f) => ({
      ...f,
      kind: "contrato",
      amount_due: String(selectedContract.monthly_value ?? ""),
      due_date: due,
    }));
    (async () => {
      const ids = new Set<string>();
      if (selectedContract.room_id) ids.add(selectedContract.room_id);
      const { data } = await supabase
        .from("contract_schedules")
        .select("room_id")
        .eq("contract_id", selectedContract.id);
      for (const s of (data ?? []) as { room_id: string | null }[]) {
        if (s.room_id) ids.add(s.room_id);
      }
      setNewRoomIds(Array.from(ids));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newForm.contract_id, newForm.year, newForm.month]);


  // load year receivables for the contract/professional
  useEffect(() => {
    (async () => {
      if (!newForm.professional_id || !newOpen) return;
      const yStart = `${newForm.year}-01-01`;
      const yEnd = `${newForm.year}-12-31`;
      let q = supabase
        .from("receivables")
        .select("*")
        .eq("professional_id", newForm.professional_id)
        .gte("reference_month", yStart)
        .lte("reference_month", yEnd);
      if (newForm.contract_id) q = q.eq("contract_id", newForm.contract_id);
      const { data } = await q;
      setYearReceivables((data ?? []) as Receivable[]);
      setMonthsChecked({});
    })();
  }, [newForm.professional_id, newForm.contract_id, newForm.year, newOpen]);

  const monthAvailability = useMemo(() => {
    const yearExisting = new Set(
      yearReceivables.map((r) => Number(r.reference_month.slice(5, 7)) - 1),
    );
    let startIdx = 0;
    let endIdx = 11;
    if (selectedContract) {
      const sd = selectedContract.start_date;
      if (sd && Number(sd.slice(0, 4)) === newForm.year) startIdx = Number(sd.slice(5, 7)) - 1;
      else if (sd && Number(sd.slice(0, 4)) > newForm.year) startIdx = 12;
      const ed = selectedContract.end_date;
      if (ed && Number(ed.slice(0, 4)) === newForm.year) endIdx = Number(ed.slice(5, 7)) - 1;
      else if (ed && Number(ed.slice(0, 4)) < newForm.year) endIdx = -1;
    }
    return MONTHS_PT.map((label, i) => ({
      idx: i,
      label,
      inRange: i >= startIdx && i <= endIdx,
      exists: yearExisting.has(i),
    }));
  }, [yearReceivables, selectedContract, newForm.year]);

  async function insertOneReceivable(
    monthIdx: number,
    overrides?: { amount?: number; due?: string },
    allowDuplicate = false,
  ): Promise<{ ok: boolean; reason?: string }> {
    const referenceMonth = `${newForm.year}-${String(monthIdx + 1).padStart(2, "0")}-01`;
    const due =
      overrides?.due ??
      (selectedContract
        ? buildDueDate(newForm.year, monthIdx, selectedContract.due_day || 5)
        : newForm.due_date);
    const amount = overrides?.amount ?? Number(newForm.amount_due);
    if (!due) return { ok: false, reason: "Vencimento ausente" };
    if (!(amount > 0)) return { ok: false, reason: "Valor inválido" };

    if (!allowDuplicate) {
      const dups = await findDuplicateReceivables({
        professional_id: newForm.professional_id,
        contract_id: newForm.contract_id || null,
        reference_month: referenceMonth,
      });
      if (dups.length > 0) return { ok: false, reason: "duplicate" };
    }

    const firstRoom = newRoomIds[0] ?? null;
    const insertPayload = {
      kind: (newForm.contract_id ? "contrato" : "avulso") as "contrato" | "avulso",
      contract_id: newForm.contract_id || null,
      booking_id: null,
      professional_id: newForm.professional_id,
      room_id: firstRoom,
      reference_month: referenceMonth,
      due_date: due,
      amount_due: amount,
      notes: newForm.notes || null,
      status: "a_receber" as const,
    };
    const { data: ins, error } = await supabase
      .from("receivables")
      .insert(insertPayload)
      .select("id")
      .single();
    if (error) return { ok: false, reason: error.message };
    // insert receivable_rooms when we have multiple rooms (or even one — keeps source of truth)
    if (ins?.id && newRoomIds.length > 0) {
      const rows = newRoomIds.map((roomId) => ({ receivable_id: ins.id, room_id: roomId }));
      const { error: rrErr } = await supabase.from("receivable_rooms").insert(rows);
      if (rrErr) console.warn("[financeiro] receivable_rooms insert", rrErr);
    }
    await audit("receivable.manual_create", ins?.id ?? null, {
      ...insertPayload,
      room_ids: newRoomIds,
      duplicated: allowDuplicate,
      reason: newForm.notes || null,
    });
    return { ok: true };
  }


  async function saveNewReceivableSingle() {
    if (!newForm.professional_id) return toast.error("Selecione um profissional.");
    setSavingNew(true);
    try {
      const res = await insertOneReceivable(newForm.month);
      if (!res.ok && res.reason === "duplicate") {
        const dups = await findDuplicateReceivables({
          professional_id: newForm.professional_id,
          contract_id: newForm.contract_id || null,
          reference_month: `${newForm.year}-${String(newForm.month + 1).padStart(2, "0")}-01`,
        });
        const det = dups
          .map((d) => `${brl(d.amount_due)} · venc. ${d.due_date} · ${d.status}`)
          .join("\n");
        if (!confirm(`Já existe recebível para este mês:\n\n${det}\n\nGerar mesmo assim?`)) {
          setSavingNew(false);
          return;
        }
        const res2 = await insertOneReceivable(newForm.month, undefined, true);
        if (!res2.ok) toast.error(res2.reason || "Falha ao criar");
        else toast.success("Recebível criado");
      } else if (!res.ok) {
        toast.error(res.reason || "Falha ao criar");
      } else {
        toast.success("Recebível criado");
      }
      setNewOpen(false);
      load();
    } finally {
      setSavingNew(false);
    }
  }

  async function saveNewReceivableBatch() {
    if (!newForm.professional_id) return toast.error("Selecione um profissional.");
    const months = Object.entries(monthsChecked)
      .filter(([, v]) => v)
      .map(([k]) => Number(k));
    if (months.length === 0) return toast.error("Marque pelo menos um mês.");
    setSavingNew(true);
    try {
      const dupMonths: number[] = [];
      for (const m of months) {
        const dups = await findDuplicateReceivables({
          professional_id: newForm.professional_id,
          contract_id: newForm.contract_id || null,
          reference_month: `${newForm.year}-${String(m + 1).padStart(2, "0")}-01`,
        });
        if (dups.length > 0) dupMonths.push(m);
      }
      let allowDup = false;
      if (dupMonths.length > 0) {
        const names = dupMonths.map((i) => MONTHS_PT[i]).join(", ");
        if (
          !confirm(
            `Já existem recebíveis para: ${names}.\n\nGerar mesmo assim para todos os meses marcados?`,
          )
        ) {
          setSavingNew(false);
          return;
        }
        allowDup = true;
      }
      let created = 0;
      for (const m of months) {
        const res = await insertOneReceivable(m, undefined, allowDup);
        if (res.ok) created++;
      }
      toast.success(`${created} recebível(is) gerados`);
      setNewOpen(false);
      load();
    } finally {
      setSavingNew(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">Financeiro</h1>
        <p className="text-muted-foreground">Gestão de recebíveis e análise anual.</p>
      </div>

      <Tabs value={financeView} onValueChange={(v) => setFinanceView(v as typeof financeView)}>
        <TabsList>
          <TabsTrigger value="recebiveis">Recebíveis</TabsTrigger>
          <TabsTrigger value="analise">Análise Financeira</TabsTrigger>
        </TabsList>

        <TabsContent value="recebiveis" className="mt-4 space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-muted-foreground capitalize">
                Recebíveis por vencimento · {format(monthRef, "MMMM 'de' yyyy", { locale: ptBR })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => shiftMonth(-1)}>
                Mês anterior
              </Button>
              <Button variant="outline" onClick={() => setMonthRef(startOfMonth(new Date()))}>
                Mês atual
              </Button>
              <Button variant="outline" onClick={() => shiftMonth(1)}>
                Próximo mês
              </Button>
              {canEdit && (
                <Button onClick={openNewReceivable}>
                  <Plus className="mr-2 h-4 w-4" />
                  Novo recebível
                </Button>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  A receber
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-serif text-3xl text-warning">{brl(totals.a_receber)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Recebido
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-serif text-3xl text-success">{brl(totals.recebido)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Em atraso
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-serif text-3xl text-destructive">{brl(totals.atrasado)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Perda do mês
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-serif text-3xl text-destructive">{brl(totals.lost)}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative max-w-sm flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Buscar profissional..."
                    className="pl-9"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <Select
                  value={kindFilter}
                  onValueChange={(v) => setKindFilter(v as typeof kindFilter)}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os tipos</SelectItem>
                    <SelectItem value="contrato">Apenas contratos</SelectItem>
                    <SelectItem value="avulso">Apenas avulsos</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
                <TabsList>
                  <TabsTrigger value="a_receber">A receber</TabsTrigger>
                  <TabsTrigger value="parcial">Parciais</TabsTrigger>
                  <TabsTrigger value="recebido">Recebidos</TabsTrigger>
                  <TabsTrigger value="atrasado">Em atraso</TabsTrigger>
                  <TabsTrigger value="perda">Perdas</TabsTrigger>
                  <TabsTrigger value="errada">Erradas</TabsTrigger>
                  <TabsTrigger value="todos">Todos</TabsTrigger>
                </TabsList>

                <TabsContent value={tab} className="mt-4">
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Profissional</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Sala</TableHead>
                          <TableHead>Vencimento</TableHead>
                          <TableHead>Valor</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loading ? (
                          <TableRow>
                            <TableCell
                              colSpan={7}
                              className="py-8 text-center text-muted-foreground"
                            >
                              Carregando...
                            </TableCell>
                          </TableRow>
                        ) : filtered.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={7}
                              className="py-8 text-center text-muted-foreground"
                            >
                              Nenhum recebível.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filtered.map((r) => {
                            const eff = effectiveOf(r);
                            const due = Number(r.amount_due);
                            const paid = Number(r.amount_paid ?? 0);
                            const saldo = Math.max(due - paid, 0);
                            const showPartial =
                              eff === "parcial" || (eff === "atrasado" && paid > 0);
                            const isLoss =
                              r.status === "cancelado" && r.cancel_type === "perda_contrato";
                            const isWrong =
                              r.status === "cancelado" && r.cancel_type === "cobranca_errada";
                            const label = isLoss
                              ? "Perdido"
                              : isWrong
                                ? "Cancelada (errada)"
                                : STATUS_LABEL[eff];
                            const hasReceiptForRec = receiptsByRec.has(r.id);
                            const hasAnyPaymentWithoutReceipt = (
                              paymentsByRec.get(r.id) ?? []
                            ).some((p) => p.status === "ativo" && !receiptsByPayment.has(p.id));
                            return (
                              <TableRow key={r.id}>
                                <TableCell className="font-medium">
                                  {profMap.get(r.professional_id) ?? "—"}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="capitalize">
                                    {r.kind}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-sm">
                                  {r.room_id ? (roomMap.get(r.room_id) ?? "—") : "—"}
                                </TableCell>
                                <TableCell className="text-sm">
                                  {format(parseISO(r.due_date), "dd/MM/yyyy")}
                                </TableCell>
                                <TableCell className="text-sm">
                                  <div>{brl(due)}</div>
                                  {showPartial && (
                                    <div className="text-xs text-muted-foreground">
                                      Pago {brl(paid)} · Saldo {brl(saldo)}
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <Badge variant={STATUS_VARIANT[eff]}>{label}</Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-1">
                                    {r.attachment_path && (
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        title="Baixar comprovante"
                                        onClick={() => downloadAttachment(r.attachment_path!)}
                                      >
                                        <Download className="h-4 w-4" />
                                      </Button>
                                    )}
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      title="Histórico de pagamentos"
                                      onClick={() => openHistory(r)}
                                    >
                                      <History className="h-4 w-4" />
                                    </Button>
                                    {canEdit && r.status !== "cancelado" && saldo > 0 && (
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        title="Dar baixa"
                                        onClick={() => openPay(r)}
                                      >
                                        <Check className="h-4 w-4 text-success" />
                                      </Button>
                                    )}
                                    {canEdit && paid > 0 && r.status !== "cancelado" && (
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        title="Estornar pagamento"
                                        onClick={() => openRevert(r)}
                                      >
                                        <Undo2 className="h-4 w-4" />
                                      </Button>
                                    )}
                                    {canEdit && hasAnyPaymentWithoutReceipt && (
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        title="Gerar recibo"
                                        onClick={() => handleGenerateReceipt(r)}
                                      >
                                        <FileText className="h-4 w-4 text-primary" />
                                      </Button>
                                    )}
                                    {hasReceiptForRec && (
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        title="Baixar recibo"
                                        onClick={() => handleDownloadReceipt(r)}
                                      >
                                        <FileText className="h-4 w-4 text-success" />
                                      </Button>
                                    )}
                                    {canEdit && hasReceiptForRec && (
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        title="Cancelar recibo"
                                        onClick={() => handleCancelReceipt(r)}
                                      >
                                        <Ban className="h-4 w-4 text-destructive" />
                                      </Button>
                                    )}
                                    {canEdit && r.status !== "cancelado" && (
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        title="Cancelar recebível (perda/errada)"
                                        onClick={() => openCancel(r)}
                                      >
                                        <XCircle className="h-4 w-4 text-destructive" />
                                      </Button>
                                    )}
                                    {canEdit && (
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        title="Editar"
                                        onClick={() => openEdit(r)}
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                    )}
                                    {canEdit && r.kind === "contrato" && r.contract_id && (
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        title="Regerar parcelas do contrato"
                                        onClick={() => regenerateContract(r.contract_id!)}
                                      >
                                        <RefreshCw className="h-4 w-4" />
                                      </Button>
                                    )}
                                    {canEdit && (
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        title="Excluir"
                                        onClick={() => removeRow(r)}
                                      >
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analise" className="mt-4">
          <FinancialAnalysisPanel />
        </TabsContent>
      </Tabs>

      {/* Baixa (cria pagamento) */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif">Registrar pagamento</DialogTitle>
            <DialogDescription>
              {payRow && (
                <>
                  {profMap.get(payRow.professional_id)} · previsto {brl(payRow.amount_due)} · saldo{" "}
                  {brl(Math.max(Number(payRow.amount_due) - Number(payRow.amount_paid ?? 0), 0))} ·
                  venc. {format(parseISO(payRow.due_date), "dd/MM/yyyy")}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Valor pago (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={payForm.amount_paid}
                  onChange={(e) => setPayForm({ ...payForm, amount_paid: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Data do pagamento</Label>
                <Input
                  type="date"
                  value={payForm.paid_at}
                  onChange={(e) => setPayForm({ ...payForm, paid_at: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Forma de pagamento</Label>
              <Select
                value={payForm.payment_method}
                onValueChange={(v) => setPayForm({ ...payForm, payment_method: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Observação</Label>
              <Textarea
                rows={3}
                value={payForm.notes}
                onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Paperclip className="h-4 w-4" /> Comprovante (opcional)
              </Label>
              <Input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={(e) => setPayFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3">
              <Checkbox
                id="gen-receipt"
                checked={generateReceiptAfterPay}
                onCheckedChange={(v) => setGenerateReceiptAfterPay(v === true)}
              />
              <Label htmlFor="gen-receipt" className="cursor-pointer text-sm font-normal">
                Gerar recibo automaticamente após o pagamento
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={confirmPay} disabled={paying}>
              {paying ? "Salvando..." : "Registrar pagamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Estornar pagamento */}
      <Dialog open={revOpen} onOpenChange={setRevOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif">Estornar pagamento</DialogTitle>
            <DialogDescription>
              Selecione qual pagamento deseja estornar. O recibo vinculado (se houver) será
              cancelado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <RadioGroup value={revSelected} onValueChange={setRevSelected}>
              {revPayments.map((p) => {
                const hasRec = receiptsByPayment.has(p.id);
                return (
                  <Label
                    key={p.id}
                    className="flex items-center gap-3 rounded-md border p-3 cursor-pointer"
                  >
                    <RadioGroupItem value={p.id} />
                    <div className="flex-1 text-sm">
                      <div className="font-medium">
                        {brl(Number(p.amount))} · {p.payment_method ?? "—"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Pago em {format(parseISO(p.paid_at), "dd/MM/yyyy")}{" "}
                        {hasRec && "· Recibo emitido"}
                      </div>
                    </div>
                  </Label>
                );
              })}
            </RadioGroup>
            <div className="space-y-2">
              <Label>Motivo do estorno</Label>
              <Textarea
                rows={3}
                value={revReason}
                onChange={(e) => setRevReason(e.target.value)}
                placeholder="Obrigatório"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevOpen(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmRevert}>
              Confirmar estorno
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancelar recebível (perda / cobrança errada) */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif">Cancelar recebível</DialogTitle>
            <DialogDescription>
              Escolha o tipo de cancelamento. "Perda" entra na análise financeira como perda;
              "Cobrança errada" não entra no previsto/perda.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <RadioGroup
              value={cancelType}
              onValueChange={(v) => setCancelType(v as typeof cancelType)}
            >
              <Label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer">
                <RadioGroupItem value="perda_contrato" className="mt-1" />
                <div>
                  <div className="font-medium">Perda — contrato cancelado</div>
                  <div className="text-xs text-muted-foreground">
                    O saldo não recebido entra como perda financeira do período.
                  </div>
                </div>
              </Label>
              <Label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer">
                <RadioGroupItem value="cobranca_errada" className="mt-1" />
                <div>
                  <div className="font-medium">Cobrança gerada errada</div>
                  <div className="text-xs text-muted-foreground">
                    Cobrança duplicada/incorreta. Não entra como previsto nem como perda. Pagamentos
                    e recibos vinculados serão cancelados.
                  </div>
                </div>
              </Label>
            </RadioGroup>
            <div className="space-y-2">
              <Label>Motivo</Label>
              <Textarea
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Obrigatório"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Voltar
            </Button>
            <Button variant="destructive" onClick={confirmCancel}>
              Confirmar cancelamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Histórico de pagamentos */}
      <Dialog open={histOpen} onOpenChange={setHistOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif">Histórico de pagamentos</DialogTitle>
            <DialogDescription>
              {histRow && (
                <>
                  {profMap.get(histRow.professional_id)} · {brl(histRow.amount_due)}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {histPayments.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum pagamento registrado.</p>
            )}
            {histPayments.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-md border p-3 text-sm"
              >
                <div>
                  <div className="font-medium">
                    {brl(Number(p.amount))} · {p.payment_method ?? "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {format(parseISO(p.paid_at), "dd/MM/yyyy")}
                    {p.status !== "ativo" && ` · ${p.status}`}
                    {p.reverse_reason && ` — motivo: ${p.reverse_reason}`}
                  </div>
                </div>
                <Badge variant={p.status === "ativo" ? "default" : "outline"}>{p.status}</Badge>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar parcela */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif">Editar parcela</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Valor previsto (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editForm.amount_due}
                  onChange={(e) => setEditForm({ ...editForm, amount_due: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Vencimento</Label>
                <Input
                  type="date"
                  value={editForm.due_date}
                  onChange={(e) => setEditForm({ ...editForm, due_date: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Observação</Label>
              <Textarea
                rows={3}
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={saveEdit}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Novo recebível */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-serif">Novo recebível</DialogTitle>
            <DialogDescription>
              Crie um recebível manualmente. Permitido para recriar cobranças excluídas ou para
              registros avulsos.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Profissional *</Label>
                <Select
                  value={newForm.professional_id}
                  onValueChange={(v) =>
                    setNewForm({ ...newForm, professional_id: v, contract_id: "" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {profs.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Contrato (opcional)</Label>
                <Select
                  value={newForm.contract_id || "none"}
                  onValueChange={(v) =>
                    setNewForm({
                      ...newForm,
                      contract_id: v === "none" ? "" : v,
                      kind: v === "none" ? "avulso" : "contrato",
                    })
                  }
                  disabled={!newForm.professional_id}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sem contrato (avulso)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem contrato (avulso)</SelectItem>
                    {contractsForProf.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.status} · {c.start_date}
                        {c.end_date ? ` → ${c.end_date}` : ""} · {brl(c.monthly_value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Ano</Label>
                <Input
                  type="number"
                  value={newForm.year}
                  onChange={(e) => setNewForm({ ...newForm, year: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>Mês</Label>
                <Select
                  value={String(newForm.month)}
                  onValueChange={(v) => setNewForm({ ...newForm, month: Number(v) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS_PT.map((m, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Vencimento</Label>
                <Input
                  type="date"
                  value={newForm.due_date}
                  onChange={(e) => setNewForm({ ...newForm, due_date: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Valor (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={newForm.amount_due}
                  onChange={(e) => setNewForm({ ...newForm, amount_due: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Sala (opcional)</Label>
                <Select
                  value={newForm.room_id || "none"}
                  onValueChange={(v) => setNewForm({ ...newForm, room_id: v === "none" ? "" : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sem sala" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem sala</SelectItem>
                    {rooms.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Observação / motivo</Label>
              <Textarea
                rows={2}
                value={newForm.notes}
                onChange={(e) => setNewForm({ ...newForm, notes: e.target.value })}
                placeholder="Ex.: Recebível recriado por exclusão indevida."
              />
            </div>

            {newForm.professional_id && (
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    Meses sem recebível encontrado · {newForm.year}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                  {monthAvailability.map((m) => {
                    if (!m.inRange)
                      return (
                        <div
                          key={m.idx}
                          className="rounded p-2 text-xs text-muted-foreground italic"
                        >
                          {m.label} — fora do contrato
                        </div>
                      );
                    if (m.exists)
                      return (
                        <div
                          key={m.idx}
                          className="rounded bg-muted/40 p-2 text-xs text-muted-foreground"
                        >
                          {m.label} — já existe
                        </div>
                      );
                    return (
                      <Label
                        key={m.idx}
                        className="flex items-center gap-2 rounded p-2 text-xs cursor-pointer hover:bg-muted/30"
                      >
                        <Checkbox
                          checked={!!monthsChecked[m.idx]}
                          onCheckedChange={(v) =>
                            setMonthsChecked((s) => ({ ...s, [m.idx]: v === true }))
                          }
                        />
                        {m.label} — gerar
                      </Label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => setNewOpen(false)}>
              Cancelar
            </Button>
            <Button variant="secondary" disabled={savingNew} onClick={saveNewReceivableBatch}>
              Gerar meses marcados
            </Button>
            <Button disabled={savingNew} onClick={saveNewReceivableSingle}>
              Gerar apenas mês selecionado
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
