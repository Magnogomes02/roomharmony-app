import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarDays, AlertTriangle } from "lucide-react";
import { addDays, format, startOfWeek } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { entityColor, sortRooms, colorBlockStyle } from "@/lib/entityColors";
import { loadShiftDefaults, DEFAULT_SHIFTS, SHIFT_LABELS, type ShiftKey, type ShiftDefaults } from "@/lib/shifts";
import { WeekNavigator } from "@/components/period/WeekNavigator";

function startOfWeekMidnight(d: Date): Date {
  const s = startOfWeek(d, { weekStartsOn: 1 });
  s.setHours(0, 0, 0, 0);
  return s;
}

interface BookingRow {
  id: string;
  start_at: string;
  end_at: string;
  room_id: string;
  professional_id: string;
  status: string;
}
interface RoomRow {
  id: string;
  name: string;
  active: boolean;
  color_hex: string | null;
  sort_order: number | null;
}
interface ProfRow {
  id: string;
  full_name: string;
  color_hex: string | null;
}

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const SHIFT_ORDER: ShiftKey[] = ["manha", "tarde", "noite"];

// minutos desde 00:00 a partir de "HH:MM"
function hmToMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function dateMinOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

// Retorna os turnos que esta reserva sobrepõe naquele dia.
// Se nenhum, retorna [] (fora dos turnos).
function shiftsForBooking(
  start: Date,
  end: Date,
  dayKey: string,
  defs: ShiftDefaults,
): ShiftKey[] {
  // Clampa o intervalo ao dia em questão
  const dayStart = new Date(`${dayKey}T00:00:00`);
  const dayEnd = new Date(`${dayKey}T23:59:59`);
  const s = start < dayStart ? dayStart : start;
  const e = end > dayEnd ? dayEnd : end;
  const sMin = dateMinOfDay(s);
  const eMin = dateMinOfDay(e);
  const result: ShiftKey[] = [];
  for (const k of SHIFT_ORDER) {
    const ss = hmToMin(defs[k].start);
    const se = hmToMin(defs[k].end);
    // sobreposição estrita: sMin < se && eMin > ss
    if (sMin < se && eMin > ss) result.push(k);
  }
  return result;
}

export function WeekScheduleByRoomCard() {
  const [weekStart, setWeekStart] = useState(() => startOfWeekMidnight(new Date()));

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const { data: shiftDefs = DEFAULT_SHIFTS } = useQuery({
    queryKey: ["shift-defaults"],
    queryFn: loadShiftDefaults,
    staleTime: 5 * 60 * 1000,
    placeholderData: DEFAULT_SHIFTS,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["week-schedule-by-room", weekStart.toISOString()],
    queryFn: async () => {
      const [bk, rms, pros] = await Promise.all([
        supabase
          .from("bookings")
          .select("id,start_at,end_at,room_id,professional_id,status")
          .lt("start_at", weekEnd.toISOString())
          .gt("end_at", weekStart.toISOString())
          .in("status", ["ativa", "conflito"])
          .order("start_at"),
        supabase
          .from("rooms")
          .select("id,name,active,color_hex,sort_order")
          .eq("active", true),
        supabase.from("professionals").select("id,full_name,color_hex"),
      ]);
      return {
        bookings: (bk.data ?? []) as BookingRow[],
        rooms: ((rms.data ?? []) as RoomRow[]),
        pros: Object.fromEntries(((pros.data ?? []) as ProfRow[]).map((p) => [p.id, p])) as Record<string, ProfRow>,
      };
    },
  });

  const sortedRooms = useMemo(() => (data ? sortRooms(data.rooms) : []), [data]);

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 font-serif text-xl">
          <CalendarDays className="h-5 w-5 text-primary" /> Reservas da semana
        </CardTitle>
        <div className="flex items-center gap-1">
          <WeekNavigator value={weekStart} onChange={setWeekStart} buttonVariant="ghost" />
          <Link to="/calendario" className="ml-2 text-xs text-primary hover:underline">
            Ver completo →
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-xs text-muted-foreground">Carregando…</p>}

        {!isLoading && sortedRooms.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma sala ativa cadastrada.</p>
        )}

        {shiftDefs && sortedRooms.map((room) => {
          const roomColor = entityColor(room.color_hex, room.id);
          const roomBookings = (data?.bookings ?? []).filter((b) => b.room_id === room.id);
          const conflictCount = roomBookings.filter((b) => b.status === "conflito").length;

          // Pré-classifica reservas por dia e turno, e detecta "fora dos turnos" no escopo da sala
          type Classified = {
            byShift: Record<ShiftKey, BookingRow[]>;
            outside: BookingRow[];
          };
          const perDay: Record<string, Classified> = {};
          let roomHasOutside = false;
          for (const d of days) {
            const dayKey = format(d, "yyyy-MM-dd");
            const classified: Classified = {
              byShift: { manha: [], tarde: [], noite: [] },
              outside: [],
            };
            const dayBookings = roomBookings
              .filter((b) => format(new Date(b.start_at), "yyyy-MM-dd") === dayKey)
              .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
            for (const b of dayBookings) {
              const shifts = shiftsForBooking(new Date(b.start_at), new Date(b.end_at), dayKey, shiftDefs);
              if (shifts.length === 0) {
                classified.outside.push(b);
                roomHasOutside = true;
              } else {
                // Add only to the first matching shift to avoid visual duplication
                classified.byShift[shifts[0]].push(b);
              }
            }
            perDay[dayKey] = classified;
          }

          const rowsToRender: Array<{ key: ShiftKey | "outside"; label: string }> = [
            { key: "manha", label: SHIFT_LABELS.manha },
            { key: "tarde", label: SHIFT_LABELS.tarde },
            { key: "noite", label: SHIFT_LABELS.noite },
          ];
          if (roomHasOutside) rowsToRender.push({ key: "outside", label: "Fora dos turnos" });

          const renderBookingCard = (b: BookingRow, spans?: ShiftKey[]) => {
            const prof = data?.pros[b.professional_id];
            const profColor = entityColor(prof?.color_hex, b.professional_id);
            const isConflict = b.status === "conflito";
            const s = new Date(b.start_at);
            const e = new Date(b.end_at);
            const crosses = spans && spans.length > 1;
            return (
              <Link
                key={b.id}
                to="/calendario"
                className={`block overflow-hidden rounded border-l-2 px-1.5 py-1 text-[10px] leading-tight transition hover:opacity-90 ${
                  isConflict ? "ring-1 ring-destructive/60" : ""
                }`}
                style={colorBlockStyle(profColor)}
                title={crosses ? "Atravessa turnos" : undefined}
              >
                <div className="truncate font-medium">
                  {format(s, "HH:mm")}–{format(e, "HH:mm")}
                  {crosses && <span className="ml-1 opacity-70">↕</span>}
                </div>
                <div className="truncate opacity-80">{prof?.full_name ?? "—"}</div>
                {isConflict && (
                  <div className="mt-0.5 flex items-center gap-0.5 text-[9px] font-medium text-destructive">
                    <AlertTriangle className="h-2.5 w-2.5" />
                    Conflito
                  </div>
                )}
              </Link>
            );
          };

          return (
            <div
              key={room.id}
              className="rounded-lg border-l-4 border bg-card/50"
              style={{ borderLeftColor: roomColor }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: roomColor }}
                    aria-hidden
                  />
                  <span className="font-medium">{room.name}</span>
                  <span className="text-xs text-muted-foreground">
                    · {roomBookings.length} {roomBookings.length === 1 ? "reserva" : "reservas"}
                  </span>
                </div>
                {conflictCount > 0 && (
                  <Badge variant="outline" className="gap-1 border-destructive/60 text-destructive">
                    <AlertTriangle className="h-3 w-3" />
                    {conflictCount} {conflictCount === 1 ? "conflito" : "conflitos"}
                  </Badge>
                )}
              </div>

              {roomBookings.length === 0 ? (
                <p className="px-3 py-3 text-xs text-muted-foreground">
                  Nenhuma reserva nesta semana.
                </p>
              ) : (
                <div className="p-2">
                  {/* Cabeçalho de dias */}
                  <div className="grid gap-1" style={{ gridTemplateColumns: "70px repeat(7, minmax(0, 1fr))" }}>
                    <div />
                    {days.map((d, di) => {
                      const dayKey = format(d, "yyyy-MM-dd");
                      const isToday = dayKey === format(new Date(), "yyyy-MM-dd");
                      return (
                        <div
                          key={dayKey}
                          className={`mb-1 text-center text-[10px] uppercase ${
                            isToday ? "font-semibold text-primary" : "text-muted-foreground"
                          }`}
                        >
                          {WEEKDAYS[di]} {format(d, "dd/MM")}
                        </div>
                      );
                    })}
                  </div>

                  {/* Linhas por turno */}
                  {rowsToRender.map((row) => {
                    const isOutside = row.key === "outside";
                    const shiftRange = !isOutside
                      ? `${shiftDefs[row.key as ShiftKey].start}–${shiftDefs[row.key as ShiftKey].end}`
                      : "";
                    return (
                      <div
                        key={row.key}
                        className="grid gap-1 border-t border-border/30 py-1"
                        style={{ gridTemplateColumns: "70px repeat(7, minmax(0, 1fr))" }}
                      >
                        <div className="flex flex-col justify-center pr-1 text-[10px]">
                          <span className="font-medium text-foreground/80">{row.label}</span>
                          {shiftRange && (
                            <span className="text-[9px] text-muted-foreground">{shiftRange}</span>
                          )}
                        </div>
                        {days.map((d) => {
                          const dayKey = format(d, "yyyy-MM-dd");
                          const cls = perDay[dayKey];
                          const items = isOutside
                            ? cls.outside
                            : cls.byShift[row.key as ShiftKey];
                          return (
                            <div key={dayKey} className="min-h-[44px] space-y-1">
                              {items.length === 0 ? (
                                <div className="flex h-full min-h-[44px] items-center justify-center rounded border border-dashed border-border/40 text-[10px] text-muted-foreground/60">
                                  —
                                </div>
                              ) : (
                                items.map((b) => {
                                  const spans = !isOutside
                                    ? shiftsForBooking(
                                        new Date(b.start_at),
                                        new Date(b.end_at),
                                        dayKey,
                                        shiftDefs,
                                      )
                                    : undefined;
                                  return renderBookingCard(b, spans);
                                })
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
