import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Pencil, Power, Search, Paperclip, Trash2, Download, FileText, Image as ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { entityColor } from "@/lib/entityColors";

export const Route = createFileRoute("/_app/profissionais")({
  component: ProfissionaisPage,
});

interface Professional {
  id: string;
  full_name: string;
  cpf: string | null;
  registry: string | null;
  specialty: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  color_hex: string | null;
}

interface Attachment {
  id: string;
  professional_id: string;
  category: string | null;
  description: string | null;
  file_name: string;
  file_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

interface PendingAttachment {
  tmpId: string;
  category: string;
  description: string;
  file: File | null;
}

const empty = {
  full_name: "", cpf: "", registry: "", specialty: "",
  phone: "", email: "", address: "", notes: "", color_hex: "",
};

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function newPending(): PendingAttachment {
  return { tmpId: crypto.randomUUID(), category: "", description: "", file: null };
}

function ProfissionaisPage() {
  const { role } = useAuth();
  const canEdit = role === "gestor";
  const [items, setItems] = useState<Professional[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Professional | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  // Attachments state
  const [attachEnabled, setAttachEnabled] = useState(false);
  const [existing, setExisting] = useState<Attachment[]>([]);
  const [pending, setPending] = useState<PendingAttachment[]>([]);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("professionals")
      .select("*")
      .order("full_name");
    if (error) toast.error("Erro ao carregar", { description: error.message });
    setItems((data as Professional[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function loadAttachments(profId: string) {
    const { data, error } = await supabase
      .from("professional_attachments")
      .select("*")
      .eq("professional_id", profId)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Erro ao carregar anexos", { description: error.message });
      return;
    }
    const list = (data as Attachment[]) ?? [];
    setExisting(list);
    if (list.length > 0) setAttachEnabled(true);
  }

  function resetAttachments() {
    setAttachEnabled(false);
    setExisting([]);
    setPending([]);
  }

  function openNew() {
    setEditing(null);
    setForm(empty);
    resetAttachments();
    setOpen(true);
  }

  function openEdit(p: Professional) {
    setEditing(p);
    setForm({
      full_name: p.full_name ?? "", cpf: p.cpf ?? "", registry: p.registry ?? "",
      specialty: p.specialty ?? "", phone: p.phone ?? "", email: p.email ?? "",
      address: p.address ?? "", notes: p.notes ?? "", color_hex: p.color_hex ?? "",
    });
    resetAttachments();
    loadAttachments(p.id);
    setOpen(true);
  }

  function addPendingRow() {
    setPending((prev) => [...prev, newPending()]);
  }

  function updatePending(tmpId: string, patch: Partial<PendingAttachment>) {
    setPending((prev) => prev.map((p) => (p.tmpId === tmpId ? { ...p, ...patch } : p)));
  }

  function removePending(tmpId: string) {
    setPending((prev) => prev.filter((p) => p.tmpId !== tmpId));
  }

  async function uploadPending(profId: string, userId: string | null) {
    const toUpload = pending.filter((p) => p.file);
    for (const item of toUpload) {
      const file = item.file!;
      if (file.size > MAX_SIZE) {
        toast.error(`Arquivo "${file.name}" excede 10 MB`);
        continue;
      }
      const ext = file.name.split(".").pop() ?? "bin";
      const path = `${profId}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage
        .from("professional-attachments")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) {
        toast.error(`Falha no upload de ${file.name}`, { description: up.error.message });
        continue;
      }
      const ins = await supabase.from("professional_attachments").insert({
        professional_id: profId,
        category: item.category.trim() || null,
        description: item.description.trim() || null,
        file_name: file.name,
        file_path: path,
        mime_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: userId,
      });
      if (ins.error) {
        toast.error(`Erro ao registrar ${file.name}`, { description: ins.error.message });
      }
    }
  }

  async function deleteExisting(att: Attachment) {
    if (!confirm(`Remover anexo "${att.file_name}"?`)) return;
    const rm = await supabase.storage.from("professional-attachments").remove([att.file_path]);
    if (rm.error) toast.error("Erro ao remover arquivo", { description: rm.error.message });
    const del = await supabase.from("professional_attachments").delete().eq("id", att.id);
    if (del.error) {
      toast.error("Erro ao excluir registro", { description: del.error.message });
      return;
    }
    setExisting((prev) => prev.filter((e) => e.id !== att.id));
    toast.success("Anexo removido");
  }

  async function downloadAttachment(att: Attachment) {
    const { data, error } = await supabase.storage
      .from("professional-attachments")
      .createSignedUrl(att.file_path, 60);
    if (error || !data) {
      toast.error("Erro ao gerar link", { description: error?.message });
      return;
    }
    window.open(data.signedUrl, "_blank");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    const colorHex = form.color_hex.trim();
    if (colorHex && !/^#[0-9A-Fa-f]{6}$/.test(colorHex)) {
      toast.error("Cor inválida", { description: "Use formato #RRGGBB." });
      return;
    }
    setSaving(true);
    const payload = {
      full_name: form.full_name.trim(),
      cpf: form.cpf.trim() || null,
      registry: form.registry.trim() || null,
      specialty: form.specialty.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
      color_hex: colorHex || null,
    };

    let profId: string | null = editing?.id ?? null;
    if (editing) {
      const res = await supabase.from("professionals").update(payload).eq("id", editing.id);
      if (res.error) {
        setSaving(false);
        toast.error("Erro ao salvar", { description: res.error.message });
        return;
      }
    } else {
      const res = await supabase.from("professionals").insert(payload).select("id").single();
      if (res.error || !res.data) {
        setSaving(false);
        toast.error("Erro ao salvar", { description: res.error?.message });
        return;
      }
      profId = res.data.id;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (attachEnabled && profId && pending.some((p) => p.file)) {
      await uploadPending(profId, user?.id ?? null);
    }

    setSaving(false);
    toast.success(editing ? "Profissional atualizado" : "Profissional cadastrado");
    setOpen(false);
    await logAudit(editing ? "professional.update" : "professional.create", profId ?? undefined);
    load();
  }

  async function toggleActive(p: Professional) {
    const { error } = await supabase
      .from("professionals").update({ active: !p.active }).eq("id", p.id);
    if (error) return toast.error("Erro", { description: error.message });
    toast.success(p.active ? "Profissional inativado" : "Profissional reativado");
    await logAudit("professional.toggle_active", p.id, { active: !p.active });
    load();
  }

  async function logAudit(action: string, entityId?: string, metadata?: Record<string, unknown>) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("audit_logs").insert({
      actor_id: user.id, action, entity_type: "professional",
      entity_id: entityId ?? null, metadata: (metadata ?? null) as never,
    });
  }

  const filtered = items.filter((p) => {
    const q = search.toLowerCase();
    return !q || p.full_name.toLowerCase().includes(q)
      || (p.specialty ?? "").toLowerCase().includes(q)
      || (p.email ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl">Profissionais</h1>
          <p className="text-muted-foreground">Cadastro e gestão dos profissionais de saúde.</p>
        </div>
        {canEdit && (
          <Button onClick={openNew}>
            <Plus className="mr-2 h-4 w-4" /> Novo profissional
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, especialidade ou e-mail..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Especialidade</TableHead>
                  <TableHead>Registro</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Carregando...</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Nenhum profissional encontrado.</TableCell></TableRow>
                ) : filtered.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.full_name}</TableCell>
                    <TableCell>{p.specialty ?? "—"}</TableCell>
                    <TableCell>{p.registry ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {p.email && <div>{p.email}</div>}
                      {p.phone && <div className="text-muted-foreground">{p.phone}</div>}
                      {!p.email && !p.phone && "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.active ? "default" : "secondary"}>
                        {p.active ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {canEdit && (
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" onClick={() => openEdit(p)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => toggleActive(p)}>
                            <Power className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">
              {editing ? "Editar profissional" : "Novo profissional"}
            </DialogTitle>
            <DialogDescription>Preencha os dados do profissional.</DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="full_name">Nome completo *</Label>
                <Input id="full_name" required maxLength={150}
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="specialty">Especialidade</Label>
                <Input id="specialty" maxLength={100}
                  value={form.specialty}
                  onChange={(e) => setForm({ ...form, specialty: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="registry">Registro profissional</Label>
                <Input id="registry" maxLength={50} placeholder="CRM, CRP, CRN..."
                  value={form.registry}
                  onChange={(e) => setForm({ ...form, registry: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cpf">CPF</Label>
                <Input id="cpf" maxLength={14}
                  value={form.cpf}
                  onChange={(e) => setForm({ ...form, cpf: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Telefone</Label>
                <Input id="phone" maxLength={20}
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" type="email" maxLength={150}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="address">Endereço</Label>
                <Input id="address" maxLength={250}
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="notes">Observações</Label>
                <Textarea id="notes" rows={3} maxLength={1000}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>

            {/* Attachments section */}
            <div className="space-y-4 rounded-md border p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <Label className="flex items-center gap-2 text-base">
                    <Paperclip className="h-4 w-4" /> Documentos e anexos
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Diploma, RG, comprovante de residência, certificados (até 10 MB cada).
                  </p>
                </div>
                <Switch
                  checked={attachEnabled}
                  onCheckedChange={(v) => {
                    setAttachEnabled(v);
                    if (!v) setPending([]);
                  }}
                />
              </div>

              {attachEnabled && (
                <div className="space-y-3">
                  {existing.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase">Anexos salvos</p>
                      {existing.map((att) => (
                        <div key={att.id} className="flex items-center gap-3 rounded-md border bg-muted/30 p-3">
                          {att.mime_type?.startsWith("image/")
                            ? <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                            : <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />}
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium truncate">{att.file_name}</span>
                              {att.category && <Badge variant="secondary">{att.category}</Badge>}
                            </div>
                            {att.description && (
                              <p className="text-xs text-muted-foreground truncate">{att.description}</p>
                            )}
                          </div>
                          <Button type="button" size="icon" variant="ghost" onClick={() => downloadAttachment(att)}>
                            <Download className="h-4 w-4" />
                          </Button>
                          <Button type="button" size="icon" variant="ghost" onClick={() => deleteExisting(att)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {pending.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase">Novos anexos</p>
                      {pending.map((p) => (
                        <div key={p.tmpId} className="space-y-2 rounded-md border p-3">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <div className="space-y-1">
                              <Label className="text-xs">Categoria</Label>
                              <Input
                                placeholder="Ex.: Diploma, RG, Comprovante"
                                value={p.category}
                                maxLength={60}
                                onChange={(e) => updatePending(p.tmpId, { category: e.target.value })}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Descrição</Label>
                              <Input
                                placeholder="Detalhe opcional"
                                value={p.description}
                                maxLength={250}
                                onChange={(e) => updatePending(p.tmpId, { description: e.target.value })}
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Input
                              type="file"
                              accept={ACCEPT}
                              onChange={(e) => updatePending(p.tmpId, { file: e.target.files?.[0] ?? null })}
                            />
                            <Button type="button" size="icon" variant="ghost" onClick={() => removePending(p.tmpId)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                          {p.file && (
                            <p className="text-xs text-muted-foreground">
                              {p.file.name} — {(p.file.size / 1024 / 1024).toFixed(2)} MB
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <Button type="button" variant="outline" size="sm" onClick={addPendingRow}>
                    <Plus className="mr-2 h-4 w-4" /> Adicionar anexo
                  </Button>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
