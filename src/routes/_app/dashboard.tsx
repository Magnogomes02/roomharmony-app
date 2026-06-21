import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
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
import { parseDateOnlyLocal, formatDateOnlyBR, toDateOnlyString } from "@/lib/dateOnly";
import { computeEffectiveStatus as computeReceivableEffectiveStatus } from "@/lib/paymentsService";
import { computeEffectiveStatus as computePayableEffectiveStatus, generateRecurringForYear } from "@/lib/payablesStatus";
import { createNotification } from "@/lib/notifications";

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
      const monthStart = toDateOnlyString(startOfMonth(now));
      const monthEnd = toDateOnlyString(endOfMonth(now));

      await generateRecurringForYear(now.getFullYear());

      const [profs, rooms, contracts, weekBookings, conflicts, receivables, payables, audits, expiringContracts, allProfessionals, allSchedules, allRooms] = await Promise.all([
        supabase.from("professionals").select("id", { count: "exact", head: true }).eq("active", true),
        supabase.from("rooms").select("id", { count: "exact", head: true }).eq("active", true),
        supabase.from("contracts").select("id", { count: "exact", head: true }).eq("status", "ativo"),
        supabase.from("bookings").select("id,status")
          .lt("start_at", weekEnd.toISOString())
          .gt("end_at", weekStart.toISOString())
          .in("status", ["ativa", "conflito"]),
        supabase.from("booking_conflicts").select("id", { count: "exact", head: true }).eq("status", "pendente"),
        supabase.from("receivables").select("kind,status,due_date,amount_due,amount_paid,credit_applied_amount,remaining_due_date")
          .gte("due_date", monthStart).lte("due_date", monthEnd),
        supabase.from("payables").select("kind,status,due_date,amount_due,amount_paid,credit_applied_amount,remaining_due_date")
          .gte("reference_month", monthStart).lte("reference_month", monthEnd)
          .or("kind.eq.avulso,parent_payable_id.not.is.null"),
        supabase.from("audit_logs").select("id, action, entity_type, created_at, metadata").order("created_at", { ascending: false }).limit(5),
        supabase.from("contracts").select("id,professional_id,end_date,status").eq("status", "ativo").not("end_date", "is", null),
        supabase.from("professionals").select("id,full_name"),
        supabase.from("contract_schedules").select("contract_id,room_id"),
        supabase.from("rooms").select("id,name"),
      ]);

      const fin = {
        aReceberContrato: 0, aReceberAvulso: 0,
        recebidoContrato: 0, recebidoAvulso: 0,
        atrasadoContrato: 0, atrasadoAvulso: 0,
      };
      for (const r of (receivables.data ?? []) as { kind: string; status: string; due_date: string; amount_due: number; amount_paid: number | null; credit_applied_amount: number | null; remaining_due_date: string | null }[]) {
        if (r.status === "cancelado") continue;
        const due = Number(r.amount_due);
        const paid = Number(r.amount_paid ?? 0);
        const credit = Number(r.credit_applied_amount ?? 0);
        const saldo = Math.max(due - paid - credit, 0);
        const k = r.kind === "avulso" ? "Avulso" : "Contrato";
        const effectiveStatus = computeReceivableEffectiveStatus({
          status: r.status,
          due_date: r.due_date,
          amount_due: due,
          amount_paid: paid,
          credit_applied_amount: credit,
          remaining_due_date: r.remaining_due_date,
        });
        if (paid > 0) fin[`recebido${k}` as keyof typeof fin] += paid;
        if (saldo > 0) {
          if (effectiveStatus === "atrasado") fin[`atrasado${k}` as keyof typeof fin] += saldo;
          else fin[`aReceber${k}` as keyof typeof fin] += saldo;
        }
      }

      const pag = {
        aPagarRecorrente: 0, aPagarAvulso: 0,
        pagoRecorrente: 0, pagoAvulso: 0,
        atrasadoRecorrente: 0, atrasadoAvulso: 0,
      };
      for (const p of (payables.data ?? []) as { kind: string; status: string; due_date: string; amount_due: number; amount_paid: number | null; credit_applied_amount: number | null; remaining_due_date: string | null }[]) {
        const due = Number(p.amount_due);
        const paid = Number(p.amount_paid ?? 0);
        const credit = Number(p.credit_applied_amount ?? 0);
        const saldo = Math.max(due - paid - credit, 0);
        const k = p.kind === "avulso" ? "Avulso" : "Recorrente";
        const effectiveStatus = computePayableEffectiveStatus(p);
        if (effectiveStatus === "a_pagar" || effectiveStatus === "parcial") pag[`aPagar${k}` as keyof typeof pag] += saldo;
        else if (effectiveStatus === "atrasado") pag[`atrasado${k}` as keyof typeof pag] += saldo;
        else if (effectiveStatus === "pago") pag[`pago${k}` as keyof typeof pag] += paid;
      }

      const weekRows = (weekBookings.data ?? []) as { status: string }[];
      const weekActive = weekRows.filter((b) => b.status === "ativa").length;
      const weekConflict = weekRows.filter((b) => b.status === "conflito").length;

      // Contratos próximos do vencimento (próximos 30 dias)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const profMap = new Map<string, string>(
        ((allProfessionals.data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]),
      );
      const roomMap = new Map<string, string>(
        ((allRooms.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]),
      );
      const schedulesByContract = new Map<string, Set<string>>();
      for (const s of (allSchedules.data ?? []) as { contract_id: string; room_id: string }[]) {
        const set = schedulesByContract.get(s.contract_id) ?? new Set<string>();
        set.add(s.room_id);
        schedulesByContract.set(s.contract_id, set);
      }
      const expiring = ((expiringContracts.data ?? []) as { id: string; professional_id: string; end_date: string | null }[])
        .filter((c) => !!c.end_date)
        .map((c) => {
          const end = parseDateOnlyLocal(c.end_date as string);
          const diff = Math.floor((end.getTime() - today.getTime()) / 86400000);
          const roomIds = Array.from(schedulesByContract.get(c.id) ?? []);
          const roomsSummary = roomIds.map((id) => roomMap.get(id) ?? "Sala").join(", ");
          return {
            id: c.id,
            professional_name: profMap.get(c.professional_id) ?? "—",
            end_date: c.end_date as string,
            days_left: diff,
            rooms_summary: roomsSummary,
          };
        })
        .filter((c) => c.days_left >= 0 && c.days_left <= 30)
        .sort((a, b) => a.days_left - b.days_left);

      return {
        professionals: profs.count ?? 0,
        rooms: rooms.count ?? 0,
        contracts: contracts.count ?? 0,
        weekBookings: weekRows.length,
        weekActive,
        weekConflict,
        conflicts: conflicts.count ?? 0,
        fin,
        pag,
        audits: audits.data ?? [],
        expiring,
      };
    },
  });

  // Fire notifications once per day when overdue amounts are found
  useEffect(() => {
    if (!stats || !user?.email) return;
    const today = toDateOnlyString(new Date());
    const key = `notif_overdue_checked_${today}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");

    const totalOverdue = (stats.fin.atrasadoContrato ?? 0) + (stats.fin.atrasadoAvulso ?? 0);
    if (totalOverdue > 0) {
      const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      createNotification(
        user.email,
        "Recebíveis em atraso",
        `Há ${brl(totalOverdue)} em recebíveis vencidos no mês atual. Acesse Financeiro para mais detalhes.`,
        { total_overdue: totalOverdue, date: today },
      );
    }

    if ((stats.conflicts ?? 0) > 0) {
      createNotification(
        user.email,
        "Conflitos de agenda pendentes",
        `${stats.conflicts} conflito(s) de reserva aguardam resolução.`,
        { conflict_count: stats.conflicts, date: today },
      );
    }

    if ((stats.expiring ?? []).length > 0) {
      const expiring = stats.expiring as { professional_name: string; days_left: number }[];
      const names = expiring.map((c) => `${c.professional_name} (${c.days_left}d)`).join(", ");
      createNotification(
        user.email,
        "Contratos próximos do vencimento",
        `${expiring.length} contrato(s) vencem nos próximos 30 dias: ${names}.`,
        { count: expiring.length, date: today },
      );
    }
  }, [stats, user?.email]);

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
  const p = stats?.pag;

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
              item1={f?.aReceberContrato ?? 0} item2={f?.aReceberAvulso ?? 0} tone="warning" loading={isLoading} />
            <FinBlock label="Recebido" total={(f?.recebidoContrato ?? 0) + (f?.recebidoAvulso ?? 0)}
              item1={f?.recebidoContrato ?? 0} item2={f?.recebidoAvulso ?? 0} tone="success" loading={isLoading} />
            <FinBlock label="Em atraso" total={(f?.atrasadoContrato ?? 0) + (f?.atrasadoAvulso ?? 0)}
              item1={f?.atrasadoContrato ?? 0} item2={f?.atrasadoAvulso ?? 0} tone="destructive" loading={isLoading} />

            <FinBlock label="A pagar" total={(p?.aPagarRecorrente ?? 0) + (p?.aPagarAvulso ?? 0)}
              item1={p?.aPagarRecorrente ?? 0} item2={p?.aPagarAvulso ?? 0} breakdownLabels={["Recorrente", "Avulso"]} tone="warning" loading={isLoading} />
            <FinBlock label="Pago" total={(p?.pagoRecorrente ?? 0) + (p?.pagoAvulso ?? 0)}
              item1={p?.pagoRecorrente ?? 0} item2={p?.pagoAvulso ?? 0} breakdownLabels={["Recorrente", "Avulso"]} tone="success" loading={isLoading} />
            <FinBlock label="Contas em atraso" total={(p?.atrasadoRecorrente ?? 0) + (p?.atrasadoAvulso ?? 0)}
              item1={p?.atrasadoRecorrente ?? 0} item2={p?.atrasadoAvulso ?? 0} breakdownLabels={["Recorrente", "Avulso"]} tone="destructive" loading={isLoading} />
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

      <Card className={stats?.expiring && stats.expiring.length > 0 ? "border-warning/60" : "border-border/60"}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 font-serif text-xl">
            <AlertTriangle className={`h-5 w-5 ${stats?.expiring && stats.expiring.length > 0 ? "text-warning" : "text-muted-foreground"}`} />
            Contratos próximos do vencimento
          </CardTitle>
          <Link to="/contratos" className="text-xs text-primary hover:underline">Ver tudo →</Link>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : !stats?.expiring || stats.expiring.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum contrato vencendo nos próximos 30 dias.</p>
          ) : (
            <>
              <p className="mb-3 text-sm">
                <span className="font-medium">{stats.expiring.length}</span>{" "}
                contrato{stats.expiring.length === 1 ? "" : "s"} vencendo nos próximos 30 dias.
              </p>
              <ul className="divide-y divide-border">
                {stats.expiring.slice(0, 5).map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.professional_name}</p>
                      {c.rooms_summary && (
                        <p className="truncate text-xs text-muted-foreground">{c.rooms_summary}</p>
                      )}
                    </div>
                    <div className="ml-3 text-right">
                      <p className="text-xs">{formatDateOnlyBR(c.end_date)}</p>
                      <p className="text-xs text-warning">
                        {c.days_left === 0 ? "vence hoje" : `${c.days_left} dia${c.days_left === 1 ? "" : "s"}`}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

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

function FinBlock({ label, total, item1, item2, breakdownLabels = ["Contratos", "Avulsos"], tone, loading }: {
  label: string; total: number; item1: number; item2: number;
  breakdownLabels?: [string, string];
  tone: "warning" | "success" | "destructive"; loading: boolean;
}) {
  const toneClass = tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-destructive";
  const [label1, label2] = breakdownLabels;
  return (
    <div className="rounded-lg border bg-card/50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 font-serif text-2xl ${toneClass}`}>
        {loading ? "—" : brl(total)}
      </p>
      <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
        <div className="flex justify-between"><span>{label1}</span><span>{brl(item1)}</span></div>
        <div className="flex justify-between"><span>{label2}</span><span>{brl(item2)}</span></div>
      </div>
    </div>
  );
}
