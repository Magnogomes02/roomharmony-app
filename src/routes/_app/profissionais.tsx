import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Pencil, Power, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

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
}

const empty = {
  full_name: "", cpf: "", registry: "", specialty: "",
  phone: "", email: "", address: "", notes: "",
};

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

  function openNew() {
    setEditing(null);
    setForm(empty);
    setOpen(true);
  }

  function openEdit(p: Professional) {
    setEditing(p);
    setForm({
      full_name: p.full_name ?? "", cpf: p.cpf ?? "", registry: p.registry ?? "",
      specialty: p.specialty ?? "", phone: p.phone ?? "", email: p.email ?? "",
      address: p.address ?? "", notes: p.notes ?? "",
    });
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim()) {
      toast.error("Nome é obrigatório");
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
    };
    const res = editing
      ? await supabase.from("professionals").update(payload).eq("id", editing.id)
      : await supabase.from("professionals").insert(payload);
    setSaving(false);
    if (res.error) {
      toast.error("Erro ao salvar", { description: res.error.message });
      return;
    }
    toast.success(editing ? "Profissional atualizado" : "Profissional cadastrado");
    setOpen(false);
    await logAudit(editing ? "professional.update" : "professional.create", editing?.id);
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
      entity_id: entityId ?? null, metadata: metadata ?? null,
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">
              {editing ? "Editar profissional" : "Novo profissional"}
            </DialogTitle>
            <DialogDescription>Preencha os dados do profissional.</DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
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
