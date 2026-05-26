import { supabase } from "@/integrations/supabase/client";

export type ShiftKey = "manha" | "tarde" | "noite";

export interface ShiftRange { start: string; end: string }
export type ShiftDefaults = Record<ShiftKey, ShiftRange>;

export const DEFAULT_SHIFTS: ShiftDefaults = {
  manha: { start: "08:00", end: "12:00" },
  tarde: { start: "13:00", end: "17:00" },
  noite: { start: "17:30", end: "20:00" },
};

export const SHIFT_LABELS: Record<ShiftKey, string> = {
  manha: "Turno manhã",
  tarde: "Turno tarde",
  noite: "Turno noite",
};

export async function loadShiftDefaults(): Promise<ShiftDefaults> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "shift_defaults")
    .maybeSingle();
  const v = (data?.value ?? {}) as Partial<ShiftDefaults>;
  return {
    manha: { ...DEFAULT_SHIFTS.manha, ...(v.manha ?? {}) },
    tarde: { ...DEFAULT_SHIFTS.tarde, ...(v.tarde ?? {}) },
    noite: { ...DEFAULT_SHIFTS.noite, ...(v.noite ?? {}) },
  };
}

export async function saveShiftDefaults(next: ShiftDefaults) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("settings").upsert({
    key: "shift_defaults",
    value: next as never,
    updated_by: user?.id ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });
  if (error) throw error;
}

export function detectShift(start: string, end: string, defs: ShiftDefaults): ShiftKey | null {
  const s = start.slice(0, 5), e = end.slice(0, 5);
  for (const k of ["manha", "tarde", "noite"] as ShiftKey[]) {
    if (defs[k].start === s && defs[k].end === e) return k;
  }
  return null;
}
