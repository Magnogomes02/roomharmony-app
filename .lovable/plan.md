## Escopo
Evoluir o módulo Financeiro com baixa parcial, múltiplos pagamentos por recebível, recibo por pagamento, cancelamento tipado (perda de contrato × cobrança errada) e criação manual de recebíveis com recomendação de meses faltantes.

Mantém: regra atual de exclusão (sem recibo → pode excluir; com recibo → não), layout, rotas, nomes existentes, recibos antigos.

---

## 1. Banco (1 migration única)

**Tabela nova `public.receivable_payments`**
- Campos: `id`, `receivable_id` (FK cascade), `amount numeric(10,2)`, `paid_at date`, `payment_method text`, `attachment_path text`, `notes text`, `status text default 'ativo'` (`ativo|estornado|cancelado`), `created_by`, `created_at`, `reversed_at`, `reversed_by`, `reverse_reason`.
- Índices: `receivable_id`, `status`, `paid_at`.
- GRANT a `authenticated` + `service_role`. RLS:
  - SELECT: gestor OU visualizador OU profissional dono (via profiles.professional_id = receivable.professional_id).
  - INSERT/UPDATE/DELETE: apenas gestor.

**`public.receivables` — colunas opcionais**
- `cancel_type text` (`perda_contrato|cobranca_errada`)
- `cancel_reason text`
- `cancelled_at timestamptz`
- `cancelled_by uuid`
- Aceitar `status = 'parcial'` (texto, sem CHECK novo).

**`public.receivable_receipts`**
- Adicionar `payment_id uuid references receivable_payments(id)` (nullable; recibos antigos continuam válidos).

Sem constraint única bloqueando duplicidade por mês.

---

## 2. Status financeiro (`src/lib/financeStatus.ts`)
Tipo: `a_receber | parcial | recebido | atrasado | cancelado` (label "Perdido" só na UI quando `cancel_type=perda_contrato`).

Helper passa a receber também `amount_due`, `total_paid_ativo`, `cancel_type`:
- `cancelado` se status base = cancelado.
- `recebido` se total_pago ≥ amount_due.
- `atrasado` se saldo > 0 e due_date < hoje.
- `parcial` se total_pago > 0 e saldo > 0 e dentro do prazo.
- `a_receber` caso contrário.

Mantém assinatura antiga funcionando (overload / default) para não quebrar chamadas existentes.

---

## 3. Fluxo de baixa (refatorar action existente)
- "Dar baixa" passa a inserir em `receivable_payments` (não marca recebível direto).
- Após inserir, recomputar resumo do recebível:
  - `amount_paid` = soma pagamentos ativos
  - `paid_at` = max(paid_at) ativo
  - `payment_method` = do último ativo
  - `status` = derivado conforme regra acima
- Se usuário marcou "gerar recibo automaticamente", emitir recibo com `payment_id` preenchido.

Modal de baixa aceita valor menor que saldo (default = saldo aberto).

---

## 4. Estorno
- Se 1 pagamento ativo: confirmação + motivo, estorna.
- Se >1: modal lista pagamentos ativos com ações por linha.
- Ao estornar: `status=estornado`, preenche `reversed_*`, cancela recibo vinculado (se houver), recomputa recebível.

---

## 5. Cancelamento tipado
Nova ação "Cancelar recebível" pergunta motivo + tipo:
- **Perda (contrato cancelado)** → `cancel_type=perda_contrato`, vira "Perdido", saldo aberto entra como perda.
- **Cobrança errada** → `cancel_type=cobranca_errada`, não entra em previsto/recebido/perda. Se já tinha pagamento+recibo, cancela recibo e estorna pagamento na mesma transação.

Regra de exclusão atual preservada (sem recibo → DELETE).

---

## 6. Botão "Novo recebível" + modal
Botão visível só para gestor, ao lado dos filtros na aba Recebíveis.

Modal:
- Profissional (obrigatório)
- Contrato (opcional, filtrado pelo profissional, mostra status/vigência/valor)
- Tipo (auto: contrato se contrato selecionado, senão avulso)
- Ano (default atual) + Mês
- Data de vencimento (auto via `due_day`, editável)
- Valor (auto via `monthly_value`, editável)
- Sala (auto via `contract_schedules` se única)
- Observação (`notes`)

**Seção "Meses sem recebível encontrado"** (quando contrato + ano escolhidos):
- Lista 12 meses respeitando `start_date`/`end_date` do contrato.
- Marca "já existe" ou checkbox "gerar".
- Botões: "Gerar meses marcados" / "Gerar apenas mês selecionado".

**Aviso de duplicidade:** antes de cada insert, checa (professional_id, contract_id, reference_month). Se existe → modal confirma com detalhes (valor, status, vencimento). Lote: lista todos os conflitos juntos.

Insert padrão conforme spec (status `a_receber`).

---

## 7. UI tela Financeiro
- Badge novo para `parcial` (warning).
- Linha do recebível mostra "Pago R$ X de R$ Y · Saldo R$ Z" quando parcial.
- "Dar baixa" continua disponível em parcial (registra novo pagamento).
- Histórico de pagamentos: popover/accordion expansível na linha mostrando pagamentos com status e ação "Estornar".
- Aba "Perdas" continua, agora filtra `cancel_type=perda_contrato`. Cobranças erradas com recibo aparecem em aba/visão separada "Canceladas" ou filtro próprio (não em Perdas).

---

## 8. Análise financeira (`financeAnalytics.ts`)
Query passa a trazer `cancel_type` + soma de pagamentos ativos (via segunda query agregada em `receivable_payments` agrupada por `receivable_id`).
- Ignora linhas com `cancel_type=cobranca_errada`.
- Previsto = soma `amount_due` das demais.
- Recebido = soma pagamentos ativos no mês.
- A receber / Em atraso = saldo aberto por efetivo.
- Perda = saldo aberto de cancelados com `perda_contrato`.

---

## 9. Auditoria
Inserir em `audit_logs` nas ações: `receivable.manual_create`, `payment_create`, `payment_reverse`, `receipt_create`, `receipt_cancel`, `cancel_as_loss`, `cancel_as_wrong_charge`. Metadata conforme spec.

---

## 10. Ordem de execução
1. Migration (tabela + colunas + RLS + GRANT).
2. Aguardar regeneração de `types.ts`.
3. Helpers: novo `paymentsService.ts`, atualizar `financeStatus.ts`, `financeAnalytics.ts`, `receiptService.ts` (aceitar payment_id).
4. UI: modal Baixa parcial, modal Estornar (multi), modal Cancelar (tipado), modal Novo Recebível, badges/saldo na lista.
5. Build + smoke test no preview.

---

## Não-objetivos
- Não alterar criação/edição de contratos, agenda, bookings.
- Não criar constraint única para bloquear duplicidade.
- Não remover funcionalidades atuais nem quebrar recibos antigos.