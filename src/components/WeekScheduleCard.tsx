import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { addDays, format, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface BookingRow {
  id: string;
  start_at: string;
  end_at: string;
  room_id: string;
  professional_id: string;
}

const ROOM_COLORS = [
  "bg-primary/15 text-primary border-primary/40",
  "bg-success/15 text-success border-success/40",
  "bg-warning/15 text-warning border-warning/40",
  "bg-destructive/15 text-destructive border-destructive/40",
  "bg-accent text-accent-foreground border-border",
  "bg-secondary text-secondary-foreground border-border",
];

const ROW_PX = 40;

export function WeekScheduleCard() {
  const [offset, setOffset] = useState(0);

  const weekStart = useMemo(() => {
    const base = startOfWeek(new Date(), { weekStartsOn: 1 });
    return addDays(base, offset * 7);
  }, [offset]);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const { data, isLoading } = useQuery({
    queryKey: ["week-schedule", weekStart.toISOString()],
    queryFn: async () => {
      const [bk, rms, pros] = await Promise.all([
        supabase.from("bookings").select("id,start_at,end_at,room_id,professional_id")
          .gte("start_at", weekStart.toISOString())
          .lt("start_at", weekEnd.toISOString())
          .neq("status", "cancelada")
          .order("start_at"),
        supabase.from("rooms").select("id,name"),
        supabase.from("professionals").select("id,full_name"),
      ]);
      return {
        bookings: (bk.data ?? []) as BookingRow[],
        rooms: Object.fromEntries((rms.data ?? []).map((r: any) => [r.id, r.name])) as Record<string, string>,
        roomIds: (rms.data ?? []).map((r: any) => r.id) as string[],
        pros: Object.fromEntries((pros.data ?? []).map((p: any) => [p.id, p.full_name])) as Record<string, string>,
      };
    },
  });

  const { hourStart, hourEnd } = useMemo(() => {
    let min = 8, max = 19;
    for (const b of data?.bookings ?? []) {
      const s = new Date(b.start_at).getHours();
      const e = new Date(b.end_at).getHours() + (new Date(b.end_at).getMinutes() > 0 ? 1 : 0);
      if (s < min) min = s;
      if (e > max) max = e;
    }
    return { hourStart: Math.max(0, min), hourEnd: Math.min(24, Math.max(max, min + 4)) };
  }, [data]);

  const hours = useMemo(
    () => Array.from({ length: hourEnd - hourStart }, (_, i) => hourStart + i),
    [hourStart, hourEnd]
  );

  const colorForRoom = (roomId: string) => {
    const idx = data?.roomIds.indexOf(roomId) ?? 0;
    return ROOM_COLORS[idx % ROOM_COLORS.length];
  };

  type Laid = BookingRow & { _col: number; _cols: number };
  const layoutByDay = useMemo(() => {
    const map: Record<string, { items: Laid[]; maxCols: number }> = {};
    const groups: Record<string, BookingRow[]> = {};
    for (const b of data?.bookings ?? []) {
      const k = format(new Date(b.start_at), "yyyy-MM-dd");
      (groups[k] ||= []).push(b);
    }
    for (const [k, list] of Object.entries(groups)) {
      const sorted = [...list].sort(
        (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
      );
      const laid: Laid[] = [];
      let cluster: Laid[] = [];
      let clusterEnd = 0;
      let dayMax = 1;
      const flush = () => {
        const cols = Math.max(...cluster.map((c) => c._col + 1), 1);
        cluster.forEach((c) => (c._cols = cols));
        dayMax = Math.max(dayMax, cols);
        cluster = [];
      };
      for (const b of sorted) {
        const s = new Date(b.start_at).getTime();
        const e = new Date(b.end_at).getTime();
        if (cluster.length && s >= clusterEnd) flush();
        // find smallest free column index
        const used = new Set(
          cluster.filter((c) => new Date(c.end_at).getTime() > s).map((c) => c._col)
        );
        let col = 0;
        while (used.has(col)) col++;
        const item: Laid = { ...b, _col: col, _cols: 1 };
        cluster.push(item);
        laid.push(item);
        clusterEnd = Math.max(clusterEnd, e);
      }
      if (cluster.length) flush();
      map[k] = { items: laid, maxCols: dayMax };
    }
    return map;
  }, [data]);

  const gridHeight = hours.length * ROW_PX;
  const MIN_COL_PX = 80;

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
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          {format(weekStart, "dd 'de' MMM", { locale: ptBR })} —{" "}
          {format(addDays(weekStart, 6), "dd 'de' MMM yyyy", { locale: ptBR })}
        </p>

        <TooltipProvider delayDuration={150}>
          <div className="overflow-x-auto">
            <div className="min-w-[700px]">
              {/* Header row */}
              <div className="grid" style={{ gridTemplateColumns: "56px repeat(7, 1fr)" }}>
                <div />
                {days.map((d) => {
                  const isToday = format(d, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");
                  return (
                    <div
                      key={d.toISOString()}
                      className={`border-b border-border px-2 pb-2 text-center text-xs ${
                        isToday ? "font-semibold text-primary" : "text-muted-foreground"
                      }`}
                    >
                      <div className="uppercase">{format(d, "EEE", { locale: ptBR })}</div>
                      <div className="text-sm">{format(d, "dd/MM")}</div>
                    </div>
                  );
                })}
              </div>

              {/* Body */}
              <div className="grid" style={{ gridTemplateColumns: "56px repeat(7, 1fr)" }}>
                {/* Hour column */}
                <div className="relative" style={{ height: gridHeight }}>
                  {hours.map((h, i) => (
                    <div
                      key={h}
                      className="absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground"
                      style={{ top: i * ROW_PX }}
                    >
                      {String(h).padStart(2, "0")}:00
                    </div>
                  ))}
                </div>

                {/* Day columns */}
                {days.map((d) => {
                  const key = format(d, "yyyy-MM-dd");
                  const list = bookingsByDay[key] ?? [];
                  return (
                    <div
                      key={key}
                      className="relative border-l border-border/50"
                      style={{ height: gridHeight }}
                    >
                      {/* hour grid lines */}
                      {hours.map((_, i) => (
                        <div
                          key={i}
                          className="absolute inset-x-0 border-t border-border/40"
                          style={{ top: i * ROW_PX }}
                        />
                      ))}
                      {/* bookings */}
                      {list.map((b) => {
                        const s = new Date(b.start_at);
                        const e = new Date(b.end_at);
                        const startMin = (s.getHours() - hourStart) * 60 + s.getMinutes();
                        const durMin = Math.max(30, (e.getTime() - s.getTime()) / 60000);
                        const top = (startMin / 60) * ROW_PX;
                        const height = (durMin / 60) * ROW_PX - 2;
                        if (top < 0 || top >= gridHeight) return null;
                        return (
                          <Tooltip key={b.id}>
                            <TooltipTrigger asChild>
                              <Link
                                to="/calendario"
                                className={`absolute left-0.5 right-0.5 overflow-hidden rounded border px-1.5 py-0.5 text-[10px] leading-tight hover:opacity-90 ${colorForRoom(b.room_id)}`}
                                style={{ top, height }}
                              >
                                <div className="truncate font-medium">
                                  {format(s, "HH:mm")}–{format(e, "HH:mm")}
                                </div>
                                <div className="truncate">{data?.pros[b.professional_id] ?? "—"}</div>
                                <div className="truncate opacity-80">{data?.rooms[b.room_id] ?? "—"}</div>
                              </Link>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="text-xs">
                                <div className="font-medium">{data?.pros[b.professional_id]}</div>
                                <div>{data?.rooms[b.room_id]}</div>
                                <div className="text-muted-foreground">
                                  {format(s, "EEE dd/MM HH:mm", { locale: ptBR })} – {format(e, "HH:mm")}
                                </div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </TooltipProvider>

        {isLoading && <p className="mt-3 text-xs text-muted-foreground">Carregando…</p>}
        {!isLoading && (data?.bookings.length ?? 0) === 0 && (
          <p className="mt-3 text-xs text-muted-foreground">Nenhuma reserva nesta semana.</p>
        )}
      </CardContent>
    </Card>
  );
}
