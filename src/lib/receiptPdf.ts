import { jsPDF } from "jspdf";
import { getClinicBranding, type ClinicBranding } from "@/lib/contractPdf";
import { loadReceiptSettings, renderReceiptTemplate, type ReceiptSettings } from "@/lib/receiptSettings";

export interface ReceiptPdfData {
  receipt_number: string;
  authentication_code: string;
  issued_at: string;
  cancelled: boolean;

  professional_name: string;
  professional_document?: string | null;
  professional_email?: string | null;
  professional_phone?: string | null;

  kind: string;
  reference_month: string;
  due_date: string;
  paid_at: string;
  payment_method?: string | null;
  amount_due: number;
  amount_paid: number;
  room_name?: string | null;
  notes?: string | null;
}

function brl(v: number) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtDate(d?: string | null) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR");
}
function fmtMonth(d: string) {
  const x = new Date(d);
  return `${String(x.getMonth() + 1).padStart(2, "0")}/${x.getFullYear()}`;
}

async function loadImage(url: string): Promise<{ data: string; w: number; h: number } | null> {
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
    return { data: dataUrl, ...dims };
  } catch { return null; }
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function buildReceiptAuthenticationCode(receiptId: string, receiptNumber: string): string {
  const seed = `${receiptId}|${receiptNumber}`;
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  const hex = (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
  const up = hex.toUpperCase();
  return `${up.slice(0, 4)}-${up.slice(4, 8)}-${up.slice(8, 12)}`;
}

export async function generateReceiptPdf(d: ReceiptPdfData): Promise<Blob> {
  const [branding, settings] = await Promise.all([getClinicBranding(), loadReceiptSettings()]);
  return renderReceiptPdf(d, branding, settings);
}

export async function renderReceiptPdf(
  d: ReceiptPdfData,
  branding: ClinicBranding,
  settings: ReceiptSettings,
): Promise<Blob> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 18;
  const accent = hexToRgb(settings.accent_color || "#E8BF2F");

  let y = margin;

  // Top accent bar
  doc.setFillColor(accent[0], accent[1], accent[2]);
  doc.rect(0, 0, pageW, 4, "F");
  y = margin;

  // Header: logo + clinic info / receipt number
  const headerTop = y;
  let logoBottom = y;
  if (settings.show_logo && branding.logo_url) {
    const img = await loadImage(branding.logo_url);
    if (img) {
      const maxH = 22;
      const maxW = 50;
      const ratio = img.w / img.h;
      let h = maxH;
      let w = h * ratio;
      if (w > maxW) { w = maxW; h = w / ratio; }
      try {
        const fmt = img.data.startsWith("data:image/png") ? "PNG" : "JPEG";
        doc.addImage(img.data, fmt, margin, y, w, h);
        logoBottom = y + h;
      } catch { /* ignore */ }
    }
  }

  // Right: receipt number + issue date
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(60);
  doc.text(`Recibo nº ${d.receipt_number}`, pageW - margin, headerTop + 4, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Emitido em ${fmtDate(d.issued_at)}`, pageW - margin, headerTop + 10, { align: "right" });

  // Clinic data block
  if (settings.show_clinic_data) {
    doc.setTextColor(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    const clinicX = margin;
    let cy = Math.max(logoBottom + 4, headerTop + 4);
    if (!settings.show_logo || !branding.logo_url) cy = headerTop + 4;
    if (branding.clinic_name) {
      doc.text(branding.clinic_name, clinicX, cy);
      cy += 5;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(90);
    if (branding.cnpj) { doc.text(`CNPJ: ${branding.cnpj}`, clinicX, cy); cy += 4; }
    if (branding.address) {
      const lines = doc.splitTextToSize(branding.address, pageW - margin * 2 - 70);
      doc.text(lines, clinicX, cy);
      cy += lines.length * 4;
    }
    y = Math.max(cy, logoBottom) + 6;
  } else {
    y = Math.max(logoBottom, headerTop + 14) + 6;
  }

  // Divider
  doc.setDrawColor(accent[0], accent[1], accent[2]);
  doc.setLineWidth(0.6);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(30);
  const title = (settings.title || "RECIBO DE PAGAMENTO").toUpperCase();
  doc.text(title, pageW / 2, y, { align: "center" });
  y += 4;

  // Amount highlight
  doc.setFontSize(22);
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.text(brl(d.amount_paid), pageW / 2, y + 10, { align: "center" });
  y += 18;

  // Two-column data card
  const colW = (pageW - margin * 2 - 6) / 2;
  const cardY = y;
  const cardH = 60;
  doc.setDrawColor(220);
  doc.setFillColor(250, 250, 248);
  doc.roundedRect(margin, cardY, pageW - margin * 2, cardH, 2, 2, "FD");

  const rows: Array<[string, string]> = [
    ["Pagador", d.professional_name || "—"],
    ["Documento", d.professional_document || "—"],
    ["E-mail", d.professional_email || "—"],
    ["Telefone", d.professional_phone || "—"],
    ["Forma de pagamento", d.payment_method || "—"],
    ["Data do pagamento", fmtDate(d.paid_at)],
    ["Tipo", d.kind === "contrato" ? "Contrato" : "Avulso"],
    ["Sala", d.room_name || "—"],
    ["Mês de referência", fmtMonth(d.reference_month)],
    ["Vencimento", fmtDate(d.due_date)],
    ["Valor previsto", brl(d.amount_due)],
    ["Valor pago", brl(d.amount_paid)],
  ];

  doc.setFontSize(8.5);
  const rowH = 9;
  for (let i = 0; i < rows.length; i++) {
    const col = i % 2;
    const r = Math.floor(i / 2);
    const x = margin + 4 + col * (colW + 6);
    const ry = cardY + 6 + r * rowH;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120);
    doc.text(rows[i][0].toUpperCase(), x, ry);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(40);
    const valLines = doc.splitTextToSize(rows[i][1], colW - 6);
    doc.text(valLines[0] ?? "—", x, ry + 3.5);
  }
  y = cardY + cardH + 8;

  // Declarative body
  const placeholderData: Record<string, string | number> = {
    CLINICA_NOME: branding.clinic_name ?? "",
    CLINICA_CNPJ: branding.cnpj ?? "",
    CLINICA_ENDERECO: branding.address ?? "",
    PAGADOR_NOME: d.professional_name,
    PAGADOR_DOCUMENTO: d.professional_document ?? "",
    PAGADOR_EMAIL: d.professional_email ?? "",
    PAGADOR_TELEFONE: d.professional_phone ?? "",
    VALOR_PAGO: brl(d.amount_paid),
    VALOR_PREVISTO: brl(d.amount_due),
    DATA_PAGAMENTO: fmtDate(d.paid_at),
    FORMA_PAGAMENTO: d.payment_method ?? "",
    DATA_EMISSAO: fmtDate(d.issued_at),
    NUMERO_RECIBO: d.receipt_number,
    CODIGO_AUTENTICACAO: d.authentication_code,
    TIPO_RECEBIVEL: d.kind === "contrato" ? "Contrato" : "Avulso",
    MES_REFERENCIA: fmtMonth(d.reference_month),
    DATA_VENCIMENTO: fmtDate(d.due_date),
    SALA: d.room_name ?? "",
    REFERENCIA_DESCRICAO:
      d.kind === "contrato"
        ? `mensalidade de ${fmtMonth(d.reference_month)}${d.room_name ? ` — ${d.room_name}` : ""}`
        : `uso avulso${d.room_name ? ` — ${d.room_name}` : ""} em ${fmtDate(d.due_date)}`,
    OBSERVACAO: d.notes ?? "",
  };

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(40);
  const body = renderReceiptTemplate(settings.body || "", placeholderData);
  const bodyLines = doc.splitTextToSize(body, pageW - margin * 2);
  doc.text(bodyLines, margin, y, { align: "justify", maxWidth: pageW - margin * 2 });
  y += bodyLines.length * 5 + 8;

  // Signature line
  y += 6;
  doc.setDrawColor(180);
  doc.setLineWidth(0.3);
  const sigW = 80;
  const sigX = (pageW - sigW) / 2;
  doc.line(sigX, y, sigX + sigW, y);
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(branding.clinic_name || "Versão Saúde", pageW / 2, y + 4, { align: "center" });
  y += 12;

  // Footer
  const footerText = renderReceiptTemplate(settings.footer || "", placeholderData);
  if (footerText) {
    doc.setFontSize(8);
    doc.setTextColor(110);
    const lines = doc.splitTextToSize(footerText, pageW - margin * 2);
    doc.text(lines, pageW / 2, y, { align: "center" });
    y += lines.length * 4;
  }

  if (settings.show_authentication_code) {
    doc.setFontSize(8);
    doc.setTextColor(130);
    doc.text(`Código de autenticação: ${d.authentication_code}`, pageW / 2, y + 4, { align: "center" });
  }

  // Cancellation watermark
  if (d.cancelled) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(72);
    doc.setTextColor(220, 50, 50);
    const c = doc as unknown as { setGState?: (g: unknown) => void; GState?: new (o: unknown) => unknown };
    if (c.setGState && c.GState) {
      try { c.setGState(new c.GState({ opacity: 0.25 })); } catch { /* ignore */ }
    }
    doc.text("CANCELADO", pageW / 2, doc.internal.pageSize.getHeight() / 2, { align: "center", angle: -30 });
    if (c.setGState && c.GState) {
      try { c.setGState(new c.GState({ opacity: 1 })); } catch { /* ignore */ }
    }
  }

  return doc.output("blob");
}

export async function downloadReceiptPdf(d: ReceiptPdfData, fileName?: string): Promise<void> {
  const blob = await generateReceiptPdf(d);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName ?? `recibo-${d.receipt_number}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
