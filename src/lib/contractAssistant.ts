import { CONTRACT_TEMPLATE_VARIABLES } from "@/lib/contractTemplates";

/**
 * Regras compartilhadas do Assistente de contratos (navegador e servidor):
 * atalhos, limite diário, variáveis permitidas, limpeza do HTML gerado e
 * verificação de variáveis desconhecidas.
 */

export const ASSISTANT_DAILY_LIMIT = 30;
export const ASSISTANT_AUDIT_ACTION = "ai.contract_assist";
export const ASSISTANT_MAX_REQUEST = 1000;
export const ASSISTANT_MAX_SELECTION = 6000;

export type AssistantMode = "draft" | "improve";

export interface AssistantShortcut {
  id: string;
  label: string;
  request: string;
}

export const ASSISTANT_SHORTCUTS: AssistantShortcut[] = [
  {
    id: "rescisao",
    label: "Multa e rescisão antecipada",
    request:
      "Cláusula de rescisão antecipada pelas partes, com aviso prévio por escrito, multa rescisória proporcional ao período restante e hipóteses de rescisão imediata por descumprimento.",
  },
  {
    id: "biosseguranca",
    label: "Lixo hospitalar e biossegurança",
    request:
      "Cláusula sobre descarte de resíduos de serviços de saúde e biossegurança, com responsabilidade do locatário pela segregação e acondicionamento, conforme normas sanitárias vigentes.",
  },
  {
    id: "lgpd",
    label: "Sigilo profissional e LGPD",
    request:
      "Cláusula de sigilo profissional e proteção de dados pessoais (LGPD), cobrindo prontuários, dados de pacientes, responsabilidade de cada parte como controladora e uso das instalações sem acesso do locador aos dados clínicos.",
  },
  {
    id: "turnos",
    label: "Atraso e tolerância entre turnos",
    request:
      "Cláusula sobre pontualidade no uso da sala por turno, tolerância de atraso na entrada e na saída, desocupação da sala ao fim do turno e consequências do uso fora do horário contratado.",
  },
  {
    id: "conservacao",
    label: "Conservação do consultório e aparelhos",
    request:
      "Cláusula de conservação do consultório, mobiliário e aparelhos, com dever de uso adequado, comunicação de danos, responsabilidade por reparos causados por mau uso e vistoria.",
  },
];

/** Variáveis oficiais do sistema que a IA pode usar. */
export const ASSISTANT_VARIABLE_KEYS: readonly string[] = CONTRACT_TEMPLATE_VARIABLES.map((v) => v.key);

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Variáveis {{X}} presentes no texto que não existem no sistema. */
export function findUnknownPlaceholders(html: string): string[] {
  const known = new Set(ASSISTANT_VARIABLE_KEYS);
  const unknown = new Set<string>();
  for (const m of html.matchAll(PLACEHOLDER_RE)) {
    if (!known.has(m[1])) unknown.add(m[1]);
  }
  return [...unknown];
}

/** Troca variáveis desconhecidas por um campo a preencher: {{CAUCAO}} → [CAUCAO]. */
export function replaceUnknownPlaceholders(html: string): string {
  const known = new Set(ASSISTANT_VARIABLE_KEYS);
  return html.replace(PLACEHOLDER_RE, (full, key: string) => (known.has(key) ? full : `[${key}]`));
}

/** Remove cercas de código que alguns modelos colocam em volta do HTML. */
export function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

const ALLOWED: Record<string, string> = {
  P: "p",
  H1: "h3",
  H2: "h3",
  H3: "h3",
  H4: "h3",
  STRONG: "strong",
  B: "strong",
  EM: "em",
  I: "em",
  U: "u",
  UL: "ul",
  OL: "ol",
  LI: "li",
  BR: "br",
};

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Mantém só parágrafos, subtítulos, negrito, itálico, sublinhado e listas,
 * sem nenhum atributo. Qualquer outra marcação é descartada (o texto dentro
 * dela é preservado; scripts e estilos são removidos por inteiro). Só roda
 * no navegador (usa DOMParser).
 */
export function sanitizeAssistantHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeText(node.textContent ?? "");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as Element;
    if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "TEMPLATE", "HEAD"].includes(el.tagName)) return "";
    const inner = [...el.childNodes].map(walk).join("");
    const tag = ALLOWED[el.tagName];
    if (!tag) return inner;
    if (tag === "br") return "<br>";
    return `<${tag}>${inner}</${tag}>`;
  };
  const out = [...doc.body.childNodes].map(walk).join("").trim();
  // texto solto vira parágrafo, para o editor e o PDF tratarem igual
  return /^<(p|h3|ul|ol)>/.test(out) ? out : `<p>${out}</p>`;
}
