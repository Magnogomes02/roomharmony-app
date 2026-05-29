import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Trash2, Plus, Pencil, Copy as CopyIcon, Star, StarOff } from "lucide-react";
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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
  CONTRACT_TEMPLATE_VARIABLES,
  loadContractTemplatesSettings,
  saveContractTemplatesSettings,
  getInitialContractTemplate,
  stripHtmlToText,
  DEFAULT_SIGNATURE_SETTINGS,
  type ContractTemplate,
  type SignatureSettings,
} from "@/lib/contractTemplates";
import { RichContractEditor } from "@/components/RichContractEditor";
import {
  DEFAULT_RECEIPT_SETTINGS,
  RECEIPT_TEMPLATE_VARIABLES,
  loadReceiptSettings,
  saveReceiptSettings,
  type ReceiptSettings,
} from "@/lib/receiptSettings";

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
  const [sigSettings, setSigSettings] = useState<SignatureSettings>(DEFAULT_SIGNATURE_SETTINGS);
  const [savingSig, setSavingSig] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [tplEditing, setTplEditing] = useState<ContractTemplate | null>(null);
  const [tplForm, setTplForm] = useState<ContractTemplate>(() => emptyTemplate());
  const [tplSaving, setTplSaving] = useState(false);
  const [tplDeleteTarget, setTplDeleteTarget] = useState<ContractTemplate | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const [receipt, setReceipt] = useState<ReceiptSettings>(DEFAULT_RECEIPT_SETTINGS);
  const [savingReceipt, setSavingReceipt] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data }, sd, tplSettings, rcp] = await Promise.all([
      supabase.from("settings").select("value").eq("key", "clinic_branding").maybeSingle(),
      loadShiftDefaults(),
      loadContractTemplatesSettings(),
      loadReceiptSettings(),
    ]);
    setBranding(((data?.value as ClinicBranding) ?? {}) as ClinicBranding);
    setShifts(sd);
    setTemplates(tplSettings.templates);
    setSigSettings(tplSettings.signature_settings ?? DEFAULT_SIGNATURE_SETTINGS);
    setReceipt(rcp);
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

  // ---- Templates handlers ----
  function emptyTemplate(): ContractTemplate {
    return {
      id: crypto.randomUUID(),
      name: "",
      description: "",
      active: true,
      is_default: false,
      title: "",
      body_html: "",
      body_text: "",
    };
  }

  function openNewTemplate() {
    const t = emptyTemplate();
    if (templates.length === 0) t.is_default = true;
    setTplEditing(null);
    setTplForm(t);
    setTplOpen(true);
  }

  function openEditTemplate(t: ContractTemplate) {
    setTplEditing(t);
    setTplForm({ ...t });
    setTplOpen(true);
  }

  function fillInitialTemplate() {
    const init = getInitialContractTemplate();
    setTplForm((f) => ({ ...f, title: init.title, body_html: init.body_html, body_text: stripHtmlToText(init.body_html), name: f.name || "Sublocação padrão" }));
  }

  async function persistTemplates(next: ContractTemplate[]) {
    await saveContractTemplatesSettings({ templates: next, signature_settings: sigSettings });
    const reloaded = await loadContractTemplatesSettings();
    setTemplates(reloaded.templates);
    setSigSettings(reloaded.signature_settings ?? DEFAULT_SIGNATURE_SETTINGS);
  }

  async function saveSigSettings() {
    setSavingSig(true);
    try {
      await saveContractTemplatesSettings({ templates, signature_settings: sigSettings });
      toast.success("Configuração de assinatura salva");
    } catch (err) {
      toast.error("Erro", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSavingSig(false);
    }
  }

  async function saveReceipt() {
    setSavingReceipt(true);
    try {
      await saveReceiptSettings(receipt);
      toast.success("Modelo de recibo salvo");
    } catch (err) {
      toast.error("Erro", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSavingReceipt(false);
    }
  }

  async function submitTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!tplForm.name.trim()) { toast.error("Informe o nome do modelo."); return; }
    if (!tplForm.title.trim()) { toast.error("Informe o título do contrato."); return; }
    if (!tplForm.body_html.trim()) { toast.error("Informe o corpo do contrato."); return; }
    setTplSaving(true);
    try {
      let next = [...templates];
      const idx = next.findIndex((x) => x.id === tplForm.id);
      const incoming: ContractTemplate = {
        ...tplForm,
        name: tplForm.name.trim(),
        description: tplForm.description?.trim() || "",
        title: tplForm.title,
        body_html: tplForm.body_html,
        body_text: stripHtmlToText(tplForm.body_html),
      };
      if (idx >= 0) next[idx] = incoming;
      else next.push(incoming);
      // single-default enforcement
      if (incoming.is_default && incoming.active) {
        next = next.map((t) =>
          t.id === incoming.id ? t : { ...t, is_default: false },
        );
      }
      await persistTemplates(next);
      toast.success(idx >= 0 ? "Modelo atualizado" : "Modelo criado");
      setTplOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Erro ao salvar modelo", { description: msg });
    } finally {
      setTplSaving(false);
    }
  }

  async function duplicateTemplate(t: ContractTemplate) {
    const copy: ContractTemplate = {
      ...t,
      id: crypto.randomUUID(),
      name: `${t.name} (cópia)`,
      is_default: false,
    };
    try {
      await persistTemplates([...templates, copy]);
      toast.success("Modelo duplicado");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Erro ao duplicar", { description: msg });
    }
  }

  async function toggleActive(t: ContractTemplate) {
    const next = templates.map((x) =>
      x.id === t.id ? { ...x, active: !x.active, is_default: !x.active ? x.is_default : false } : x,
    );
    try {
      await persistTemplates(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Erro", { description: msg });
    }
  }

  async function makeDefault(t: ContractTemplate) {
    if (!t.active) { toast.error("Ative o modelo antes de defini-lo como padrão."); return; }
    const next = templates.map((x) => ({ ...x, is_default: x.id === t.id }));
    try {
      await persistTemplates(next);
      toast.success("Modelo definido como padrão");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Erro", { description: msg });
    }
  }

  async function confirmDeleteTemplate() {
    if (!tplDeleteTarget) return;
    const next = templates.filter((x) => x.id !== tplDeleteTarget.id);
    try {
      await persistTemplates(next);
      toast.success("Modelo excluído");
      setTplDeleteTarget(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Erro ao excluir", { description: msg });
    }
  }

  const sortedTemplates = useMemo(
    () => [...templates].sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name)),
    [templates],
  );

  if (loading) return <div className="text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="font-serif text-3xl">Preferências</h1>
        <p className="text-muted-foreground">Identidade visual, dados da clínica, turnos e modelos de contrato.</p>
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
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="font-serif">Modelos de contrato</CardTitle>
            <CardDescription>
              Cadastre modelos completos de contrato. O título, identificação das partes, cláusulas
              e assinaturas serão renderizados a partir do modelo escolhido.
            </CardDescription>
          </div>
          {canEdit && (
            <Button size="sm" onClick={openNewTemplate}>
              <Plus className="mr-2 h-4 w-4" /> Novo modelo
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {sortedTemplates.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nenhum modelo cadastrado.{" "}
              {canEdit && (
                <Button variant="link" className="px-1" onClick={openNewTemplate}>
                  Criar primeiro modelo
                </Button>
              )}
            </div>
          ) : (
            <ul className="divide-y rounded-md border">
              {sortedTemplates.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0 flex-1">
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
                    <div className="flex flex-wrap items-center gap-1">
                      <Button size="icon" variant="ghost" onClick={() => makeDefault(t)} title={t.is_default ? "Já é o padrão" : "Definir como padrão"} disabled={t.is_default}>
                        {t.is_default ? <Star className="h-4 w-4 text-primary" /> : <StarOff className="h-4 w-4" />}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => toggleActive(t)}>
                        {t.active ? "Inativar" : "Ativar"}
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => duplicateTemplate(t)} title="Duplicar">
                        <CopyIcon className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => openEditTemplate(t)} title="Editar">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon" variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setTplDeleteTarget(t)} title="Excluir"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <div className="mt-6 space-y-4 rounded-md border bg-muted/30 p-4">
              <div>
                <h3 className="font-serif text-lg">Bloco de assinaturas</h3>
                <p className="text-xs text-muted-foreground">
                  Define como o marcador {"{{BLOCO_ASSINATURAS}}"} é renderizado no PDF.
                  O espaço reservado permite a aposição de assinatura digital ou manuscrita.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Disposição</Label>
                  <Select
                    value={sigSettings.layout}
                    onValueChange={(v) => setSigSettings({ ...sigSettings, layout: v as SignatureSettings["layout"] })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="side_by_side">Lado a lado</SelectItem>
                      <SelectItem value="stacked">Empilhado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Altura reservada (mm)</Label>
                  <Input
                    type="number" min={25} max={80}
                    value={sigSettings.reserved_height_mm}
                    onChange={(e) => setSigSettings({ ...sigSettings, reserved_height_mm: Number(e.target.value) || 40 })}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={sigSettings.show_date}
                    onCheckedChange={(v) => setSigSettings({ ...sigSettings, show_date: v })}
                  />
                  <Label>Mostrar data/local</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={sigSettings.show_qualification}
                    onCheckedChange={(v) => setSigSettings({ ...sigSettings, show_qualification: v })}
                  />
                  <Label>Mostrar qualificação (Locador/Locatário)</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={sigSettings.show_party_document}
                    onCheckedChange={(v) => setSigSettings({ ...sigSettings, show_party_document: v })}
                  />
                  <Label>Mostrar documento (CPF/CNPJ)</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={sigSettings.force_new_page_if_needed}
                    onCheckedChange={(v) => setSigSettings({ ...sigSettings, force_new_page_if_needed: v })}
                  />
                  <Label>Forçar nova página se não couber</Label>
                </div>
              </div>
              <Button size="sm" onClick={saveSigSettings} disabled={savingSig}>
                {savingSig ? "Salvando..." : "Salvar configuração de assinatura"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Template editor dialog */}
      <Dialog open={tplOpen} onOpenChange={setTplOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">
              {tplEditing ? "Editar modelo" : "Novo modelo de contrato"}
            </DialogTitle>
            <DialogDescription>
              Use placeholders como {"{{LOCATARIO_NOME}}"} para inserir dados dinâmicos. Todo o texto do
              contrato (título, partes, cláusulas e assinaturas) é renderizado a partir deste modelo.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submitTemplate} className="grid gap-4 md:grid-cols-3">
            <div className="space-y-4 md:col-span-2">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Nome *</Label>
                  <Input
                    value={tplForm.name} maxLength={150}
                    onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Descrição</Label>
                  <Input
                    value={tplForm.description ?? ""} maxLength={250}
                    onChange={(e) => setTplForm({ ...tplForm, description: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={tplForm.active}
                    onCheckedChange={(v) => setTplForm({ ...tplForm, active: v, is_default: v ? tplForm.is_default : false })}
                  />
                  <Label>Ativo</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={tplForm.is_default}
                    disabled={!tplForm.active}
                    onCheckedChange={(v) => setTplForm({ ...tplForm, is_default: v })}
                  />
                  <Label>Modelo padrão</Label>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={fillInitialTemplate}>
                  Inserir modelo inicial
                </Button>
              </div>

              <div className="space-y-2">
                <Label>Título do contrato *</Label>
                <Input
                  value={tplForm.title} maxLength={250}
                  placeholder="Ex.: CONTRATO DE SUBLOCAÇÃO DE IMÓVEL"
                  onChange={(e) => setTplForm({ ...tplForm, title: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Corpo completo do contrato *</Label>
                <RichContractEditor
                  value={tplForm.body_html}
                  onChange={(html) => setTplForm({ ...tplForm, body_html: html })}
                  onPreview={() => setPreviewOpen(true)}
                />
                <p className="text-xs text-muted-foreground">
                  Use a barra de ferramentas para formatar. Insira variáveis e o bloco de assinaturas pelos botões da toolbar.
                </p>
              </div>
            </div>

            <div className="space-y-2 md:col-span-1">
              <Label>Variáveis disponíveis</Label>
              <div className="max-h-[60vh] overflow-y-auto rounded-md border p-2 text-xs">
                <ul className="space-y-1">
                  {CONTRACT_TEMPLATE_VARIABLES.map((v) => (
                    <li key={v.key} className="flex items-start justify-between gap-2 rounded p-1 hover:bg-muted">
                      <div className="min-w-0">
                        <code className="font-mono">{`{{${v.key}}}`}</code>
                        <div className="text-[10px] text-muted-foreground">{v.description}</div>
                      </div>
                      <Button
                        type="button" size="icon" variant="ghost"
                        className="h-6 w-6 shrink-0"
                        title="Copiar"
                        onClick={() => {
                          navigator.clipboard.writeText(`{{${v.key}}}`);
                          toast.success("Copiado");
                        }}
                      >
                        <CopyIcon className="h-3 w-3" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <DialogFooter className="md:col-span-3">
              <Button type="button" variant="outline" onClick={() => setTplOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={tplSaving}>
                {tplSaving ? "Salvando..." : "Salvar modelo"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* A4 Preview dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-[900px] max-h-[92vh] overflow-y-auto bg-muted/40">
          <DialogHeader>
            <DialogTitle className="font-serif">Pré-visualização A4</DialogTitle>
            <DialogDescription>
              Renderização aproximada do conteúdo. As variáveis aparecem como {"{{NOME}}"} —
              no PDF final elas serão substituídas pelos dados do contrato.
            </DialogDescription>
          </DialogHeader>
          <div
            className="mx-auto bg-white text-black shadow-md"
            style={{ width: "210mm", minHeight: "297mm", padding: "25mm 20mm", boxSizing: "border-box" }}
          >
            {tplForm.title && (
              <h1 className="mb-6 text-center text-xl font-bold uppercase">{tplForm.title}</h1>
            )}
            <div
              className="prose prose-sm max-w-none [&_p]:my-2 [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-bold [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6"
              style={{ textAlign: "justify" }}
              dangerouslySetInnerHTML={{ __html: tplForm.body_html || "<p><em>(modelo vazio)</em></p>" }}
            />
            <div
              className="mt-10 border-t border-dashed border-gray-400 pt-3 text-center text-[10px] text-gray-500"
              style={{ minHeight: `${sigSettings.reserved_height_mm}mm` }}
            >
              Espaço reservado para o bloco de assinaturas ({sigSettings.layout === "side_by_side" ? "lado a lado" : "empilhado"} · {sigSettings.reserved_height_mm}mm)
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif">Modelo de recibo</CardTitle>
          <CardDescription>
            Configure o conteúdo padrão usado nos recibos de pagamento gerados pelo Financeiro.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-4 md:col-span-2">
            <div className="space-y-2">
              <Label>Título do recibo</Label>
              <Input
                value={receipt.title} maxLength={120} disabled={!canEdit}
                onChange={(e) => setReceipt({ ...receipt, title: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Texto declarativo</Label>
              <Textarea
                rows={5} value={receipt.body} disabled={!canEdit}
                onChange={(e) => setReceipt({ ...receipt, body: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Rodapé</Label>
              <Textarea
                rows={2} value={receipt.footer} disabled={!canEdit}
                onChange={(e) => setReceipt({ ...receipt, footer: e.target.value })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={receipt.show_logo} disabled={!canEdit}
                  onCheckedChange={(v) => setReceipt({ ...receipt, show_logo: v })}
                />
                <Label>Mostrar logomarca</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={receipt.show_clinic_data} disabled={!canEdit}
                  onCheckedChange={(v) => setReceipt({ ...receipt, show_clinic_data: v })}
                />
                <Label>Mostrar dados da clínica</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={receipt.show_authentication_code} disabled={!canEdit}
                  onCheckedChange={(v) => setReceipt({ ...receipt, show_authentication_code: v })}
                />
                <Label>Mostrar código de autenticação</Label>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cor de destaque</Label>
                <Input
                  type="color" value={receipt.accent_color} disabled={!canEdit}
                  onChange={(e) => setReceipt({ ...receipt, accent_color: e.target.value })}
                />
              </div>
            </div>
            {canEdit && (
              <Button size="sm" onClick={saveReceipt} disabled={savingReceipt}>
                {savingReceipt ? "Salvando..." : "Salvar modelo de recibo"}
              </Button>
            )}
          </div>
          <div className="space-y-2">
            <Label>Variáveis disponíveis</Label>
            <div className="max-h-[60vh] overflow-y-auto rounded-md border p-2 text-xs">
              <ul className="space-y-1">
                {RECEIPT_TEMPLATE_VARIABLES.map((v) => (
                  <li key={v.key} className="flex items-start justify-between gap-2 rounded p-1 hover:bg-muted">
                    <div className="min-w-0">
                      <code className="font-mono">{`{{${v.key}}}`}</code>
                      <div className="text-[10px] text-muted-foreground">{v.description}</div>
                    </div>
                    <Button
                      type="button" size="icon" variant="ghost" className="h-6 w-6 shrink-0" title="Copiar"
                      onClick={() => { navigator.clipboard.writeText(`{{${v.key}}}`); toast.success("Copiado"); }}
                    >
                      <CopyIcon className="h-3 w-3" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <AccessDiagnosticsCard />

      <AlertDialog open={!!tplDeleteTarget} onOpenChange={(o) => !o && setTplDeleteTarget(null)}>

        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">Excluir modelo</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o modelo <strong>{tplDeleteTarget?.name}</strong>?
              Contratos vinculados a ele perderão a referência e passarão a usar o modelo padrão.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDeleteTemplate(); }}
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

function emptyTemplate(): ContractTemplate {
  return {
    id: crypto.randomUUID(),
    name: "",
    description: "",
    active: true,
    is_default: false,
    title: "",
    body_html: "",
    body_text: "",
  };
}
