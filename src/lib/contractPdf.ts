import { jsPDF } from "jspdf";
import { supabase } from "@/integrations/supabase/client";

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
  if (!d) return "____/____/______";
  return new Date(d).toLocaleDateString("pt-BR");
}

function fmtBRL(v: number) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export async function generateContractPdf(contract: ContractPdfData) {
  const branding = await getClinicBranding();
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 56;
  let y = margin;

  // Header com logo
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
  doc.text(branding.clinic_name ?? "Clínica", pageW - margin, y + 18, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (branding.cnpj) doc.text(`CNPJ: ${branding.cnpj}`, pageW - margin, y + 34, { align: "right" });
  if (branding.address) doc.text(branding.address, pageW - margin, y + 48, { align: "right" });

  y += 80;
  doc.setDrawColor(200);
  doc.line(margin, y, pageW - margin, y);
  y += 24;

  // Título
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("CONTRATO DE SUBLOCAÇÃO DE IMÓVEL", pageW / 2, y, { align: "center" });
  y += 30;

  // Partes
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("LOCADOR:", margin, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  const locadorText = `${branding.clinic_name ?? "____________________"}${
    branding.cnpj ? `, CNPJ ${branding.cnpj}` : ""
  }${branding.address ? `, ${branding.address}` : ""}, neste ato representado(a) por ${contract.locador_name ?? "____________________"}.`;
  y = writeWrapped(doc, locadorText, margin, y, pageW - margin * 2, 14);

  y += 8;
  doc.setFont("helvetica", "bold");
  doc.text("LOCATÁRIO:", margin, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  const p = contract.professional;
  const locatarioText = `${p.full_name}${p.cpf ? `, CPF ${p.cpf}` : ""}${
    p.registry ? `, ${p.registry}` : ""
  }${p.specialty ? `, ${p.specialty}` : ""}${p.address ? `, residente em ${p.address}` : ""}${
    p.email || p.phone ? `, contato: ${[p.email, p.phone].filter(Boolean).join(" / ")}` : ""
  }.`;
  y = writeWrapped(doc, locatarioText, margin, y, pageW - margin * 2, 14);

  y += 16;

  // Cláusulas padrão
  doc.setFont("helvetica", "bold");
  doc.text("CLÁUSULA 1ª — OBJETO", margin, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  y = writeWrapped(
    doc,
    `O LOCADOR cede ao LOCATÁRIO, em regime de locação, o uso da sala denominada "${contract.room.name}" para a prestação de serviços profissionais na área de saúde.`,
    margin,
    y,
    pageW - margin * 2,
    14,
  );

  y += 10;
  doc.setFont("helvetica", "bold");
  doc.text("CLÁUSULA 2ª — VIGÊNCIA", margin, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  const vig = contract.end_date
    ? `O presente contrato vigora de ${fmtDate(contract.start_date)} a ${fmtDate(contract.end_date)}.`
    : `O presente contrato vigora a partir de ${fmtDate(contract.start_date)} por prazo indeterminado.`;
  y = writeWrapped(doc, vig, margin, y, pageW - margin * 2, 14);

  y += 10;
  doc.setFont("helvetica", "bold");
  doc.text("CLÁUSULA 3ª — VALOR", margin, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  y = writeWrapped(
    doc,
    `O valor mensal da locação é de ${fmtBRL(contract.monthly_value)}, a ser pago conforme acordado entre as partes.`,
    margin,
    y,
    pageW - margin * 2,
    14,
  );

  // Cláusulas adicionais
  if (contract.extra_clauses && contract.extra_clauses.trim()) {
    y += 10;
    y = ensureSpace(doc, y, pageH, margin, 40);
    doc.setFont("helvetica", "bold");
    doc.text("CLÁUSULAS ADICIONAIS", margin, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    y = writeWrapped(doc, contract.extra_clauses, margin, y, pageW - margin * 2, 14);
  }

  if (contract.notes && contract.notes.trim()) {
    y += 10;
    y = ensureSpace(doc, y, pageH, margin, 40);
    doc.setFont("helvetica", "bold");
    doc.text("OBSERVAÇÕES", margin, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    y = writeWrapped(doc, contract.notes, margin, y, pageW - margin * 2, 14);
  }

  // Assinaturas
  y += 30;
  y = ensureSpace(doc, y, pageH, margin, 140);
  doc.setFont("helvetica", "normal");
  doc.text(
    `Local e data: ____________________, ${
      contract.signed_at ? fmtDate(contract.signed_at) : fmtDate(new Date().toISOString())
    }.`,
    margin,
    y,
  );

  y += 60;
  const colW = (pageW - margin * 2 - 40) / 2;
  doc.line(margin, y, margin + colW, y);
  doc.line(margin + colW + 40, y, pageW - margin, y);
  y += 14;
  doc.setFontSize(10);
  doc.text("LOCADOR", margin + colW / 2, y, { align: "center" });
  doc.text("LOCATÁRIO", margin + colW + 40 + colW / 2, y, { align: "center" });
  y += 12;
  doc.text(contract.locador_name ?? "—", margin + colW / 2, y, { align: "center" });
  doc.text(contract.signed_by_name ?? contract.professional.full_name, margin + colW + 40 + colW / 2, y, {
    align: "center",
  });

  // Footer com paginação
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Página ${i} de ${total}`, pageW - margin, pageH - 20, { align: "right" });
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

function ensureSpace(doc: jsPDF, y: number, pageH: number, margin: number, need: number): number {
  if (y + need > pageH - margin) {
    doc.addPage();
    return margin;
  }
  return y;
}
