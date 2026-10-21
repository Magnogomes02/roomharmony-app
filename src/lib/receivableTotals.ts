import { fromCents, toCents } from "@/lib/money";
import { computeEffectiveStatus, type EffectiveStatus } from "@/lib/paymentsService";

export interface ReceivableTotalsRow {
  status: string;
  cancel_type?: string | null;
  due_date: string;
  amount_due: number | string;
  amount_paid: number | string | null;
  credit_applied_amount?: number | string | null;
  remaining_due_date?: string | null;
}

/** Valores em reais. */
export interface ReceivableTotals {
  /** Valor previsto das cobranças (exceto as lançadas por engano). */
  expected: number;
  /** Dinheiro que entrou: soma dos pagamentos, inclusive excedentes. */
  received: number;
  /** Saldo em aberto ainda dentro do prazo. */
  toReceive: number;
  /** Saldo em aberto com vencimento (ou nova data do saldo) já passado. */
  overdue: number;
  /** Parte de toReceive que vem de pagamentos parciais. */
  partialOpen: number;
  /** Saldo em aberto de cobranças canceladas como perda de contrato. */
  lost: number;
}

/** Saldo em aberto em centavos: devido - pago - crédito aplicado, nunca negativo. */
export function openBalanceCents(r: ReceivableTotalsRow): number {
  return Math.max(toCents(r.amount_due) - toCents(r.amount_paid) - toCents(r.credit_applied_amount), 0);
}

/**
 * Regra única de totais de recebíveis, usada por Dashboard, Financeiro e
 * Análise financeira. O mês de cada recebível é decidido por quem chama
 * (pelo vencimento); aqui só se soma.
 *
 * - Cobranças canceladas como "cobrança errada" não contam em nada.
 * - "Recebido" é o dinheiro que entrou, inclusive em cobranças depois
 *   canceladas como perda e o excedente que virou crédito.
 * - Crédito aplicado reduz o saldo em aberto, mas não conta como recebido.
 */
export function summarizeReceivables(
  rows: ReceivableTotalsRow[],
  statusOf: (r: ReceivableTotalsRow) => EffectiveStatus = computeEffectiveStatus,
): ReceivableTotals {
  let expected = 0;
  let received = 0;
  let toReceive = 0;
  let overdue = 0;
  let partialOpen = 0;
  let lost = 0;

  for (const r of rows) {
    if (r.status === "cancelado" && r.cancel_type === "cobranca_errada") continue;
    expected += toCents(r.amount_due);
    received += toCents(r.amount_paid);
    const open = openBalanceCents(r);

    if (r.status === "cancelado") {
      lost += open;
      continue;
    }
    if (open <= 0) continue;
    const status = statusOf(r);
    if (status === "atrasado") {
      overdue += open;
    } else {
      toReceive += open;
      if (status === "parcial") partialOpen += open;
    }
  }

  return {
    expected: fromCents(expected),
    received: fromCents(received),
    toReceive: fromCents(toReceive),
    overdue: fromCents(overdue),
    partialOpen: fromCents(partialOpen),
    lost: fromCents(lost),
  };
}
