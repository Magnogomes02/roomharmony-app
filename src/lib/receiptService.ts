import { supabase } from "@/integrations/supabase/client";
import { getClinicBranding } from "@/lib/contractPdf";
import {
  loadReceiptSettings,
  renderReceiptTemplate,
} from "@/lib/receiptSettings";
import {
  buildReceiptAuthenticationCode,
  renderReceiptPdf,
  downloadReceiptPdf,
  type ReceiptPdfData,
} from "@/lib/receiptPdf";

const RECEIPTS_BUCKET = "contract-attachments";

export interface ReceiptRow {
  id: string;
  receivable_id: string;
  payment_id: string | null;
  receipt_number: string;
  status: "emitido" | "cancelado";
  issued_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  professional_name: string;
  professional_document: string | null;
  professional_email: string | null;
  professional_phone: string | null;
  professional_id: string;
  room_id: string | null;
  room_name: string | null;
  kind: string;
  reference_month: string;
  due_date: string;
  paid_at: string;
  payment_method: string | null;
  amount_due: number;
  amount_paid: number;
  clinic_name: string | null;
  clinic_cnpj: string | null;
  clinic_address: string | null;
  receipt_title: string | null;
  receipt_body: string | null;
  receipt_footer: string | null;
  receipt_path: string | null;
  authentication_code: string | null;
}

function pad(n: number, w = 2) { return String(n).padStart(w, "0"); }

function generateReceiptNumber(): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `REC-${stamp}-${rand}`;
}

function toPdfData(row: ReceiptRow, overrides?: { cancelled?: boolean }): ReceiptPdfData {
  return {
    receipt_number: row.receipt_number,
    authentication_code: row.authentication_code ?? buildReceiptAuthenticationCode(row.id, row.receipt_number),
    issued_at: row.issued_at,
    cancelled: overrides?.cancelled ?? row.status === "cancelado",
    professional_name: row.professional_name,
    professional_document: row.professional_document,
    professional_email: row.professional_email,
    professional_phone: row.professional_phone,
    kind: row.kind,
    reference_month: row.reference_month,
    due_date: row.due_date,
    paid_at: row.paid_at,
    payment_method: row.payment_method,
    amount_due: Number(row.amount_due),
    amount_paid: Number(row.amount_paid),
    room_name: row.room_name,
    notes: null,
  };
}

async function audit(action: string, entity_id: string, metadata: Record<string, unknown>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("audit_logs").insert({
    actor_id: user.id,
    action,
    entity_type: "receivable",
    entity_id,
    metadata: metadata as never,
  });
}

export async function getReceiptByReceivableId(receivableId: string): Promise<ReceiptRow | null> {
  const { data } = await supabase
    .from("receivable_receipts")
    .select("*")
    .eq("receivable_id", receivableId)
    .eq("status", "emitido")
    .maybeSingle();
  return (data as ReceiptRow | null) ?? null;
}

export async function getReceiptsByReceivableIds(ids: string[]): Promise<Map<string, ReceiptRow>> {
  const out = new Map<string, ReceiptRow>();
  if (ids.length === 0) return out;
  const { data } = await supabase
    .from("receivable_receipts")
    .select("*")
    .in("receivable_id", ids)
    .eq("status", "emitido");
  for (const r of (data ?? []) as ReceiptRow[]) out.set(r.receivable_id, r);
  return out;
}

async function resolveReceivableRoom(rec: { room_id: string | null; contract_id: string | null }): Promise<{ room_id: string | null; room_name: string | null }> {
  if (rec.room_id) {
    const { data } = await supabase.from("rooms").select("id,name").eq("id", rec.room_id).maybeSingle();
    return { room_id: rec.room_id, room_name: data?.name ?? null };
  }
  if (rec.contract_id) {
    const { data: schedules } = await supabase
      .from("contract_schedules").select("room_id").eq("contract_id", rec.contract_id);
    const uniqueIds = Array.from(new Set((schedules ?? []).map((s) => s.room_id).filter(Boolean) as string[]));
    if (uniqueIds.length === 0) return { room_id: null, room_name: null };
    const { data: rooms } = await supabase.from("rooms").select("id,name").in("id", uniqueIds);
    const names = (rooms ?? []).map((r) => r.name).filter(Boolean);
    if (uniqueIds.length === 1) {
      return { room_id: uniqueIds[0], room_name: names[0] ?? null };
    }
    return { room_id: null, room_name: names.length ? names.join(", ") : null };
  }
  return { room_id: null, room_name: null };
}

export async function createReceiptForReceivable(receivableId: string): Promise<ReceiptRow> {
  // 1. receivable
  const { data: rec, error: recErr } = await supabase
    .from("receivables").select("*").eq("id", receivableId).single();
  if (recErr || !rec) throw new Error(recErr?.message ?? "Recebível não encontrado");
  if (rec.status !== "recebido") throw new Error("O recebível precisa estar com status 'recebido'.");
  if (!rec.amount_paid || Number(rec.amount_paid) <= 0) throw new Error("Valor pago inválido.");
  if (!rec.paid_at) throw new Error("Data de pagamento ausente.");

  // 1b. block if already an active receipt exists
  const existing = await getReceiptByReceivableId(receivableId);
  if (existing) throw new Error("Já existe um recibo emitido para este recebível.");

  // 2. related
  const [{ data: prof }, resolvedRoom, branding, settings, userQ] = await Promise.all([
    supabase.from("professionals").select("*").eq("id", rec.professional_id).single(),
    resolveReceivableRoom({ room_id: rec.room_id, contract_id: rec.contract_id }),
    getClinicBranding(),
    loadReceiptSettings(),
    supabase.auth.getUser(),
  ]);
  if (!prof) throw new Error("Profissional não encontrado");

  const receiptNumber = generateReceiptNumber();
  const tempId = crypto.randomUUID();
  const authCode = buildReceiptAuthenticationCode(tempId, receiptNumber);

  // 3. insert snapshot
  const insertPayload = {
    id: tempId,
    receivable_id: rec.id,
    receipt_number: receiptNumber,
    status: "emitido",
    issued_by: userQ.data.user?.id ?? null,
    professional_id: rec.professional_id,
    professional_name: prof.full_name,
    professional_document: prof.cpf,
    professional_email: prof.email,
    professional_phone: prof.phone,
    room_id: resolvedRoom.room_id,
    room_name: resolvedRoom.room_name,
    kind: rec.kind,
    reference_month: rec.reference_month,
    due_date: rec.due_date,
    paid_at: rec.paid_at,
    payment_method: rec.payment_method,
    amount_due: rec.amount_due,
    amount_paid: rec.amount_paid,
    clinic_name: branding.clinic_name ?? null,
    clinic_cnpj: branding.cnpj ?? null,
    clinic_address: branding.address ?? null,
    receipt_title: settings.title,
    receipt_body: settings.body,
    receipt_footer: settings.footer,
    authentication_code: authCode,
  };

  const { data: inserted, error: insErr } = await supabase
    .from("receivable_receipts").insert(insertPayload).select("*").single();
  if (insErr || !inserted) throw new Error(insErr?.message ?? "Falha ao criar recibo");
  const row = inserted as ReceiptRow;

  // 4. PDF + upload
  try {
    const pdfData: ReceiptPdfData = toPdfData(row);
    const blob = await renderReceiptPdf(pdfData, branding, settings);
    const path = `receipts/${rec.id}/${row.receipt_number}.pdf`;
    const up = await supabase.storage.from(RECEIPTS_BUCKET).upload(path, blob, {
      cacheControl: "3600", upsert: true, contentType: "application/pdf",
    });
    if (!up.error) {
      await supabase.from("receivable_receipts")
        .update({ receipt_path: path }).eq("id", row.id);
      row.receipt_path = path;
    }
  } catch (e) {
    // PDF/upload failure is non-fatal; row stays so user can re-download
    console.warn("[receiptService] PDF upload falhou", e);
  }

  await audit("receivable.receipt_create", rec.id, {
    receipt_id: row.id,
    receipt_number: row.receipt_number,
    amount_paid: rec.amount_paid,
  });

  return row;
}

export async function cancelReceiptForReceivable(receivableId: string, reason: string): Promise<void> {
  const existing = await getReceiptByReceivableId(receivableId);
  if (!existing) return;
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("receivable_receipts")
    .update({
      status: "cancelado",
      cancelled_at: new Date().toISOString(),
      cancelled_by: user?.id ?? null,
      cancel_reason: reason,
    })
    .eq("id", existing.id);
  if (error) throw error;
  await audit("receivable.receipt_cancel", receivableId, {
    receipt_id: existing.id,
    receipt_number: existing.receipt_number,
    reason,
  });
}

export async function cancelReceiptById(receiptId: string, reason: string): Promise<void> {
  const { data: existing } = await supabase
    .from("receivable_receipts").select("*").eq("id", receiptId).maybeSingle();
  if (!existing) return;
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("receivable_receipts")
    .update({
      status: "cancelado",
      cancelled_at: new Date().toISOString(),
      cancelled_by: user?.id ?? null,
      cancel_reason: reason,
    })
    .eq("id", receiptId);
  if (error) throw error;
  await audit("receivable.receipt_cancel", (existing as ReceiptRow).receivable_id, {
    receipt_id: receiptId,
    receipt_number: (existing as ReceiptRow).receipt_number,
    reason,
  });
}

export async function downloadReceipt(receipt: ReceiptRow): Promise<void> {
  const triggerBlobDownload = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recibo-${receipt.receipt_number}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // 1. Try downloading the stored PDF as a Blob (avoids ERR_BLOCKED_BY_CLIENT from window.open)
  if (receipt.receipt_path) {
    try {
      const { data, error } = await supabase.storage
        .from(RECEIPTS_BUCKET).download(receipt.receipt_path);
      if (!error && data) {
        triggerBlobDownload(data);
        await audit("receivable.receipt_download", receipt.receivable_id, {
          receipt_id: receipt.id, receipt_number: receipt.receipt_number,
        });
        return;
      }
    } catch (e) {
      console.warn("[receiptService] storage download falhou, regenerando", e);
    }
  }

  // 2. Fallback: regenerate from snapshot using current branding/settings
  const [branding, settings] = await Promise.all([getClinicBranding(), loadReceiptSettings()]);
  const snapshotSettings = {
    ...settings,
    title: receipt.receipt_title ?? settings.title,
    body: receipt.receipt_body ?? settings.body,
    footer: receipt.receipt_footer ?? settings.footer,
  };
  const blob = await renderReceiptPdf(toPdfData(receipt), branding, snapshotSettings);
  triggerBlobDownload(blob);
  await audit("receivable.receipt_download", receipt.receivable_id, {
    receipt_id: receipt.id, receipt_number: receipt.receipt_number,
  });
}

// re-export to make consumers happy
export { renderReceiptTemplate, downloadReceiptPdf };
