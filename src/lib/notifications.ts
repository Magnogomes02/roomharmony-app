import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export interface AppNotification {
  id: string;
  channel: string;
  recipient: string;
  subject: string | null;
  message: string;
  status: string;
  metadata: Json | null;
  created_at: string;
  sent_at: string | null;
}

export async function createNotification(
  recipient: string,
  subject: string,
  message: string,
  metadata?: Json,
  channel = "sistema",
) {
  await supabase.from("notification_queue").insert({
    channel,
    recipient,
    subject,
    message,
    metadata: metadata ?? null,
    status: "pendente",
  });
}

export async function getUnreadNotifications(userEmail: string): Promise<AppNotification[]> {
  const { data } = await supabase
    .from("notification_queue")
    .select("*")
    .eq("channel", "sistema")
    .eq("recipient", userEmail)
    .eq("status", "pendente")
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []) as AppNotification[];
}

export async function getRecentNotifications(userEmail: string): Promise<AppNotification[]> {
  const { data } = await supabase
    .from("notification_queue")
    .select("*")
    .eq("channel", "sistema")
    .eq("recipient", userEmail)
    .order("created_at", { ascending: false })
    .limit(30);
  return (data ?? []) as AppNotification[];
}

export async function markAsRead(id: string) {
  await supabase
    .from("notification_queue")
    .update({ status: "lido", sent_at: new Date().toISOString() })
    .eq("id", id);
}

export async function markAllAsRead(userEmail: string) {
  await supabase
    .from("notification_queue")
    .update({ status: "lido", sent_at: new Date().toISOString() })
    .eq("channel", "sistema")
    .eq("recipient", userEmail)
    .eq("status", "pendente");
}
