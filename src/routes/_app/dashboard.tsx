import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  DoorOpen,
  FileText,
  Calendar,
  AlertTriangle,
  PenLine,
  ScrollText,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_app/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { user, role } = useAuth();

  const { data: stats, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const now = new Date();
      const start = new Date(now); start.setDate(now.getDate() - now.getDay()); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(start.getDate() + 7);

      const [profs, rooms, contracts, weekBookings, conflicts, awaiting, audits] = await Promise.all([
        supabase.from("professionals").select("id", { count: "exact", head: true }).eq("active", true),
        supabase.from("rooms").select("id", { count: "exact", head: true }).eq("active", true),
        supabase.from("contracts").select("id", { count: "exact", head: true }).eq("status", "ativo"),
        supabase.from("bookings").select("id", { count: "exact", head: true })
          .gte("start_at", start.toISOString()).lt("start_at", end.toISOString()),
        supabase.from("booking_conflicts").select("id", { count: "exact", head: true }).eq("status", "pendente"),
        supabase.from("contracts").select("id", { count: "exact", head: true }).eq("status", "aguardando_assinatura"),
        supabase.from("audit_logs").select("id, action, entity_type, created_at, metadata").order("created_at", { ascending: false }).limit(5),
      ]);
      return {
        professionals: profs.count ?? 0,
        rooms: rooms.count ?? 0,
        contracts: contracts.count ?? 0,
        weekBookings: weekBookings.count ?? 0,
        conflicts: conflicts.count ?? 0,
        awaiting: awaiting.count ?? 0,
        audits: audits.data ?? [],
      };
    },
  });

  const cards = [
    { label: "Profissionais ativos", value: stats?.professionals, icon: Users, color: "text-primary" },
    { label: "Salas ativas", value: stats?.rooms, icon: DoorOpen, color: "text-success" },
    { label: "Contratos ativos", value: stats?.contracts, icon: FileText, color: "text-primary" },
    { label: "Reservas da semana", value: stats?.weekBookings, icon: Calendar, color: "text-success" },
    { label: "Conflitos pendentes", value: stats?.conflicts, icon: AlertTriangle, color: "text-destructive" },
    { label: "Aguardando assinatura", value: stats?.awaiting, icon: PenLine, color: "text-warning" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-muted-foreground">Olá, {user?.email}</p>
        <h1 className="font-serif text-3xl">Dashboard</h1>
        <p className="text-muted-foreground">
          Visão geral da operação · perfil <Badge variant="secondary">{role ?? "—"}</Badge>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label} className="border-border/60">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
              <c.icon className={`h-5 w-5 ${c.color}`} />
            </CardHeader>
            <CardContent>
              <div className="font-serif text-4xl">
                {isLoading ? <span className="text-muted-foreground/40">—</span> : c.value ?? 0}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ScrollText className="h-5 w-5 text-primary" />
            <CardTitle className="font-serif text-xl">Últimas ações</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {!stats?.audits?.length ? (
            <p className="text-sm text-muted-foreground">Nenhuma ação registrada ainda.</p>
          ) : (
            <ul className="divide-y divide-border">
              {stats.audits.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <span className="font-medium">{a.action}</span>
                    <span className="ml-2 text-muted-foreground">· {a.entity_type}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(a.created_at).toLocaleString("pt-BR")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
