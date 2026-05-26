import { supabase } from "@/integrations/supabase/client";

export interface ContractTemplate {
  id: string;
  name: string;
  description?: string;
  active: boolean;
  is_default: boolean;
  title: string;
  body: string;
}

export interface ContractTemplatesSettings {
  templates: ContractTemplate[];
}

export type ContractTemplateRenderData = Record<string, string | number | null | undefined>;

export const CONTRACT_TEMPLATE_VARIABLES: { key: string; description: string }[] = [
  { key: "LOCADOR_NOME", description: "Nome da clínica (locador)" },
  { key: "LOCADOR_CNPJ", description: "CNPJ da clínica" },
  { key: "LOCADOR_ENDERECO", description: "Endereço da clínica" },
  { key: "LOCADOR_ASSINANTE", description: "Nome do representante do locador" },
  { key: "LOCATARIO_NOME", description: "Nome do profissional" },
  { key: "LOCATARIO_CPF", description: "CPF do profissional" },
  { key: "LOCATARIO_REGISTRO", description: "Registro profissional" },
  { key: "LOCATARIO_ESPECIALIDADE", description: "Especialidade" },
  { key: "LOCATARIO_ENDERECO", description: "Endereço do profissional" },
  { key: "LOCATARIO_EMAIL", description: "E-mail do profissional" },
  { key: "LOCATARIO_TELEFONE", description: "Telefone do profissional" },
  { key: "LOCATARIO_ASSINANTE", description: "Nome usado na assinatura do locatário" },
  { key: "SALA_RESUMO", description: "Resumo das salas (ex: Sala 4 (Seg))" },
  { key: "GRADE_HORARIOS", description: "Grade detalhada dia/hora/sala" },
  { key: "DATA_INICIO", description: "Data de início (dd/mm/aaaa)" },
  { key: "DATA_TERMINO", description: "Data de término ou prazo indeterminado" },
  { key: "VALOR_MENSAL", description: "Valor mensal (R$)" },
  { key: "DIA_VENCIMENTO", description: "Dia de vencimento" },
  { key: "DATA_ASSINATURA", description: "Data de assinatura" },
  { key: "DATA_ATUAL", description: "Data atual" },
  { key: "CLAUSULAS_ADICIONAIS", description: "Conteúdo do campo Cláusulas adicionais" },
  { key: "OBSERVACOES_INTERNAS", description: "Conteúdo do campo Observações internas" },
];

const KNOWN_KEYS = new Set(CONTRACT_TEMPLATE_VARIABLES.map((v) => v.key));

export function normalizeContractTemplates(templates: ContractTemplate[]): ContractTemplate[] {
  const list = (templates ?? []).map((t) => ({
    ...t,
    active: t.active !== false,
    is_default: !!t.is_default,
  }));
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

export async function loadContractTemplates(): Promise<ContractTemplate[]> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "contract_templates")
    .maybeSingle();
  const value = (data?.value as ContractTemplatesSettings | null) ?? null;
  return normalizeContractTemplates(value?.templates ?? []);
}

export async function saveContractTemplates(templates: ContractTemplate[]): Promise<void> {
  const normalized = normalizeContractTemplates(templates);
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
  return templates.find((t) => t.is_default && t.active) ?? null;
}

export function getTemplateById(
  templates: ContractTemplate[],
  id?: string | null,
): ContractTemplate | null {
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

export function getInitialContractTemplate(): { title: string; body: string } {
  return {
    title: "CONTRATO DE SUBLOCAÇÃO DE IMÓVEL",
    body: `IDENTIFICAÇÃO DAS PARTES

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

{{CLAUSULAS_ADICIONAIS}}

{{OBSERVACOES_INTERNAS}}

{{DATA_ATUAL}}

SUBLOCADOR: {{LOCADOR_ASSINANTE}}

SUBLOCATÁRIO: {{LOCATARIO_ASSINANTE}}`,
  };
}
