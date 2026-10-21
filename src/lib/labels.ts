/** Rótulos em português para códigos internos que aparecem na interface. */

export const BOOKING_STATUS_LABELS: Record<string, string> = {
  ativa: "Ativa",
  conflito: "Em conflito",
  realocada: "Realocada",
  cancelada: "Cancelada",
};

export const BOOKING_SOURCE_LABELS: Record<string, string> = {
  recorrencia: "Recorrência",
  realocacao: "Realocação",
  avulsa: "Avulsa",
  manutencao: "Manutenção",
};

export const CONTRACT_STATUS_LABELS: Record<string, string> = {
  rascunho: "Rascunho",
  ativo: "Ativo",
  encerrado: "Encerrado",
  cancelado: "Cancelado",
};

export const CONFLICT_STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente",
  resolvido: "Resolvido",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  ativo: "Ativo",
  estornado: "Estornado",
  cancelado: "Cancelado",
};

export const RECEIVABLE_STATUS_LABELS: Record<string, string> = {
  a_receber: "A receber",
  parcial: "Parcial",
  recebido: "Recebido",
  atrasado: "Em atraso",
  cancelado: "Cancelado",
};

export const RECEIVABLE_KIND_LABELS: Record<string, string> = {
  contrato: "Contrato",
  avulso: "Avulso",
};

/** Rótulo do mapa, ou o próprio código com a primeira letra maiúscula. */
export function labelOf(map: Record<string, string>, code: string | null | undefined): string {
  if (!code) return "—";
  return map[code] ?? capitalizeFirst(code);
}

/** "outubro de 2026" → "Outubro de 2026" (o CSS capitalize maiusculava todas as palavras). */
export function capitalizeFirst(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1) : text;
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  "booking.batch_reallocate": "Reservas realocadas em lote",
  "booking.cancel": "Reserva cancelada",
  "booking.create": "Reserva criada",
  "booking.generate": "Agenda gerada dos contratos",
  "booking.reallocate": "Reserva realocada",
  "conflict.adjust": "Conflito ajustado",
  "conflict.cancel_occurrence": "Conflito resolvido com cancelamento",
  "conflict.manual_resolve": "Conflito marcado como resolvido",
  "ai.contract_assist": "Assistente de contratos usado",
  "ai.provider_limit": "Limite de IA atingido",
  "contract.attachment_delete": "Anexo de contrato excluído",
  "contract.attachment_upload": "Anexo de contrato enviado",
  "contract.cancel": "Contrato cancelado",
  "contract.create": "Contrato criado",
  "contract.delete": "Contrato excluído",
  "contract.pdf_download": "PDF do contrato baixado",
  "contract.update": "Contrato atualizado",
  "payable.create": "Conta a pagar criada",
  "payable.payment_create": "Pagamento de conta registrado",
  "payable.payment_reverse": "Pagamento de conta estornado",
  "payable.partial_remaining_due_set": "Saldo de conta reagendado",
  "payable.overpayment_credit_next": "Excedente de conta virou crédito",
  "professional.create": "Profissional cadastrado",
  "professional.update": "Profissional atualizado",
  "professional.toggle_active": "Profissional ativado/inativado",
  "receivable.cancel_as_loss": "Recebível cancelado como perda",
  "receivable.cancel_as_wrong_charge": "Recebível cancelado como cobrança errada",
  "receivable.delete": "Recebível excluído",
  "receivable.edit": "Recebível editado",
  "receivable.manual_create": "Recebível criado manualmente",
  "receivable.overpayment_credit_next": "Excedente virou crédito",
  "receivable.overpayment_current_fee": "Excedente virou taxa",
  "receivable.partial_remaining_due_set": "Saldo reagendado",
  "receivable.payment_create": "Pagamento registrado",
  "receivable.payment_reverse": "Pagamento estornado",
  "receivable.receipt_cancel": "Recibo cancelado",
  "receivable.receipt_create": "Recibo emitido",
  "receivable.receipt_download": "Recibo baixado",
  "room.create": "Sala cadastrada",
  "room.update": "Sala atualizada",
  "room.toggle_active": "Sala ativada/inativada",
};

const AUDIT_ENTITY_LABELS: Record<string, string> = {
  booking: "Reserva",
  conflict: "Conflito",
  contract: "Contrato",
  payable: "Conta a pagar",
  professional: "Profissional",
  receivable: "Recebível",
  room: "Sala",
};

/** "receivable.payment_create" → "Pagamento registrado". */
export function auditActionLabel(action: string): string {
  if (AUDIT_ACTION_LABELS[action]) return AUDIT_ACTION_LABELS[action];
  const [entity] = action.split(".");
  return `${AUDIT_ENTITY_LABELS[entity] ?? "Sistema"}: ação registrada`;
}

export function auditEntityLabel(entityType: string): string {
  return AUDIT_ENTITY_LABELS[entityType] ?? entityType;
}
