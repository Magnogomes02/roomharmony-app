export type ReceivableStatus = "a_receber" | "recebido" | "atrasado" | "cancelado";

export interface ReceivableLike {
  status: ReceivableStatus;
  due_date: string;
}

/**
 * Status financeiro efetivo — regra única do sistema.
 *
 * - "recebido" / "cancelado": mantém o status original.
 * - "atrasado": mantém.
 * - "a_receber" com due_date < hoje: vira "atrasado".
 * - "a_receber" com due_date >= hoje: continua "a_receber".
 */
export function getEffectiveReceivableStatus(row: ReceivableLike): ReceivableStatus {
  if (row.status === "recebido") return "recebido";
  if (row.status === "cancelado") return "cancelado";
  if (row.status === "atrasado") return "atrasado";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(row.due_date);
  due.setHours(0, 0, 0, 0);

  if (row.status === "a_receber" && due < today) return "atrasado";
  return "a_receber";
}

export function isReceivableOverdue(row: ReceivableLike): boolean {
  return getEffectiveReceivableStatus(row) === "atrasado";
}

export function isReceivablePending(row: ReceivableLike): boolean {
  return getEffectiveReceivableStatus(row) === "a_receber";
}

export function isReceivablePaid(row: ReceivableLike): boolean {
  return getEffectiveReceivableStatus(row) === "recebido";
}
