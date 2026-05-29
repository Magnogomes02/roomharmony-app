import { jsPDF } from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import {
  loadContractTemplatesSettings,
  getDefaultContractTemplate,
  getTemplateById,
  renderContractTemplate,
  DEFAULT_SIGNATURE_SETTINGS,
  type ContractTemplateRenderData,
  type SignatureSettings,
} from "@/lib/contractTemplates";
import { formatAnyDateBR, formatDateOnlyBR } from "@/lib/dateOnly";

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

// ============================================================
// Minimal HTML renderer for jsPDF
// Supports: h1-h3, p, br, hr (incl. page-break marker), ul/ol/li,
// strong/b, em/i, u, text-align via style="text-align:..."
// Special placeholders: {{BLOCO_ASSINATURAS}}, {{ASSINATURA_LOCADOR}}, {{ASSINATURA_LOCATARIO}}
// ============================================================

interface InlineRun { text: string; bold: boolean; italic: boolean; underline: boolean; }
type Align = "left" | "center" | "right" | "justify";

interface Block {
  kind: "para" | "heading" | "list" | "hr" | "pageBreak" | "signatureBlock" | "signatureParty";
  level?: 1 | 2 | 3;
  align?: Align;
  runs?: InlineRun[];
  listOrdered?: boolean;
  items?: InlineRun[][];
  party?: "locador" | "locatario";
}

function parseInline(node: Node, ctx: { bold: boolean; italic: boolean; underline: boolean }): InlineRun[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? "").replace(/\s+/g, " ");
    if (!text) return [];
    return [{ text, ...ctx }];
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === "br") return [{ text: "\n", ...ctx }];
  const nextCtx = {
    bold: ctx.bold || tag === "strong" || tag === "b",
    italic: ctx.italic || tag === "em" || tag === "i",
    underline: ctx.underline || tag === "u",
  };
  const out: InlineRun[] = [];
  el.childNodes.forEach((c) => out.push(...parseInline(c, nextCtx)));
  return out;
}

function getAlign(el: HTMLElement): Align | undefined {
  const v = (el.style?.textAlign || el.getAttribute("align") || "").toLowerCase();
  if (v === "center" || v === "right" || v === "justify" || v === "left") return v as Align;
  return undefined;
}

function htmlToBlocks(html: string): Block[] {
  // Detect special signature placeholders as standalone blocks
  const cleaned = html
    .replace(/\{\{\s*BLOCO_ASSINATURAS\s*\}\}/g, '<div data-sig="block"></div>')
    .replace(/\{\{\s*ASSINATURA_LOCADOR\s*\}\}/g, '<div data-sig="locador"></div>')
    .replace(/\{\{\s*ASSINATURA_LOCATARIO\s*\}\}/g, '<div data-sig="locatario"></div>');

  const doc = new DOMParser().parseFromString(`<div id="root">${cleaned}</div>`, "text/html");
  const root = doc.getElementById("root");
  const blocks: Block[] = [];
  if (!root) return blocks;

  const pushPara = (el: HTMLElement) => {
    const runs = parseInline(el, { bold: false, italic: false, underline: false });
    blocks.push({ kind: "para", align: getAlign(el), runs });
  };

  root.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent ?? "").trim();
      if (t) blocks.push({ kind: "para", runs: [{ text: t, bold: false, italic: false, underline: false }] });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (el.getAttribute("data-sig") === "block") {
      blocks.push({ kind: "signatureBlock" }); return;
    }
    if (el.getAttribute("data-sig") === "locador") {
      blocks.push({ kind: "signatureParty", party: "locador" }); return;
    }
    if (el.getAttribute("data-sig") === "locatario") {
      blocks.push({ kind: "signatureParty", party: "locatario" }); return;
    }

    if (tag === "hr") {
      if (el.getAttribute("data-page-break") === "true") blocks.push({ kind: "pageBreak" });
      else blocks.push({ kind: "hr" });
      return;
    }
    if (tag === "h1" || tag === "h2" || tag === "h3") {
      const lvl = Number(tag[1]) as 1 | 2 | 3;
      blocks.push({
        kind: "heading", level: lvl, align: getAlign(el),
        runs: parseInline(el, { bold: true, italic: false, underline: false }),
      });
      return;
    }
    if (tag === "ul" || tag === "ol") {
      const items: InlineRun[][] = [];
      el.querySelectorAll(":scope > li").forEach((li) => {
        items.push(parseInline(li, { bold: false, italic: false, underline: false }));
      });
      blocks.push({ kind: "list", listOrdered: tag === "ol", items });
      return;
    }
    // p, div, anything else → paragraph
    pushPara(el);
  });
  return blocks;
}

// ============================================================
// PDF layout
// ============================================================
const PAGE = { w: 595.28, h: 841.89 }; // A4 pt
const MARGIN = 56;
const CONTENT_W = PAGE.w - MARGIN * 2;
const FOOTER_RESERVE = 40;
const MM_TO_PT = 2.834645669;

function setFontFor(doc: jsPDF, run: InlineRun, size: number) {
  const style = run.bold && run.italic ? "bolditalic" : run.bold ? "bold" : run.italic ? "italic" : "normal";
  doc.setFont("helvetica", style);
  doc.setFontSize(size);
}

interface DrawCtx {
  doc: jsPDF;
  y: number;
  ensureSpace: (h: number) => void;
}

function lineHeightFor(size: number) { return size * 1.35; }

/** Build word-tokens (word + space width using current font); switch font per run. */
function drawRuns(ctx: DrawCtx, runs: InlineRun[], fontSize: number, align: Align): number {
  const { doc } = ctx;
  // First, split runs into tokens
  type Token = { text: string; run: InlineRun; w: number; isSpace: boolean; isBreak: boolean };
  const lines: Token[][] = [];
  let currentLine: Token[] = [];
  let lineW = 0;
  const spaceWidth = (run: InlineRun) => {
    setFontFor(doc, run, fontSize);
    return doc.getTextWidth(" ");
  };

  const flushLine = (justify: boolean) => {
    if (currentLine.length === 0) {
      lines.push([]); return;
    }
    // strip trailing space
    while (currentLine.length && currentLine[currentLine.length - 1].isSpace) {
      const t = currentLine.pop()!;
      lineW -= t.w;
    }
    (currentLine as Token[] & { _justify?: boolean })._justify = justify;
    (currentLine as Token[] & { _width?: number })._width = lineW;
    lines.push(currentLine);
    currentLine = [];
    lineW = 0;
  };

  for (const run of runs) {
    const parts = run.text.split(/(\n)/);
    for (const part of parts) {
      if (part === "") continue;
      if (part === "\n") { flushLine(false); continue; }
      // tokenize on whitespace
      const tokens = part.split(/(\s+)/);
      for (const t of tokens) {
        if (!t) continue;
        if (/^\s+$/.test(t)) {
          const w = spaceWidth(run);
          if (currentLine.length === 0) continue; // skip leading spaces
          currentLine.push({ text: " ", run, w, isSpace: true, isBreak: false });
          lineW += w;
          continue;
        }
        setFontFor(doc, run, fontSize);
        const w = doc.getTextWidth(t);
        if (lineW + w > CONTENT_W && currentLine.length > 0) {
          flushLine(align === "justify");
        }
        currentLine.push({ text: t, run, w, isSpace: false, isBreak: false });
        lineW += w;
      }
    }
  }
  flushLine(false);

  const lh = lineHeightFor(fontSize);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as Token[] & { _justify?: boolean; _width?: number };
    ctx.ensureSpace(lh);
    let x = MARGIN;
    const usedW = line._width ?? 0;
    let extraSpace = 0;
    if (line._justify && i < lines.length - 1 && line.length > 1) {
      const spaces = line.filter((t) => t.isSpace).length;
      if (spaces > 0) extraSpace = (CONTENT_W - usedW) / spaces;
    } else if (align === "center") {
      x = MARGIN + (CONTENT_W - usedW) / 2;
    } else if (align === "right") {
      x = MARGIN + (CONTENT_W - usedW);
    }
    for (const tok of line) {
      setFontFor(doc, tok.run, fontSize);
      ctx.doc.text(tok.text, x, ctx.y);
      const drawW = tok.w + (tok.isSpace ? extraSpace : 0);
      if (tok.run.underline && !tok.isSpace) {
        ctx.doc.setDrawColor(0);
        ctx.doc.setLineWidth(0.5);
        ctx.doc.line(x, ctx.y + 1.5, x + tok.w, ctx.y + 1.5);
      }
      x += drawW;
    }
    ctx.y += lh;
  }
  return ctx.y;
}

function drawSignatureParty(
  doc: jsPDF, x: number, y: number, w: number, sig: SignatureSettings,
  party: "locador" | "locatario", data: ContractTemplateRenderData,
): number {
  const reservedH = sig.reserved_height_mm * MM_TO_PT;
  // Reserved blank area (for digital signature/stamp)
  doc.setDrawColor(220);
  doc.setLineWidth(0.3);
  // Optional faint box outline (very subtle)
  // doc.rect(x, y, w, reservedH);
  let cy = y + reservedH;
  // Signature line
  doc.setDrawColor(80);
  doc.setLineWidth(0.6);
  doc.line(x, cy, x + w, cy);
  cy += 12;
  const label = party === "locador" ? "SUBLOCADOR" : "SUBLOCATÁRIO";
  const nameKey = party === "locador" ? "LOCADOR_ASSINANTE" : "LOCATARIO_ASSINANTE";
  const orgKey = party === "locador" ? "LOCADOR_NOME" : "LOCATARIO_NOME";
  const docKey = party === "locador" ? "LOCADOR_CNPJ" : "LOCATARIO_CPF";
  const docLabel = party === "locador" ? "CNPJ" : "CPF";

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  const name = String(data[nameKey] ?? "").trim() || "____________________";
  doc.text(`${label}: ${name}`, x + w / 2, cy, { align: "center" });
  cy += 13;
  if (sig.show_qualification) {
    const org = String(data[orgKey] ?? "").trim();
    if (org) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(org, x + w / 2, cy, { align: "center" });
      cy += 11;
    }
  }
  if (sig.show_party_document) {
    const dv = String(data[docKey] ?? "").trim();
    if (dv) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(`${docLabel}: ${dv}`, x + w / 2, cy, { align: "center" });
      cy += 11;
    }
  }
  return cy;
}

function signatureBlockHeight(sig: SignatureSettings): number {
  const reservedH = sig.reserved_height_mm * MM_TO_PT;
  const extras = 12 + 13 + (sig.show_qualification ? 11 : 0) + (sig.show_party_document ? 11 : 0);
  return reservedH + extras + 20;
}

function drawSignatureBlock(ctx: DrawCtx, sig: SignatureSettings, data: ContractTemplateRenderData) {
  const totalH = signatureBlockHeight(sig) + (sig.show_date ? 30 : 0) + (sig.layout === "stacked" ? signatureBlockHeight(sig) + 20 : 0);
  const remaining = (PAGE.h - FOOTER_RESERVE) - ctx.y;
  if (sig.force_new_page_if_needed && remaining < totalH) {
    ctx.doc.addPage();
    ctx.y = MARGIN;
  }
  ctx.y += 20;
  if (sig.show_date) {
    ctx.doc.setFont("helvetica", "normal");
    ctx.doc.setFontSize(11);
    const dateText = String(data.DATA_ASSINATURA ?? data.DATA_ATUAL ?? "");
    ctx.doc.text(dateText, MARGIN + CONTENT_W / 2, ctx.y, { align: "center" });
    ctx.y += 25;
  }
  if (sig.layout === "side_by_side") {
    const colW = (CONTENT_W - 30) / 2;
    const y1 = drawSignatureParty(ctx.doc, MARGIN, ctx.y, colW, sig, "locador", data);
    const y2 = drawSignatureParty(ctx.doc, MARGIN + colW + 30, ctx.y, colW, sig, "locatario", data);
    ctx.y = Math.max(y1, y2) + 10;
  } else {
    ctx.y = drawSignatureParty(ctx.doc, MARGIN, ctx.y, CONTENT_W, sig, "locador", data) + 25;
    ctx.y = drawSignatureParty(ctx.doc, MARGIN, ctx.y, CONTENT_W, sig, "locatario", data) + 10;
  }
}

function drawSinglePartyBlock(ctx: DrawCtx, sig: SignatureSettings, data: ContractTemplateRenderData, party: "locador" | "locatario") {
  const need = signatureBlockHeight(sig);
  const remaining = (PAGE.h - FOOTER_RESERVE) - ctx.y;
  if (sig.force_new_page_if_needed && remaining < need) {
    ctx.doc.addPage(); ctx.y = MARGIN;
  }
  ctx.y += 15;
  ctx.y = drawSignatureParty(ctx.doc, MARGIN, ctx.y, CONTENT_W, sig, party, data) + 10;
}

function renderBlocks(
  doc: jsPDF, blocks: Block[], data: ContractTemplateRenderData, sig: SignatureSettings,
): jsPDF {
  const state = { y: MARGIN };
  const ctx: DrawCtx = {
    doc,
    get y() { return state.y; },
    set y(v: number) { state.y = v; },
    ensureSpace: (h: number) => {
      if (state.y + h > PAGE.h - FOOTER_RESERVE) {
        doc.addPage();
        state.y = MARGIN;
      }
    },
  };

  // Substituir placeholders nos runs antes de desenhar
  const applyData = (runs?: InlineRun[]): InlineRun[] => {
    if (!runs) return [];
    return runs
      .map((r) => ({ ...r, text: renderContractTemplate(r.text, data) }))
      .filter((r) => r.text.length > 0);
  };

  for (const b of blocks) {
    if (b.kind === "pageBreak") { doc.addPage(); state.y = MARGIN; continue; }
    if (b.kind === "hr") {
      ctx.ensureSpace(14);
      doc.setDrawColor(180); doc.setLineWidth(0.5);
      doc.line(MARGIN, state.y, MARGIN + CONTENT_W, state.y);
      state.y += 14;
      continue;
    }
    if (b.kind === "signatureBlock") { drawSignatureBlock(ctx, sig, data); continue; }
    if (b.kind === "signatureParty") { drawSinglePartyBlock(ctx, sig, data, b.party!); continue; }
    if (b.kind === "heading") {
      const size = b.level === 1 ? 16 : b.level === 2 ? 14 : 12;
      state.y += 6;
      drawRuns(ctx, applyData(b.runs), size, b.align ?? "left");
      state.y += 4;
      continue;
    }
    if (b.kind === "list") {
      const lh = lineHeightFor(11);
      (b.items ?? []).forEach((itemRuns, i) => {
        const bullet = b.listOrdered ? `${i + 1}.` : "•";
        ctx.ensureSpace(lh);
        doc.setFont("helvetica", "normal"); doc.setFontSize(11);
        doc.text(bullet, MARGIN, state.y);
        const saveMargin = state.y;
        const x0 = MARGIN + 18;
        // temporarily render with indented width: we use a sub-renderer
        const subCtx: DrawCtx = {
          doc,
          get y() { return state.y; },
          set y(v: number) { state.y = v; },
          ensureSpace: ctx.ensureSpace,
        };
        // Quick trick: shift margin via wrapper
        const oldText = doc.text.bind(doc);
        // simpler: just draw runs with regular function but offset x via temporary CONTENT_W shrink not feasible.
        // Use simple wrap on plain text fallback:
        const plain = applyData(itemRuns).map((r) => r.text).join("");
        const wrapped = doc.splitTextToSize(plain, CONTENT_W - 18);
        for (const ln of wrapped) {
          ctx.ensureSpace(lh);
          doc.text(ln, x0, state.y);
          state.y += lh;
        }
        void saveMargin; void subCtx; void oldText;
      });
      state.y += 4;
      continue;
    }
    // paragraph
    drawRuns(ctx, applyData(b.runs), 11, b.align ?? "left");
    state.y += 4;
  }

  // Footer pagination
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`${i} / ${total}`, PAGE.w - MARGIN, PAGE.h - 20, { align: "right" });
    doc.setTextColor(0);
  }
  return doc;
}

function buildRenderData(contract: ContractPdfData, branding: ClinicBranding): ContractTemplateRenderData {
  const p = contract.professional;
  return {
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
}

async function drawHeader(doc: jsPDF, branding: ClinicBranding, title: string): Promise<number> {
  let y = MARGIN;
  if (branding.logo_url) {
    const img = await loadImageAsDataUrl(branding.logo_url);
    if (img) {
      const maxW = 120, maxH = 60;
      const ratio = Math.min(maxW / img.w, maxH / img.h);
      const w = img.w * ratio, h = img.h * ratio;
      try { doc.addImage(img.data, "PNG", MARGIN, y, w, h, undefined, "FAST"); } catch { /* ignore */ }
    }
  }
  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  if (branding.clinic_name) doc.text(branding.clinic_name, PAGE.w - MARGIN, y + 18, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  if (branding.cnpj) doc.text(`CNPJ: ${branding.cnpj}`, PAGE.w - MARGIN, y + 34, { align: "right" });
  if (branding.address) doc.text(branding.address, PAGE.w - MARGIN, y + 48, { align: "right" });
  y += 80;
  doc.setDrawColor(200); doc.line(MARGIN, y, PAGE.w - MARGIN, y);
  y += 24;

  if (title) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    const lines = doc.splitTextToSize(title, CONTENT_W);
    for (const ln of lines) {
      doc.text(ln, PAGE.w / 2, y, { align: "center" });
      y += 20;
    }
    y += 8;
  }
  return y;
}

export async function generateContractPdf(contract: ContractPdfData) {
  const branding = await getClinicBranding();
  const settings = await loadContractTemplatesSettings();
  const selected =
    getTemplateById(settings.templates, contract.template_id) ??
    getDefaultContractTemplate(settings.templates);

  if (!selected) {
    throw new Error("Nenhum modelo de contrato cadastrado. Cadastre um modelo em Preferências antes de gerar o PDF.");
  }

  const data = buildRenderData(contract, branding);
  const sig = settings.signature_settings ?? DEFAULT_SIGNATURE_SETTINGS;
  const renderedTitle = renderContractTemplate(selected.title, data).trim();

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const headerY = await drawHeader(doc, branding, renderedTitle);

  // Begin body
  const blocks = htmlToBlocks(selected.body_html);
  // We need the renderer's state to start at headerY
  const state = { y: headerY };
  const ctx: DrawCtx = {
    doc,
    get y() { return state.y; },
    set y(v: number) { state.y = v; },
    ensureSpace: (h: number) => {
      if (state.y + h > PAGE.h - FOOTER_RESERVE) { doc.addPage(); state.y = MARGIN; }
    },
  };
  // Use renderBlocks logic by inlining via the same path:
  // (Re-implement small wrapper that mirrors renderBlocks but uses our ctx initial y.)
  renderBlocksAt(ctx, blocks, data, sig);

  const fileName = `contrato-${contract.professional.full_name.replace(/\s+/g, "_")}-${contract.start_date}.pdf`;
  doc.save(fileName);
}

function renderBlocksAt(ctx: DrawCtx, blocks: Block[], data: ContractTemplateRenderData, sig: SignatureSettings) {
  // mirrors renderBlocks but accepts external ctx
  const doc = ctx.doc;
  const applyData = (runs?: InlineRun[]): InlineRun[] => {
    if (!runs) return [];
    return runs.map((r) => ({ ...r, text: renderContractTemplate(r.text, data) })).filter((r) => r.text.length > 0);
  };

  for (const b of blocks) {
    if (b.kind === "pageBreak") { doc.addPage(); ctx.y = MARGIN; continue; }
    if (b.kind === "hr") {
      ctx.ensureSpace(14);
      doc.setDrawColor(180); doc.setLineWidth(0.5);
      doc.line(MARGIN, ctx.y, MARGIN + CONTENT_W, ctx.y);
      ctx.y += 14; continue;
    }
    if (b.kind === "signatureBlock") { drawSignatureBlock(ctx, sig, data); continue; }
    if (b.kind === "signatureParty") { drawSinglePartyBlock(ctx, sig, data, b.party!); continue; }
    if (b.kind === "heading") {
      const size = b.level === 1 ? 16 : b.level === 2 ? 14 : 12;
      ctx.y += 6;
      drawRuns(ctx, applyData(b.runs), size, b.align ?? "left");
      ctx.y += 4; continue;
    }
    if (b.kind === "list") {
      const lh = lineHeightFor(11);
      (b.items ?? []).forEach((itemRuns, i) => {
        const bullet = b.listOrdered ? `${i + 1}.` : "•";
        ctx.ensureSpace(lh);
        doc.setFont("helvetica", "normal"); doc.setFontSize(11);
        doc.text(bullet, MARGIN, ctx.y);
        const plain = applyData(itemRuns).map((r) => r.text).join("");
        const wrapped = doc.splitTextToSize(plain, CONTENT_W - 18);
        for (const ln of wrapped) {
          ctx.ensureSpace(lh);
          doc.text(ln, MARGIN + 18, ctx.y);
          ctx.y += lh;
        }
      });
      ctx.y += 4; continue;
    }
    drawRuns(ctx, applyData(b.runs), 11, b.align ?? "left");
    ctx.y += 4;
  }

  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`${i} / ${total}`, PAGE.w - MARGIN, PAGE.h - 20, { align: "right" });
    doc.setTextColor(0);
  }
}

// Keep renderBlocks export-free unused warning down
void renderBlocks;
