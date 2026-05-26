import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Upload, Trash2, Plus, Pencil, Copy, Star, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  DEFAULT_SHIFTS, SHIFT_LABELS, loadShiftDefaults, saveShiftDefaults,
  type ShiftDefaults, type ShiftKey,
} from "@/lib/shifts";
import {
  loadContractTemplates, saveContractTemplates, getInitialContractTemplateBody,
  CONTRACT_TEMPLATE_PLACEHOLDERS,
  type ContractTemplate,
} from "@/lib/contractTemplates";



export const Route = createFileRoute("/_app/preferencias")({
  component: PreferenciasPage,
});

interface ClinicBranding {
  clinic_name?: string;
  cnpj?: string;
  address?: string;
  logo_url?: string;
  logo_path?: string;
}

function PreferenciasPage() {
  const { role } = useAuth();
  const canEdit = role === "gestor";

  const [branding, setBranding] = useState<ClinicBranding>({});
  const [shifts, setShifts] = useState<ShiftDefaults>(DEFAULT_SHIFTS);
  const [savingShifts, setSavingShifts] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [tplSearch, setTplSearch] = useState("");
  const [tplDialogOpen, setTplDialogOpen] = useState(false);
  const [tplEditing, setTplEditing] = useState<ContractTemplate | null>(null);
  const [tplForm, setTplForm] = useState<ContractTemplate>({
    id: "", name: "", description: "", active: true, is_default: false, body: "",
  });
  const [tplSaving, setTplSaving] = useState(false);
  const [tplDeleteTarget, setTplDeleteTarget] = useState<ContractTemplate | null>(null);

  async function load() {
    setLoading(true);
    const [{ data }, sd, tpls] = await Promise.all([
      supabase.from("settings").select("value").eq("key", "clinic_branding").maybeSingle(),
      loadShiftDefaults(),
      loadContractTemplates(),
    ]);
    setBranding(((data?.value as ClinicBranding) ?? {}) as ClinicBranding);
    setShifts(sd);
    setTemplates(tpls);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function saveShifts() {
    setSavingShifts(true);
    try {
      for (const k of ["manha", "tarde", "noite"] as ShiftKey[]) {
        if (shifts[k].end <= shifts[k].start) {
          toast.error(`${SHIFT_LABELS[k]}: o fim deve ser após o início.`);
          return;
        }
      }
      await saveShiftDefaults(shifts);
      toast.success("Turnos salvos");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao salvar turnos";
      toast.error(msg);
    } finally {
      setSavingShifts(false);
    }
  }


  async function save(next: ClinicBranding) {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("settings").upsert({
      key: "clinic_branding",
      value: next as never,
      updated_by: user?.id ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
    setSaving(false);
    if (error) toast.error("Erro ao salvar", { description: error.message });
    else toast.success("Preferências salvas");
    setBranding(next);
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Selecione um arquivo de imagem (PNG ou JPG)");
      return;
    }
    setUploading(true);
    // remove anterior
    if (branding.logo_path) {
      await supabase.storage.from("clinic-assets").remove([branding.logo_path]);
    }
    const ext = file.name.split(".").pop() ?? "png";
    const path = `logo-${Date.now()}.${ext}`;
    const up = await supabase.storage.from("clinic-assets").upload(path, file, {
      cacheControl: "3600", upsert: true, contentType: file.type,
    });
    if (up.error) {
      setUploading(false);
      e.target.value = "";
      console.error("[logo upload]", up.error);
      toast.error("Erro no upload", { description: up.error.message });
      return;
    }
    const { data: pub } = supabase.storage.from("clinic-assets").getPublicUrl(path);
    await save({ ...branding, logo_path: path, logo_url: pub.publicUrl });
    setUploading(false);
    e.target.value = "";
  }

  async function removeLogo() {
    if (!branding.logo_path) return;
    if (!confirm("Remover a logomarca atual?")) return;
    await supabase.storage.from("clinic-assets").remove([branding.logo_path]);
    await save({ ...branding, logo_path: undefined, logo_url: undefined });
  }

  // ===== Templates =====

  async function logTplAudit(action: string, metadata?: Record<string, unknown>) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("audit_logs").insert({
        actor_id: user.id, action,
        entity_type: "settings", entity_id: null,
        metadata: ({ key: "contract_templates", ...(metadata ?? {}) }) as never,
      });
    } catch { /* opcional */ }
  }

  function openNewTpl() {
    setTplEditing(null);
    setTplForm({
      id: crypto.randomUUID(),
      name: "",
      description: "",
      active: true,
      is_default: templates.length === 0,
      body: "",
    });
    setTplDialogOpen(true);
  }

  function openEditTpl(t: ContractTemplate) {
    setTplEditing(t);
    setTplForm({ ...t });
    setTplDialogOpen(true);
  }

  function duplicateTpl(t: ContractTemplate) {
    setTplEditing(null);
    setTplForm({
      id: crypto.randomUUID(),
      name: `${t.name} (cópia)`,
      description: t.description ?? "",
      active: true,
      is_default: false,
      body: t.body,
    });
    setTplDialogOpen(true);
  }

  async function persistTemplates(next: ContractTemplate[]) {
    await saveContractTemplates(next);
    const fresh = await loadContractTemplates();
    setTemplates(fresh);
  }

  async function saveTpl() {
    if (!tplForm.name.trim()) { toast.error("Informe o nome do modelo."); return; }
    if (!tplForm.body.trim()) { toast.error("O texto do modelo é obrigatório."); return; }
    setTplSaving(true);
    try {
      let next: ContractTemplate[];
      const cleaned: ContractTemplate = {
        ...tplForm,
        name: tplForm.name.trim(),
        description: (tplForm.description ?? "").trim(),
      };
      if (tplEditing) {
        next = templates.map((t) => (t.id === cleaned.id ? cleaned : t));
      } else {
        next = [...templates, cleaned];
      }
      if (cleaned.is_default) {
        next = next.map((t) => (t.id === cleaned.id ? t : { ...t, is_default: false }));
      }
      await persistTemplates(next);
      await logTplAudit(tplEditing ? "contract_template.update" : "contract_template.create",
        { template_id: cleaned.id, name: cleaned.name });
      toast.success(tplEditing ? "Modelo atualizado" : "Modelo criado");
      setTplDialogOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Erro ao salvar modelo", { description: msg });
    } finally {
      setTplSaving(false);
    }
  }

  async function setAsDefault(t: ContractTemplate) {
    if (!t.active) {
      toast.error("Ative o modelo antes de defini-lo como padrão.");
      return;
    }
    const next = templates.map((x) => ({ ...x, is_default: x.id === t.id }));
    try {
      await persistTemplates(next);
      await logTplAudit("contract_template.set_default", { template_id: t.id });
      toast.success(`"${t.name}" definido como padrão`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Erro", { description: msg });
    }
  }

  async function toggleActive(t: ContractTemplate) {
    const wasDefault = t.is_default;
    const next = templates.map((x) =>
      x.id === t.id ? { ...x, active: !x.active, is_default: !x.active ? x.is_default : false } : x,
    );
    // se o que era padrão foi desativado, eleger outro ativo
    if (wasDefault && t.active) {
      const firstActive = next.find((x) => x.active && x.id !== t.id);
      if (firstActive) firstActive.is_default = true;
    }
    try {
      await persistTemplates(next);
      await logTplAudit("contract_template.update", { template_id: t.id, active: !t.active });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Erro", { description: msg });
    }
  }

  async function confirmDeleteTpl() {
    if (!tplDeleteTarget) return;
    const id = tplDeleteTarget.id;
    const wasDefault = tplDeleteTarget.is_default;
    let next = templates.filter((t) => t.id !== id);
    if (wasDefault) {
      const firstActive = next.find((t) => t.active);
      if (firstActive) firstActive.is_default = true;
    }
    try {
      await persistTemplates(next);
      await logTplAudit("contract_template.delete", { template_id: id, name: tplDeleteTarget.name });
      toast.success("Modelo excluído");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Erro ao excluir", { description: msg });
    } finally {
      setTplDeleteTarget(null);
    }
  }

  const filteredTemplates = useMemo(() => {
    const q = tplSearch.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) =>
      t.name.toLowerCase().includes(q)
      || (t.description ?? "").toLowerCase().includes(q),
    );
  }, [templates, tplSearch]);

  function insertPlaceholder(ph: string) {
    setTplForm((f) => ({ ...f, body: `${f.body}${f.body.endsWith("\n") || !f.body ? "" : " "}{{${ph}}}` }));
  }

  function copyPlaceholder(ph: string) {
    const text = `{{${ph}}}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => toast.success(`Copiado: ${text}`),
        () => insertPlaceholder(ph),
      );
    } else {
      insertPlaceholder(ph);
    }
  }

  if (loading) return <div className="text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-serif text-3xl">Preferências</h1>
        <p className="text-muted-foreground">Identidade visual e dados da clínica usados nos contratos em PDF.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif">Logomarca</CardTitle>
          <CardDescription>Exibida no topo dos contratos gerados em PDF. Recomendado PNG com fundo transparente.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {branding.logo_url ? (
            <div className="flex items-center gap-4 rounded-md border p-4">
              <img src={branding.logo_url} alt="Logomarca" className="h-20 w-auto object-contain" />
              {canEdit && (
                <Button variant="outline" size="sm" onClick={removeLogo}>
                  <Trash2 className="mr-2 h-4 w-4" /> Remover
                </Button>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nenhuma logomarca enviada.
            </div>
          )}
          {canEdit && (
            <div className="flex items-center gap-3">
              <Label htmlFor="logo-upload" className="sr-only">Enviar logomarca</Label>
              <Input
                id="logo-upload"
                type="file"
                accept="image/png,image/jpeg"
                onChange={onUpload}
                disabled={uploading}
              />
              {uploading && <span className="text-sm text-muted-foreground">Enviando...</span>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif">Dados da clínica</CardTitle>
          <CardDescription>Aparecem no cabeçalho dos contratos.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Nome da clínica</Label>
            <Input
              value={branding.clinic_name ?? ""}
              maxLength={150}
              disabled={!canEdit}
              onChange={(e) => setBranding({ ...branding, clinic_name: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>CNPJ</Label>
            <Input
              value={branding.cnpj ?? ""}
              maxLength={20}
              disabled={!canEdit}
              onChange={(e) => setBranding({ ...branding, cnpj: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Endereço</Label>
            <Input
              value={branding.address ?? ""}
              maxLength={250}
              disabled={!canEdit}
              onChange={(e) => setBranding({ ...branding, address: e.target.value })}
            />
          </div>
          {canEdit && (
            <Button onClick={() => save(branding)} disabled={saving}>
              {saving ? "Salvando..." : "Salvar dados"}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif">Turnos padrão</CardTitle>
          <CardDescription>
            Horários usados quando, na grade de horários de um contrato, o gestor escolher
            "Turno" em vez de definir início e fim manualmente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(["manha", "tarde", "noite"] as ShiftKey[]).map((k) => (
            <div key={k} className="grid grid-cols-12 items-end gap-3">
              <div className="col-span-4">
                <Label>{SHIFT_LABELS[k]}</Label>
              </div>
              <div className="col-span-4 space-y-1">
                <Label className="text-xs">Início</Label>
                <Input
                  type="time"
                  value={shifts[k].start}
                  disabled={!canEdit}
                  onChange={(e) => setShifts({ ...shifts, [k]: { ...shifts[k], start: e.target.value } })}
                />
              </div>
              <div className="col-span-4 space-y-1">
                <Label className="text-xs">Fim</Label>
                <Input
                  type="time"
                  value={shifts[k].end}
                  disabled={!canEdit}
                  onChange={(e) => setShifts({ ...shifts, [k]: { ...shifts[k], end: e.target.value } })}
                />
              </div>
            </div>
          ))}
          {canEdit && (
            <Button onClick={saveShifts} disabled={savingShifts}>
              {savingShifts ? "Salvando..." : "Salvar turnos"}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif">Modelos de contrato</CardTitle>
          <CardDescription>
            Cadastre textos padrão para cláusulas contratuais. Esses modelos serão usados
            na geração do PDF dos contratos. Use variáveis como <code>{"{{LOCATARIO_NOME}}"}</code>
            {" "}para inserir dados dinâmicos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="Buscar modelo..."
              value={tplSearch}
              onChange={(e) => setTplSearch(e.target.value)}
              className="max-w-xs"
            />
            {canEdit && (
              <Button size="sm" onClick={openNewTpl}>
                <Plus className="mr-2 h-4 w-4" /> Novo modelo
              </Button>
            )}
          </div>

          {templates.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground space-y-3">
              <FileText className="mx-auto h-8 w-8 opacity-50" />
              <p>Nenhum modelo cadastrado. O PDF usa o texto padrão interno do sistema.</p>
              {canEdit && (
                <Button size="sm" onClick={openNewTpl}>
                  <Plus className="mr-2 h-4 w-4" /> Criar primeiro modelo
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredTemplates.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{t.name}</span>
                      {t.is_default && <Badge variant="default">Padrão</Badge>}
                      {!t.active && <Badge variant="outline">Inativo</Badge>}
                    </div>
                    {t.description && (
                      <p className="text-xs text-muted-foreground line-clamp-1">{t.description}</p>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon" variant="ghost"
                        title={t.is_default ? "Já é o padrão" : "Definir como padrão"}
                        onClick={() => setAsDefault(t)}
                        disabled={t.is_default || !t.active}
                      >
                        <Star className={t.is_default ? "h-4 w-4 fill-current" : "h-4 w-4"} />
                      </Button>
                      <div className="flex items-center gap-2 px-2">
                        <Switch checked={t.active} onCheckedChange={() => toggleActive(t)} />
                      </div>
                      <Button size="icon" variant="ghost" title="Duplicar" onClick={() => duplicateTpl(t)}>
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" title="Editar" onClick={() => openEditTpl(t)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon" variant="ghost"
                        className="text-destructive hover:text-destructive"
                        title="Excluir"
                        onClick={() => setTplDeleteTarget(t)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog editor de modelo */}
      <Dialog open={tplDialogOpen} onOpenChange={setTplDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">
              {tplEditing ? "Editar modelo de contrato" : "Novo modelo de contrato"}
            </DialogTitle>
            <DialogDescription>
              Cole ou edite o texto do contrato. Use as variáveis abaixo para inserir
              dados que serão preenchidos automaticamente em cada contrato.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="md:col-span-2 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Nome *</Label>
                  <Input value={tplForm.name} maxLength={150}
                    onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Descrição</Label>
                  <Input value={tplForm.description ?? ""} maxLength={250}
                    onChange={(e) => setTplForm({ ...tplForm, description: e.target.value })} />
                </div>
              </div>
              <div className="flex flex-wrap gap-6">
                <div className="flex items-center gap-2">
                  <Switch checked={tplForm.active}
                    onCheckedChange={(v) => setTplForm({ ...tplForm, active: v })} />
                  <Label>Ativo</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={tplForm.is_default}
                    onCheckedChange={(v) => setTplForm({ ...tplForm, is_default: v })}
                    disabled={!tplForm.active} />
                  <Label>Padrão</Label>
                </div>
                {!tplEditing && (
                  <Button
                    type="button" size="sm" variant="outline"
                    onClick={() => setTplForm({ ...tplForm, body: getInitialContractTemplateBody() })}
                  >
                    Inserir modelo inicial
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                <Label>Texto do modelo *</Label>
                <Textarea
                  rows={24}
                  className="font-mono text-xs"
                  value={tplForm.body}
                  onChange={(e) => setTplForm({ ...tplForm, body: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Variáveis disponíveis</Label>
              <p className="text-xs text-muted-foreground">
                Clique para copiar e cole no texto do modelo.
              </p>
              <div className="max-h-[500px] overflow-y-auto rounded-md border p-2 space-y-1">
                {CONTRACT_TEMPLATE_PLACEHOLDERS.map((ph) => (
                  <button
                    key={ph}
                    type="button"
                    onClick={() => copyPlaceholder(ph)}
                    className="w-full rounded px-2 py-1 text-left text-xs font-mono hover:bg-muted"
                  >
                    {`{{${ph}}}`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTplDialogOpen(false)}>Cancelar</Button>
            <Button onClick={saveTpl} disabled={tplSaving}>
              {tplSaving ? "Salvando..." : "Salvar modelo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!tplDeleteTarget} onOpenChange={(o) => !o && setTplDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">Excluir modelo</AlertDialogTitle>
            <AlertDialogDescription>
              Excluir o modelo <strong>{tplDeleteTarget?.name}</strong>?
              Contratos antigos vinculados a ele passarão a usar o modelo padrão.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDeleteTpl(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>

  );
}
