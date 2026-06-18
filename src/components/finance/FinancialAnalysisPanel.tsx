import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  loadAnnualFinancialSummary,
  type AnnualFinancialResult,
} from "@/lib/financeAnalytics";

function brl(v: number | null | undefined) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pct(v: number) {
  return `${(v * 100).toFixed(1).replace(".", ",")}%`;
}

export function FinancialAnalysisPanel() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const [data, setData] = useState<AnnualFinancialResult | null>(null);
  const [loading, setLoading] = useState(true);

  const years = useMemo(() => {
    const arr: number[] = [];
    for (let y = currentYear + 1; y >= currentYear - 4; y--) arr.push(y);
    return arr;
  }, [currentYear]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadAnnualFinancialSummary(year)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e) => toast.error("Erro ao carregar análise", { description: e instanceof Error ? e.message : String(e) }))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year]);

  const totals = data?.annualTotals;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl">Análise Financeira</h2>
          <p className="text-muted-foreground text-sm">
            Visão anual por competência (mês de referência).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Previsto no ano</CardTitle></CardHeader>
          <CardContent><div className="font-serif text-2xl">{brl(totals?.expected ?? 0)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Recebido no ano</CardTitle></CardHeader>
          <CardContent><div className="font-serif text-2xl text-success">{brl(totals?.received ?? 0)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">A receber no ano</CardTitle></CardHeader>
          <CardContent><div className="font-serif text-2xl text-warning">{brl(totals?.receivable ?? 0)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Em atraso no ano</CardTitle></CardHeader>
          <CardContent><div className="font-serif text-2xl text-destructive">{brl(totals?.overdue ?? 0)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Taxa de recebimento</CardTitle></CardHeader>
          <CardContent>
            <div className="font-serif text-2xl">{pct(totals?.receivedRate ?? 0)}</div>
            {totals?.bestMonth && (
              <p className="mt-1 text-xs text-muted-foreground capitalize">Melhor mês: {totals.bestMonth}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Taxa de inadimplência</CardTitle></CardHeader>
          <CardContent><div className="font-serif text-2xl text-destructive">{pct(totals?.overdueRate ?? 0)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Perda no ano</CardTitle></CardHeader>
          <CardContent>
            <div className="font-serif text-2xl text-destructive">{brl(totals?.lost ?? 0)}</div>
            <p className="mt-1 text-xs text-muted-foreground">Taxa de perda: {pct(totals?.lossRate ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Despesas pagas</CardTitle></CardHeader>
          <CardContent>
            <div className="font-serif text-2xl text-destructive">{brl(totals?.expensesPaid ?? 0)}</div>
            <p className="mt-1 text-xs text-muted-foreground">Previsto: {brl(totals?.expensesPlanned ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Resultado (receitas − despesas)</CardTitle></CardHeader>
          <CardContent>
            <div className={`font-serif text-2xl ${(totals?.resultado ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>
              {brl(totals?.resultado ?? 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">Resumo mensal · {year}</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead className="text-right">Previsto</TableHead>
                  <TableHead className="text-right">Recebido</TableHead>
                  <TableHead className="text-right">A receber</TableHead>
                  <TableHead className="text-right">Em atraso</TableHead>
                  <TableHead className="text-right">Perda</TableHead>
                  <TableHead className="text-right">Despesas</TableHead>
                  <TableHead className="text-right">Resultado</TableHead>
                  <TableHead className="text-right">% Recebido</TableHead>
                  <TableHead className="text-right">% Atraso</TableHead>
                  <TableHead className="text-right">% Perda</TableHead>
                  <TableHead className="text-right">Acumulado recebido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={12} className="py-8 text-center text-muted-foreground">Carregando...</TableCell></TableRow>
                ) : (data?.monthlyRows ?? []).map((m) => (
                  <TableRow key={m.month}>
                    <TableCell className="font-medium capitalize">{m.monthLabel}</TableCell>
                    <TableCell className="text-right">{brl(m.expected)}</TableCell>
                    <TableCell className="text-right text-success">{brl(m.received)}</TableCell>
                    <TableCell className="text-right text-warning">{brl(m.receivable)}</TableCell>
                    <TableCell className="text-right text-destructive">{brl(m.overdue)}</TableCell>
                    <TableCell className="text-right text-destructive">{brl(m.lost)}</TableCell>
                    <TableCell className="text-right text-destructive">{brl(m.expensesPaid)}</TableCell>
                    <TableCell className={`text-right font-medium ${m.resultado >= 0 ? "text-success" : "text-destructive"}`}>{brl(m.resultado)}</TableCell>
                    <TableCell className="text-right">{pct(m.receivedRate)}</TableCell>
                    <TableCell className="text-right">{pct(m.overdueRate)}</TableCell>
                    <TableCell className="text-right">{pct(m.lossRate)}</TableCell>
                    <TableCell className="text-right">{brl(m.accumulatedReceived)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
