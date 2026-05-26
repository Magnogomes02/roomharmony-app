import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, CalendarDays, AlertTriangle } from "lucide-react";
import { addDays, format, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { entityColor, sortRooms, colorBlockStyle } from "@/lib/entityColors";

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

export function WeekScheduleByRoomCard() {
  const [offset, setOffset] = useState(0);

  const weekStart = useMemo(() => {
    const base = startOfWeek(new Date(), { weekStartsOn: 1 });
    base.setHours(0, 0, 0, 0);
    return addDays(base, offset * 7);
  }, [offset]);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

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
          <Button variant="ghost" size="icon" onClick={() => setOffset((o) => o - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOffset(0)} disabled={offset === 0}>
            Hoje
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setOffset((o) => o + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Link to="/calendario" className="ml-2 text-xs text-primary hover:underline">
            Ver completo →
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Semana: {format(weekStart, "dd 'de' MMM", { locale: ptBR })} —{" "}
          {format(addDays(weekStart, 6), "dd 'de' MMM yyyy", { locale: ptBR })}
        </p>

        {isLoading && <p className="text-xs text-muted-foreground">Carregando…</p>}

        {!isLoading && sortedRooms.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma sala ativa cadastrada.</p>
        )}

        {sortedRooms.map((room) => {
          const roomColor = entityColor(room.color_hex, room.id);
          const roomBookings = (data?.bookings ?? []).filter((b) => b.room_id === room.id);
          const conflictCount = roomBookings.filter((b) => b.status === "conflito").length;

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
                <div className="grid grid-cols-7 gap-1 p-2">
                  {days.map((d, di) => {
                    const dayKey = format(d, "yyyy-MM-dd");
                    const dayBookings = roomBookings
                      .filter((b) => format(new Date(b.start_at), "yyyy-MM-dd") === dayKey)
                      .sort(
                        (a, b) =>
                          new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
                      );
                    const isToday = dayKey === format(new Date(), "yyyy-MM-dd");
                    return (
                      <div key={dayKey} className="min-h-[80px]">
                        <div
                          className={`mb-1 text-center text-[10px] uppercase ${
                            isToday ? "font-semibold text-primary" : "text-muted-foreground"
                          }`}
                        >
                          {WEEKDAYS[di]} {format(d, "dd/MM")}
                        </div>
                        <div className="space-y-1">
                          {dayBookings.length === 0 ? (
                            <div className="rounded border border-dashed border-border/40 px-1 py-2 text-center text-[10px] text-muted-foreground/60">
                              —
                            </div>
                          ) : (
                            dayBookings.map((b) => {
                              const prof = data?.pros[b.professional_id];
                              const profColor = entityColor(prof?.color_hex, b.professional_id);
                              const isConflict = b.status === "conflito";
                              const s = new Date(b.start_at);
                              const e = new Date(b.end_at);
                              return (
                                <Link
                                  key={b.id}
                                  to="/calendario"
                                  className={`block overflow-hidden rounded border-l-2 px-1.5 py-1 text-[10px] leading-tight transition hover:opacity-90 ${
                                    isConflict ? "ring-1 ring-destructive/60" : ""
                                  }`}
                                  style={colorBlockStyle(profColor)}
                                >
                                  <div className="truncate font-medium">
                                    {format(s, "HH:mm")}–{format(e, "HH:mm")}
                                  </div>
                                  <div className="truncate opacity-80">
                                    {prof?.full_name ?? "—"}
                                  </div>
                                  {isConflict && (
                                    <div className="mt-0.5 flex items-center gap-0.5 text-[9px] font-medium text-destructive">
                                      <AlertTriangle className="h-2.5 w-2.5" />
                                      Conflito
                                    </div>
                                  )}
                                </Link>
                              );
                            })
                          )}
                        </div>
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
