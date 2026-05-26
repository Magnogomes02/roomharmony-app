import { jsPDF } from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import {
  loadContractTemplates,
  getDefaultContractTemplate,
  getTemplateById,
  renderContractTemplate,
  type ContractTemplateRenderData,
} from "@/lib/contractTemplates";

export interface ContractPdfData {
  professional: {
    full_name: string;
    cpf?: string | null;
    registry?: string | null;
    specialty?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
  };
  room: { name: string };
  start_date: string;
  end_date?: string | null;
  monthly_value: number;
  extra_clauses?: string | null;
  notes?: string | null;
  locador_name?: string | null;
  signed_by_name?: string | null;
  signed_at?: string | null;
  template_id?: string | null;
  due_day?: number | null;
  schedules_summary?: string | null;
  schedules_detail?: string | null;
}

export interface ClinicBranding {
  clinic_name?: string;
  cnpj?: string;
  address?: string;
  logo_url?: string;
}

async function loadImageAsDataUrl(url: string): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.width, h: img.height });
      img.onerror = () => resolve({ w: 200, h: 80 });
      img.src = dataUrl;
    });
    return { data: dataUrl, w: dims.w, h: dims.h };
  } catch {
    return null;
  }
}

export async function getClinicBranding(): Promise<ClinicBranding> {
  const { data } = await supabase.from("settings").select("value").eq("key", "clinic_branding").maybeSingle();
  return ((data?.value as ClinicBranding) ?? {}) as ClinicBranding;
}

function fmtDate(d?: string | null) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR");
}

function fmtBRL(v: number) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export async function generateContractPdf(contract: ContractPdfData) {
  const branding = await getClinicBranding();
  const templates = await loadContractTemplates();
  const selected =
    getTemplateById(templates, contract.template_id) ??
    getDefaultContractTemplate(templates);

  if (!selected) {
    throw new Error(
      "Nenhum modelo de contrato cadastrado. Cadastre um modelo em Preferências antes de gerar o PDF.",
    );
  }

  const p = contract.professional;
  const data: ContractTemplateRenderData = {
    LOCADOR_NOME: branding.clinic_name ?? "",
    LOCADOR_CNPJ: branding.cnpj ?? "",
    LOCADOR_ENDERECO: branding.address ?? "",
    LOCADOR_ASSINANTE: contract.locador_name ?? "",
    LOCATARIO_NOME: p.full_name,
    LOCATARIO_CPF: p.cpf ?? "",
    LOCATARIO_REGISTRO: p.registry ?? "",
    LOCATARIO_ESPECIALIDADE: p.specialty ?? "",
    LOCATARIO_ENDERECO: p.address ?? "",
    LOCATARIO_EMAIL: p.email ?? "",
    LOCATARIO_TELEFONE: p.phone ?? "",
    LOCATARIO_ASSINANTE: contract.signed_by_name || p.full_name,
    SALA_RESUMO: contract.schedules_summary || contract.room.name,
    GRADE_HORARIOS: contract.schedules_detail || contract.room.name,
    DATA_INICIO: fmtDate(contract.start_date),
    DATA_TERMINO: contract.end_date ? fmtDate(contract.end_date) : "prazo indeterminado",
    VALOR_MENSAL: fmtBRL(contract.monthly_value),
    DIA_VENCIMENTO: contract.due_day != null ? String(contract.due_day) : "",
    DATA_ASSINATURA: contract.signed_at ? fmtDate(contract.signed_at) : fmtDate(new Date().toISOString()),
    DATA_ATUAL: fmtDate(new Date().toISOString()),
    CLAUSULAS_ADICIONAIS: contract.extra_clauses?.trim() || "",
    OBSERVACOES_INTERNAS: contract.notes?.trim() || "",
  };

  const renderedTitle = renderContractTemplate(selected.title, data).trim();
  const renderedBody = renderContractTemplate(selected.body, data);

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 56;
  let y = margin;

  // Header com logo + branding (não-jurídico, identidade visual)
  if (branding.logo_url) {
    const img = await loadImageAsDataUrl(branding.logo_url);
    if (img) {
      const maxW = 120;
      const maxH = 60;
      const ratio = Math.min(maxW / img.w, maxH / img.h);
      const w = img.w * ratio;
      const h = img.h * ratio;
      try {
        doc.addImage(img.data, "PNG", margin, y, w, h, undefined, "FAST");
      } catch {
        // ignore
      }
    }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  if (branding.clinic_name) {
    doc.text(branding.clinic_name, pageW - margin, y + 18, { align: "right" });
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (branding.cnpj) doc.text(`CNPJ: ${branding.cnpj}`, pageW - margin, y + 34, { align: "right" });
  if (branding.address) doc.text(branding.address, pageW - margin, y + 48, { align: "right" });

  y += 80;
  doc.setDrawColor(200);
  doc.line(margin, y, pageW - margin, y);
  y += 24;

  // Título — vindo do modelo
  if (renderedTitle) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    const titleLines = doc.splitTextToSize(renderedTitle, pageW - margin * 2);
    for (const line of titleLines) {
      doc.text(line, pageW / 2, y, { align: "center" });
      y += 20;
    }
    y += 10;
  }

  // Corpo — vindo do modelo, preservando quebras de linha
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const paragraphs = renderedBody.split(/\n/);
  for (const para of paragraphs) {
    if (para.trim() === "") {
      y += 8;
      if (y > pageH - margin) { doc.addPage(); y = margin; }
      continue;
    }
    y = writeWrapped(doc, para, margin, y, pageW - margin * 2, 14);
  }

  // Footer com paginação
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`${i} / ${total}`, pageW - margin, pageH - 20, { align: "right" });
    doc.setTextColor(0);
  }

  const fileName = `contrato-${contract.professional.full_name.replace(/\s+/g, "_")}-${contract.start_date}.pdf`;
  doc.save(fileName);
}

function writeWrapped(doc: jsPDF, text: string, x: number, y: number, maxWidth: number, lineH: number): number {
  const lines = doc.splitTextToSize(text, maxWidth);
  const pageH = doc.internal.pageSize.getHeight();
  for (const line of lines) {
    if (y > pageH - 80) {
      doc.addPage();
      y = 56;
    }
    doc.text(line, x, y);
    y += lineH;
  }
  return y;
}
