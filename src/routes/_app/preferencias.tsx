import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import {
  DEFAULT_SHIFTS, SHIFT_LABELS, loadShiftDefaults, saveShiftDefaults,
  type ShiftDefaults, type ShiftKey,
} from "@/lib/shifts";

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

  async function load() {
    setLoading(true);
    const [{ data }, sd] = await Promise.all([
      supabase.from("settings").select("value").eq("key", "clinic_branding").maybeSingle(),
      loadShiftDefaults(),
    ]);
    setBranding(((data?.value as ClinicBranding) ?? {}) as ClinicBranding);
    setShifts(sd);
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
    </div>
  );
}
