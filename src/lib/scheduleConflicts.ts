import { addDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { ScheduleRow } from "@/lib/contractBookings";

export interface BusySlot {
  weekday: number;
  room_id: string;
  start_min: number; // minutes from midnight (local)
  end_min: number;
  label: string;
  kind: "contrato" | "avulso";
}

export interface RowConflict {
  label: string;
  kind: "interno" | "contrato" | "avulso";
  start_min?: number;
  end_min?: number;
}

export interface RowSuggestion {
  alternativeRooms: Array<{ id: string; name: string }>;
  alternativeStart: string | null; // HH:mm of a free slot of same duration in same room/weekday
}

export const tm = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
export const fromMin = (n: number) => {
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

/**
 * Loads busy slots for the next 90 days:
 *  - all schedule rows of OTHER active contracts (excluding excludeContractId)
 *  - all upcoming non-cancelled avulso bookings (contract_id is null)
 */
export async function loadBusySlots(opts: {
  excludeContractId: string | null;
}): Promise<BusySlot[]> {
  const profsRes = await supabase.from("professionals").select("id,full_name");
  const profMap = new Map(((profsRes.data as Array<{ id: string; full_name: string }>) ?? []).map((p) => [p.id, p.full_name]));

  const activeRes = await supabase
    .from("contracts").select("id,professional_id").eq("status", "ativo");
  const active = ((activeRes.data as Array<{ id: string; professional_id: string }>) ?? []).filter(
    (c) => c.id !== opts.excludeContractId,
  );
  const activeIds = active.map((c) => c.id);
  const profByContract = new Map(active.map((c) => [c.id, c.professional_id]));

  let extSchedules: Array<{
    contract_id: string; room_id: string; weekday: number; start_time: string; end_time: string;
  }> = [];
  if (activeIds.length > 0) {
    const r = await supabase
      .from("contract_schedules")
      .select("contract_id,room_id,weekday,start_time,end_time")
      .in("contract_id", activeIds);
    extSchedules = (r.data as typeof extSchedules) ?? [];
  }

  const today = new Date();
  const horizon = addDays(today, 90);
  const bkRes = await supabase
    .from("bookings")
    .select("room_id,start_at,end_at,professional_id,contract_id,status")
    .neq("status", "cancelada")
    .is("contract_id", null)
    .gte("start_at", today.toISOString())
    .lt("start_at", horizon.toISOString());
  const avulsos = (bkRes.data as Array<{
    room_id: string; start_at: string; end_at: string; professional_id: string;
  }>) ?? [];

  const busy: BusySlot[] = [];

  for (const s of extSchedules) {
    const profId = profByContract.get(s.contract_id);
    const profName = profId ? profMap.get(profId) ?? "Profissional" : "Profissional";
    busy.push({
      weekday: s.weekday,
      room_id: s.room_id,
      start_min: tm(s.start_time.slice(0, 5)),
      end_min: tm(s.end_time.slice(0, 5)),
      label: `${profName} (contrato)`,
      kind: "contrato",
    });
  }

  for (const b of avulsos) {
    const s = new Date(b.start_at);
    const e = new Date(b.end_at);
    const profName = profMap.get(b.professional_id) ?? "Avulso";
    busy.push({
      weekday: s.getDay(),
      room_id: b.room_id,
      start_min: s.getHours() * 60 + s.getMinutes(),
      end_min: e.getHours() * 60 + e.getMinutes(),
      label: `${profName} (avulso)`,
      kind: "avulso",
    });
  }

  return busy;
}

export function computeRowConflicts(
  row: ScheduleRow,
  rowIndex: number,
  allRows: ScheduleRow[],
  busy: BusySlot[],
): RowConflict[] {
  if (!row.room_id || !row.start_time || !row.end_time) return [];
  const a = tm(row.start_time), b = tm(row.end_time);
  if (b <= a) return [];
  const out: RowConflict[] = [];
  allRows.forEach((other, i) => {
    if (i === rowIndex) return;
    if (other.weekday !== row.weekday || other.room_id !== row.room_id) return;
    const os = tm(other.start_time), oe = tm(other.end_time);
    if (!(b <= os || oe <= a)) {
      out.push({
        label: `Outra linha deste contrato (${other.start_time}–${other.end_time})`,
        kind: "interno",
      });
    }
  });
  for (const slot of busy) {
    if (slot.weekday !== row.weekday || slot.room_id !== row.room_id) continue;
    if (!(b <= slot.start_min || slot.end_min <= a)) {
      out.push({ label: slot.label, kind: slot.kind, start_min: slot.start_min, end_min: slot.end_min });
    }
  }
  return out;
}

export function suggestAlternatives(
  row: ScheduleRow,
  rowIndex: number,
  allRows: ScheduleRow[],
  busy: BusySlot[],
  rooms: Array<{ id: string; name: string; active: boolean }>,
): RowSuggestion {
  if (!row.room_id || !row.start_time || !row.end_time) {
    return { alternativeRooms: [], alternativeStart: null };
  }
  const a = tm(row.start_time), b = tm(row.end_time);
  if (b <= a) return { alternativeRooms: [], alternativeStart: null };
  const duration = b - a;

  // alternative rooms with same weekday/time free
  const alternativeRooms = rooms
    .filter((r) => r.active && r.id !== row.room_id)
    .filter((r) => {
      const hitsExternal = busy.some(
        (s) => s.weekday === row.weekday && s.room_id === r.id && !(b <= s.start_min || s.end_min <= a),
      );
      const hitsInternal = allRows.some(
        (o, i) =>
          i !== rowIndex &&
          o.weekday === row.weekday &&
          o.room_id === r.id &&
          !(b <= tm(o.start_time) || tm(o.end_time) <= a),
      );
      return !hitsExternal && !hitsInternal;
    })
    .slice(0, 3);

  // alternative start time in same room/weekday
  const occupied: Array<[number, number]> = [];
  for (const s of busy) {
    if (s.weekday === row.weekday && s.room_id === row.room_id) occupied.push([s.start_min, s.end_min]);
  }
  allRows.forEach((o, i) => {
    if (i === rowIndex) return;
    if (o.weekday === row.weekday && o.room_id === row.room_id) {
      occupied.push([tm(o.start_time), tm(o.end_time)]);
    }
  });
  occupied.sort((x, y) => x[0] - y[0]);

  const dayStart = 6 * 60;
  const dayEnd = 22 * 60;
  let cursor = dayStart;
  let alternativeStart: string | null = null;
  for (const [s, e] of [...occupied, [dayEnd, dayEnd] as [number, number]]) {
    if (s - cursor >= duration) { alternativeStart = fromMin(cursor); break; }
    cursor = Math.max(cursor, e);
  }
  return { alternativeRooms, alternativeStart };
}

export const TIMELINE_START_MIN = 6 * 60;
export const TIMELINE_END_MIN = 22 * 60;
