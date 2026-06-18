import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check, CheckCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/hooks/useAuth";
import {
  type AppNotification,
  getRecentNotifications,
  markAllAsRead,
  markAsRead,
} from "@/lib/notifications";

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const email = user?.email ?? "";

  const load = useCallback(async () => {
    if (!email) return;
    setLoading(true);
    const data = await getRecentNotifications(email);
    setNotifications(data);
    setLoading(false);
  }, [email]);

  useEffect(() => {
    if (!email) return;
    load();
    // Poll every 60s for new notifications
    intervalRef.current = setInterval(load, 60_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [email, load]);

  // Reload when popover opens
  useEffect(() => { if (open) load(); }, [open, load]);

  const unreadCount = notifications.filter((n) => n.status === "pendente").length;

  async function handleMarkOne(n: AppNotification) {
    if (n.status !== "pendente") return;
    await markAsRead(n.id);
    setNotifications((prev) =>
      prev.map((x) => x.id === n.id ? { ...x, status: "lido", sent_at: new Date().toISOString() } : x)
    );
  }

  async function handleMarkAll() {
    if (!email) return;
    await markAllAsRead(email);
    setNotifications((prev) => prev.map((x) => ({ ...x, status: "lido", sent_at: x.sent_at ?? new Date().toISOString() })));
  }

  if (!email) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 p-0"
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="font-medium text-sm">Notificações</span>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={handleMarkAll}>
              <CheckCheck className="h-3 w-3" /> Marcar todas como lidas
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-[380px]">
          {loading && notifications.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">Carregando…</p>
          ) : notifications.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">Nenhuma notificação.</p>
          ) : (
            <div className="divide-y">
              {notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleMarkOne(n)}
                  className={`w-full px-3 py-2.5 text-left transition hover:bg-muted/50 ${n.status === "pendente" ? "bg-primary/5" : ""}`}
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      {n.subject && (
                        <p className={`truncate text-xs font-medium ${n.status === "pendente" ? "text-foreground" : "text-muted-foreground"}`}>
                          {n.subject}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.message}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground/60">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: ptBR })}
                      </p>
                    </div>
                    {n.status === "pendente" && (
                      <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    )}
                    {n.status === "lido" && (
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
