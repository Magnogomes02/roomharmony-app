import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, FileText, Paperclip, Download, Trash2, Search, FileDown } from "lucide-react";
import { generateContractPdf } from "@/lib/contractPdf";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/contratos")({
  component: ContratosPage,
});

interface Professional {
  id: string;
  full_name: string;
  cpf: string | null;
  registry: string | null;
  specialty: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
}

interface Room {
  id: string;
  name: string;
  active: boolean;
}

interface Contract {
  id: string;
  professional_id: string;
  room_id: string;
  start_date: string;
  end_date: string | null;
  monthly_value: number;
  status: string;
  notes: string | null;
  extra_clauses: string | null;
  signed_at: string | null;
  signed_by_name: string | null;
  signature_hash: string | null;
  locador_name: string | null;
  created_at: string;
  professional?: Professional;
  room?: Room;
}

interface Attachment {
  id: string;
  professional_id: string;
  contract_id: string | null;
  file_name: string;
  file_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

const emptyForm = {
  professional_id: "",
  room_id: "",
  start_date: new Date().toISOString().slice(0, 10),
  end_date: "",
  monthly_value: "",
  status: "rascunho",
  extra_clauses: "",
  notes: "",
  locador_name: "",
  signed_by_name: "",
  signed_at: "",
};

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  rascunho: "secondary",
  ativo: "default",
  encerrado: "outline",
  cancelado: "destructive",
};

function ContratosPage() {
  const { role } = useAuth();
  const canEdit = role === "gestor";

  const [contracts, setContracts] = useState<Contract[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [attachOpen, setAttachOpen] = useState(false);
  const [attachContract, setAttachContract] = useState<Contract | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  async function load() {
    setLoading(true);
    const [c, p, r] = await Promise.all([
      supabase.from("contracts").select("*").order("created_at", { ascending: false }),
      supabase.from("professionals").select("id,full_name,cpf,registry,specialty,email,phone,address").eq("active", true).order("full_name"),
      supabase.from("rooms").select("id,name,active").order("name"),
    ]);
    if (c.error) toast.error("Erro ao carregar contratos", { description: c.error.message });
    const profs = (p.data as Professional[]) ?? [];
    const rms = (r.data as Room[]) ?? [];
    const enriched = ((c.data as Contract[]) ?? []).map((ct) => ({
      ...ct,
      professional: profs.find((pp) => pp.id === ct.professional_id),
      room: rms.find((rr) => rr.id === ct.room_id),
    }));
    setContracts(enriched);
    setProfessionals(profs);
    setRooms(rms);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const selectedProfessional = useMemo(
    () => professionals.find((p) => p.id === form.professional_id),
    [professionals, form.professional_id],
  );

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(c: Contract) {
    setEditing(c);
    setForm({
      professional_id: c.professional_id,
      room_id: c.room_id,
      start_date: c.start_date,
      end_date: c.end_date ?? "",
      monthly_value: String(c.monthly_value ?? ""),
      status: c.status,
      extra_clauses: c.extra_clauses ?? "",
      notes: c.notes ?? "",
      locador_name: c.locador_name ?? "",
      signed_by_name: c.signed_by_name ?? "",
      signed_at: c.signed_at ? c.signed_at.slice(0, 10) : "",
    });
    setOpen(true);
  }

  // auto-fill locatário (signed_by_name) quando seleciona profissional num novo contrato
  useEffect(() => {
    if (!editing && selectedProfessional && !form.signed_by_name) {
      setForm((f) => ({ ...f, signed_by_name: selectedProfessional.full_name }));
    }
  }, [selectedProfessional, editing]); // eslint-disable-line react-hooks/exhaustive-deps

  async function logAudit(action: string, entityId?: string, metadata?: Record<string, unknown>) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("audit_logs").insert({
      actor_id: user.id, action, entity_type: "contract",
      entity_id: entityId ?? null, metadata: (metadata ?? null) as never,
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.professional_id || !form.room_id || !form.start_date) {
      toast.error("Profissional, sala e data de início são obrigatórios");
      return;
    }
    setSaving(true);
    const payload = {
      professional_id: form.professional_id,
      room_id: form.room_id,
      start_date: form.start_date,
      end_date: form.end_date || null,
      monthly_value: form.monthly_value ? Number(form.monthly_value) : 0,
      status: form.status,
      extra_clauses: form.extra_clauses.trim() || null,
      notes: form.notes.trim() || null,
      locador_name: form.locador_name.trim() || null,
      signed_by_name: form.signed_by_name.trim() || null,
      signed_at: form.signed_at ? new Date(form.signed_at).toISOString() : null,
    };
    const res = editing
      ? await supabase.from("contracts").update(payload).eq("id", editing.id)
      : await supabase.from("contracts").insert(payload);
    setSaving(false);
    if (res.error) {
      toast.error("Erro ao salvar", { description: res.error.message });
      return;
    }
    toast.success(editing ? "Contrato atualizado" : "Contrato criado");
    setOpen(false);
    await logAudit(editing ? "contract.update" : "contract.create", editing?.id);
    load();
  }

  async function openAttachments(c: Contract) {
    setAttachContract(c);
    setAttachOpen(true);
    const { data, error } = await supabase
      .from("contract_attachments")
      .select("*")
      .eq("professional_id", c.professional_id)
      .order("created_at", { ascending: false });
    if (error) toast.error("Erro ao carregar anexos", { description: error.message });
    setAttachments((data as Attachment[]) ?? []);
  }

  async function refreshAttachments(professionalId: string) {
    const { data } = await supabase
      .from("contract_attachments")
      .select("*")
      .eq("professional_id", professionalId)
      .order("created_at", { ascending: false });
    setAttachments((data as Attachment[]) ?? []);
  }

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !attachContract) return;
    setUploading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const path = `${attachContract.professional_id}/${Date.now()}-${file.name}`;
    const up = await supabase.storage.from("contract-attachments").upload(path, file);
    if (up.error) {
      setUploading(false);
      toast.error("Erro no upload", { description: up.error.message });
      return;
    }
    const ins = await supabase.from("contract_attachments").insert({
      professional_id: attachContract.professional_id,
      contract_id: attachContract.id,
      file_name: file.name,
      file_path: path,
      mime_type: file.type,
      size_bytes: file.size,
      uploaded_by: user?.id ?? null,
    });
    setUploading(false);
    e.target.value = "";
    if (ins.error) {
      toast.error("Erro ao registrar anexo", { description: ins.error.message });
      return;
    }
    toast.success("Anexo enviado");
    await logAudit("contract.attachment_upload", attachContract.id, { file: file.name });
    refreshAttachments(attachContract.professional_id);
  }

  async function downloadAttachment(a: Attachment) {
    const { data, error } = await supabase.storage
      .from("contract-attachments")
      .createSignedUrl(a.file_path, 60);
    if (error || !data) {
      toast.error("Erro ao gerar link", { description: error?.message });
      return;
    }
    window.open(data.signedUrl, "_blank");
  }

  async function deleteAttachment(a: Attachment) {
    if (!confirm(`Remover "${a.file_name}"?`)) return;
    const s = await supabase.storage.from("contract-attachments").remove([a.file_path]);
    if (s.error) return toast.error("Erro ao remover arquivo", { description: s.error.message });
    const d = await supabase.from("contract_attachments").delete().eq("id", a.id);
    if (d.error) return toast.error("Erro", { description: d.error.message });
    toast.success("Anexo removido");
    await logAudit("contract.attachment_delete", attachContract?.id, { file: a.file_name });
    if (attachContract) refreshAttachments(attachContract.professional_id);
  }

  const filtered = contracts.filter((c) => {
    const q = search.toLowerCase();
    return !q
      || (c.professional?.full_name ?? "").toLowerCase().includes(q)
      || (c.room?.name ?? "").toLowerCase().includes(q)
      || c.status.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl">Contratos</h1>
          <p className="text-muted-foreground">
            Contratos de locação com dados do profissional, cláusulas editáveis e anexos.
          </p>
        </div>
        {canEdit && (
          <Button onClick={openNew} disabled={professionals.length === 0 || rooms.length === 0}>
            <Plus className="mr-2 h-4 w-4" /> Novo contrato
          </Button>
        )}
      </div>

      {professionals.length === 0 && (
        <Card><CardContent className="p-4 text-sm text-muted-foreground">
          Cadastre ao menos um profissional ativo para emitir contratos.
        </CardContent></Card>
      )}

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por profissional, sala ou status..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Profissional</TableHead>
                  <TableHead>Sala</TableHead>
                  <TableHead>Vigência</TableHead>
                  <TableHead>Valor mensal</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Carregando...</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Nenhum contrato encontrado.</TableCell></TableRow>
                ) : filtered.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.professional?.full_name ?? "—"}</TableCell>
                    <TableCell>{c.room?.name ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {new Date(c.start_date).toLocaleDateString("pt-BR")}
                      {c.end_date && <> – {new Date(c.end_date).toLocaleDateString("pt-BR")}</>}
                    </TableCell>
                    <TableCell>
                      {Number(c.monthly_value).toLocaleString("pt-BR", {
                        style: "currency", currency: "BRL",
                      })}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[c.status] ?? "secondary"}>{c.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Baixar PDF"
                          onClick={async () => {
                            if (!c.professional || !c.room) {
                              toast.error("Dados incompletos para gerar o PDF");
                              return;
                            }
                            try {
                              await generateContractPdf({
                                professional: c.professional,
                                room: { name: c.room.name },
                                start_date: c.start_date,
                                end_date: c.end_date,
                                monthly_value: Number(c.monthly_value),
                                extra_clauses: c.extra_clauses,
                                notes: c.notes,
                                locador_name: c.locador_name,
                                signed_by_name: c.signed_by_name,
                                signed_at: c.signed_at,
                              });
                              await logAudit("contract.pdf_download", c.id);
                            } catch (err) {
                              toast.error("Erro ao gerar PDF", {
                                description: err instanceof Error ? err.message : undefined,
                              });
                            }
                          }}
                        >
                          <FileDown className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => openAttachments(c)} title="Anexos">
                          <Paperclip className="h-4 w-4" />
                        </Button>
                        {canEdit && (
                          <Button size="icon" variant="ghost" onClick={() => openEdit(c)} title="Editar">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Form dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">
              {editing ? "Editar contrato" : "Novo contrato"}
            </DialogTitle>
            <DialogDescription>
              Os dados do locatário são preenchidos automaticamente a partir do profissional selecionado.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={save} className="space-y-6">
            {/* Partes */}
            <section className="space-y-4">
              <h3 className="font-serif text-lg">Partes</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Profissional (locatário) *</Label>
                  <Select
                    value={form.professional_id}
                    onValueChange={(v) => setForm({ ...form, professional_id: v })}
                    disabled={!!editing}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      {professionals.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Sala *</Label>
                  <Select
                    value={form.room_id}
                    onValueChange={(v) => setForm({ ...form, room_id: v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      {rooms.filter((r) => r.active).map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {selectedProfessional && (
                <div className="rounded-md border bg-muted/40 p-3 text-sm">
                  <div className="font-medium">{selectedProfessional.full_name}</div>
                  <div className="text-muted-foreground">
                    {selectedProfessional.specialty ?? "—"}
                    {selectedProfessional.registry && <> • {selectedProfessional.registry}</>}
                    {selectedProfessional.cpf && <> • CPF {selectedProfessional.cpf}</>}
                  </div>
                  <div className="text-muted-foreground">
                    {selectedProfessional.email ?? ""} {selectedProfessional.phone ? `• ${selectedProfessional.phone}` : ""}
                  </div>
                  {selectedProfessional.address && (
                    <div className="text-muted-foreground">{selectedProfessional.address}</div>
                  )}
                </div>
              )}
            </section>

            {/* Vigência */}
            <section className="space-y-4">
              <h3 className="font-serif text-lg">Vigência e valor</h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Início *</Label>
                  <Input type="date" required value={form.start_date}
                    onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Término</Label>
                  <Input type="date" value={form.end_date}
                    onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Valor mensal (R$)</Label>
                  <Input type="number" step="0.01" min="0" value={form.monthly_value}
                    onChange={(e) => setForm({ ...form, monthly_value: e.target.value })} />
                </div>
                <div className="space-y-2 sm:col-span-3">
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rascunho">Rascunho</SelectItem>
                      <SelectItem value="ativo">Ativo</SelectItem>
                      <SelectItem value="encerrado">Encerrado</SelectItem>
                      <SelectItem value="cancelado">Cancelado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            {/* Cláusulas */}
            <section className="space-y-4">
              <h3 className="font-serif text-lg">Cláusulas e observações</h3>
              <div className="space-y-2">
                <Label>Cláusulas adicionais</Label>
                <Textarea rows={6} maxLength={5000}
                  placeholder="Inclua aqui cláusulas específicas deste contrato..."
                  value={form.extra_clauses}
                  onChange={(e) => setForm({ ...form, extra_clauses: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Observações internas</Label>
                <Textarea rows={3} maxLength={2000}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </section>

            {/* Assinatura */}
            <section className="space-y-4">
              <h3 className="font-serif text-lg">Assinatura</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Locador (assinante)</Label>
                  <Input maxLength={150} placeholder="Nome de quem assina pela clínica"
                    value={form.locador_name}
                    onChange={(e) => setForm({ ...form, locador_name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Locatário (editável)</Label>
                  <Input maxLength={150}
                    value={form.signed_by_name}
                    onChange={(e) => setForm({ ...form, signed_by_name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Data de assinatura</Label>
                  <Input type="date" value={form.signed_at}
                    onChange={(e) => setForm({ ...form, signed_at: e.target.value })} />
                </div>
              </div>
            </section>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Attachments dialog */}
      <Dialog open={attachOpen} onOpenChange={setAttachOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl flex items-center gap-2">
              <FileText className="h-5 w-5" /> Anexos do contrato
            </DialogTitle>
            <DialogDescription>
              Contratos assinados externamente, vinculados ao profissional{" "}
              <span className="font-medium">{attachContract?.professional?.full_name}</span>.
            </DialogDescription>
          </DialogHeader>

          {canEdit && (
            <div className="flex items-center gap-3 rounded-md border border-dashed p-4">
              <Paperclip className="h-4 w-4 text-muted-foreground" />
              <Input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                disabled={uploading}
                onChange={uploadFile}
              />
              {uploading && <span className="text-sm text-muted-foreground">Enviando...</span>}
            </div>
          )}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Arquivo</TableHead>
                  <TableHead>Enviado em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attachments.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="py-6 text-center text-muted-foreground">Nenhum anexo.</TableCell></TableRow>
                ) : attachments.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.file_name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(a.created_at).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => downloadAttachment(a)} title="Baixar">
                          <Download className="h-4 w-4" />
                        </Button>
                        {canEdit && (
                          <Button size="icon" variant="ghost" onClick={() => deleteAttachment(a)} title="Remover">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
