import { supabase } from "@/integrations/supabase/client";

export interface ReceiptSettings {
  title: string;
  body: string;
  footer: string;
  show_logo: boolean;
  show_clinic_data: boolean;
  show_authentication_code: boolean;
  accent_color: string;
}

export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  title: "RECIBO DE PAGAMENTO",
  body: "Recebemos de {{PAGADOR_NOME}} a importância de {{VALOR_PAGO}}, referente a {{REFERENCIA_DESCRICAO}}, com pagamento realizado em {{DATA_PAGAMENTO}} via {{FORMA_PAGAMENTO}}.",
  footer: "Este recibo foi emitido eletronicamente pelo sistema Versão Saúde.",
  show_logo: true,
  show_clinic_data: true,
  show_authentication_code: true,
  accent_color: "#E8BF2F",
};

export const RECEIPT_TEMPLATE_VARIABLES: { key: string; description: string }[] = [
  { key: "CLINICA_NOME", description: "Nome da clínica" },
  { key: "CLINICA_CNPJ", description: "CNPJ da clínica" },
  { key: "CLINICA_ENDERECO", description: "Endereço da clínica" },
  { key: "PAGADOR_NOME", description: "Nome do profissional/pagador" },
  { key: "PAGADOR_DOCUMENTO", description: "CPF/CNPJ do pagador" },
  { key: "PAGADOR_EMAIL", description: "E-mail do pagador" },
  { key: "PAGADOR_TELEFONE", description: "Telefone do pagador" },
  { key: "VALOR_PAGO", description: "Valor pago formatado em R$" },
  { key: "VALOR_PREVISTO", description: "Valor previsto da parcela" },
  { key: "DATA_PAGAMENTO", description: "Data do pagamento" },
  { key: "FORMA_PAGAMENTO", description: "Forma de pagamento" },
  { key: "DATA_EMISSAO", description: "Data de emissão do recibo" },
  { key: "NUMERO_RECIBO", description: "Número do recibo" },
  { key: "CODIGO_AUTENTICACAO", description: "Código de autenticação" },
  { key: "TIPO_RECEBIVEL", description: "Contrato ou avulso" },
  { key: "MES_REFERENCIA", description: "Mês de referência (MM/AAAA)" },
  { key: "DATA_VENCIMENTO", description: "Data de vencimento original" },
  { key: "SALA", description: "Sala vinculada (se houver)" },
  { key: "REFERENCIA_DESCRICAO", description: "Descrição automática (ex.: sublocação de sala – mês/ano)" },
  { key: "OBSERVACAO", description: "Observação do recebível" },
];

export async function loadReceiptSettings(): Promise<ReceiptSettings> {
  const { data } = await supabase
    .from("settings").select("value").eq("key", "receipt_settings").maybeSingle();
  const v = (data?.value as Partial<ReceiptSettings> | null) ?? null;
  return { ...DEFAULT_RECEIPT_SETTINGS, ...(v ?? {}) };
}

export async function saveReceiptSettings(s: ReceiptSettings): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("settings").upsert({
    key: "receipt_settings",
    value: s as never,
    updated_by: user?.id ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });
  if (error) throw error;
}

export function renderReceiptTemplate(text: string, data: Record<string, string | number | null | undefined>): string {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (_m, key: string) => {
    const v = data[key];
    if (v === null || v === undefined || v === "") return "—";
    return String(v);
  });
}
