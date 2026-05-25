import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { format, parseISO, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, CalendarIcon, CheckCircle2, Ban, ArrowRightLeft, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/conflitos")({
  component: ConflitosPage,
});

interface Conflict {
  id: string;
  booking_id_a: string;
  booking_id_b: string;
  room_id: string;
  status: string;
  created_at: string;
  resolution_notes: string | null;
}
interface Booking {
  id: string;
  professional_id: string;
  room_id: string;
  start_at: string;
  end_at: string;
  status: string;
  source: string;
  contract_id: string | null;
}
interface Room { id: string; name: string }
interface Professional { id: string; full_name: string }

interface EnrichedConflict extends Conflict {
  a?: Booking; b?: Booking;
}

function toTimeStr(d: Date) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function fromTimeStr(date: Date, t: string) {
  const [h, m] = t.split(":").map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

function ConflitosPage() {
  const { role } = useAuth();
  const canEdit = role === "gestor";

  const [conflicts, setConflicts] = useState<EnrichedConflict[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);

  // adjust dialog
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustForm, setAdjustForm] = useState<{
    conflict: EnrichedConflict | null;
    target: Booking | null;
    room_id: string;
    date: Date;
    start: string;
    end: string;
  }>({ conflict: null, target: null, room_id: "", date: new Date(), start: "08:00", end: "09:00" });

  // resolve note dialog
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveForm, setResolveForm] = useState<{ conflict: EnrichedConflict | null; notes: string }>({
    conflict: null, notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [cRes, rRes, pRes] = await Promise.all([
      supabase.from("booking_conflicts").select("*").order("created_at", { ascending: false }),
      supabase.from("rooms").select("id,name").order("name"),
      supabase.from("professionals").select("id,full_name").order("full_name"),
    ]);
    if (cRes.error) toast.error("Erro ao carregar conflitos", { description: cRes.error.message });
    const rawConflicts = (cRes.data as Conflict[]) ?? [];

    const bookingIds = Array.from(new Set(rawConflicts.flatMap((c) => [c.booking_id_a, c.booking_id_b])));
    let bookingsMap = new Map<string, Booking>();
    if (bookingIds.length > 0) {
      const { data: bks } = await supabase
        .from("bookings")
        .select("id,professional_id,room_id,start_at,end_at,status,source,contract_id")
        .in("id", bookingIds);
      bookingsMap = new Map(((bks as Booking[]) ?? []).map((b) => [b.id, b]));
    }
    const enriched = rawConflicts.map((c) => ({
      ...c,
      a: bookingsMap.get(c.booking_id_a),
      b: bookingsMap.get(c.booking_id_b),
    }));
    setConflicts(enriched);
    setRooms((rRes.data as Room[]) ?? []);
    setProfessionals((pRes.data as Professional[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const profMap = useMemo(() => new Map(professionals.map((p) => [p.id, p])), [professionals]);
  const roomMap = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);

  const visible = conflicts.filter((c) => (showResolved ? true : c.status === "pendente"));

  async function audit(action: string, entity_id: string | null, metadata: Record<string, unknown>) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("audit_logs").insert({
      actor_id: user.id, action, entity_type: "conflict", entity_id, metadata: metadata as never,
    });
  }

  function openAdjust(conflict: EnrichedConflict, target: Booking, mode: "reagendar" | "trocar_sala") {
    const s = parseISO(target.start_at), e = parseISO(target.end_at);
    setAdjustForm({
      conflict, target,
      room_id: target.room_id,
      date: startOfDay(s),
      start: toTimeStr(s), end: toTimeStr(e),
    });
    setAdjustOpen(true);
    // mode é apenas dica visual; o usuário pode mudar qualquer campo
    void mode;
  }

  async function saveAdjust(force = false) {
    const { conflict, target, room_id, date, start, end } = adjustForm;
    if (!conflict || !target) return;
    const newStart = fromTimeStr(date, start);
    const newEnd = fromTimeStr(date, end);
    if (newEnd <= newStart) { toast.error("Horário final deve ser após o inicial"); return; }

    // verifica conflito novo (excluindo o próprio booking)
    if (!force) {
      const { data: candidates } = await supabase
        .from("bookings").select("id")
        .eq("room_id", room_id)
        .neq("status", "cancelada")
        .neq("id", target.id)
        .lt("start_at", newEnd.toISOString())
        .gt("end_at", newStart.toISOString());
      if ((candidates ?? []).length > 0) {
        if (!confirm(`O novo horário ainda gera ${candidates!.length} conflito(s). Salvar mesmo assim?`)) return;
      }
    }

    const { error } = await supabase.from("bookings").update({
      room_id, start_at: newStart.toISOString(), end_at: newEnd.toISOString(),
      status: "ativa",
    }).eq("id", target.id);
    if (error) { toast.error("Erro ao ajustar", { description: error.message }); return; }

    // se o outro lado não tem mais sobreposição com este, reativa
    const other = conflict.a?.id === target.id ? conflict.b : conflict.a;
    if (other) {
      const oStart = parseISO(other.start_at), oEnd = parseISO(other.end_at);
      const stillOverlap =
        other.room_id === room_id && oStart < newEnd && oEnd > newStart;
      if (!stillOverlap && other.status === "conflito") {
        await supabase.from("bookings").update({ status: "ativa" }).eq("id", other.id);
      }
    }

    await supabase.from("booking_conflicts").update({
      status: "resolvido",
      resolved_at: new Date().toISOString(),
      resolution_notes: `Reserva ${target.id.slice(0, 8)} ajustada (sala/horário).`,
    }).eq("id", conflict.id);

    await audit("conflict.adjust", conflict.id, { booking_id: target.id, room_id, start: newStart.toISOString(), end: newEnd.toISOString() });
    toast.success("Conflito ajustado");
    setAdjustOpen(false);
    load();
  }

  async function cancelOccurrence(conflict: EnrichedConflict, b: Booking) {
    if (!confirm("Cancelar esta ocorrência? A recorrência do contrato continua.")) return;
    const { error } = await supabase.from("bookings").update({ status: "cancelada" }).eq("id", b.id);
    if (error) { toast.error("Erro", { description: error.message }); return; }

    // o outro lado volta a ser ativa (se estava conflito)
    const other = conflict.a?.id === b.id ? conflict.b : conflict.a;
    if (other && other.status === "conflito") {
      await supabase.from("bookings").update({ status: "ativa" }).eq("id", other.id);
    }
    await supabase.from("booking_conflicts").update({
      status: "resolvido",
      resolved_at: new Date().toISOString(),
      resolution_notes: `Ocorrência ${b.id.slice(0, 8)} cancelada.`,
    }).eq("id", conflict.id);

    await audit("conflict.cancel_occurrence", conflict.id, { booking_id: b.id });
    toast.success("Ocorrência cancelada");
    load();
  }

  function openResolveNote(conflict: EnrichedConflict) {
    setResolveForm({ conflict, notes: "" });
    setResolveOpen(true);
  }
  async function saveResolveNote() {
    const { conflict, notes } = resolveForm;
    if (!conflict) return;
    const { error } = await supabase.from("booking_conflicts").update({
      status: "resolvido",
      resolved_at: new Date().toISOString(),
      resolution_notes: notes.trim() || "Resolvido manualmente.",
    }).eq("id", conflict.id);
    if (error) { toast.error("Erro", { description: error.message }); return; }
    await audit("conflict.manual_resolve", conflict.id, { notes });
    toast.success("Conflito marcado como resolvido");
    setResolveOpen(false);
    load();
  }

  function renderBookingCard(b: Booking | undefined, conflict: EnrichedConflict, label: string) {
    if (!b) return (
      <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        Reserva não encontrada (possivelmente cancelada/removida).
      </div>
    );
    const prof = profMap.get(b.professional_id)?.full_name ?? "—";
    const room = roomMap.get(b.room_id)?.name ?? "—";
    const s = parseISO(b.start_at), e = parseISO(b.end_at);
    return (
      <div className="space-y-2 rounded-md border p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
          <Badge variant="outline" className="capitalize">{b.source}</Badge>
        </div>
        <div className="font-medium">{prof}</div>
        <div className="text-muted-foreground">Sala: {room}</div>
        <div className="text-muted-foreground">
          {format(s, "dd/MM/yyyy")} • {toTimeStr(s)} – {toTimeStr(e)}
        </div>
        <div><Badge variant={b.status === "conflito" ? "destructive" : "secondary"} className="capitalize">{b.status}</Badge></div>
        {canEdit && conflict.status === "pendente" && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => openAdjust(conflict, b, "reagendar")}>
              <Clock className="mr-1 h-3.5 w-3.5" /> Reagendar
            </Button>
            <Button size="sm" variant="outline" onClick={() => openAdjust(conflict, b, "trocar_sala")}>
              <ArrowRightLeft className="mr-1 h-3.5 w-3.5" /> Trocar sala
            </Button>
            <Button size="sm" variant="destructive" onClick={() => cancelOccurrence(conflict, b)}>
              <Ban className="mr-1 h-3.5 w-3.5" /> Cancelar
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl">Conflitos</h1>
          <p className="text-muted-foreground">
            Reservas com sobreposição de horário na mesma sala. Ajuste dia, horário ou sala para resolver.
          </p>
        </div>
        <Button variant="outline" onClick={() => setShowResolved((v) => !v)}>
          {showResolved ? "Ocultar resolvidos" : "Mostrar resolvidos"}
        </Button>
      </div>

      {loading ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">Carregando...</CardContent></Card>
      ) : visible.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">
          <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-500" />
          Nenhum conflito {showResolved ? "registrado" : "pendente"}.
        </CardContent></Card>
      ) : (
        <div className="space-y-4">
          {visible.map((c) => (
            <Card key={c.id} className={cn(c.status === "pendente" ? "border-amber-500/50" : "opacity-70")}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 font-serif text-lg">
                  <AlertTriangle className={cn("h-5 w-5", c.status === "pendente" ? "text-amber-500" : "text-muted-foreground")} />
                  Conflito na sala {roomMap.get(c.room_id)?.name ?? "—"}
                  <Badge variant={c.status === "pendente" ? "destructive" : "secondary"} className="ml-2 capitalize">
                    {c.status}
                  </Badge>
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Registrado em {format(parseISO(c.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  {renderBookingCard(c.a, c, "Reserva A")}
                  {renderBookingCard(c.b, c, "Reserva B")}
                </div>
                {c.resolution_notes && (
                  <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                    <strong>Resolução:</strong> {c.resolution_notes}
                  </p>
                )}
                {canEdit && c.status === "pendente" && (
                  <div className="flex justify-end">
                    <Button variant="ghost" size="sm" onClick={() => openResolveNote(c)}>
                      <CheckCircle2 className="mr-1 h-4 w-4" /> Marcar como resolvido
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Adjust dialog */}
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif">Ajustar reserva</DialogTitle>
            <DialogDescription>
              Mude sala, dia e/ou horário. Se ainda houver sobreposição, será pedida confirmação.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Sala</Label>
              <Select value={adjustForm.room_id} onValueChange={(v) => setAdjustForm({ ...adjustForm, room_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {rooms.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Data</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(adjustForm.date, "dd/MM/yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={adjustForm.date}
                    onSelect={(d) => d && setAdjustForm({ ...adjustForm, date: startOfDay(d) })}
                    locale={ptBR} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>Início</Label>
                <Input type="time" value={adjustForm.start}
                  onChange={(e) => setAdjustForm({ ...adjustForm, start: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Fim</Label>
                <Input type="time" value={adjustForm.end}
                  onChange={(e) => setAdjustForm({ ...adjustForm, end: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>Cancelar</Button>
            <Button onClick={() => saveAdjust(false)}>Salvar ajuste</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual resolve dialog */}
      <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif">Marcar conflito como resolvido</DialogTitle>
            <DialogDescription>
              Use quando a resolução foi acordada fora do sistema (ex.: troca entre profissionais).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Observação</Label>
            <Textarea rows={3} value={resolveForm.notes}
              onChange={(e) => setResolveForm({ ...resolveForm, notes: e.target.value })}
              placeholder="Ex.: Profissionais combinaram a troca diretamente." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveOpen(false)}>Cancelar</Button>
            <Button onClick={saveResolveNote}>Marcar resolvido</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
