import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Move, CalendarIcon, Ban } from "lucide-react";
import { format, addDays, startOfDay, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { createNotification } from "@/lib/notifications";
import type { Json } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { entityColor, isValidHex, sortRooms } from "@/lib/entityColors";

export const Route = createFileRoute("/_app/calendario")({
  component: CalendarioPage,
});

interface Room { id: string; name: string; active: boolean; color_hex: string | null; sort_order: number | null }
interface Professional { id: string; full_name: string; active: boolean; color_hex: string | null }
interface Booking {
  id: string;
  professional_id: string;
  room_id: string;
  start_at: string;
  end_at: string;
  status: string;
  source: string;
  contract_id: string | null;
  reallocated_from: string | null;
  reallocated_to: string | null;
  is_maintenance: boolean;
}
interface ContractSchedule {
  id: string;
  contract_id: string;
  room_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
}
interface Contract {
  id: string;
  professional_id: string;
  start_date: string;
  end_date: string | null;
  status: string;
}

type ColorMode = "sala" | "profissional" | "status";

const HOUR_START = 7;
const HOUR_END = 22;
const SLOT_MINUTES = 30;
const TOTAL_SLOTS = ((HOUR_END - HOUR_START) * 60) / SLOT_MINUTES;
const PX_PER_SLOT = 28;

const STATUS_COLORS: Record<string, string> = {
  ativa: "bg-primary/15 border-primary text-foreground",
  cancelada: "bg-destructive/10 border-destructive/40 text-muted-foreground line-through",
  realocada: "bg-muted border-border text-muted-foreground",
  conflito: "bg-amber-500/20 border-amber-600 text-foreground",
};

// Paletas determinísticas
const PALETTE = [
  "bg-amber-200/40 border-amber-500",
  "bg-emerald-200/40 border-emerald-600",
  "bg-sky-200/40 border-sky-600",
  "bg-rose-200/40 border-rose-500",
  "bg-violet-200/40 border-violet-600",
  "bg-orange-200/40 border-orange-600",
  "bg-teal-200/40 border-teal-600",
  "bg-indigo-200/40 border-indigo-600",
];

function colorFromId(id: string, mode: ColorMode, status: string): string {
  if (mode === "status") return STATUS_COLORS[status] ?? STATUS_COLORS.ativa;
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
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

function CalendarioPage() {
  const { role, user } = useAuth();
  const canEdit = role === "gestor";

  const [date, setDate] = useState<Date>(startOfDay(new Date()));
  const [rooms, setRooms] = useState<Room[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  // filtros
  const [roomFilter, setRoomFilter] = useState<Set<string>>(new Set());
  const [profFilter, setProfFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set(["ativa", "conflito"]));
  const [colorMode, setColorMode] = useState<ColorMode>("sala");
  const [profSearch, setProfSearch] = useState("");

  // dialogs
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState<{ room_id: string; professional_id: string; start: string; end: string; notes: string; avulso_amount: string; avulso_paid: boolean; is_maintenance: boolean }>({
    room_id: "", professional_id: "", start: "08:00", end: "09:00", notes: "", avulso_amount: "", avulso_paid: false, is_maintenance: false,
  });
  const [conflictWarn, setConflictWarn] = useState<{ open: boolean; onConfirm: () => void; message: string }>({ open: false, onConfirm: () => {}, message: "" });
  const [detailBooking, setDetailBooking] = useState<Booking | null>(null);
  const [reallocOpen, setReallocOpen] = useState(false);
  const [reallocForm, setReallocForm] = useState<{ room_id: string; date: Date; start: string; end: string }>({
    room_id: "", date: new Date(), start: "08:00", end: "09:00",
  });
  const [genOpen, setGenOpen] = useState(false);
  const [genFrom, setGenFrom] = useState<Date>(startOfDay(new Date()));
  const [genTo, setGenTo] = useState<Date>(addDays(new Date(), 30));
  const [generating, setGenerating] = useState(false);

  const loadStatic = useCallback(async () => {
    const [r, p] = await Promise.all([
      supabase.from("rooms").select("id,name,active,color_hex,sort_order").eq("active", true),
      supabase.from("professionals").select("id,full_name,active,color_hex").eq("active", true).order("full_name"),
    ]);
    setRooms(sortRooms((r.data as Room[]) ?? []));
    setProfessionals((p.data as Professional[]) ?? []);
  }, []);

  const loadBookings = useCallback(async () => {
    setLoading(true);
    const dayStart = startOfDay(date).toISOString();
    const dayEnd = addDays(startOfDay(date), 1).toISOString();
    const { data, error } = await supabase
      .from("bookings")
      .select("id,professional_id,room_id,start_at,end_at,status,source,contract_id,reallocated_from,reallocated_to,is_maintenance")
      .lt("start_at", dayEnd)
      .gt("end_at", dayStart)
      .order("start_at");
    if (error) toast.error("Erro ao carregar reservas", { description: error.message });
    setBookings((data as Booking[]) ?? []);
    setLoading(false);
  }, [date]);

  useEffect(() => { loadStatic(); }, [loadStatic]);
  useEffect(() => { loadBookings(); }, [loadBookings]);

  const profMap = useMemo(() => new Map(professionals.map((p) => [p.id, p])), [professionals]);
  const roomMap = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);

  const visibleRooms = useMemo(
    () => rooms.filter((r) => roomFilter.size === 0 || roomFilter.has(r.id)),
    [rooms, roomFilter],
  );

  const visibleBookings = useMemo(() => {
    return bookings.filter((b) => {
      if (statusFilter.size > 0 && !statusFilter.has(b.status)) return false;
      if (profFilter.size > 0 && !profFilter.has(b.professional_id)) return false;
      if (roomFilter.size > 0 && !roomFilter.has(b.room_id)) return false;
      return true;
    });
  }, [bookings, statusFilter, profFilter, roomFilter]);

  function toggleSet(s: Set<string>, id: string): Set<string> {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  }

  async function checkConflict(roomId: string, start: Date, end: Date, ignoreId?: string): Promise<Booking[]> {
    const { data } = await supabase
      .from("bookings")
      .select("id,professional_id,room_id,start_at,end_at,status,source,contract_id,reallocated_from,reallocated_to,is_maintenance")
      .eq("room_id", roomId)
      .in("status", ["ativa", "conflito"])
      .lt("start_at", end.toISOString())
      .gt("end_at", start.toISOString());
    return ((data as Booking[]) ?? []).filter((b) => b.id !== ignoreId);
  }

  async function audit(action: string, entity_id: string | null, metadata: Json) {
    const { data: { user: auditUser } } = await supabase.auth.getUser();
    if (!auditUser) return;
    await supabase.from("audit_logs").insert({ actor_id: auditUser.id, action, entity_type: "booking", entity_id, metadata });
  }

  function openNewAt(roomId: string, slotIdx: number) {
    if (!canEdit) return;
    const startMin = HOUR_START * 60 + slotIdx * SLOT_MINUTES;
    const endMin = startMin + 60;
    const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    setNewForm({ room_id: roomId, professional_id: "", start: fmt(startMin), end: fmt(endMin), notes: "", avulso_amount: "", avulso_paid: false, is_maintenance: false });
    setNewOpen(true);
  }

  async function saveNew(force = false) {
    if (!newForm.room_id || !newForm.professional_id) {
      toast.error("Selecione sala e profissional");
      return;
    }
    const start = fromTimeStr(date, newForm.start);
    const end = fromTimeStr(date, newForm.end);
    if (end <= start) { toast.error("Horário final deve ser após o inicial"); return; }

    if (!force) {
      const conflicts = await checkConflict(newForm.room_id, start, end);
      if (conflicts.length > 0) {
        setConflictWarn({
          open: true,
          message: `Já existe ${conflicts.length} reserva(s) sobrepostas nessa sala. Deseja criar mesmo assim?`,
          onConfirm: () => { setConflictWarn((c) => ({ ...c, open: false })); saveNew(true); },
        });
        return;
      }
    }

    const amountNum = !newForm.is_maintenance && newForm.avulso_amount ? Number(newForm.avulso_amount) : null;
    const { data, error } = await supabase.from("bookings").insert({
      professional_id: newForm.professional_id,
      room_id: newForm.room_id,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      status: "ativa",
      source: newForm.is_maintenance ? "manutencao" : "avulsa",
      is_maintenance: newForm.is_maintenance,
      avulso_amount: amountNum,
      avulso_paid_at: newForm.avulso_paid && amountNum ? new Date().toISOString() : null,
    }).select("id").single();
    if (error) { toast.error("Erro ao criar reserva", { description: error.message }); return; }

    // gera recebível avulso se há valor e não é manutenção
    if (!newForm.is_maintenance && amountNum && amountNum > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const monthRef = new Date(start.getFullYear(), start.getMonth(), 1).toISOString().slice(0, 10);
      const recPayload = {
        kind: "avulso" as const,
        booking_id: data!.id,
        professional_id: newForm.professional_id,
        room_id: newForm.room_id,
        reference_month: monthRef,
        due_date: today,
        amount_due: amountNum,
        status: newForm.avulso_paid ? "recebido" : "a_receber",
        amount_paid: newForm.avulso_paid ? amountNum : null,
        paid_at: newForm.avulso_paid ? new Date().toISOString() : null,
        payment_method: newForm.avulso_paid ? "PIX" : null,
      };
      await supabase.from("receivables").insert(recPayload);
    }

    await audit("booking.create", data?.id ?? null, { source: newForm.is_maintenance ? "manutencao" : "avulsa", is_maintenance: newForm.is_maintenance, forced_conflict: force, amount: amountNum });

    if (force && user?.email) {
      const roomName = rooms.find((r) => r.id === newForm.room_id)?.name ?? "sala";
      createNotification(
        user.email,
        "Conflito de agenda criado",
        `Uma reserva em conflito foi criada na ${roomName} em ${format(start, "dd/MM HH:mm")}–${format(end, "HH:mm")}.`,
        { booking_id: data?.id, room_id: newForm.room_id },
      );
    }

    toast.success("Reserva criada");
    setNewOpen(false);
    loadBookings();
  }

  async function cancelOccurrence(b: Booking) {
    if (!confirm("Cancelar esta ocorrência? A recorrência do contrato continua.")) return;
    const { error } = await supabase.from("bookings").update({ status: "cancelada" }).eq("id", b.id);
    if (error) { toast.error("Erro ao cancelar", { description: error.message }); return; }
    await audit("booking.cancel", b.id, { date: b.start_at });
    toast.success("Reserva cancelada");
    setDetailBooking(null);
    loadBookings();
  }

  function openRealloc(b: Booking) {
    const s = parseISO(b.start_at), e = parseISO(b.end_at);
    setReallocForm({ room_id: b.room_id, date: startOfDay(s), start: toTimeStr(s), end: toTimeStr(e) });
    setReallocOpen(true);
  }

  async function saveRealloc(force = false) {
    if (!detailBooking) return;
    const start = fromTimeStr(reallocForm.date, reallocForm.start);
    const end = fromTimeStr(reallocForm.date, reallocForm.end);
    if (end <= start) { toast.error("Horário final deve ser após o inicial"); return; }

    if (!force) {
      const conflicts = await checkConflict(reallocForm.room_id, start, end, detailBooking.id);
      if (conflicts.length > 0) {
        setConflictWarn({
          open: true,
          message: `Conflito com ${conflicts.length} reserva(s). Realocar mesmo assim?`,
          onConfirm: () => { setConflictWarn((c) => ({ ...c, open: false })); saveRealloc(true); },
        });
        return;
      }
    }

    // marca original como realocada e cria nova
    const { data: novo, error: e1 } = await supabase.from("bookings").insert({
      professional_id: detailBooking.professional_id,
      room_id: reallocForm.room_id,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      status: "ativa",
      source: "realocacao",
      contract_id: detailBooking.contract_id,
      reallocated_from: detailBooking.id,
    }).select("id").single();
    if (e1) { toast.error("Erro ao realocar", { description: e1.message }); return; }

    const { error: e2 } = await supabase.from("bookings").update({
      status: "realocada", reallocated_to: novo?.id ?? null,
    }).eq("id", detailBooking.id);
    if (e2) { toast.error("Erro ao atualizar original", { description: e2.message }); return; }

    await audit("booking.reallocate", detailBooking.id, { to: novo?.id, forced_conflict: force });
    toast.success("Reserva realocada");
    setReallocOpen(false);
    setDetailBooking(null);
    loadBookings();
  }

  async function generateFromContracts() {
    setGenerating(true);
    try {
      const { data: contracts } = await supabase
        .from("contracts")
        .select("id,professional_id,start_date,end_date,status")
        .in("status", ["assinado", "ativo", "rascunho"]);
      const { data: schedules } = await supabase
        .from("contract_schedules")
        .select("id,contract_id,room_id,weekday,start_time,end_time");

      const contractMap = new Map((contracts as Contract[] ?? []).map((c) => [c.id, c]));
      const schedList = (schedules as ContractSchedule[] ?? []).filter((s) => contractMap.has(s.contract_id));

      // janela
      const from = startOfDay(genFrom);
      const to = startOfDay(genTo);
      let created = 0, skipped = 0;

      for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
        const weekday = d.getDay();
        for (const s of schedList) {
          if (s.weekday !== weekday) continue;
          const c = contractMap.get(s.contract_id)!;
          const cStart = parseISO(c.start_date);
          const cEnd = c.end_date ? parseISO(c.end_date) : null;
          if (d < startOfDay(cStart)) continue;
          if (cEnd && d > startOfDay(cEnd)) continue;

          const start = fromTimeStr(d, s.start_time.slice(0, 5));
          const end = fromTimeStr(d, s.end_time.slice(0, 5));

          // já existe?
          const { data: existing } = await supabase
            .from("bookings")
            .select("id")
            .eq("contract_id", c.id)
            .eq("room_id", s.room_id)
            .eq("start_at", start.toISOString())
            .limit(1);
          if (existing && existing.length > 0) { skipped++; continue; }

          const { error } = await supabase.from("bookings").insert({
            professional_id: c.professional_id,
            room_id: s.room_id,
            start_at: start.toISOString(),
            end_at: end.toISOString(),
            status: "ativa",
            source: "recorrencia",
            contract_id: c.id,
          });
          if (!error) created++;
        }
      }
      await audit("booking.generate", null, { from: from.toISOString(), to: to.toISOString(), created, skipped });
      toast.success(`Geração concluída`, { description: `${created} criadas, ${skipped} já existentes.` });
      setGenOpen(false);
      loadBookings();
    } finally {
      setGenerating(false);
    }
  }

  // posicionamento
  function bookingStyle(b: Booking) {
    const s = parseISO(b.start_at), e = parseISO(b.end_at);
    const ref = startOfDay(date);
    const startMin = Math.max(0, (s.getTime() - ref.getTime()) / 60000 - HOUR_START * 60);
    const endMin = Math.min(TOTAL_SLOTS * SLOT_MINUTES, (e.getTime() - ref.getTime()) / 60000 - HOUR_START * 60);
    const top = (startMin / SLOT_MINUTES) * PX_PER_SLOT;
    const height = Math.max(PX_PER_SLOT - 2, ((endMin - startMin) / SLOT_MINUTES) * PX_PER_SLOT - 2);
    return { top, height };
  }

  const filteredProfsForFilter = professionals.filter((p) =>
    p.full_name.toLowerCase().includes(profSearch.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl">Calendário</h1>
          <p className="text-muted-foreground capitalize">
            {format(date, "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => setDate(startOfDay(new Date()))}>Hoje</Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="min-w-[160px] justify-start">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(date, "dd/MM/yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={date}
                onSelect={(d) => d && setDate(startOfDay(d))}
                locale={ptBR}
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {canEdit && (
            <>
              <Button variant="outline" onClick={() => setGenOpen(true)}>
                <RefreshCw className="mr-2 h-4 w-4" /> Gerar dos contratos
              </Button>
              <Button onClick={() => openNewAt(rooms[0]?.id ?? "", 2)}>
                <Plus className="mr-2 h-4 w-4" /> Nova reserva
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        {/* Sidebar filtros */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-serif text-base">Filtros</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Cor por</Label>
              <Select value={colorMode} onValueChange={(v) => setColorMode(v as ColorMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sala">Sala</SelectItem>
                  <SelectItem value="profissional">Profissional</SelectItem>
                  <SelectItem value="status">Status</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Status</Label>
              {["ativa", "conflito", "realocada", "cancelada"].map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm capitalize">
                  <Checkbox checked={statusFilter.has(s)} onCheckedChange={() => setStatusFilter((p) => toggleSet(p, s))} />
                  {s}
                </label>
              ))}
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Salas</Label>
              <div className="max-h-40 space-y-1 overflow-auto">
                {rooms.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={roomFilter.has(r.id)} onCheckedChange={() => setRoomFilter((p) => toggleSet(p, r.id))} />
                    {r.name}
                  </label>
                ))}
              </div>
              {roomFilter.size > 0 && (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setRoomFilter(new Set())}>Limpar</Button>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Profissionais</Label>
              <Input placeholder="Buscar..." value={profSearch} onChange={(e) => setProfSearch(e.target.value)} className="h-8" />
              <div className="max-h-48 space-y-1 overflow-auto">
                {filteredProfsForFilter.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={profFilter.has(p.id)} onCheckedChange={() => setProfFilter((s) => toggleSet(s, p.id))} />
                    <span className="truncate">{p.full_name}</span>
                  </label>
                ))}
              </div>
              {profFilter.size > 0 && (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setProfFilter(new Set())}>Limpar</Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Grade */}
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Carregando...</div>
            ) : visibleRooms.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">Nenhuma sala disponível.</div>
            ) : (
              <div className="overflow-auto">
                <div className="flex min-w-fit">
                  {/* coluna de horas */}
                  <div className="sticky left-0 z-10 w-16 shrink-0 border-r bg-card">
                    <div className="h-10 border-b" />
                    {Array.from({ length: TOTAL_SLOTS }).map((_, i) => {
                      const min = HOUR_START * 60 + i * SLOT_MINUTES;
                      const isHour = min % 60 === 0;
                      return (
                        <div key={i} style={{ height: PX_PER_SLOT }} className={cn("border-b px-2 text-[10px]", isHour ? "text-foreground" : "text-muted-foreground/60")}>
                          {isHour ? `${String(Math.floor(min / 60)).padStart(2, "0")}:00` : ""}
                        </div>
                      );
                    })}
                  </div>

                  {/* colunas de salas */}
                  {visibleRooms.map((room) => {
                    const roomBookings = visibleBookings.filter((b) => b.room_id === room.id);
                    return (
                      <div key={room.id} className="relative min-w-[160px] flex-1 border-r last:border-r-0">
                        <div className="sticky top-0 z-10 flex h-10 items-center justify-center border-b bg-card px-2 text-sm font-medium">
                          {room.name}
                        </div>
                        <div className="relative" style={{ height: TOTAL_SLOTS * PX_PER_SLOT }}>
                          {/* slots clicáveis */}
                          {Array.from({ length: TOTAL_SLOTS }).map((_, i) => {
                            const min = HOUR_START * 60 + i * SLOT_MINUTES;
                            const isHour = min % 60 === 0;
                            return (
                              <button
                                key={i}
                                type="button"
                                disabled={!canEdit}
                                onClick={() => openNewAt(room.id, i)}
                                style={{ height: PX_PER_SLOT }}
                                className={cn(
                                  "block w-full border-b text-left transition-colors",
                                  isHour ? "border-border" : "border-border/40",
                                  canEdit && "hover:bg-accent/40",
                                )}
                              />
                            );
                          })}
                          {/* reservas */}
                          {roomBookings.map((b) => {
                            const { top, height } = bookingStyle(b);
                            const colorClass = colorFromId(b.room_id, colorMode, b.status);
                            const prof = profMap.get(b.professional_id);
                            // cor cadastrada (style inline) sobrepõe paleta determinística quando aplicável
                            let inlineStyle: React.CSSProperties = { top, height, left: 2, right: 2 };
                            if (colorMode === "sala") {
                              const r = roomMap.get(b.room_id);
                              if (isValidHex(r?.color_hex)) {
                                const c = entityColor(r!.color_hex, b.room_id);
                                inlineStyle = { ...inlineStyle, borderLeftColor: c, backgroundColor: `${c}22` };
                              }
                            } else if (colorMode === "profissional") {
                              if (isValidHex(prof?.color_hex)) {
                                const c = entityColor(prof!.color_hex, b.professional_id);
                                inlineStyle = { ...inlineStyle, borderLeftColor: c, backgroundColor: `${c}22` };
                              }
                            }
                            return (
                              <button
                                key={b.id}
                                type="button"
                                onClick={() => setDetailBooking(b)}
                                style={b.is_maintenance ? { top, height, left: 2, right: 2 } : inlineStyle}
                                className={cn(
                                  "absolute overflow-hidden rounded-md border-l-4 px-2 py-1 text-left text-xs shadow-sm transition hover:shadow-md",
                                  b.is_maintenance
                                    ? "border-orange-400 bg-orange-100/60 text-orange-900 dark:bg-orange-900/20 dark:text-orange-200"
                                    : colorClass,
                                )}
                              >
                                <div className="truncate font-medium">
                                  {b.is_maintenance ? "🔧 Manutenção" : (prof?.full_name ?? "—")}
                                </div>
                                <div className="truncate opacity-70">
                                  {toTimeStr(parseISO(b.start_at))} – {toTimeStr(parseISO(b.end_at))}
                                </div>
                                {!b.is_maintenance && b.source !== "recorrencia" && (
                                  <Badge variant="outline" className="mt-0.5 h-4 px-1 text-[9px]">{b.source}</Badge>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Nova reserva avulsa */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif">Nova reserva avulsa</DialogTitle>
            <DialogDescription>{format(date, "dd/MM/yyyy")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="flex items-center gap-2 rounded-md border border-orange-200 bg-orange-50/50 px-3 py-2 text-sm dark:border-orange-900/40 dark:bg-orange-900/10">
              <Checkbox
                checked={newForm.is_maintenance}
                onCheckedChange={(v) => setNewForm({ ...newForm, is_maintenance: !!v, avulso_amount: "", avulso_paid: false })}
              />
              <span className="font-medium">Reserva de manutenção</span>
              <span className="text-xs text-muted-foreground">(não gera cobrança)</span>
            </label>
            <div className="space-y-2">
              <Label>Sala</Label>
              <Select value={newForm.room_id} onValueChange={(v) => setNewForm({ ...newForm, room_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {rooms.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Responsável</Label>
              <Select value={newForm.professional_id} onValueChange={(v) => setNewForm({ ...newForm, professional_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {professionals.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>Início</Label>
                <Input type="time" value={newForm.start} onChange={(e) => setNewForm({ ...newForm, start: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Fim</Label>
                <Input type="time" value={newForm.end} onChange={(e) => setNewForm({ ...newForm, end: e.target.value })} />
              </div>
            </div>
            {!newForm.is_maintenance && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label>Valor avulso (R$)</Label>
                    <Input type="number" step="0.01" min="0" placeholder="0,00"
                      value={newForm.avulso_amount}
                      onChange={(e) => setNewForm({ ...newForm, avulso_amount: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Pagamento</Label>
                    <label className="flex h-10 items-center gap-2 rounded-md border px-3 text-sm">
                      <Checkbox checked={newForm.avulso_paid}
                        onCheckedChange={(v) => setNewForm({ ...newForm, avulso_paid: !!v })} />
                      Já pago no ato
                    </label>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Se informar valor, será criado um recebível avulso no Financeiro. Sem marcar "pago no ato", ele entra como "A receber".
                </p>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancelar</Button>
            <Button onClick={() => saveNew(false)}>Criar reserva</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detalhes */}
      <Dialog open={!!detailBooking} onOpenChange={(o) => !o && setDetailBooking(null)}>
        <DialogContent>
          {detailBooking && (
            <>
              <DialogHeader>
                <DialogTitle className="font-serif">Detalhes da reserva</DialogTitle>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <div><span className="text-muted-foreground">Profissional:</span> {profMap.get(detailBooking.professional_id)?.full_name}</div>
                <div><span className="text-muted-foreground">Sala:</span> {roomMap.get(detailBooking.room_id)?.name}</div>
                <div>
                  <span className="text-muted-foreground">Quando:</span>{" "}
                  {format(parseISO(detailBooking.start_at), "dd/MM/yyyy HH:mm")} – {toTimeStr(parseISO(detailBooking.end_at))}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="capitalize">{detailBooking.status}</Badge>
                  <Badge variant="outline" className="capitalize">{detailBooking.source}</Badge>
                </div>
              </div>
              <DialogFooter className="flex-wrap gap-2">
                {canEdit && detailBooking.status === "ativa" && (
                  <>
                    <Button variant="outline" onClick={() => openRealloc(detailBooking)}>
                      <Move className="mr-2 h-4 w-4" /> Realocar
                    </Button>
                    <Button variant="destructive" onClick={() => cancelOccurrence(detailBooking)}>
                      <Ban className="mr-2 h-4 w-4" /> Cancelar ocorrência
                    </Button>
                  </>
                )}
                <Button variant="ghost" onClick={() => setDetailBooking(null)}>Fechar</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Realocar */}
      <Dialog open={reallocOpen} onOpenChange={setReallocOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif">Realocar reserva</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Sala</Label>
              <Select value={reallocForm.room_id} onValueChange={(v) => setReallocForm({ ...reallocForm, room_id: v })}>
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
                    {format(reallocForm.date, "dd/MM/yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={reallocForm.date} onSelect={(d) => d && setReallocForm({ ...reallocForm, date: startOfDay(d) })} locale={ptBR} className={cn("p-3 pointer-events-auto")} />
                </PopoverContent>
              </Popover>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>Início</Label>
                <Input type="time" value={reallocForm.start} onChange={(e) => setReallocForm({ ...reallocForm, start: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Fim</Label>
                <Input type="time" value={reallocForm.end} onChange={(e) => setReallocForm({ ...reallocForm, end: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReallocOpen(false)}>Cancelar</Button>
            <Button onClick={() => saveRealloc(false)}>Confirmar realocação</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Gerar reservas */}
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif">Gerar reservas dos contratos</DialogTitle>
            <DialogDescription>
              Materializa as reservas recorrentes para o período selecionado, ignorando datas já criadas.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>De</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <CalendarIcon className="mr-2 h-4 w-4" />{format(genFrom, "dd/MM/yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={genFrom} onSelect={(d) => d && setGenFrom(startOfDay(d))} locale={ptBR} className={cn("p-3 pointer-events-auto")} />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>Até</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <CalendarIcon className="mr-2 h-4 w-4" />{format(genTo, "dd/MM/yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={genTo} onSelect={(d) => d && setGenTo(startOfDay(d))} locale={ptBR} className={cn("p-3 pointer-events-auto")} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenOpen(false)} disabled={generating}>Cancelar</Button>
            <Button onClick={generateFromContracts} disabled={generating}>
              {generating ? "Gerando..." : "Gerar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Aviso de conflito */}
      <AlertDialog open={conflictWarn.open} onOpenChange={(o) => !o && setConflictWarn((c) => ({ ...c, open: false }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Conflito de horário</AlertDialogTitle>
            <AlertDialogDescription>{conflictWarn.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={conflictWarn.onConfirm}>Continuar mesmo assim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
