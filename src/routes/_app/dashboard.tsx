import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Users, DoorOpen, FileText, Calendar, AlertTriangle, DollarSign, ScrollText,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { WeekScheduleByRoomCard } from "@/components/WeekScheduleByRoomCard";
import { startOfMonth, endOfMonth, startOfWeek, addDays } from "date-fns";
import { parseDateOnlyLocal, formatDateOnlyBR } from "@/lib/dateOnly";

export const Route = createFileRoute("/_app/dashboard")({
  component: DashboardPage,
});

function brl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function DashboardPage() {
  const { user, role } = useAuth();

  const { data: stats, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const now = new Date();
      const weekStart = startOfWeek(now, { weekStartsOn: 1 });
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = addDays(weekStart, 7);
      const monthStart = startOfMonth(now).toISOString().slice(0, 10);
      const monthEnd = endOfMonth(now).toISOString().slice(0, 10);

      const [profs, rooms, contracts, weekBookings, conflicts, receivables, audits] = await Promise.all([
        supabase.from("professionals").select("id", { count: "exact", head: true }).eq("active", true),
        supabase.from("rooms").select("id", { count: "exact", head: true }).eq("active", true),
        supabase.from("contracts").select("id", { count: "exact", head: true }).eq("status", "ativo"),
        supabase.from("bookings").select("id,status")
          .lt("start_at", weekEnd.toISOString())
          .gt("end_at", weekStart.toISOString())
          .in("status", ["ativa", "conflito"]),
        supabase.from("booking_conflicts").select("id", { count: "exact", head: true }).eq("status", "pendente"),
        supabase.from("receivables").select("kind,status,amount_due,amount_paid")
          .gte("due_date", monthStart).lte("due_date", monthEnd),
        supabase.from("audit_logs").select("id, action, entity_type, created_at, metadata").order("created_at", { ascending: false }).limit(5),
      ]);

      const fin = {
        aReceberContrato: 0, aReceberAvulso: 0,
        recebidoContrato: 0, recebidoAvulso: 0,
        atrasadoContrato: 0, atrasadoAvulso: 0,
      };
      for (const r of (receivables.data ?? []) as { kind: string; status: string; amount_due: number; amount_paid: number | null }[]) {
        const v = Number(r.amount_due);
        const vPago = Number(r.amount_paid ?? r.amount_due);
        const k = r.kind === "avulso" ? "Avulso" : "Contrato";
        if (r.status === "a_receber") fin[`aReceber${k}` as keyof typeof fin] += v;
        else if (r.status === "atrasado") fin[`atrasado${k}` as keyof typeof fin] += v;
        else if (r.status === "recebido") fin[`recebido${k}` as keyof typeof fin] += vPago;
      }

      const weekRows = (weekBookings.data ?? []) as { status: string }[];
      const weekActive = weekRows.filter((b) => b.status === "ativa").length;
      const weekConflict = weekRows.filter((b) => b.status === "conflito").length;

      return {
        professionals: profs.count ?? 0,
        rooms: rooms.count ?? 0,
        contracts: contracts.count ?? 0,
        weekBookings: weekRows.length,
        weekActive,
        weekConflict,
        conflicts: conflicts.count ?? 0,
        fin,
        audits: audits.data ?? [],
      };
    },
  });

  const cards = [
    { label: "Profissionais ativos", value: stats?.professionals, icon: Users, color: "text-primary" },
    { label: "Salas ativas", value: stats?.rooms, icon: DoorOpen, color: "text-success" },
    { label: "Contratos ativos", value: stats?.contracts, icon: FileText, color: "text-primary" },
    {
      label: "Reservas da semana",
      value: stats?.weekBookings,
      icon: Calendar,
      color: "text-success",
      hint: stats
        ? `Ativas: ${stats.weekActive} · Conflitos: ${stats.weekConflict}`
        : undefined,
    },
    { label: "Conflitos pendentes", value: stats?.conflicts, icon: AlertTriangle, color: "text-destructive" },
  ];

  const f = stats?.fin;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-muted-foreground">Olá, {user?.email}</p>
        <h1 className="font-serif text-3xl">Dashboard</h1>
        <p className="text-muted-foreground">
          Visão geral da operação · perfil <Badge variant="secondary">{role ?? "—"}</Badge>
        </p>
      </div>

      <Card className="border-border/60">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 font-serif text-xl">
            <DollarSign className="h-5 w-5 text-primary" /> Financeiro do mês
          </CardTitle>
          <Link to="/financeiro" className="text-xs text-primary hover:underline">Ver tudo →</Link>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <FinBlock label="A vencer" total={(f?.aReceberContrato ?? 0) + (f?.aReceberAvulso ?? 0)}
              contrato={f?.aReceberContrato ?? 0} avulso={f?.aReceberAvulso ?? 0} tone="warning" loading={isLoading} />
            <FinBlock label="Recebido" total={(f?.recebidoContrato ?? 0) + (f?.recebidoAvulso ?? 0)}
              contrato={f?.recebidoContrato ?? 0} avulso={f?.recebidoAvulso ?? 0} tone="success" loading={isLoading} />
            <FinBlock label="Em atraso" total={(f?.atrasadoContrato ?? 0) + (f?.atrasadoAvulso ?? 0)}
              contrato={f?.atrasadoContrato ?? 0} avulso={f?.atrasadoAvulso ?? 0} tone="destructive" loading={isLoading} />
          </div>
        </CardContent>
      </Card>

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
              {"hint" in c && c.hint && !isLoading && (
                <p className="mt-1 text-xs text-muted-foreground">{c.hint}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <WeekScheduleByRoomCard />

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

function FinBlock({ label, total, contrato, avulso, tone, loading }: {
  label: string; total: number; contrato: number; avulso: number;
  tone: "warning" | "success" | "destructive"; loading: boolean;
}) {
  const toneClass = tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-destructive";
  return (
    <div className="rounded-lg border bg-card/50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 font-serif text-2xl ${toneClass}`}>
        {loading ? "—" : brl(total)}
      </p>
      <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
        <div className="flex justify-between"><span>Contratos</span><span>{brl(contrato)}</span></div>
        <div className="flex justify-between"><span>Avulsos</span><span>{brl(avulso)}</span></div>
      </div>
    </div>
  );
}
