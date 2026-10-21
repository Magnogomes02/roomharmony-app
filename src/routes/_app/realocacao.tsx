import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowRightLeft, CheckCircle2, AlertTriangle, Loader2, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateOnlyBR, toDateOnlyString } from "@/lib/dateOnly";
import { SortableTableHead } from "@/components/SortableTableHead";
import { useTableSort } from "@/hooks/useTableSort";
import { DEFAULT_SHIFTS, loadShiftDefaults, type ShiftDefaults, type ShiftKey } from "@/lib/shifts";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/realocacao")({
  head: () => ({
    meta: [
      { title: "Realocação de reservas | Versão Saúde" },
      { name: "description", content: "Transfira reservas em lote entre salas e datas em imprevistos e manutenções." },
      { property: "og:title", content: "Realocação de reservas | Versão Saúde" },
      { property: "og:description", content: "Assistente de remanejamento de reservas em lote." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RealocacaoPage,
});

interface Room { id: string; name: string }
interface Prof { id: string; full_name: string }
interface Booking {
  id: string; professional_id: string; room_id: string; start_at: string; end_at: string;
  status: string; contract_id: string | null; is_maintenance: boolean;
  avulso_amount: number | null; avulso_paid_at: string | null;
}
interface PlanItem {
  booking: Booking; newStart: Date; newEnd: Date; conflicts: Booking[]; selected: boolean;
}
interface LogRow { id: string; created_at: string; metadata: Json }

const SHIFT_NAMES: Record<ShiftKey, string> = { manha: "Manhã", tarde: "Tarde", noite: "Noite" };

type ShiftFilter = "todos" | ShiftKey;

const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const REASONS = ["Manutenção emergencial", "Reforma da sala", "Dedetização/limpeza", "Solicitação do profissional", "Outro"];

function RealocacaoPage() {
  const { role } = useAuth();
  const canEdit = role === "gestor";
  const today = toDateOnlyString(new Date());

  const [rooms, setRooms] = useState<Room[]>([]);
  const [profs, setProfs] = useState<Prof[]>([]);
  const [step, setStep] = useState(1);

  const [originRoom, setOriginRoom] = useState("");
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [shift, setShift] = useState<ShiftFilter>("todos");
  const [shiftDefs, setShiftDefs] = useState<ShiftDefaults>(DEFAULT_SHIFTS);
  const [profFilter, setProfFilter] = useState("todos");
  const [reason, setReason] = useState(REASONS[0]);
  const [notes, setNotes] = useState("");

  const [destRoom, setDestRoom] = useState("");
  const [dayShift, setDayShift] = useState(0);

  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [includeConflicts, setIncludeConflicts] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [logs, setLogs] = useState<LogRow[]>([]);

  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? "—";
  const profName = (id: string) => profs.find((p) => p.id === id)?.full_name ?? "—";

  const planSort = useTableSort<PlanItem>("realocacao.previa", {
    profissional: (p) => profName(p.booking.professional_id),
    atual: (p) => p.booking.start_at,
    novo: (p) => p.newStart,
    situacao: (p) => p.conflicts.length,
  });
  const logMeta = (l: LogRow) => (l.metadata ?? {}) as Record<string, unknown>;
  const logSort = useTableSort<LogRow>("realocacao.historico", {
    data: (l) => l.created_at,
    salas: (l) => `${String(logMeta(l).origin_room_name ?? "")} ${String(logMeta(l).dest_room_name ?? "")}`,
    periodo: (l) => String(logMeta(l).from_date ?? ""),
    motivo: (l) => String(logMeta(l).reason ?? ""),
    qtd: (l) => Number(logMeta(l).moved_count ?? 0),
  });

  async function loadLogs() {
    const { data } = await supabase.from("audit_logs").select("id,created_at,metadata")
      .eq("action", "booking.batch_reallocate").order("created_at", { ascending: false }).limit(10);
    setLogs((data as LogRow[]) ?? []);
  }

  useEffect(() => {
    (async () => {
      const [r, p] = await Promise.all([
        supabase.from("rooms").select("id,name").eq("active", true).order("sort_order").order("name"),
        supabase.from("professionals").select("id,full_name").order("full_name"),
      ]);
      setRooms((r.data as Room[]) ?? []);
      setProfs((p.data as Prof[]) ?? []);
      setShiftDefs(await loadShiftDefaults());
    })();
    loadLogs();
  }, []);

  async function analyze() {
    if (!originRoom || !destRoom) return toast.error("Selecione as salas de origem e destino");
    if (originRoom === destRoom && dayShift === 0) return toast.error("Destino deve ser diferente da origem");
    if (toDate < fromDate) return toast.error("Data final deve ser após a inicial");
    setAnalyzing(true);
    try {
      const start = new Date(`${fromDate}T00:00:00`);
      const end = new Date(`${toDate}T23:59:59`);
      let q = supabase.from("bookings")
        .select("id,professional_id,room_id,start_at,end_at,status,contract_id,is_maintenance,avulso_amount,avulso_paid_at")
        .eq("room_id", originRoom).in("status", ["ativa", "conflito"])
        .gte("start_at", start.toISOString()).lte("start_at", end.toISOString()).order("start_at");
      if (profFilter !== "todos") q = q.eq("professional_id", profFilter);
      const { data, error } = await q;
      if (error) throw error;
      // turnos configurados em Preferências; a reserva entra no turno quando
      // ocupa pelo menos parte dele
      const range = shift === "todos" ? null : shiftDefs[shift];
      const source = ((data as Booking[]) ?? []).filter((b) => {
        if (!range) return true;
        const bStart = minutesOfDay(new Date(b.start_at));
        const bEnd = minutesOfDay(new Date(b.end_at)) || 24 * 60;
        return bStart < toMinutes(range.end) && bEnd > toMinutes(range.start);
      });
      if (source.length === 0) { setPlan([]); setStep(3); return; }

      const offset = dayShift * 86400000;
      const items = source.map((b) => ({
        booking: b,
        newStart: new Date(new Date(b.start_at).getTime() + offset),
        newEnd: new Date(new Date(b.end_at).getTime() + offset),
      }));
      const minS = new Date(Math.min(...items.map((i) => i.newStart.getTime())));
      const maxE = new Date(Math.max(...items.map((i) => i.newEnd.getTime())));
      const { data: dest } = await supabase.from("bookings")
        .select("id,professional_id,room_id,start_at,end_at,status,contract_id,is_maintenance,avulso_amount,avulso_paid_at")
        .eq("room_id", destRoom).in("status", ["ativa", "conflito"])
        .lt("start_at", maxE.toISOString()).gt("end_at", minS.toISOString());
      const sourceIds = new Set(source.map((s) => s.id));
      const destB = ((dest as Booking[]) ?? []).filter((d) => !sourceIds.has(d.id));
      setPlan(items.map((i) => {
        const conflicts = destB.filter((d) => new Date(d.start_at) < i.newEnd && new Date(d.end_at) > i.newStart);
        return { ...i, conflicts, selected: conflicts.length === 0 };
      }));
      setStep(3);
    } catch (e) {
      toast.error("Erro ao analisar reservas", { description: (e as Error).message });
    } finally { setAnalyzing(false); }
  }

  const toMove = useMemo(
    () => plan.filter((p) => p.selected && (includeConflicts || p.conflicts.length === 0)),
    [plan, includeConflicts],
  );

  async function execute() {
    if (toMove.length === 0) return toast.error("Nenhuma reserva selecionada");
    setExecuting(true);
    const { data: { user } } = await supabase.auth.getUser();
    let ok = 0, withConflict = 0;
    const moved: { from: string; to: string }[] = [];
    const failures: string[] = [];
    for (const item of toMove) {
      const b = item.booking;
      const hasConflict = item.conflicts.length > 0;
      const { data: novo, error } = await supabase.from("bookings").insert({
        professional_id: b.professional_id, room_id: destRoom,
        start_at: item.newStart.toISOString(), end_at: item.newEnd.toISOString(),
        status: hasConflict ? "conflito" : "ativa", source: "realocacao",
        contract_id: b.contract_id, reallocated_from: b.id, is_maintenance: b.is_maintenance,
        avulso_amount: b.avulso_amount, avulso_paid_at: b.avulso_paid_at,
      }).select("id").single();
      if (error || !novo) { failures.push(b.id); continue; }
      const { error: e2 } = await supabase.from("bookings")
        .update({ status: "realocada", reallocated_to: novo.id }).eq("id", b.id);
      if (e2) {
        await supabase.from("bookings").delete().eq("id", novo.id);
        failures.push(b.id); continue;
      }
      if (hasConflict) {
        withConflict++;
        for (const c of item.conflicts) {
          await supabase.from("booking_conflicts").insert({ booking_id_a: novo.id, booking_id_b: c.id, room_id: destRoom, status: "pendente" });
          if (c.status === "ativa") await supabase.from("bookings").update({ status: "conflito" }).eq("id", c.id);
        }
      }
      moved.push({ from: b.id, to: novo.id });
      ok++;
    }
    if (user) {
      await supabase.from("audit_logs").insert({
        actor_id: user.id, action: "booking.batch_reallocate", entity_type: "booking", entity_id: null,
        metadata: {
          reason, notes, origin_room: originRoom, origin_room_name: roomName(originRoom),
          dest_room: destRoom, dest_room_name: roomName(destRoom), from_date: fromDate, to_date: toDate,
          day_shift: dayShift, shift, moved_count: ok, conflicts_count: withConflict, failures, moved,
        },
      });
    }
    setExecuting(false);
    if (failures.length) toast.warning(`${ok} realocada(s), ${failures.length} falha(s)`);
    else toast.success(`${ok} reserva(s) realocada(s)`, { description: withConflict ? `${withConflict} enviada(s) para Conflitos` : undefined });
    setStep(4);
    loadLogs();
  }

  function reset() {
    setPlan([]); setStep(1); setIncludeConflicts(false); setNotes("");
  }

  if (!canEdit) {
    return <div className="p-6 text-muted-foreground">Acesso restrito ao gestor.</div>;
  }

  const free = plan.filter((p) => p.conflicts.length === 0).length;
  const fmt = (d: Date) => format(d, "EEE dd/MM HH:mm", { locale: ptBR });

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="font-serif text-2xl">Realocação de reservas</h1>
        <p className="text-sm text-muted-foreground">Transfira reservas em lote para outra sala ou data em imprevistos, manutenções ou reformas.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {["Origem", "Destino", "Prévia", "Concluído"].map((label, i) => (
          <Badge key={label} variant={step === i + 1 ? "default" : step > i + 1 ? "secondary" : "outline"}>
            {i + 1}. {label}
          </Badge>
        ))}
      </div>

      {step === 1 && (
        <Card>
          <CardHeader><CardTitle>1. O que remanejar</CardTitle><CardDescription>Sala, período e motivo.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="f-sala-de-origem">Sala de origem</Label>
              <Select value={originRoom} onValueChange={setOriginRoom}>
                <SelectTrigger id="f-sala-de-origem"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{rooms.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="f-motivo">Motivo</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger id="f-motivo"><SelectValue /></SelectTrigger>
                <SelectContent>{REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="f-data-inicial">Data inicial</Label><Input id="f-data-inicial" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="f-data-final">Data final</Label><Input id="f-data-final" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="f-turno">Turno</Label>
              <Select value={shift} onValueChange={(v) => setShift(v as ShiftFilter)}>
                <SelectTrigger id="f-turno"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {(["manha", "tarde", "noite"] as ShiftKey[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {SHIFT_NAMES[k]} ({shiftDefs[k].start}–{shiftDefs[k].end})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="f-profissional">Profissional</Label>
              <Select value={profFilter} onValueChange={setProfFilter}>
                <SelectTrigger id="f-profissional"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {profs.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 md:col-span-2"><Label htmlFor="f-observacoes">Observações</Label><Textarea id="f-observacoes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Detalhes do imprevisto (opcional)" /></div>
            <div className="md:col-span-2 flex justify-end">
              <Button disabled={!originRoom} onClick={() => setStep(2)}>Próximo</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader><CardTitle>2. Para onde remanejar</CardTitle><CardDescription>Origem: {roomName(originRoom)}</CardDescription></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="f-sala-de-destino">Sala de destino</Label>
              <Select value={destRoom} onValueChange={setDestRoom}>
                <SelectTrigger id="f-sala-de-destino"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{rooms.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="f-deslocar-datas-dias">Deslocar datas (dias)</Label>
              <Input id="f-deslocar-datas-dias" type="number" value={dayShift} onChange={(e) => setDayShift(parseInt(e.target.value || "0", 10))} />
              <p className="text-xs text-muted-foreground">0 = mesmo dia e horário. Ex.: 7 = mesma hora na semana seguinte.</p>
            </div>
            <div className="md:col-span-2 flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>Voltar</Button>
              <Button disabled={!destRoom || analyzing} onClick={analyze}>
                {analyzing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Analisar disponibilidade
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>3. Prévia da realocação</CardTitle>
            <CardDescription>{roomName(originRoom)} → {roomName(destRoom)} · {plan.length} reserva(s) · {free} livre(s) · {plan.length - free} com conflito</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {plan.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma reserva ativa encontrada nesse período.</p>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Checkbox id="inc" checked={includeConflicts} onCheckedChange={(v) => setIncludeConflicts(!!v)} />
                  <Label htmlFor="inc" className="text-sm font-normal">Transferir também as com conflito (vão para a tela de Conflitos)</Label>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead className="w-10" />
                      <SortableTableHead sort={planSort} column="profissional">Profissional</SortableTableHead>
                      <SortableTableHead sort={planSort} column="atual">Atual</SortableTableHead>
                      <SortableTableHead sort={planSort} column="novo">Novo horário</SortableTableHead>
                      <SortableTableHead sort={planSort} column="situacao">Situação</SortableTableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {planSort.apply(plan).map((p) => {
                        const blocked = p.conflicts.length > 0 && !includeConflicts;
                        return (
                          <TableRow key={p.booking.id} className={blocked ? "opacity-60" : ""}>
                            <TableCell>
                              <Checkbox checked={p.selected && !blocked} disabled={blocked}
                                onCheckedChange={(v) => setPlan((pl) => pl.map((x) => x.booking.id === p.booking.id ? { ...x, selected: !!v } : x))} />
                            </TableCell>
                            <TableCell>{profName(p.booking.professional_id)}{p.booking.is_maintenance && <Badge variant="outline" className="ml-2">Manutenção</Badge>}</TableCell>
                            <TableCell className="whitespace-nowrap">{fmt(parseISO(p.booking.start_at))}–{format(parseISO(p.booking.end_at), "HH:mm")}</TableCell>
                            <TableCell className="whitespace-nowrap">{fmt(p.newStart)}–{format(p.newEnd, "HH:mm")}</TableCell>
                            <TableCell>
                              {p.conflicts.length === 0 ? (
                                <Badge variant="secondary"><CheckCircle2 className="mr-1 h-3 w-3" />Disponível</Badge>
                              ) : (
                                <div className="space-y-1">
                                  <Badge variant="destructive"><AlertTriangle className="mr-1 h-3 w-3" />Conflito</Badge>
                                  {p.conflicts.map((c) => (
                                    <div key={c.id} className="text-xs text-muted-foreground">
                                      {profName(c.professional_id)} {format(parseISO(c.start_at), "HH:mm")}–{format(parseISO(c.end_at), "HH:mm")}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>Voltar</Button>
              <Button disabled={toMove.length === 0 || executing} onClick={execute}>
                {executing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRightLeft className="mr-2 h-4 w-4" />}
                Realocar {toMove.length} reserva(s)
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <CardHeader><CardTitle>Realocação concluída</CardTitle><CardDescription>As reservas originais ficaram marcadas como realocadas e o histórico foi registrado.</CardDescription></CardHeader>
          <CardContent><Button onClick={reset}>Nova realocação</Button></CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><History className="h-4 w-4" />Últimas realocações em lote</CardTitle></CardHeader>
        <CardContent>
          {logs.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma realocação registrada.</p> : (
            <Table>
              <TableHeader><TableRow>
                <SortableTableHead sort={logSort} column="data">Data</SortableTableHead>
                <SortableTableHead sort={logSort} column="salas">Origem → Destino</SortableTableHead>
                <SortableTableHead sort={logSort} column="periodo">Período</SortableTableHead>
                <SortableTableHead sort={logSort} column="motivo">Motivo</SortableTableHead>
                <SortableTableHead sort={logSort} column="qtd">Qtd.</SortableTableHead>
              </TableRow></TableHeader>
              <TableBody>
                {logSort.apply(logs).map((l) => {
                  const m = (l.metadata ?? {}) as Record<string, unknown>;
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="whitespace-nowrap">{format(parseISO(l.created_at), "dd/MM/yyyy HH:mm")}</TableCell>
                      <TableCell>{String(m.origin_room_name ?? "—")} → {String(m.dest_room_name ?? "—")}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDateOnlyBR(String(m.from_date ?? ""))} a {formatDateOnlyBR(String(m.to_date ?? ""))}</TableCell>
                      <TableCell>{String(m.reason ?? "—")}</TableCell>
                      <TableCell>{String(m.moved_count ?? 0)}{Number(m.conflicts_count) > 0 && ` (${String(m.conflicts_count)} c/ conflito)`}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
