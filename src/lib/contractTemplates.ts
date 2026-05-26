import { supabase } from "@/integrations/supabase/client";

export interface ContractTemplate {
  id: string;
  name: string;
  description?: string;
  active: boolean;
  is_default: boolean;
  title: string;
  /** HTML do corpo do contrato (gerado pelo editor rico) */
  body_html: string;
  /** Versão em texto puro, para busca/fallback */
  body_text: string;
}

export interface SignatureSettings {
  layout: "side_by_side" | "stacked";
  show_date: boolean;
  reserved_height_mm: number;
  force_new_page_if_needed: boolean;
  show_qualification: boolean;
  show_party_document: boolean;
}

export const DEFAULT_SIGNATURE_SETTINGS: SignatureSettings = {
  layout: "side_by_side",
  show_date: true,
  reserved_height_mm: 40,
  force_new_page_if_needed: true,
  show_qualification: true,
  show_party_document: true,
};

export interface ContractTemplatesSettings {
  templates: ContractTemplate[];
  signature_settings?: SignatureSettings;
}

export type ContractTemplateRenderData = Record<string, string | number | null | undefined>;

export interface ContractVariableGroup {
  group: string;
  items: { key: string; description: string }[];
}

export const CONTRACT_TEMPLATE_VARIABLE_GROUPS: ContractVariableGroup[] = [
  {
    group: "Locador / Clínica",
    items: [
      { key: "LOCADOR_NOME", description: "Nome da clínica" },
      { key: "LOCADOR_CNPJ", description: "CNPJ da clínica" },
      { key: "LOCADOR_ENDERECO", description: "Endereço da clínica" },
      { key: "LOCADOR_ASSINANTE", description: "Representante do locador" },
    ],
  },
  {
    group: "Locatário / Profissional",
    items: [
      { key: "LOCATARIO_NOME", description: "Nome do profissional" },
      { key: "LOCATARIO_CPF", description: "CPF do profissional" },
      { key: "LOCATARIO_REGISTRO", description: "Registro profissional" },
      { key: "LOCATARIO_ESPECIALIDADE", description: "Especialidade" },
      { key: "LOCATARIO_ENDERECO", description: "Endereço do profissional" },
      { key: "LOCATARIO_EMAIL", description: "E-mail" },
      { key: "LOCATARIO_TELEFONE", description: "Telefone" },
      { key: "LOCATARIO_ASSINANTE", description: "Assinante do locatário" },
    ],
  },
  {
    group: "Contrato",
    items: [
      { key: "SALA_RESUMO", description: "Resumo das salas" },
      { key: "GRADE_HORARIOS", description: "Grade detalhada dia/hora/sala" },
      { key: "DATA_INICIO", description: "Data de início" },
      { key: "DATA_TERMINO", description: "Data de término" },
      { key: "VALOR_MENSAL", description: "Valor mensal (R$)" },
      { key: "DIA_VENCIMENTO", description: "Dia de vencimento" },
      { key: "DATA_ASSINATURA", description: "Data de assinatura" },
      { key: "DATA_ATUAL", description: "Data atual" },
    ],
  },
  {
    group: "Conteúdo complementar",
    items: [
      { key: "CLAUSULAS_ADICIONAIS", description: "Cláusulas adicionais do contrato" },
      { key: "OBSERVACOES_INTERNAS", description: "Observações internas" },
    ],
  },
  {
    group: "Assinaturas",
    items: [
      { key: "BLOCO_ASSINATURAS", description: "Bloco completo de assinaturas (padronizado)" },
      { key: "ASSINATURA_LOCADOR", description: "Apenas assinatura do locador" },
      { key: "ASSINATURA_LOCATARIO", description: "Apenas assinatura do locatário" },
    ],
  },
];

export const CONTRACT_TEMPLATE_VARIABLES = CONTRACT_TEMPLATE_VARIABLE_GROUPS.flatMap((g) => g.items);

const KNOWN_KEYS = new Set(CONTRACT_TEMPLATE_VARIABLES.map((v) => v.key));

/** Legacy helper, used internally to migrate old templates that used `body` (plain text). */
function textToHtml(text: string): string {
  if (!text) return "";
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function stripHtmlToText(html: string): string {
  if (!html) return "";
  if (typeof window !== "undefined" && "DOMParser" in window) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return (doc.body.textContent ?? "").replace(/\s+\n/g, "\n").trim();
  }
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export function normalizeContractTemplates(templates: unknown): ContractTemplate[] {
  const arr = Array.isArray(templates) ? (templates as Array<Record<string, unknown>>) : [];
  const list: ContractTemplate[] = arr.map((raw) => {
    const html = (raw.body_html as string) ?? (typeof raw.body === "string" ? textToHtml(raw.body as string) : "");
    const text = (raw.body_text as string) ?? stripHtmlToText(html);
    return {
      id: String(raw.id ?? crypto.randomUUID()),
      name: String(raw.name ?? ""),
      description: typeof raw.description === "string" ? raw.description : "",
      active: raw.active !== false,
      is_default: !!raw.is_default,
      title: String(raw.title ?? ""),
      body_html: html,
      body_text: text,
    };
  });
  const defaults = list.filter((t) => t.is_default && t.active);
  if (defaults.length > 1) {
    let seen = false;
    for (const t of list) {
      if (t.is_default && t.active) {
        if (seen) t.is_default = false;
        else seen = true;
      }
    }
  } else if (defaults.length === 0) {
    const firstActive = list.find((t) => t.active);
    if (firstActive) firstActive.is_default = true;
  }
  return list;
}

export function normalizeSignatureSettings(raw: unknown): SignatureSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<SignatureSettings>;
  const h = Number(s.reserved_height_mm ?? DEFAULT_SIGNATURE_SETTINGS.reserved_height_mm);
  return {
    layout: s.layout === "stacked" ? "stacked" : "side_by_side",
    show_date: s.show_date !== false,
    reserved_height_mm: Math.min(80, Math.max(25, Number.isFinite(h) ? h : 40)),
    force_new_page_if_needed: s.force_new_page_if_needed !== false,
    show_qualification: s.show_qualification !== false,
    show_party_document: s.show_party_document !== false,
  };
}

export async function loadContractTemplatesSettings(): Promise<ContractTemplatesSettings> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "contract_templates")
    .maybeSingle();
  const value = (data?.value as Partial<ContractTemplatesSettings> | null) ?? null;
  return {
    templates: normalizeContractTemplates(value?.templates ?? []),
    signature_settings: normalizeSignatureSettings(value?.signature_settings),
  };
}

export async function loadContractTemplates(): Promise<ContractTemplate[]> {
  const s = await loadContractTemplatesSettings();
  return s.templates;
}

export async function saveContractTemplatesSettings(settings: ContractTemplatesSettings): Promise<void> {
  const payload: ContractTemplatesSettings = {
    templates: normalizeContractTemplates(settings.templates),
    signature_settings: normalizeSignatureSettings(settings.signature_settings),
  };
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("settings").upsert({
    key: "contract_templates",
    value: payload as never,
    updated_by: user?.id ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });
  if (error) throw error;
}

export async function saveContractTemplates(templates: ContractTemplate[]): Promise<void> {
  const current = await loadContractTemplatesSettings();
  await saveContractTemplatesSettings({ ...current, templates });
}

export function getDefaultContractTemplate(templates: ContractTemplate[]): ContractTemplate | null {
  return templates.find((t) => t.is_default && t.active) ?? null;
}

export function getTemplateById(templates: ContractTemplate[], id?: string | null): ContractTemplate | null {
  if (!id) return null;
  return templates.find((t) => t.id === id) ?? null;
}

export function renderContractTemplate(text: string, data: ContractTemplateRenderData): string {
  if (!text) return "";
  return text.replace(/\{\{\s*([A-Z_][A-Z0-9_]*)\s*\}\}/g, (match, key: string) => {
    if (!KNOWN_KEYS.has(key)) return match;
    const value = data[key];
    if (value === undefined || value === null || String(value).trim() === "") {
      return "____________________";
    }
    return String(value);
  });
}

export function getInitialContractTemplate(): { title: string; body_html: string } {
  const body_html = `<p style="text-align:center"><strong>IDENTIFICAÇÃO DAS PARTES</strong></p>
<p><strong>SUBLOCATÁRIO:</strong> {{LOCATARIO_NOME}}, CPF nº {{LOCATARIO_CPF}}, residente e domiciliado em {{LOCATARIO_ENDERECO}}.</p>
<p><strong>SUBLOCADOR:</strong> {{LOCADOR_NOME}}, CNPJ nº {{LOCADOR_CNPJ}}, com endereço em {{LOCADOR_ENDERECO}}.</p>
<p>As partes acima identificadas celebram o presente Contrato de Sublocação, que se regerá pelas cláusulas e condições a seguir:</p>
<p><strong>CLÁUSULA 1ª – DO OBJETO</strong></p>
<p>O presente contrato tem como objeto a sublocação de sala para consultório, conforme grade contratada:</p>
<p>{{GRADE_HORARIOS}}</p>
<p>Local/resumo da sala: {{SALA_RESUMO}}.</p>
<p><em>Parágrafo único – Da natureza da atividade:</em> O presente contrato não tem por objeto a prestação de serviços de saúde, mas apenas a cessão de uso de sala e infraestrutura física e administrativa, em modelo de coworking de saúde. Cada profissional é autônomo e responde técnica e legalmente pelos atendimentos que realiza.</p>
<p><strong>CLÁUSULA 2ª – DO PRAZO</strong></p>
<p>O presente contrato vigora de {{DATA_INICIO}} até {{DATA_TERMINO}}, podendo ser renovado conforme acordo entre as partes.</p>
<p><strong>CLÁUSULA 3ª – DO REAJUSTE</strong></p>
<p>O valor do aluguel poderá ser reajustado conforme índice legalmente previsto ou mediante acordo entre as partes, desde que comunicado previamente ao SUBLOCATÁRIO.</p>
<p><strong>CLÁUSULA 4ª – DO VALOR E FORMA DE PAGAMENTO</strong></p>
<p>O valor mensal da sublocação é de {{VALOR_MENSAL}}, com vencimento no dia {{DIA_VENCIMENTO}} de cada mês.</p>
<p><strong>CLÁUSULA 5ª – DA ÁREA DE ATUAÇÃO</strong></p>
<p>O SUBLOCATÁRIO declara que atuará na área de {{LOCATARIO_ESPECIALIDADE}}, sendo profissional devidamente habilitado(a). Registro profissional: {{LOCATARIO_REGISTRO}}.</p>
<p><strong>CLÁUSULA 6ª – DAS CONDIÇÕES DO IMÓVEL</strong></p>
<p>O ambiente sublocado inclui sala e infraestrutura disponibilizada pelo SUBLOCADOR, devendo o SUBLOCATÁRIO zelar pelo bom uso do espaço, equipamentos e áreas comuns.</p>
<p><strong>CLÁUSULA 7ª – DA RESCISÃO CONTRATUAL</strong></p>
<p>Em caso de rescisão antecipada, a parte interessada deverá comunicar a outra com antecedência mínima de 30 (trinta) dias.</p>
<p><strong>CLÁUSULA 8ª – DISPOSIÇÕES GERAIS</strong></p>
<p>O SUBLOCATÁRIO responde integralmente por quaisquer danos causados ao imóvel ou aos equipamentos fornecidos. O presente contrato não gera vínculo empregatício, societário ou de subordinação técnica entre as partes.</p>
<p><strong>CLÁUSULA 9ª – DA RESPONSABILIDADE PROFISSIONAL</strong></p>
<p>O SUBLOCATÁRIO declara estar regularmente habilitado e registrado junto ao seu Conselho de Classe, sendo único responsável técnico e ético pelos atendimentos realizados no espaço.</p>
<p><strong>CLÁUSULA 10ª – DO ENQUADRAMENTO SANITÁRIO</strong></p>
<p>O SUBLOCATÁRIO deverá cumprir integralmente as normas de seu Conselho de Classe e da Vigilância Sanitária.</p>
<p><strong>CLÁUSULA 11ª – DAS REGRAS DE USO DO ESPAÇO</strong></p>
<p>O SUBLOCATÁRIO compromete-se a manter o ambiente limpo, organizado e em condições adequadas de higiene.</p>
<p>{{CLAUSULAS_ADICIONAIS}}</p>
<p>{{BLOCO_ASSINATURAS}}</p>`;
  return { title: "CONTRATO DE SUBLOCAÇÃO DE IMÓVEL", body_html };
}

/** Marcador HTML usado pelo editor para indicar quebra de página manual. */
export const PAGE_BREAK_MARKER = '<hr data-page-break="true" />';
