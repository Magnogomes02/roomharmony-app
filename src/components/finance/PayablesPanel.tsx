import { useCallback, useEffect, useMemo, useState } from "react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import {
  Plus,
  Search,
  Check,
  Ban,
  Undo2,
  History,
  TrendingDown,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { MonthNavigator } from "@/components/period/MonthNavigator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { toDateOnlyString } from "@/lib/dateOnly";
import { computeEffectiveStatus, generateRecurringForMonth, type PayableStatus } from "@/lib/payablesStatus";
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
  const [savingPay, setSavingPay] = useState(false);

  const [histOpen, setHistOpen] = useState(false);
  const [histTarget, setHistTarget] = useState<Payable | null>(null);
  const [histPayments, setHistPayments] = useState<PayablePayment[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Payable | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [savingCancel, setSavingCancel] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    await generateRecurringForMonth(monthRef);
    const monthStart = toDateOnlyString(startOfMonth(monthRef));
    const monthEnd = toDateOnlyString(endOfMonth(monthRef));
    const { data, error } = await supabase
      .from("payables")
      .select("*")
      .gte("reference_month", monthStart)
      .lte("reference_month", monthEnd)
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
      const remaining = Number(p.amount_due) - Number(p.amount_paid ?? 0);
      if (eff === "a_pagar" || eff === "parcial") aPagar += remaining;
      else if (eff === "pago") pago += Number(p.amount_paid ?? p.amount_due);
      else if (eff === "atrasado") atrasado += remaining;
    }
    return { aPagar, pago, atrasado };
  }, [items]);

  async function logAudit(action: string, entityId: string, metadata?: Json) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("audit_logs").insert({
      actor_id: user.id, action, entity_type: "payable",
      entity_id: entityId, metadata: metadata ?? null,
    });
  }

  async function saveNew(e: React.FormEvent) {
    e.preventDefault();
    if (!newForm.description.trim()) return toast.error("Descrição é obrigatória");
    if (!newForm.amount_due || Number(newForm.amount_due) <= 0) return toast.error("Valor inválido");
    if (!newForm.due_date) return toast.error("Data de vencimento é obrigatória");
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
      recurrence_day: newForm.recurrence_day ? Number(newForm.recurrence_day) : null,
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
    const remaining = Number(p.amount_due) - Number(p.amount_paid ?? 0);
    setPayAmount(String(remaining.toFixed(2)));
    setPayMethod("");
    setPayNotes("");
    setPayOpen(true);
  }

  async function savePay(e: React.FormEvent) {
    e.preventDefault();
    if (!payTarget) return;
    const amount = Number(payAmount);
    if (!amount || amount <= 0) return toast.error("Valor inválido");
    const remaining = Number(payTarget.amount_due) - Number(payTarget.amount_paid ?? 0);
    if (amount > remaining + 0.001) return toast.error("Valor maior que o saldo devedor");
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

    const newPaid = Number(payTarget.amount_paid ?? 0) + amount;
    const newStatus: PayableStatus = newPaid >= Number(payTarget.amount_due) - 0.001 ? "pago" : "parcial";
    const { error: updErr } = await supabase
      .from("payables")
      .update({ amount_paid: newPaid, status: newStatus })
      .eq("id", payTarget.id);
    setSavingPay(false);
    if (updErr) return toast.error("Pagamento registrado mas falhou ao atualizar conta", { description: updErr.message });
    toast.success("Pagamento registrado");
    setPayOpen(false);
    await logAudit("payable.payment_create", payTarget.id, { payment_id: pay.id, amount, payment_method: payMethod });
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

  function openCancel(p: Payable) {
    setCancelTarget(p);
    setCancelReason("");
    setCancelOpen(true);
  }

  async function saveCancel(e: React.FormEvent) {
    e.preventDefault();
    if (!cancelTarget) return;
    setSavingCancel(true);
    const { data: { user } } = await supabase.auth.getUser();
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
    await logAudit("payable.cancel", cancelTarget.id, { reason: cancelReason });
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
                                title="Cancelar conta"
                                onClick={() => openCancel(p)}
                              >
                                <Ban className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Tipo *</Label>
                <Select value={newForm.kind} onValueChange={(v) => setNewForm({ ...newForm, kind: v as "avulso" | "recorrente" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="avulso">Avulso</SelectItem>
                    <SelectItem value="recorrente">Recorrente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {newForm.kind === "recorrente" && (
                <div className="space-y-2">
                  <Label>Dia de vencimento</Label>
                  <Input type="number" min={1} max={28} placeholder="ex: 10"
                    value={newForm.recurrence_day}
                    onChange={(e) => setNewForm({ ...newForm, recurrence_day: e.target.value })} />
                </div>
              )}
            </div>
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
                <Label>Valor (R$) *</Label>
                <Input type="number" min={0.01} step={0.01} required value={newForm.amount_due}
                  onChange={(e) => setNewForm({ ...newForm, amount_due: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Vencimento *</Label>
                <Input type="date" required value={newForm.due_date}
                  onChange={(e) => setNewForm({ ...newForm, due_date: e.target.value })} />
              </div>
            </div>
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
                <div className="flex justify-between font-medium"><span>Saldo:</span><span>{brl(Number(payTarget.amount_due) - Number(payTarget.amount_paid))}</span></div>
              </div>
            )}
            <div className="space-y-2">
              <Label>Valor a pagar (R$) *</Label>
              <Input type="number" min={0.01} step={0.01} required value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)} />
            </div>
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
            <DialogTitle className="font-serif text-xl">Cancelar conta</DialogTitle>
            <DialogDescription>{cancelTarget?.description}</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveCancel} className="space-y-4">
            {cancelTarget?.kind === "recorrente" && cancelTarget.parent_payable_id === null && (
              <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
                Este é o modelo desta recorrência. Cancelar impede a geração automática nos próximos meses. As instâncias já criadas não são afetadas.
              </p>
            )}
            <div className="space-y-2">
              <Label>Motivo (opcional)</Label>
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
    </div>
  );
}
