import { supabase } from "@/integrations/supabase/client";

export interface ContractTemplate {
  id: string;
  name: string;
  description?: string;
  active: boolean;
  is_default: boolean;
  body: string;
}

export interface ContractTemplatesSettings {
  templates: ContractTemplate[];
}

export interface ContractTemplateRenderData {
  LOCADOR_NOME?: string | null;
  LOCADOR_CNPJ?: string | null;
  LOCADOR_ENDERECO?: string | null;
  LOCATARIO_NOME?: string | null;
  LOCATARIO_CPF?: string | null;
  LOCATARIO_REGISTRO?: string | null;
  LOCATARIO_ESPECIALIDADE?: string | null;
  LOCATARIO_ENDERECO?: string | null;
  LOCATARIO_EMAIL?: string | null;
  LOCATARIO_TELEFONE?: string | null;
  SALA_RESUMO?: string | null;
  GRADE_HORARIOS?: string | null;
  DATA_INICIO?: string | null;
  DATA_TERMINO?: string | null;
  VALOR_MENSAL?: string | null;
  DIA_VENCIMENTO?: string | null;
  DATA_ASSINATURA?: string | null;
  LOCADOR_ASSINANTE?: string | null;
  LOCATARIO_ASSINANTE?: string | null;
}

export const CONTRACT_TEMPLATE_PLACEHOLDERS: Array<keyof ContractTemplateRenderData> = [
  "LOCADOR_NOME", "LOCADOR_CNPJ", "LOCADOR_ENDERECO",
  "LOCATARIO_NOME", "LOCATARIO_CPF", "LOCATARIO_REGISTRO",
  "LOCATARIO_ESPECIALIDADE", "LOCATARIO_ENDERECO", "LOCATARIO_EMAIL", "LOCATARIO_TELEFONE",
  "SALA_RESUMO", "GRADE_HORARIOS",
  "DATA_INICIO", "DATA_TERMINO",
  "VALOR_MENSAL", "DIA_VENCIMENTO",
  "DATA_ASSINATURA", "LOCADOR_ASSINANTE", "LOCATARIO_ASSINANTE",
];

const LONG_FIELDS = new Set<keyof ContractTemplateRenderData>([
  "LOCADOR_NOME", "LOCADOR_ENDERECO",
  "LOCATARIO_NOME", "LOCATARIO_ENDERECO",
  "GRADE_HORARIOS", "SALA_RESUMO",
  "LOCADOR_ASSINANTE", "LOCATARIO_ASSINANTE",
]);

export async function loadContractTemplates(): Promise<ContractTemplate[]> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "contract_templates")
    .maybeSingle();
  const raw = (data?.value as ContractTemplatesSettings | null) ?? null;
  const list = Array.isArray(raw?.templates) ? raw!.templates : [];
  return list.map((t) => ({
    id: String(t.id),
    name: String(t.name ?? ""),
    description: t.description ?? "",
    active: t.active !== false,
    is_default: !!t.is_default,
    body: String(t.body ?? ""),
  }));
}

export async function saveContractTemplates(templates: ContractTemplate[]): Promise<void> {
  // Garante somente um default
  let defaultSeen = false;
  const normalized = templates.map((t) => {
    let is_default = !!t.is_default;
    if (is_default && defaultSeen) is_default = false;
    if (is_default) defaultSeen = true;
    return { ...t, is_default };
  });
  // Se nenhum default e há ativos, marca o primeiro ativo como padrão
  if (!normalized.some((t) => t.is_default)) {
    const firstActive = normalized.findIndex((t) => t.active);
    if (firstActive >= 0) normalized[firstActive].is_default = true;
  }

  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("settings").upsert({
    key: "contract_templates",
    value: { templates: normalized } as never,
    updated_by: user?.id ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });
  if (error) throw error;
}

export function getDefaultContractTemplate(templates: ContractTemplate[]): ContractTemplate | null {
  return templates.find((t) => t.is_default && t.active)
    ?? templates.find((t) => t.is_default)
    ?? templates.find((t) => t.active)
    ?? null;
}

export function getTemplateById(
  templates: ContractTemplate[],
  id?: string | null,
): ContractTemplate | null {
  if (!id) return null;
  return templates.find((t) => t.id === id) ?? null;
}

export function renderContractTemplate(
  body: string,
  data: ContractTemplateRenderData,
): string {
  return body.replace(/\{\{\s*([A-Z_][A-Z0-9_]*)\s*\}\}/g, (match, key: string) => {
    const k = key as keyof ContractTemplateRenderData;
    if (!CONTRACT_TEMPLATE_PLACEHOLDERS.includes(k)) return match;
    const raw = data[k];
    const value = raw == null ? "" : String(raw).trim();
    if (value) return value;
    return LONG_FIELDS.has(k) ? "____________________" : "—";
  });
}

export function getFallbackContractTemplateBody(): string {
  return `CLÁUSULA 1ª — OBJETO
O LOCADOR cede ao LOCATÁRIO, em regime de locação, o uso da sala denominada "{{SALA_RESUMO}}" para a prestação de serviços profissionais na área de saúde, conforme grade contratada:
{{GRADE_HORARIOS}}

CLÁUSULA 2ª — VIGÊNCIA
O presente contrato vigora de {{DATA_INICIO}} a {{DATA_TERMINO}}, podendo ser renovado mediante acordo entre as partes.

CLÁUSULA 3ª — VALOR
O valor mensal da locação é de {{VALOR_MENSAL}}, com vencimento no dia {{DIA_VENCIMENTO}} de cada mês, a ser pago conforme acordado entre as partes.

CLÁUSULA 4ª — RESPONSABILIDADE PROFISSIONAL
O LOCATÁRIO declara estar regularmente habilitado junto ao seu Conselho de Classe, sendo único responsável técnico e ético pelos atendimentos realizados no espaço.

CLÁUSULA 5ª — DISPOSIÇÕES GERAIS
O presente contrato não gera vínculo empregatício, societário ou de subordinação técnica entre as partes. O LOCATÁRIO responde integralmente por quaisquer danos causados ao imóvel ou aos equipamentos fornecidos.

Data de assinatura: {{DATA_ASSINATURA}}`;
}

export function getInitialContractTemplateBody(): string {
  return `CONTRATO DE SUBLOCAÇÃO DE IMÓVEL

IDENTIFICAÇÃO DAS PARTES

SUBLOCATÁRIO: {{LOCATARIO_NOME}}, CPF nº {{LOCATARIO_CPF}}, residente e domiciliado em {{LOCATARIO_ENDERECO}}.

SUBLOCADOR: {{LOCADOR_NOME}}, CNPJ nº {{LOCADOR_CNPJ}}, com endereço em {{LOCADOR_ENDERECO}}.

As partes acima identificadas celebram o presente Contrato de Sublocação, que se regerá pelas cláusulas e condições a seguir:

CLÁUSULA 1ª – DO OBJETO
O presente contrato tem como objeto a sublocação de sala para consultório, conforme grade contratada:
{{GRADE_HORARIOS}}
Local/resumo da sala: {{SALA_RESUMO}}.

Parágrafo único – Da natureza da atividade:
O presente contrato não tem por objeto a prestação de serviços de saúde, mas apenas a cessão de uso de sala e infraestrutura física e administrativa, em modelo de coworking de saúde. Cada profissional que utiliza o espaço é autônomo, independente e responde técnica e legalmente pelos atendimentos que realiza, em conformidade com seu conselho de classe e legislação profissional.

CLÁUSULA 2ª – DO PRAZO
O presente contrato vigora de {{DATA_INICIO}} até {{DATA_TERMINO}}, podendo ser renovado conforme acordo entre as partes.

CLÁUSULA 3ª – DO REAJUSTE
O valor do aluguel poderá ser reajustado conforme índice legalmente previsto ou mediante acordo entre as partes, desde que comunicado previamente ao SUBLOCATÁRIO.

CLÁUSULA 4ª – DO VALOR E FORMA DE PAGAMENTO
O valor mensal da sublocação é de {{VALOR_MENSAL}}, com vencimento no dia {{DIA_VENCIMENTO}} de cada mês. O pagamento poderá ser realizado conforme forma acordada entre as partes.

CLÁUSULA 5ª – DA ÁREA DE ATUAÇÃO
O SUBLOCATÁRIO declara que atuará na área de {{LOCATARIO_ESPECIALIDADE}}, conforme certificados e documentação apresentados, sendo profissional devidamente habilitado(a) e registrado(a) em seu respectivo conselho de classe.
Registro profissional: {{LOCATARIO_REGISTRO}}.

CLÁUSULA 6ª – DAS CONDIÇÕES DO IMÓVEL
O ambiente sublocado inclui sala e infraestrutura disponibilizada pelo SUBLOCADOR, devendo o SUBLOCATÁRIO zelar pelo bom uso do espaço, equipamentos e áreas comuns.

CLÁUSULA 7ª – DA RESCISÃO CONTRATUAL
Em caso de rescisão antecipada, a parte interessada deverá comunicar a outra com antecedência mínima de 30 (trinta) dias, salvo disposição específica acordada entre as partes.

CLÁUSULA 8ª – DISPOSIÇÕES GERAIS
O SUBLOCATÁRIO responde integralmente por quaisquer danos causados ao imóvel ou aos equipamentos fornecidos. O SUBLOCADOR não se responsabiliza por objetos deixados no local, nem por qualquer ocorrência decorrente dos atendimentos realizados pelo SUBLOCATÁRIO. O presente contrato não gera vínculo empregatício, societário ou de subordinação técnica entre as partes.

CLÁUSULA 9ª – DA RESPONSABILIDADE PROFISSIONAL
O SUBLOCATÁRIO declara estar regularmente habilitado e registrado junto ao seu Conselho de Classe, sendo único responsável técnico e ético pelos atendimentos realizados no espaço. O SUBLOCADOR não assume responsabilidade técnica, civil, trabalhista ou sanitária pelos serviços prestados pelo SUBLOCATÁRIO, seus clientes ou terceiros.

CLÁUSULA 10ª – DO ENQUADRAMENTO SANITÁRIO
O SUBLOCATÁRIO deverá cumprir integralmente as normas de seu Conselho de Classe e da Vigilância Sanitária, mantendo a regularidade de sua responsabilidade técnica individual, quando aplicável.

CLÁUSULA 11ª – DAS REGRAS DE USO DO ESPAÇO
O SUBLOCATÁRIO compromete-se a manter o ambiente limpo, organizado e em condições adequadas de higiene, zelando pelo bom uso do espaço e pelo respeito às normas internas.

Data de assinatura: {{DATA_ASSINATURA}}`;
}
