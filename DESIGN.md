---
name: Versão Saúde
description: Gestão clínica da sublocação de salas, com o acolhimento de uma recepção premium.
colors:
  dourado-acolhida: "oklch(0.78 0.14 85)"
  dourado-palido: "oklch(0.95 0.015 85)"
  dourado-sombra: "oklch(0.30 0.05 85)"
  linho-dourado: "oklch(0.92 0.04 85)"
  nogueira-noturna: "oklch(0.22 0.01 85)"
  nogueira-realce: "oklch(0.28 0.015 85)"
  nogueira-veio: "oklch(0.30 0.01 85)"
  bege-recepcao: "oklch(0.985 0.008 90)"
  papel-branco: "oklch(1 0 0)"
  areia-suave: "oklch(0.96 0.008 85)"
  junta-de-areia: "oklch(0.92 0.015 85)"
  tinta-quente: "oklch(0.18 0.005 90)"
  cinza-recado: "oklch(0.50 0.01 85)"
  verde-saude: "oklch(0.62 0.08 145)"
  ambar-aviso: "oklch(0.78 0.14 70)"
  vermelho-alerta: "oklch(0.58 0.22 27)"
typography:
  display:
    fontFamily: "Cormorant Garamond, Inter, serif"
    fontSize: "3rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Cormorant Garamond, Inter, serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Cormorant Garamond, Inter, serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.33
rounded:
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.dourado-acolhida}"
    textColor: "{colors.tinta-quente}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-outline:
    backgroundColor: "{colors.bege-recepcao}"
    textColor: "{colors.tinta-quente}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-outline-hover:
    backgroundColor: "{colors.linho-dourado}"
    textColor: "{colors.dourado-sombra}"
  button-ghost-hover:
    backgroundColor: "{colors.linho-dourado}"
    textColor: "{colors.dourado-sombra}"
  button-destructive:
    backgroundColor: "{colors.vermelho-alerta}"
    textColor: "{colors.papel-branco}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  card:
    backgroundColor: "{colors.papel-branco}"
    textColor: "{colors.tinta-quente}"
    rounded: "{rounded.xl}"
    padding: "24px"
  input:
    backgroundColor: "{colors.bege-recepcao}"
    textColor: "{colors.tinta-quente}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "36px"
  badge-outline:
    textColor: "{colors.tinta-quente}"
    rounded: "{rounded.md}"
    padding: "2px 10px"
  sidebar:
    backgroundColor: "{colors.nogueira-noturna}"
    textColor: "{colors.junta-de-areia}"
    width: "16rem"
  sidebar-item-active:
    backgroundColor: "{colors.nogueira-realce}"
    textColor: "{colors.junta-de-areia}"
---

# Design System: Versão Saúde

## Overview

**Creative North Star: "A Recepção Dourada"**

O Versão Saúde se comporta como a recepção de uma clínica premium: um balcão escuro de madeira (a sidebar em Nogueira Noturna), paredes claras e quentes (o fundo Bege Recepção) e papel branco sobre a mesa (os cards). O dourado é o gesto de atenção da recepcionista. Ele aparece onde há algo a fazer ou a notar, nunca como enfeite. Os títulos em Cormorant Garamond dão o tom de cortesia. Todo o resto, em Inter, é direto e funcional, porque o gestor está trabalhando.

É uma ferramenta de operação, então a ambição aparece como precisão: informação escaneável, estados claros, nenhum ruído. Os componentes são táteis e confiantes. Alvos de toque generosos, contraste nítido e retorno visível a cada interação importam, porque o gestor resolve conflitos e dá baixas pelo celular.

Rejeições confirmadas: nada de visual **hospitalar e frio** (azul e branco estéril) e nada de **SaaS genérico** (o cinza-azulado padrão de template shadcn). A temperatura quente, com croma sutil no hue 85 em todos os neutros, é o que separa este sistema das duas coisas.

**Key Characteristics:**
- Neutros quentes em todo lugar: até os brancos e cinzas carregam um pouco de dourado (hue 85–90).
- Um único acento, o dourado, usado como preenchimento de ação e sinal de estado ativo.
- Serifa editorial só nos títulos; interface e dados em sans.
- Profundidade por camadas tonais (bege → branco), com sombra só de apoio.
- Balcão escuro (sidebar) contra salão claro (conteúdo).

## Colors

Uma paleta de recepção: madeira escura, paredes de linho, papel branco e um único dourado de mel que guia o olhar.

### Primary
- **Dourado Acolhida** (`dourado-acolhida`): o acento único. Preenche o botão primário, o anel de foco, o ícone de marca, o item ativo da sidebar e as séries principais dos gráficos. Sobre ele, o texto é sempre Tinta Quente, nunca branco.
- **Dourado Pálido** (`dourado-palido`): fundo do botão e do badge secundários. É o dourado diluído para ações de segunda ordem.
- **Linho Dourado** (`linho-dourado`): fundo de hover em botões outline e ghost e em itens de menu. É o "toque" que confirma que o elemento responde.
- **Dourado Sombra** (`dourado-sombra`): texto sobre Linho Dourado e Dourado Pálido. É o dourado escurecido o bastante para ser lido como texto.

### Neutral
- **Bege Recepção** (`bege-recepcao`): fundo da aplicação inteira. A parede quente da sala.
- **Papel Branco** (`papel-branco`): cards, popovers e diálogos. O papel sobre a mesa.
- **Areia Suave** (`areia-suave`): superfícies "muted", como faixas de tabela, áreas de apoio e skeletons.
- **Junta de Areia** (`junta-de-areia`): bordas e contornos de campo. Também é o texto da sidebar.
- **Tinta Quente** (`tinta-quente`): texto principal e texto sobre o dourado.
- **Cinza Recado** (`cinza-recado`): texto secundário, descrições e placeholders.
- **Nogueira Noturna** (`nogueira-noturna`): o balcão, ou seja, o fundo da sidebar. **Nogueira Realce** (`nogueira-realce`) marca o hover e o item ativo nela, e **Nogueira Veio** (`nogueira-veio`) faz as divisórias.

### Semânticas
- **Verde Saúde** (`verde-saude`): recebido, ativo, concluído. É um verde dessaturado, nunca o verde-neon de sucesso.
- **Âmbar Aviso** (`ambar-aviso`): atenção e prazo próximo. Fica perto do dourado, mas puxado para o laranja (hue 70).
- **Vermelho Alerta** (`vermelho-alerta`): conflito, atraso e ações destrutivas.

### Cores de entidade
Salas e profissionais têm uma cor própria, cadastrada em `color_hex`. Quando a cor não foi cadastrada, uma paleta de reserva determinística, sempre de tons terrosos, é sorteada a partir do id: dourado, verde saúde, azul acinzentado, terracota, lilás, rosa queimado, dourado escuro e cinza (`src/lib/entityColors.ts`). Essas cores entram como borda forte com fundo translúcido (`hex` + `22`, cerca de 13% de opacidade). Elas identificam quem e onde, não comunicam estado.

### Named Rules
**A Regra do Gesto Único.** O dourado é o único acento e marca o que pede ação ou o que está ativo. Se uma tela tem dourado em tudo, ele não aponta para nada.

**A Regra do Ouro como Preenchimento.** O Dourado Acolhida tem luminosidade alta (0.78) e não tem contraste para texto pequeno sobre o Bege Recepção ou o Papel Branco. Use-o como fundo, borda ou ícone. Quando precisar de texto dourado, use o Dourado Sombra. O código atual ainda tem links em `text-primary` que violam esta regra.

**A Regra do Neutro Quente.** Nenhum neutro é cinza puro. Todo cinza novo carrega croma de 0.005 a 0.015 no hue 85–90. Cinza-azulado é a assinatura do SaaS genérico que este sistema rejeita.

## Typography

**Display Font:** Cormorant Garamond (com Inter e serif como fallback), pesos 500, 600 e 700
**Body Font:** Inter (com system-ui e -apple-system), pesos 400, 500, 600 e 700

**Character:** A Cormorant faz o papel da cortesia da recepção: elegante, levemente editorial, presente só nos títulos. A Inter faz o trabalho: números, tabelas, formulários e rótulos, sempre neutra e legível.

### Hierarchy
- **Display** (600, 3rem, 1.25): uso raro. Aparece só no título da tela de login e na página 404 (até 4.5rem).
- **Headline** (600, 1.875rem, 1.2): o título `h1` de cada página (Contratos, Financeiro, Preferências).
- **Title** (600, 1.25–1.5rem, 1.3): títulos de cards e de seções (`font-serif text-xl` / `text-2xl`). É o nível mais usado da serifa.
- **Body** (400, 0.875rem, 1.43): o texto padrão da interface, células de tabela e descrições. Os inputs usam 1rem no celular, para o iOS não dar zoom, e 0.875rem a partir de `md`.
- **Label** (500, 0.75rem, 1.33): metadados, badges, legendas e o papel do usuário na sidebar (em caixa alta e com `tracking-wide` só ali).

### Named Rules
**A Regra da Cortesia nos Títulos.** A serifa aparece em `h1` a `h4` e em títulos de card, nunca em números, valores em BRL, botões ou células de tabela. Dinheiro e horários são sempre Inter.

**A Regra dos Números Alinhados.** Colunas de valores e horários devem usar `tabular-nums`, para que somas e turnos se alinhem verticalmente.

## Layout

A estrutura é a de um app shell. À esquerda fica uma sidebar recolhível: 16rem aberta, 3rem só com ícones, e 18rem como gaveta no celular. À direita, a coluna de conteúdo tem um cabeçalho fixo de 56px (`h-14`) com fundo Bege Recepção a 80% e desfoque, e o `main` usa padding de 24px, que sobe para 32px a partir de `lg`.

- **Breakpoint principal:** 768px (`md`). Abaixo disso a sidebar vira gaveta (`useIsMobile`). Os demais breakpoints seguem o padrão do Tailwind (`sm` 640, `lg` 1024, `xl` 1280).
- **Ritmo:** a escala é de 4px. As medidas recorrentes são 8px (`gap-2`, dentro de componentes), 16px (`space-y-4`, entre blocos de um card) e 24px (o padding de card e o espaço entre cards).
- **Largura:** as páginas de operação ocupam toda a largura disponível. Só formulários e diálogos limitam a largura (`max-w-md`, `max-w-3xl`).
- **Densidade:** é média. Tabelas e grades de agenda podem ser densas (a grade semanal usa texto de 10px), mas os controles de ação mantêm 36px de altura no mínimo.

**A Regra do Bolso.** Toda ação que o gestor faz no celular (resolver conflito, dar baixa, consultar a agenda) precisa caber em uma coluna de 360px sem rolagem horizontal da página. Tabelas largas rolam dentro do próprio contêiner.

## Elevation & Depth

A profundidade vem de camadas tonais. O Papel Branco dos cards fica sobre o Bege Recepção, separado por uma borda em Junta de Areia. A sombra existe só como apoio, a `shadow` sutil padrão (`0 1px 3px rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)`). Ela nunca é a principal responsável por separar as superfícies. Popovers, menus e diálogos ganham uma sombra maior porque flutuam sobre o conteúdo.

### Shadow Vocabulary
- **Apoio** (`box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)`): cards e botões preenchidos em repouso.
- **Apoio leve** (`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)`): inputs e botões outline e secondary (`shadow-sm`).
- **Flutuante** (`box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)`): popovers, dropdowns e diálogos.

### Named Rules
**A Regra do Papel sobre a Mesa.** A separação entre superfícies vem primeiro da troca de tom (bege → branco) e da borda quente. Se for preciso aumentar a sombra para um card "aparecer", o problema está no tom ou no espaçamento.

## Shapes

Os cantos são suavemente arredondados e derivam de um raio-base de 12px (`--radius: 0.75rem`). A escala é 8px (`sm`), 10px (`md`: botões, inputs, badges), 12px (`lg`) e 16px (`xl`: cards). Os blocos de reserva na grade de agenda usam cantos mínimos (4px) e uma borda esquerda colorida (2px nos blocos, 4px nos grupos de sala), que leva a cor da entidade. Os círculos ficam restritos a pontos de cor de sala e profissional, a avatares e ao spinner de carregamento.

**A Regra da Borda que Identifica.** A borda esquerda colorida é o sinal de "a quem pertence" (sala ou profissional). Não use esse recurso para indicar estado. Estado fica com os badges e as cores semânticas.

## Components

Os componentes são táteis e confiantes: respondem a cada toque, têm contraste nítido e nunca deixam dúvida sobre o que é clicável.

### Buttons
- **Shape:** cantos suaves (10px), altura de 36px (`h-9`), 32px na variante `sm` e 40px na `lg`, com padding de 8px × 16px.
- **Primary:** fundo Dourado Acolhida, texto Tinta Quente em peso 500 e sombra de apoio. No hover, o dourado cai para 90% de opacidade.
- **Hover / Focus:** transição de cor. O foco visível é um anel de 1px em Dourado Acolhida.
- **Outline:** fundo Bege Recepção, borda Junta de Areia e sombra leve. No hover, o fundo vira Linho Dourado e o texto, Dourado Sombra.
- **Ghost:** sem fundo. No hover, o mesmo Linho Dourado.
- **Destructive:** fundo Vermelho Alerta e texto branco, para estornos, cancelamentos e exclusões.
- **Desabilitado:** 50% de opacidade e sem eventos de ponteiro.

### Chips (Badges)
- **Style:** cantos de 10px, padding de 2px × 10px e rótulo de 12px em peso 600. O badge padrão é dourado com texto Tinta Quente. O secundário usa Dourado Pálido com Dourado Sombra.
- **Estado:** os status financeiros e de reserva usam o badge outline com borda e texto na cor semântica (por exemplo, borda Vermelho Alerta a 60% para conflito). O ícone de alerta acompanha o rótulo, nunca o substitui.

### Cards / Containers
- **Corner Style:** 16px.
- **Background:** Papel Branco sobre Bege Recepção.
- **Shadow Strategy:** sombra de apoio (ver Elevation & Depth).
- **Border:** 1px em Junta de Areia, às vezes suavizada para 60%.
- **Internal Padding:** 24px. O cabeçalho tem `space-y-1.5` e título em serifa de 1.25rem com ícone dourado de 20px.

### Inputs / Fields
- **Style:** borda de 1px em Junta de Areia, fundo transparente (deixa ver o Bege Recepção ou o Papel Branco por baixo), cantos de 10px, altura de 36px e sombra leve.
- **Focus:** anel de 1px em Dourado Acolhida, sem outline nativo.
- **Error / Disabled:** desabilitado fica a 50% de opacidade. O erro é sinalizado com texto Vermelho Alerta abaixo do campo.

### Navigation
- **Sidebar:** é o balcão em Nogueira Noturna, com texto Junta de Areia e ícones de 16px ao lado de rótulos em 14px. No hover e no item ativo, o fundo vira Nogueira Realce. No topo fica a marca (quadrado dourado de 36px com cantos de 12px e o nome em serifa). No rodapé ficam o e-mail do usuário, o papel em dourado e caixa alta e o botão Sair.
- **Mobile:** abaixo de 768px a sidebar vira gaveta de 18rem, aberta pelo gatilho no cabeçalho fixo.
- **Filtragem por papel:** cada item aparece só para os papéis permitidos. Não existe item desabilitado à vista.

### Grade semanal por sala (Signature Component)
É o retrato da ocupação. Cada sala é um bloco com borda esquerda de 4px na cor da sala, um ponto colorido de 12px, o nome e a contagem de reservas. Dentro, cada reserva aparece em um mini-bloco de 10px de texto, com borda esquerda de 2px na cor do profissional, fundo translúcido, nome da sala ou turno e nome do profissional. Uma reserva em conflito ganha o ícone de alerta e o rótulo em Vermelho Alerta.

## Do's and Don'ts

### Do:
- **Do** manter um único acento: o Dourado Acolhida marca a ação principal e o estado ativo de cada tela.
- **Do** pôr texto Tinta Quente sobre o dourado, nunca branco.
- **Do** separar superfícies por tom (Papel Branco sobre Bege Recepção) e borda Junta de Areia antes de recorrer à sombra.
- **Do** reservar a Cormorant Garamond para `h1`–`h4` e títulos de card. Números, BRL, horários e botões são Inter.
- **Do** usar as cores de entidade como borda forte com fundo translúcido (cerca de 13%) para identificar salas e profissionais.
- **Do** garantir alvos de toque generosos nos fluxos que o gestor usa no celular: conflitos, baixas e agenda.

### Don't:
- **Don't** usar texto em Dourado Acolhida sobre fundo claro. Use o Dourado Sombra.
- **Don't** introduzir azul-e-branco clínico ou superfícies frias e estéreis (anti-referência confirmada: hospital frio).
- **Don't** usar o cinza-azulado neutro do template shadcn padrão. Todo neutro é quente (anti-referência confirmada: SaaS genérico).
- **Don't** usar a borda esquerda colorida para indicar estado. Ela identifica a entidade.
- **Don't** criar um segundo acento colorido para competir com o dourado. As cores semânticas (verde, âmbar, vermelho) só comunicam estado.
