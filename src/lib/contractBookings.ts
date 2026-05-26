import { addDays, parseISO, startOfDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

export interface ScheduleRow {
  id?: string;
  weekday: number; // 0..6
  room_id: string;
  start_time: string; // HH:mm
  end_time: string;   // HH:mm
}

export interface ContractGenInput {
  contract_id: string;
  professional_id: string;
  start_date: string; // YYYY-MM-DD
  end_date: string | null;
  schedules: ScheduleRow[];
}

export interface ConflictPreview {
  schedule: ScheduleRow;
  date: Date;
  start: Date;
  end: Date;
  conflictingBookingIds: string[];
}

export interface GenerationPlan {
  toCreate: Array<{
    professional_id: string;
    room_id: string;
    contract_id: string;
    start_at: string;
    end_at: string;
    weekday: number;
  }>;
  conflicts: ConflictPreview[];
  alreadyExisting: number;
}

function fromTimeStr(date: Date, t: string) {
  const [h, m] = t.split(":").map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * Computes which bookings would be created for a contract over its full window,
 * separating clean inserts from conflicting ones.
 */
export async function planContractBookings(input: ContractGenInput): Promise<GenerationPlan> {
  const from = startOfDay(parseISO(input.start_date));
  const to = input.end_date
    ? startOfDay(parseISO(input.end_date))
    : addDays(startOfDay(new Date()), 365);

  const occurrences: Array<{ schedule: ScheduleRow; start: Date; end: Date }> = [];
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
    const weekday = d.getDay();
    for (const s of input.schedules) {
      if (s.weekday !== weekday) continue;
      occurrences.push({
        schedule: s,
        start: fromTimeStr(d, s.start_time.slice(0, 5)),
        end: fromTimeStr(d, s.end_time.slice(0, 5)),
      });
    }
  }
  if (occurrences.length === 0) return { toCreate: [], conflicts: [], alreadyExisting: 0 };

  // already existing for this contract
  const { data: existing } = await supabase
    .from("bookings")
    .select("room_id,start_at")
    .eq("contract_id", input.contract_id);
  const existSet = new Set(
    (existing ?? []).map((b) => `${b.room_id}|${b.start_at}`),
  );

  // load potential conflicts in the window for all involved rooms
  const roomIds = Array.from(new Set(occurrences.map((o) => o.schedule.room_id)));
  const winStart = occurrences[0].start.toISOString();
  const winEnd = occurrences[occurrences.length - 1].end.toISOString();
  const { data: candidate } = await supabase
    .from("bookings")
    .select("id,room_id,start_at,end_at,status,contract_id")
    .in("room_id", roomIds)
    .in("status", ["ativa", "conflito"])
    .lt("start_at", winEnd)
    .gt("end_at", winStart);
  const others = (candidate ?? []).filter((b) => b.contract_id !== input.contract_id);

  const toCreate: GenerationPlan["toCreate"] = [];
  const conflicts: ConflictPreview[] = [];
  let alreadyExisting = 0;

  for (const occ of occurrences) {
    const key = `${occ.schedule.room_id}|${occ.start.toISOString()}`;
    if (existSet.has(key)) { alreadyExisting++; continue; }
    const overlap = others.filter(
      (b) =>
        b.room_id === occ.schedule.room_id &&
        parseISO(b.start_at) < occ.end &&
        parseISO(b.end_at) > occ.start,
    );
    if (overlap.length > 0) {
      conflicts.push({
        schedule: occ.schedule,
        date: startOfDay(occ.start),
        start: occ.start,
        end: occ.end,
        conflictingBookingIds: overlap.map((b) => b.id),
      });
    }
    toCreate.push({
      professional_id: input.professional_id,
      room_id: occ.schedule.room_id,
      contract_id: input.contract_id,
      start_at: occ.start.toISOString(),
      end_at: occ.end.toISOString(),
      weekday: occ.schedule.weekday,
    });
  }

  return { toCreate, conflicts, alreadyExisting };
}

/**
 * Commits the plan: inserts the bookings (conflicting ones marked 'conflito')
 * and records pairs in booking_conflicts for the Conflitos page.
 */
export async function commitGenerationPlan(plan: GenerationPlan): Promise<{
  created: number;
  conflictsRegistered: number;
}> {
  if (plan.toCreate.length === 0) return { created: 0, conflictsRegistered: 0 };

  const conflictStartSet = new Set(
    plan.conflicts.map((c) => `${c.schedule.room_id}|${c.start.toISOString()}`),
  );

  const rows = plan.toCreate.map((b) => ({
    professional_id: b.professional_id,
    room_id: b.room_id,
    contract_id: b.contract_id,
    start_at: b.start_at,
    end_at: b.end_at,
    source: "recorrencia" as const,
    status: conflictStartSet.has(`${b.room_id}|${b.start_at}`) ? "conflito" : "ativa",
  }));

  // insert in chunks to avoid payload limits
  const CHUNK = 200;
  const insertedIds: Array<{ id: string; room_id: string; start_at: string }> = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("bookings")
      .insert(slice)
      .select("id,room_id,start_at");
    if (error) throw error;
    insertedIds.push(...((data ?? []) as Array<{ id: string; room_id: string; start_at: string }>));
  }

  // register conflict pairs
  let conflictsRegistered = 0;
  for (const c of plan.conflicts) {
    const created = insertedIds.find(
      (x) => x.room_id === c.schedule.room_id && x.start_at === c.start.toISOString(),
    );
    if (!created) continue;
    for (const otherId of c.conflictingBookingIds) {
      const { error } = await supabase.from("booking_conflicts").insert({
        booking_id_a: created.id,
        booking_id_b: otherId,
        room_id: c.schedule.room_id,
        status: "pendente",
      });
      if (!error) conflictsRegistered++;
      // mark the other booking as conflito too
      await supabase.from("bookings").update({ status: "conflito" }).eq("id", otherId).eq("status", "ativa");
    }
  }

  return { created: insertedIds.length, conflictsRegistered };
}

export const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
