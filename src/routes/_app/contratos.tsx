import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, FileText, Paperclip, Download, Trash2, Search, FileDown, X, AlertTriangle } from "lucide-react";
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
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  planContractBookings, commitGenerationPlan, WEEKDAY_LABELS,
  type ScheduleRow, type GenerationPlan,
} from "@/lib/contractBookings";
import {
  loadBusySlots, computeRowConflicts, suggestAlternatives,
  TIMELINE_START_MIN, TIMELINE_END_MIN, tm, fromMin,
  type BusySlot,
} from "@/lib/scheduleConflicts";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SHIFTS, SHIFT_LABELS, loadShiftDefaults, detectShift,
  type ShiftDefaults, type ShiftKey,
} from "@/lib/shifts";
import {
  loadContractTemplates, getDefaultContractTemplate,
  type ContractTemplate,
} from "@/lib/contractTemplates";



type LocalSchedule = ScheduleRow & { _mode?: "horario" | "turno"; _shift?: ShiftKey };


export const Route = createFileRoute("/_app/contratos")({
  component: ContratosPage,
});

interface Professional {
  id: string; full_name: string; cpf: string | null; registry: string | null;
  specialty: string | null; email: string | null; phone: string | null; address: string | null;
}
interface Room { id: string; name: string; active: boolean }
interface Contract {
  id: string; professional_id: string; room_id: string | null;
  start_date: string; end_date: string | null;
  monthly_value: number; due_day: number; status: string;
  notes: string | null; extra_clauses: string | null;
  signed_at: string | null; signed_by_name: string | null; signature_hash: string | null;
  locador_name: string | null; created_at: string;
  
  professional?: Professional;
  schedules?: ScheduleRow[];
}

interface Attachment {
  id: string; professional_id: string; contract_id: string | null;
  file_name: string; file_path: string; mime_type: string | null;
  size_bytes: number | null; created_at: string;
}

const emptyForm = {
  professional_id: "",
  start_date: new Date().toISOString().slice(0, 10),
  end_date: "",
  monthly_value: "",
  due_day: "5",
  status: "rascunho",
  extra_clauses: "",
  notes: "",
  locador_name: "",
  signed_by_name: "",
  signed_at: "",
  
};


const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  rascunho: "secondary", ativo: "default", encerrado: "outline", cancelado: "destructive",
};

function ScheduleTimeline({
  weekday, roomId, startMin, endMin, busy, otherRows, hasConflict,
}: {
  weekday: number; roomId: string;
  startMin: number; endMin: number;
  busy: BusySlot[];
  otherRows: ScheduleRow[];
  hasConflict: boolean;
}) {
  const range = TIMELINE_END_MIN - TIMELINE_START_MIN;
  const pct = (n: number) => `${((n - TIMELINE_START_MIN) / range) * 100}%`;
  const width = (a: number, b: number) => `${Math.max(0, ((b - a) / range) * 100)}%`;
  const blocks = busy
    .filter((b) => b.weekday === weekday && b.room_id === roomId)
    .map((b) => ({ start: b.start_min, end: b.end_min, label: b.label, kind: b.kind as string }));
  for (const o of otherRows) {
    if (o.weekday === weekday && o.room_id === roomId && o.start_time && o.end_time) {
      blocks.push({
        start: tm(o.start_time), end: tm(o.end_time),
        label: "Outra linha deste contrato", kind: "interno",
      });
    }
  }
  const ticks = [6, 9, 12, 15, 18, 21];
  return (
    <div className="mt-2 space-y-1">
      <div className="relative h-6 w-full overflow-hidden rounded bg-muted/40">
        {blocks.map((b, i) => (
          <div
            key={i}
            className="absolute top-0 h-full bg-muted-foreground/40"
            style={{ left: pct(Math.max(b.start, TIMELINE_START_MIN)), width: width(Math.max(b.start, TIMELINE_START_MIN), Math.min(b.end, TIMELINE_END_MIN)) }}
            title={`${b.label} (${fromMin(b.start)}–${fromMin(b.end)})`}
          />
        ))}
        <div
          className={cn(
            "absolute top-0 h-full border-2",
            hasConflict ? "border-destructive bg-destructive/40" : "border-primary bg-primary/40",
          )}
          style={{ left: pct(Math.max(startMin, TIMELINE_START_MIN)), width: width(Math.max(startMin, TIMELINE_START_MIN), Math.min(endMin, TIMELINE_END_MIN)) }}
        />
      </div>
      <div className="relative h-3 w-full text-[10px] text-muted-foreground">
        {ticks.map((h) => (
          <span key={h} className="absolute -translate-x-1/2" style={{ left: pct(h * 60) }}>{h}h</span>
        ))}
      </div>
    </div>
  );
}

function ContratosPage() {
  const { role, user } = useAuth();
  const canEdit = role === "gestor";

  const [contracts, setContracts] = useState<Contract[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [schedules, setSchedules] = useState<LocalSchedule[]>([]);
  const [shiftDefs, setShiftDefs] = useState<ShiftDefaults>(DEFAULT_SHIFTS);
  


  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Contract | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);

  const [attachOpen, setAttachOpen] = useState(false);
  const [attachContract, setAttachContract] = useState<Contract | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  // Conflict preview dialog state for generation
  const [genPreview, setGenPreview] = useState<{
    open: boolean;
    plan: GenerationPlan | null;
    contractId: string | null;
  }>({ open: false, plan: null, contractId: null });

  // Realtime conflict detection state for the grid
  const [busySlots, setBusySlots] = useState<BusySlot[]>([]);
  const [loadingBusy, setLoadingBusy] = useState(false);

  async function load() {
    setLoading(true);
    const [c, p, r, sch] = await Promise.all([
      supabase.from("contracts").select("*").order("created_at", { ascending: false }),
      supabase.from("professionals").select("id,full_name,cpf,registry,specialty,email,phone,address").eq("active", true).order("full_name"),
      supabase.from("rooms").select("id,name,active").order("name"),
      supabase.from("contract_schedules").select("id,contract_id,room_id,weekday,start_time,end_time"),
    ]);
    if (c.error) toast.error("Erro ao carregar contratos", { description: c.error.message });
    const profs = (p.data as Professional[]) ?? [];
    const rms = (r.data as Room[]) ?? [];
    const schedList = (sch.data as Array<ScheduleRow & { contract_id: string }>) ?? [];
    const enriched = ((c.data as Contract[]) ?? []).map((ct) => ({
      ...ct,
      professional: profs.find((pp) => pp.id === ct.professional_id),
      schedules: schedList.filter((s) => s.contract_id === ct.id),
    }));
    setContracts(enriched);
    setProfessionals(profs);
    setRooms(rms);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Reload busy slots whenever the dialog opens or the edited contract id changes
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingBusy(true);
    loadBusySlots({ excludeContractId: editing?.id ?? null })
      .then((b) => { if (!cancelled) setBusySlots(b); })
      .catch(() => { /* silencioso: detecção é apenas um auxílio */ })
      .finally(() => { if (!cancelled) setLoadingBusy(false); });
    return () => { cancelled = true; };
  }, [open, editing?.id]);

  // Load shift defaults whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadShiftDefaults().then((d) => {
      if (cancelled) return;
      setShiftDefs(d);
      // Refresh times of any rows already in "turno" mode using new defaults
      setSchedules((rows) => rows.map((row) => {
        if (row._mode !== "turno" || !row._shift) return row;
        const r = d[row._shift];
        return { ...row, start_time: r.start, end_time: r.end };
      }));
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [open]);





  const conflictsByRow = useMemo(
    () => schedules.map((s, i) => computeRowConflicts(s, i, schedules, busySlots)),
    [schedules, busySlots],
  );
  const totalRowConflicts = conflictsByRow.reduce((acc, c) => acc + c.length, 0);
  const rowsWithConflict = conflictsByRow.filter((c) => c.length > 0).length;

  const selectedProfessional = useMemo(
    () => professionals.find((p) => p.id === form.professional_id),
    [professionals, form.professional_id],
  );
  const roomMap = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setSchedules([]);
    setOpen(true);
  }

  function openEdit(c: Contract) {
    setEditing(c);
    setForm({
      professional_id: c.professional_id,
      start_date: c.start_date,
      end_date: c.end_date ?? "",
      monthly_value: String(c.monthly_value ?? ""),
      due_day: String(c.due_day ?? 5),
      status: c.status,
      extra_clauses: c.extra_clauses ?? "",
      notes: c.notes ?? "",
      locador_name: c.locador_name ?? "",
      signed_by_name: c.signed_by_name ?? "",
      signed_at: c.signed_at ? c.signed_at.slice(0, 10) : "",
      
    });

    setSchedules((c.schedules ?? []).map((s) => {
      const start = s.start_time.slice(0, 5);
      const end = s.end_time.slice(0, 5);
      const shift = detectShift(start, end, shiftDefs);
      return {
        id: s.id, weekday: s.weekday, room_id: s.room_id,
        start_time: start, end_time: end,
        _mode: shift ? "turno" : "horario",
        _shift: shift ?? undefined,
      } as LocalSchedule;
    }));

    setOpen(true);
  }

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

  async function confirmDeleteContract() {
    if (!deleteTarget || !user?.email) return;
    if (!deletePassword) { toast.error("Informe sua senha para confirmar."); return; }
    setDeleting(true);
    try {
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: user.email, password: deletePassword,
      });
      if (authErr) { toast.error("Senha incorreta."); setDeleting(false); return; }

      const contractId = deleteTarget.id;
      // coleta bookings do contrato para limpar conflitos
      const { data: bks } = await supabase
        .from("bookings").select("id").eq("contract_id", contractId);
      const bookingIds = (bks ?? []).map((b) => b.id);
      if (bookingIds.length > 0) {
        await supabase.from("booking_conflicts").delete().or(
          `booking_id_a.in.(${bookingIds.join(",")}),booking_id_b.in.(${bookingIds.join(",")})`,
        );
      }
      await supabase.from("receivables").delete().eq("contract_id", contractId);
      await supabase.from("bookings").delete().eq("contract_id", contractId);
      await supabase.from("contract_schedules").delete().eq("contract_id", contractId);
      await supabase.from("contract_attachments").delete().eq("contract_id", contractId);
      const { error: delErr } = await supabase.from("contracts").delete().eq("id", contractId);
      if (delErr) { toast.error("Erro ao excluir contrato", { description: delErr.message }); setDeleting(false); return; }

      await logAudit("contract.delete", contractId, { professional_id: deleteTarget.professional_id });
      toast.success("Contrato excluído permanentemente.");
      setDeleteTarget(null);
      setDeletePassword("");
      await load();
    } finally {
      setDeleting(false);
    }
  }

  function addSchedule() {
    setSchedules((s) => [...s, {
      weekday: 1, room_id: rooms[0]?.id ?? "",
      start_time: "08:00", end_time: "09:00",
      _mode: "horario",
    }]);
  }
  function updateSchedule(idx: number, patch: Partial<LocalSchedule>) {
    setSchedules((s) => s.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }
  function setRowMode(idx: number, mode: "horario" | "turno") {
    setSchedules((s) => s.map((row, i) => {
      if (i !== idx) return row;
      if (mode === "turno") {
        const k: ShiftKey = row._shift ?? "manha";
        const r = shiftDefs[k];
        return { ...row, _mode: "turno", _shift: k, start_time: r.start, end_time: r.end };
      }
      return { ...row, _mode: "horario" };
    }));
  }
  function setRowShift(idx: number, k: ShiftKey) {
    const r = shiftDefs[k];
    setSchedules((s) => s.map((row, i) =>
      i === idx ? { ...row, _mode: "turno", _shift: k, start_time: r.start, end_time: r.end } : row,
    ));
  }

  function removeSchedule(idx: number) {
    setSchedules((s) => s.filter((_, i) => i !== idx));
  }

  function validateSchedules(): string | null {
    for (const s of schedules) {
      if (!s.room_id) return "Selecione a sala em todas as linhas da grade.";
      if (!s.start_time || !s.end_time) return "Preencha início e fim em todas as linhas.";
      if (s.end_time <= s.start_time) return "Em cada linha, o horário final deve ser após o inicial.";
    }
    // overlap entre linhas no mesmo dia/sala
    for (let i = 0; i < schedules.length; i++) {
      for (let j = i + 1; j < schedules.length; j++) {
        const a = schedules[i], b = schedules[j];
        if (a.weekday === b.weekday && a.room_id === b.room_id) {
          if (!(a.end_time <= b.start_time || b.end_time <= a.start_time)) {
            return "Há sobreposição de horários no mesmo dia/sala dentro deste contrato.";
          }
        }
      }
    }
    return null;
  }

  async function persistSchedules(contractId: string) {
    await supabase.from("contract_schedules").delete().eq("contract_id", contractId);
    if (schedules.length === 0) return;
    const rows = schedules.map((s) => ({
      contract_id: contractId,
      room_id: s.room_id,
      weekday: s.weekday,
      start_time: s.start_time,
      end_time: s.end_time,
    }));
    const { error } = await supabase.from("contract_schedules").insert(rows);
    if (error) throw error;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.professional_id || !form.start_date) {
      toast.error("Profissional e data de início são obrigatórios");
      return;
    }
    if (schedules.length === 0) {
      toast.error("Inclua ao menos um horário na grade (dia, sala, início, fim).");
      return;
    }
    const schedErr = validateSchedules();
    if (schedErr) { toast.error(schedErr); return; }

    setSaving(true);
    const payload = {
      professional_id: form.professional_id,
      room_id: null,
      start_date: form.start_date,
      end_date: form.end_date || null,
      monthly_value: form.monthly_value ? Number(form.monthly_value) : 0,
      due_day: Math.min(28, Math.max(1, Number(form.due_day) || 5)),
      status: form.status,
      extra_clauses: form.extra_clauses.trim() || null,
      notes: form.notes.trim() || null,
      locador_name: form.locador_name.trim() || null,
      signed_by_name: form.signed_by_name.trim() || null,
      signed_at: form.signed_at ? new Date(form.signed_at).toISOString() : null,
      
    };


    try {
      let contractId: string;
      if (editing) {
        const { error } = await supabase.from("contracts").update(payload).eq("id", editing.id);
        if (error) throw error;
        contractId = editing.id;
      } else {
        const { data, error } = await supabase.from("contracts").insert(payload).select("id").single();
        if (error) throw error;
        contractId = data!.id;
      }
      await persistSchedules(contractId);

      // Se ativo, prepara geração de bookings com prévia de conflitos
      if (form.status === "ativo") {
        const plan = await planContractBookings({
          contract_id: contractId,
          professional_id: form.professional_id,
          start_date: form.start_date,
          end_date: form.end_date || null,
          schedules,
        });

        if (plan.toCreate.length === 0) {
          toast.success(editing ? "Contrato atualizado" : "Contrato criado", {
            description: "Nenhuma reserva nova a gerar.",
          });
          await logAudit(editing ? "contract.update" : "contract.create", contractId);
          setOpen(false);
          load();
        } else if (plan.conflicts.length > 0) {
          // pedir confirmação
          setGenPreview({ open: true, plan, contractId });
          await logAudit(editing ? "contract.update" : "contract.create", contractId);
        } else {
          const res = await commitGenerationPlan(plan);
          toast.success(editing ? "Contrato atualizado" : "Contrato criado", {
            description: `${res.created} reserva(s) geradas no calendário.`,
          });
          await logAudit(editing ? "contract.update" : "contract.create", contractId, { generated: res.created });
          setOpen(false);
          load();
        }
      } else {
        toast.success(editing ? "Contrato atualizado" : "Contrato criado");
        await logAudit(editing ? "contract.update" : "contract.create", contractId);
        setOpen(false);
        load();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Erro ao salvar", { description: msg });
    } finally {
      setSaving(false);
    }
  }

  async function confirmGeneration(force: boolean) {
    if (!genPreview.plan) return;
    if (!force) {
      setGenPreview({ open: false, plan: null, contractId: null });
      setOpen(false);
      load();
      return;
    }
    try {
      const res = await commitGenerationPlan(genPreview.plan);
      toast.success("Reservas geradas", {
        description: `${res.created} criadas • ${res.conflictsRegistered} conflitos registrados para resolução em /conflitos.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Erro ao gerar reservas", { description: msg });
    } finally {
      setGenPreview({ open: false, plan: null, contractId: null });
      setOpen(false);
      load();
    }
  }

  async function openAttachments(c: Contract) {
    setAttachContract(c);
    setAttachOpen(true);
    const { data, error } = await supabase
      .from("contract_attachments").select("*")
      .eq("professional_id", c.professional_id)
      .order("created_at", { ascending: false });
    if (error) toast.error("Erro ao carregar anexos", { description: error.message });
    setAttachments((data as Attachment[]) ?? []);
  }
  async function refreshAttachments(professionalId: string) {
    const { data } = await supabase
      .from("contract_attachments").select("*")
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
      file_name: file.name, file_path: path,
      mime_type: file.type, size_bytes: file.size,
      uploaded_by: user?.id ?? null,
    });
    setUploading(false);
    e.target.value = "";
    if (ins.error) { toast.error("Erro ao registrar anexo", { description: ins.error.message }); return; }
    toast.success("Anexo enviado");
    await logAudit("contract.attachment_upload", attachContract.id, { file: file.name });
    refreshAttachments(attachContract.professional_id);
  }
  async function downloadAttachment(a: Attachment) {
    const { data, error } = await supabase.storage
      .from("contract-attachments").createSignedUrl(a.file_path, 60);
    if (error || !data) { toast.error("Erro ao gerar link", { description: error?.message }); return; }
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
    if (!q) return true;
    if ((c.professional?.full_name ?? "").toLowerCase().includes(q)) return true;
    if (c.status.toLowerCase().includes(q)) return true;
    if ((c.schedules ?? []).some((s) => (roomMap.get(s.room_id)?.name ?? "").toLowerCase().includes(q))) return true;
    return false;
  });

  function summarizeSchedules(list: ScheduleRow[] | undefined) {
    if (!list || list.length === 0) return "—";
    const byRoom = new Map<string, ScheduleRow[]>();
    for (const s of list) {
      const arr = byRoom.get(s.room_id) ?? [];
      arr.push(s); byRoom.set(s.room_id, arr);
    }
    const parts: string[] = [];
    for (const [roomId, rows] of byRoom) {
      const room = roomMap.get(roomId)?.name ?? "Sala";
      const days = rows.map((r) => WEEKDAY_LABELS[r.weekday]).join("/");
      parts.push(`${room} (${days})`);
    }
    return parts.join(" • ");
  }

  function detailSchedules(list: ScheduleRow[] | undefined) {
    if (!list || list.length === 0) return "—";
    return list.map((s) => {
      const room = roomMap.get(s.room_id)?.name ?? "Sala";
      const day = WEEKDAY_LABELS[s.weekday];
      return `${day} - ${s.start_time.slice(0, 5)} às ${s.end_time.slice(0, 5)} - ${room}`;
    }).join("\n");
  }


  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl">Contratos</h1>
          <p className="text-muted-foreground">
            Contratos com grade multi-sala, geração automática de reservas e detecção de conflitos.
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
              className="pl-9" value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Profissional</TableHead>
                  <TableHead>Salas / dias</TableHead>
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
                    <TableCell className="text-sm">{summarizeSchedules(c.schedules)}</TableCell>
                    <TableCell className="text-sm">
                      {new Date(c.start_date).toLocaleDateString("pt-BR")}
                      {c.end_date && <> – {new Date(c.end_date).toLocaleDateString("pt-BR")}</>}
                    </TableCell>
                    <TableCell>
                      {Number(c.monthly_value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[c.status] ?? "secondary"}>{c.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon" variant="ghost" title="Baixar PDF"
                          onClick={async () => {
                            if (!c.professional) { toast.error("Dados incompletos para gerar o PDF"); return; }
                            const firstRoomId = c.schedules?.[0]?.room_id;
                            const roomName = firstRoomId
                              ? (roomMap.get(firstRoomId)?.name ?? "—")
                              : "—";
                            try {
                              await generateContractPdf({
                                professional: c.professional,
                                room: { name: summarizeSchedules(c.schedules) !== "—" ? summarizeSchedules(c.schedules) : roomName },
                                start_date: c.start_date, end_date: c.end_date,
                                monthly_value: Number(c.monthly_value),
                                extra_clauses: c.extra_clauses, notes: c.notes,
                                locador_name: c.locador_name, signed_by_name: c.signed_by_name,
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
                        {canEdit && (
                          <Button
                            size="icon" variant="ghost"
                            onClick={() => { setDeleteTarget(c); setDeletePassword(""); }}
                            title="Excluir contrato"
                            className="text-destructive hover:text-destructive"
                          >
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
        </CardContent>
      </Card>

      {/* Form dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">
              {editing ? "Editar contrato" : "Novo contrato"}
            </DialogTitle>
            <DialogDescription>
              Defina a grade de horários (cada linha = dia da semana + sala + faixa de horário).
              Ao salvar como "Ativo", as reservas até a data fim do contrato são geradas no calendário.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={save} className="space-y-6">
            {/* Partes */}
            <section className="space-y-4">
              <h3 className="font-serif text-lg">Profissional</h3>
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

              {selectedProfessional && (
                <div className="rounded-md border bg-muted/40 p-3 text-sm">
                  <div className="font-medium">{selectedProfessional.full_name}</div>
                  <div className="text-muted-foreground">
                    {selectedProfessional.specialty ?? "—"}
                    {selectedProfessional.registry && <> • {selectedProfessional.registry}</>}
                    {selectedProfessional.cpf && <> • CPF {selectedProfessional.cpf}</>}
                  </div>
                </div>
              )}
            </section>

            {/* Grade de horários */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-serif text-lg">Grade de horários *</h3>
                <Button type="button" variant="outline" size="sm" onClick={addSchedule} disabled={rooms.length === 0}>
                  <Plus className="mr-2 h-4 w-4" /> Adicionar linha
                </Button>
              </div>

              {/* Resumo geral */}
              {schedules.length > 0 && (
                <div
                  className={cn(
                    "rounded-md border px-3 py-2 text-xs",
                    totalRowConflicts > 0
                      ? "border-destructive/40 bg-destructive/5 text-destructive"
                      : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
                  )}
                >
                  {loadingBusy
                    ? "Verificando conflitos com outros contratos e avulsos..."
                    : totalRowConflicts > 0
                      ? `${totalRowConflicts} conflito(s) detectado(s) em ${rowsWithConflict} linha(s). É possível salvar mesmo assim — as ocorrências ficarão marcadas como conflito para ajuste em /conflitos.`
                      : "Nenhum conflito detectado na grade (verificação nos próximos 90 dias)."}
                </div>
              )}

              {schedules.length === 0 ? (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Nenhum horário adicionado. Clique em "Adicionar linha" para definir dia, sala e faixa de horário.
                </div>
              ) : (
                <div className="space-y-2">
                  {schedules.map((s, i) => {
                    const rowConflicts = conflictsByRow[i] ?? [];
                    const hasConflict = rowConflicts.length > 0;
                    const suggestion = hasConflict
                      ? suggestAlternatives(s, i, schedules, busySlots, rooms)
                      : { alternativeRooms: [], alternativeStart: null };
                    return (
                      <div
                        key={i}
                        className={cn(
                          "rounded-md border p-3",
                          hasConflict ? "border-destructive bg-destructive/5" : "",
                        )}
                      >
                        <div className="grid grid-cols-12 items-end gap-2">
                          <div className="col-span-2 space-y-1">
                            <Label className="text-xs">Dia</Label>
                            <Select
                              value={String(s.weekday)}
                              onValueChange={(v) => updateSchedule(i, { weekday: Number(v) })}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {WEEKDAY_LABELS.map((lbl, idx) => (
                                  <SelectItem key={idx} value={String(idx)}>{lbl}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="col-span-3 space-y-1">
                            <Label className="text-xs">Sala</Label>
                            <Select value={s.room_id} onValueChange={(v) => updateSchedule(i, { room_id: v })}>
                              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                              <SelectContent>
                                {rooms.filter((r) => r.active).map((r) => (
                                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="col-span-2 space-y-1">
                            <Label className="text-xs">Tipo</Label>
                            <Select
                              value={s._mode ?? "horario"}
                              onValueChange={(v) => setRowMode(i, v as "horario" | "turno")}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="horario">Horário</SelectItem>
                                <SelectItem value="turno">Turno</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {s._mode === "turno" ? (
                            <div className="col-span-4 space-y-1">
                              <Label className="text-xs">Turno</Label>
                              <Select
                                value={s._shift ?? "manha"}
                                onValueChange={(v) => setRowShift(i, v as ShiftKey)}
                              >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {(["manha", "tarde", "noite"] as ShiftKey[]).map((k) => (
                                    <SelectItem key={k} value={k}>
                                      {SHIFT_LABELS[k]} ({shiftDefs[k].start}–{shiftDefs[k].end})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : (
                            <>
                              <div className="col-span-2 space-y-1">
                                <Label className="text-xs">Início</Label>
                                <Input type="time" value={s.start_time}
                                  onChange={(e) => updateSchedule(i, { start_time: e.target.value })} />
                              </div>
                              <div className="col-span-2 space-y-1">
                                <Label className="text-xs">Fim</Label>
                                <Input type="time" value={s.end_time}
                                  onChange={(e) => updateSchedule(i, { end_time: e.target.value })} />
                              </div>
                            </>
                          )}
                          <div className="col-span-1 flex justify-end">
                            <Button type="button" variant="ghost" size="icon" onClick={() => removeSchedule(i)} title="Remover">
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>


                        {/* Mini timeline do dia/sala */}
                        {s.room_id && s.start_time && s.end_time && tm(s.end_time) > tm(s.start_time) && (
                          <ScheduleTimeline
                            weekday={s.weekday}
                            roomId={s.room_id}
                            startMin={tm(s.start_time)}
                            endMin={tm(s.end_time)}
                            busy={busySlots}
                            otherRows={schedules.filter((_, idx) => idx !== i)}
                            hasConflict={hasConflict}
                          />
                        )}

                        {/* Badges com quem conflita + sugestões */}
                        {hasConflict && (
                          <div className="mt-2 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <AlertTriangle className="h-4 w-4 text-destructive" />
                              <span className="text-xs font-medium text-destructive">Conflita com:</span>
                              <TooltipProvider delayDuration={150}>
                                {rowConflicts.map((c, idx) => (
                                  <Tooltip key={idx}>
                                    <TooltipTrigger asChild>
                                      <Badge variant="destructive" className="cursor-help capitalize">
                                        {c.label}
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {c.start_min !== undefined && c.end_min !== undefined
                                        ? `${fromMin(c.start_min)}–${fromMin(c.end_min)} • ${c.kind}`
                                        : c.kind}
                                    </TooltipContent>
                                  </Tooltip>
                                ))}
                              </TooltipProvider>
                            </div>
                            {(suggestion.alternativeRooms.length > 0 || suggestion.alternativeStart) && (
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="text-muted-foreground">Sugestões:</span>
                                {suggestion.alternativeRooms.map((r) => (
                                  <Button
                                    key={r.id} type="button" size="sm" variant="outline"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => updateSchedule(i, { room_id: r.id })}
                                  >
                                    Trocar para {r.name}
                                  </Button>
                                ))}
                                {suggestion.alternativeStart && (
                                  <Button
                                    type="button" size="sm" variant="outline" className="h-7 px-2 text-xs"
                                    onClick={() => {
                                      const dur = tm(s.end_time) - tm(s.start_time);
                                      const newStart = suggestion.alternativeStart!;
                                      const newEnd = fromMin(tm(newStart) + dur);
                                      updateSchedule(i, { start_time: newStart, end_time: newEnd });
                                    }}
                                  >
                                    Mover para {suggestion.alternativeStart}
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
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
                <div className="space-y-2">
                  <Label>Dia de vencimento (1-28)</Label>
                  <Input type="number" min="1" max="28" value={form.due_day}
                    onChange={(e) => setForm({ ...form, due_day: e.target.value })} />
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
                  <p className="text-xs text-muted-foreground">
                    Ao salvar como "Ativo": gera recebíveis mensais no Financeiro e materializa as reservas
                    da grade no Calendário até a data de término (ou 12 meses se em aberto). Conflitos serão
                    notificados antes de prosseguir.
                  </p>
                </div>
              </div>
            </section>

            {/* Cláusulas */}
            <section className="space-y-4">
              <h3 className="font-serif text-lg">Cláusulas e observações</h3>
              <div className="space-y-2">

                <Label>Cláusulas adicionais</Label>
                <Textarea rows={6} maxLength={5000}
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
                  <Input maxLength={150} value={form.locador_name}
                    onChange={(e) => setForm({ ...form, locador_name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Locatário (editável)</Label>
                  <Input maxLength={150} value={form.signed_by_name}
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

      {/* Conflict preview dialog */}
      <AlertDialog open={genPreview.open} onOpenChange={(o) => !o && setGenPreview({ open: false, plan: null, contractId: null })}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">Conflitos detectados na geração</AlertDialogTitle>
            <AlertDialogDescription>
              Foram encontrados {genPreview.plan?.conflicts.length ?? 0} conflito(s) ao tentar materializar{" "}
              {genPreview.plan?.toCreate.length ?? 0} reserva(s).
              Você pode gerar mesmo assim — as reservas conflitantes ficarão marcadas como{" "}
              <strong>conflito</strong> e listadas em <strong>/conflitos</strong> para ajuste.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-64 overflow-auto rounded-md border text-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Sala</TableHead>
                  <TableHead>Horário</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(genPreview.plan?.conflicts ?? []).slice(0, 50).map((c, i) => (
                  <TableRow key={i}>
                    <TableCell>{c.date.toLocaleDateString("pt-BR")} ({WEEKDAY_LABELS[c.schedule.weekday]})</TableCell>
                    <TableCell>{roomMap.get(c.schedule.room_id)?.name ?? "—"}</TableCell>
                    <TableCell>{c.schedule.start_time}–{c.schedule.end_time}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {(genPreview.plan?.conflicts.length ?? 0) > 50 && (
              <div className="p-2 text-center text-xs text-muted-foreground">
                Mostrando os primeiros 50 conflitos.
              </div>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => confirmGeneration(false)}>Cancelar geração</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmGeneration(true)}>Gerar mesmo assim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete contract confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setDeletePassword(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" /> Excluir contrato permanentemente
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é <strong>irreversível</strong>. Serão removidos do banco de dados:
              o contrato, sua grade de horários, reservas geradas, recebíveis e anexos vinculados.
              Para confirmar, digite a senha de login do gestor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delete-pwd">Senha do gestor ({user?.email})</Label>
            <Input
              id="delete-pwd"
              type="password"
              autoComplete="current-password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !deleting) confirmDeleteContract(); }}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting || !deletePassword}
              onClick={(e) => { e.preventDefault(); confirmDeleteContract(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Excluindo..." : "Excluir definitivamente"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      {/* Attachments dialog */}
      <Dialog open={attachOpen} onOpenChange={setAttachOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl flex items-center gap-2">
              <FileText className="h-5 w-5" /> Anexos do contrato
            </DialogTitle>
            <DialogDescription>
              Vinculados ao profissional{" "}
              <span className="font-medium">{attachContract?.professional?.full_name}</span>.
            </DialogDescription>
          </DialogHeader>

          {canEdit && (
            <div className="flex items-center gap-3 rounded-md border border-dashed p-4">
              <Paperclip className="h-4 w-4 text-muted-foreground" />
              <Input type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                disabled={uploading} onChange={uploadFile} />
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
