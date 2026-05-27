import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { format, parseISO, startOfMonth, endOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Check, Pencil, Trash2, RefreshCw, Undo2, Search, Paperclip, Download, FileText, Ban } from "lucide-react";
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
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  createReceiptForReceivable,
  cancelReceiptForReceivable,
  cancelReceiptById,
  downloadReceipt,
  getReceiptsByReceivableIds,
  type ReceiptRow,
} from "@/lib/receiptService";
import { FinancialAnalysisPanel } from "@/components/finance/FinancialAnalysisPanel";

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
  status: "a_receber" | "recebido" | "atrasado" | "cancelado";
}

const PAYMENT_METHODS = ["PIX", "Dinheiro", "Transferência", "Cartão", "Boleto"];

const STATUS_LABEL: Record<string, string> = {
  a_receber: "A receber",
  recebido: "Recebido",
  atrasado: "Atrasado",
  cancelado: "Cancelado",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  a_receber: "secondary",
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
  const [profs, setProfs] = useState<Map<string, string>>(new Map());
  const [rooms, setRooms] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  const [monthRef, setMonthRef] = useState<Date>(startOfMonth(new Date()));
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "contrato" | "avulso">("all");
  const [tab, setTab] = useState<"a_receber" | "recebido" | "atrasado" | "todos">("a_receber");
  const [financeView, setFinanceView] = useState<"recebiveis" | "analise">("recebiveis");

  const [payOpen, setPayOpen] = useState(false);
  const [payRow, setPayRow] = useState<Receivable | null>(null);
  const [payForm, setPayForm] = useState({
    amount_paid: "", paid_at: new Date().toISOString().slice(0, 10),
    payment_method: "PIX", notes: "",
  });
  const [payFile, setPayFile] = useState<File | null>(null);
  const [paying, setPaying] = useState(false);
  const [generateReceiptAfterPay, setGenerateReceiptAfterPay] = useState(true);
  const [receipts, setReceipts] = useState<Map<string, ReceiptRow>>(new Map());

  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState<Receivable | null>(null);
  const [editForm, setEditForm] = useState({ amount_due: "", due_date: "", notes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const monthStart = startOfMonth(monthRef);
    const monthEnd = endOfMonth(monthRef);
    const [{ data: rec, error }, p, r] = await Promise.all([
      supabase
        .from("receivables")
        .select("*")
        .gte("due_date", monthStart.toISOString().slice(0, 10))
        .lte("due_date", monthEnd.toISOString().slice(0, 10))
        .order("due_date"),
      supabase.from("professionals").select("id,full_name"),
      supabase.from("rooms").select("id,name"),
    ]);
    if (error) toast.error("Erro ao carregar", { description: error.message });
    const list = (rec as Receivable[]) ?? [];
    setRows(list);
    setProfs(new Map((p.data ?? []).map((x: { id: string; full_name: string }) => [x.id, x.full_name])));
    setRooms(new Map((r.data ?? []).map((x: { id: string; name: string }) => [x.id, x.name])));
    const recIds = list.filter((x) => x.status === "recebido").map((x) => x.id);
    setReceipts(await getReceiptsByReceivableIds(recIds));
    setLoading(false);
  }, [monthRef]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (tab !== "todos" && row.status !== tab) return false;
      if (kindFilter !== "all" && row.kind !== kindFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const profName = profs.get(row.professional_id) ?? "";
        if (!profName.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, tab, kindFilter, search, profs]);

  const totals = useMemo(() => {
    const sum = { a_receber: 0, recebido: 0, atrasado: 0 };
    for (const r of rows) {
      if (r.status === "a_receber") sum.a_receber += Number(r.amount_due);
      else if (r.status === "atrasado") sum.atrasado += Number(r.amount_due);
      else if (r.status === "recebido") sum.recebido += Number(r.amount_paid ?? r.amount_due);
    }
    return sum;
  }, [rows]);

  async function audit(action: string, entity_id: string | null, metadata: Record<string, unknown>) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("audit_logs").insert({
      actor_id: user.id, action, entity_type: "receivable", entity_id, metadata: metadata as never,
    });
  }

  function openPay(r: Receivable) {
    setGenerateReceiptAfterPay(true);
    setPayRow(r);
    setPayForm({
      amount_paid: String(r.amount_due),
      paid_at: new Date().toISOString().slice(0, 10),
      payment_method: "PIX",
      notes: "",
    });
    setPayFile(null);
    setPayOpen(true);
  }

  async function confirmPay() {
    if (!payRow) return;
    setPaying(true);
    let attachment_path: string | null = payRow.attachment_path;
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
    const { error } = await supabase
      .from("receivables")
      .update({
        status: "recebido",
        amount_paid: Number(payForm.amount_paid),
        paid_at: new Date(payForm.paid_at).toISOString(),
        payment_method: payForm.payment_method,
        notes: payForm.notes || null,
        attachment_path,
      })
      .eq("id", payRow.id);
    setPaying(false);
    if (error) return toast.error("Erro ao baixar", { description: error.message });
    await audit("receivable.pay", payRow.id, { amount: payForm.amount_paid, method: payForm.payment_method });

    if (generateReceiptAfterPay) {
      try {
        await createReceiptForReceivable(payRow.id);
        toast.success("Baixa registrada e recibo gerado");
      } catch (e) {
        toast.warning("Baixa registrada, mas não foi possível gerar o recibo", {
          description: e instanceof Error ? e.message : String(e),
        });
      }
    } else {
      toast.success("Baixa registrada");
    }
    setPayOpen(false);
    load();
  }

  async function revertPay(r: Receivable) {
    if (!confirm("Estornar este pagamento? O recebível voltará para 'A receber' e o recibo emitido (se houver) será cancelado.")) return;
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
    await audit("receivable.revert", r.id, {});
    toast.success("Pagamento estornado");
    load();
  }

  function openEdit(r: Receivable) {
    if (receipts.has(r.id)) {
      alert("Este recebível possui recibo emitido. Alterar valor/vencimento não altera o recibo já emitido.");
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
    await audit("receivable.edit", editRow.id, {});
    toast.success("Parcela atualizada");
    setEditOpen(false);
    load();
  }

  async function removeRow(r: Receivable) {
    if (receipts.has(r.id)) {
      toast.error("Este recebível possui recibo emitido. Cancele o recibo ou estorne o pagamento antes de excluir.");
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
    try {
      await createReceiptForReceivable(r.id);
      toast.success("Recibo gerado");
      load();
    } catch (e) {
      toast.error("Erro ao gerar recibo", { description: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handleDownloadReceipt(r: Receivable) {
    const rc = receipts.get(r.id);
    if (!rc) return;
    try { await downloadReceipt(rc); } catch (e) {
      toast.error("Erro ao baixar recibo", { description: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handleCancelReceipt(r: Receivable) {
    const rc = receipts.get(r.id);
    if (!rc) return;
    const reason = prompt("Motivo do cancelamento do recibo:");
    if (!reason || !reason.trim()) return;
    try {
      await cancelReceiptById(rc.id, reason.trim());
      toast.success("Recibo cancelado");
      load();
    } catch (e) {
      toast.error("Erro ao cancelar recibo", { description: e instanceof Error ? e.message : String(e) });
    }
  }


  async function regenerateContract(contractId: string) {
    const { data, error } = await supabase.rpc("regenerate_contract_receivables", { _contract_id: contractId });
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl">Financeiro</h1>
          <p className="text-muted-foreground capitalize">
            Recebíveis de {format(monthRef, "MMMM 'de' yyyy", { locale: ptBR })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => shiftMonth(-1)}>Mês anterior</Button>
          <Button variant="outline" onClick={() => setMonthRef(startOfMonth(new Date()))}>Mês atual</Button>
          <Button variant="outline" onClick={() => shiftMonth(1)}>Próximo mês</Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">A receber</CardTitle></CardHeader>
          <CardContent><div className="font-serif text-3xl text-warning">{brl(totals.a_receber)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Recebido</CardTitle></CardHeader>
          <CardContent><div className="font-serif text-3xl text-success">{brl(totals.recebido)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Em atraso</CardTitle></CardHeader>
          <CardContent><div className="font-serif text-3xl text-destructive">{brl(totals.atrasado)}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar profissional..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={kindFilter} onValueChange={(v) => setKindFilter(v as typeof kindFilter)}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
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
              <TabsTrigger value="recebido">Recebidos</TabsTrigger>
              <TabsTrigger value="atrasado">Em atraso</TabsTrigger>
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
                      <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Carregando...</TableCell></TableRow>
                    ) : filtered.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Nenhum recebível.</TableCell></TableRow>
                    ) : filtered.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{profs.get(r.professional_id) ?? "—"}</TableCell>
                        <TableCell><Badge variant="outline" className="capitalize">{r.kind}</Badge></TableCell>
                        <TableCell className="text-sm">{r.room_id ? rooms.get(r.room_id) ?? "—" : "—"}</TableCell>
                        <TableCell className="text-sm">{format(parseISO(r.due_date), "dd/MM/yyyy")}</TableCell>
                        <TableCell>
                          {brl(r.amount_paid ?? r.amount_due)}
                          {r.amount_paid != null && Number(r.amount_paid) !== Number(r.amount_due) && (
                            <span className="ml-1 text-xs text-muted-foreground">(prev. {brl(r.amount_due)})</span>
                          )}
                        </TableCell>
                        <TableCell><Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge></TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {r.attachment_path && (
                              <Button size="icon" variant="ghost" title="Baixar comprovante" onClick={() => downloadAttachment(r.attachment_path!)}>
                                <Download className="h-4 w-4" />
                              </Button>
                            )}
                            {canEdit && r.status !== "recebido" && r.status !== "cancelado" && (
                              <Button size="icon" variant="ghost" title="Dar baixa" onClick={() => openPay(r)}>
                                <Check className="h-4 w-4 text-success" />
                              </Button>
                            )}
                            {canEdit && r.status === "recebido" && (
                              <Button size="icon" variant="ghost" title="Estornar" onClick={() => revertPay(r)}>
                                <Undo2 className="h-4 w-4" />
                              </Button>
                            )}
                            {canEdit && r.status === "recebido" && !receipts.has(r.id) && (
                              <Button size="icon" variant="ghost" title="Gerar recibo" onClick={() => handleGenerateReceipt(r)}>
                                <FileText className="h-4 w-4 text-primary" />
                              </Button>
                            )}
                            {r.status === "recebido" && receipts.has(r.id) && (
                              <Button size="icon" variant="ghost" title="Baixar recibo" onClick={() => handleDownloadReceipt(r)}>
                                <FileText className="h-4 w-4 text-success" />
                              </Button>
                            )}
                            {canEdit && r.status === "recebido" && receipts.has(r.id) && (
                              <Button size="icon" variant="ghost" title="Cancelar recibo" onClick={() => handleCancelReceipt(r)}>
                                <Ban className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                            {canEdit && (
                              <Button size="icon" variant="ghost" title="Editar" onClick={() => openEdit(r)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            {canEdit && r.kind === "contrato" && r.contract_id && (
                              <Button size="icon" variant="ghost" title="Regerar parcelas do contrato" onClick={() => regenerateContract(r.contract_id!)}>
                                <RefreshCw className="h-4 w-4" />
                              </Button>
                            )}
                            {canEdit && (
                              <Button size="icon" variant="ghost" title="Excluir" onClick={() => removeRow(r)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Baixa manual */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif">Dar baixa</DialogTitle>
            <DialogDescription>
              {payRow && (
                <>
                  {profs.get(payRow.professional_id)} · {brl(payRow.amount_due)} · venc. {format(parseISO(payRow.due_date), "dd/MM/yyyy")}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Valor pago (R$)</Label>
                <Input type="number" step="0.01" value={payForm.amount_paid}
                  onChange={(e) => setPayForm({ ...payForm, amount_paid: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Data do pagamento</Label>
                <Input type="date" value={payForm.paid_at}
                  onChange={(e) => setPayForm({ ...payForm, paid_at: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Forma de pagamento</Label>
              <Select value={payForm.payment_method} onValueChange={(v) => setPayForm({ ...payForm, payment_method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Observação</Label>
              <Textarea rows={3} value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><Paperclip className="h-4 w-4" /> Comprovante (opcional)</Label>
              <Input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setPayFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3">
              <Checkbox
                id="gen-receipt"
                checked={generateReceiptAfterPay}
                onCheckedChange={(v) => setGenerateReceiptAfterPay(v === true)}
              />
              <Label htmlFor="gen-receipt" className="cursor-pointer text-sm font-normal">
                Gerar recibo automaticamente após a baixa
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancelar</Button>
            <Button onClick={confirmPay} disabled={paying}>{paying ? "Salvando..." : "Confirmar baixa"}</Button>
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
                <Input type="number" step="0.01" value={editForm.amount_due}
                  onChange={(e) => setEditForm({ ...editForm, amount_due: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Vencimento</Label>
                <Input type="date" value={editForm.due_date}
                  onChange={(e) => setEditForm({ ...editForm, due_date: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Observação</Label>
              <Textarea rows={3} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={saveEdit}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
