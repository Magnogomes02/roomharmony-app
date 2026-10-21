# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

O usuário principal é o **gestor do espaço**: o dono ou administrador da clínica Versão Saúde, que subloca salas (consultórios) para profissionais de saúde. Ele usa o sistema todo dia para montar contratos, acompanhar a ocupação das salas, resolver conflitos de agenda, realocar profissionais e cuidar do caixa.

Perfis secundários, de acesso mais restrito:
- **Profissional**: o locatário da sala. Consulta o próprio dashboard, os próprios contratos e o calendário.
- **Visualizador**: acesso somente leitura a dashboard, profissionais, salas, contratos, calendário e financeiro.

## Product Purpose

Centralizar a operação da sublocação de salas de uma clínica: quem ocupa qual sala, em qual turno, sob qual contrato, e se o dinheiro desse arranjo está entrando e saindo como deveria. Dá certo quando o gestor sabe, sem planilha paralela, quem está em qual sala hoje e nesta semana, o que está pendente de receber e de pagar, e quais conflitos precisam de decisão.

## Positioning

É uma ferramenta interna feita para uma clínica específica, não um produto comercial. O modelo de dados segue a operação real do espaço: salas alugadas por turno (manhã, tarde e noite, com horários configuráveis), contratos de sublocação que geram reservas e recebíveis, e um financeiro com baixa parcial, crédito de pagamento excedente, estorno e cancelamento tipado.

## Operating Context

- Usado no **desktop e no celular**. O gestor resolve coisas pelo celular com frequência (conflitos, baixas de pagamento, agenda), então os fluxos principais precisam funcionar bem nas duas telas.
- Idioma e formatos: português do Brasil, moeda BRL, datas dd/mm/aaaa, semana começando na segunda-feira.
- Áreas: Dashboard, Profissionais, Salas, Contratos, Calendário, Conflitos, Realocação, Financeiro (recebíveis, contas a pagar, análise financeira), Preferências, Auditoria, além de notificações.
- Documentos gerados: contratos de sublocação em PDF (modelo editável em texto rico) e recibos de pagamento em PDF.
- Os contratos registram evidências da assinatura digital (e-mail, GPS, user agent).

## Capabilities and Constraints

- Stack: TanStack Start (React 19) + Vite, Tailwind v4, componentes shadcn/Radix, Supabase (Postgres com RLS, auth, storage), deploy em Cloudflare (wrangler). O projeto também é editado pelo Lovable.
- Os papéis `gestor`, `profissional` e `visualizador` controlam a navegação e o RLS. Escrita é praticamente toda do gestor.
- Turnos: `manha`, `tarde` e `noite`, com horários padrão definidos em Preferências.
- Status de recebíveis: a receber, parcial, recebido, atrasado e cancelado. O cancelamento é tipado como perda de contrato ou cobrança errada.
- Regra preservada: um recebível sem recibo pode ser excluído; com recibo, não.
- O cadastro público está desligado. O acesso é concedido pelo gestor.
- Os dados de branding da clínica (logo) ficam em Preferências, no bucket `clinic-assets`.

## Brand Commitments

- Nome: **Versão Saúde**, com o descritor "Gestão clínica".
- Toda a interface é escrita em português do Brasil.
- O logo é enviado pela clínica em Preferências. O ícone `Sparkles` usado hoje no cabeçalho é um placeholder, não um ativo de marca.

## Evidence on Hand

- O modelo de contrato fica em `src/lib/contractTemplates.ts` ("CONTRATO DE SUBLOCAÇÃO DE IMÓVEL").
- Os planos de escopo do módulo financeiro ficam em `.lovable/plan.md`.
- Não há depoimentos, métricas públicas nem material de marketing. Como é uso interno, nada disso deve ser inventado.

## Product Principles

1. **O gestor opera, o sistema confirma.** Toda tela é uma ferramenta de trabalho. Clareza, velocidade e informação fácil de escanear vêm antes de expressão visual.
2. **Dinheiro e agenda não podem mentir.** Saldos, status e ocupação precisam bater com a realidade. Ações destrutivas ou financeiras são explícitas, reversíveis quando possível e ficam registradas na auditoria.
3. **Decidir de qualquer lugar.** Conflitos, baixas e consultas de agenda precisam ser resolvíveis no celular, não só no desktop.
4. **Cada papel vê só o que é seu.** Profissionais e visualizadores têm uma visão enxuta e segura. O gestor tem a visão completa.
