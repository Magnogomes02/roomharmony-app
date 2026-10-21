import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  ASSISTANT_AUDIT_ACTION,
  ASSISTANT_DAILY_LIMIT,
  ASSISTANT_MAX_REQUEST,
  ASSISTANT_MAX_SELECTION,
  ASSISTANT_SHORTCUTS,
  stripCodeFences,
} from "@/lib/contractAssistant";
import { CONTRACT_TEMPLATE_VARIABLES } from "@/lib/contractTemplates";

/**
 * Assistente de contratos: roda só no servidor. A chave do Gemini
 * (GEMINI_API_KEY) e as instruções do modelo nunca chegam ao navegador.
 * Só gestores usam; limite diário por gestor contado na auditoria.
 */

export type AssistantErrorCode =
  | "forbidden"
  | "limit"
  | "not_configured"
  | "provider_quota"
  | "provider_key"
  | "provider_blocked"
  | "provider_error"
  | "empty";

export type AssistantResult =
  | { ok: true; html: string; used: number; limit: number }
  | { ok: false; code: AssistantErrorCode; message: string; used?: number; limit?: number };

export interface AssistantUsage {
  used: number;
  limit: number;
  configured: boolean;
  isGestor: boolean;
}

// modelo estável atual; GEMINI_MODEL (segredo opcional) troca sem mexer no código
const DEFAULT_MODELS = ["gemini-3.8-flash", "gemini-flash-latest"];

function startOfClinicDayIso(): string {
  // Recife: UTC-3, sem horário de verão
  const local = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return `${local}T00:00:00-03:00`;
}

type Db = SupabaseClient<Database>;

async function isGestor(supabase: Db, userId: string): Promise<boolean> {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "gestor" });
  return data === true;
}

async function usedToday(supabase: Db, userId: string): Promise<number> {
  const { count } = await supabase
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("actor_id", userId)
    .eq("action", ASSISTANT_AUDIT_ACTION)
    .gte("created_at", startOfClinicDayIso());
  return count ?? 0;
}

function systemInstruction(): string {
  const vars = CONTRACT_TEMPLATE_VARIABLES.map((v) => `{{${v.key}}} — ${v.description}`).join("\n");
  return [
    "Você é um assistente de redação jurídica para uma clínica de saúde no Brasil que subloca salas (consultórios) a profissionais de saúde por turno (manhã, tarde e noite).",
    "Escreva em português do Brasil, com linguagem jurídica formal, clara e objetiva, coerente com a legislação brasileira aplicável (Código Civil, LGPD e normas sanitárias, quando pertinentes). Não cite números de artigos ou de normas se não tiver certeza deles.",
    "As partes são o LOCADOR (a clínica) e o LOCATÁRIO (o profissional).",
    "FORMATO: responda SOMENTE com HTML, usando apenas as tags <h3>, <p>, <strong>, <em>, <ul>, <ol> e <li>, sem atributos. Sem markdown, sem ``` e sem comentários ou explicações fora do texto da cláusula.",
    "Comece com um subtítulo <h3> no formato 'CLÁUSULA — TÍTULO EM MAIÚSCULAS', sem número (o gestor numera no contrato). Use parágrafos e itens curtos.",
    "VARIÁVEIS: use apenas as variáveis abaixo, exatamente como escritas, quando o dado fizer sentido. Nunca invente variáveis. Se precisar de um valor que não está na lista (por exemplo, valor de caução ou prazo específico), escreva um campo a preencher entre colchetes, como [VALOR DA CAUÇÃO].",
    vars,
    "Nunca inclua nomes, CPF, CNPJ, endereços ou valores reais; use as variáveis ou campos entre colchetes.",
  ].join("\n\n");
}

const inputSchema = z.object({
  mode: z.enum(["draft", "improve"]),
  request: z.string().trim().max(ASSISTANT_MAX_REQUEST).default(""),
  shortcutId: z.string().max(40).optional(),
  selection: z.string().max(ASSISTANT_MAX_SELECTION).optional(),
  variation: z.number().int().min(0).max(20).default(0),
});

function userPrompt(input: z.infer<typeof inputSchema>): string {
  const shortcut = ASSISTANT_SHORTCUTS.find((s) => s.id === input.shortcutId);
  const ask = input.request || shortcut?.request || "";
  const variation =
    input.variation > 0
      ? "\n\nOfereça uma redação alternativa à anterior, com outra estrutura de parágrafos, mantendo o mesmo conteúdo jurídico."
      : "";
  if (input.mode === "improve") {
    return [
      "Reescreva o trecho de contrato abaixo com linguagem jurídica mais precisa e clara.",
      "Preserve o sentido, as obrigações, os valores e TODAS as variáveis {{...}} existentes. Não acrescente obrigações novas.",
      "Se o trecho não tiver um subtítulo, não crie um; devolva apenas o texto reescrito em <p> (e listas, se houver).",
      ask ? `Orientação do gestor: ${ask}` : "",
      `TRECHO:\n${input.selection ?? ""}`,
    ]
      .filter(Boolean)
      .join("\n\n") + variation;
  }
  return `Redija uma cláusula contratual para: ${ask}${variation}`;
}

async function callGemini(apiKey: string, prompt: string, temperature: number) {
  const models = [process.env.GEMINI_MODEL, ...DEFAULT_MODELS].filter(Boolean) as string[];
  let last: { status: number; body: string } = { status: 0, body: "" };
  for (const model of models) {
    const res = await fetch(
      `${process.env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com"}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction() }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens: 4096 },
        }),
        signal: AbortSignal.timeout(45_000),
      },
    );
    const body = await res.text();
    // modelo inexistente para esta chave: tenta o próximo da lista
    if (res.status === 404) {
      last = { status: res.status, body };
      continue;
    }
    return { status: res.status, body };
  }
  return last;
}

export const askContractAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data, context }): Promise<AssistantResult> => {
    const { supabase, userId } = context;
    if (!(await isGestor(supabase, userId))) {
      return { ok: false, code: "forbidden", message: "O Assistente de contratos é exclusivo para gestores." };
    }
    if (data.mode === "improve" && !data.selection?.trim()) {
      return { ok: false, code: "empty", message: "Selecione no editor o trecho que deseja aprimorar." };
    }
    if (data.mode === "draft" && !data.request && !data.shortcutId) {
      return { ok: false, code: "empty", message: "Descreva a cláusula ou escolha um atalho." };
    }

    const used = await usedToday(supabase, userId);
    if (used >= ASSISTANT_DAILY_LIMIT) {
      return {
        ok: false,
        code: "limit",
        message: `Você usou os ${ASSISTANT_DAILY_LIMIT} pedidos de hoje. O limite renova à meia-noite.`,
        used,
        limit: ASSISTANT_DAILY_LIMIT,
      };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        code: "not_configured",
        message: "O assistente ainda não está configurado: falta o segredo GEMINI_API_KEY no servidor.",
      };
    }

    let result: { status: number; body: string };
    try {
      result = await callGemini(apiKey, userPrompt(data), data.variation > 0 ? 0.8 : 0.4);
    } catch {
      return { ok: false, code: "provider_error", message: "O Gemini demorou demais para responder. Tente de novo." };
    }

    if (result.status === 429) {
      return {
        ok: false,
        code: "provider_quota",
        message: "O limite gratuito do Gemini foi atingido por agora. Tente de novo em alguns minutos.",
      };
    }
    if (result.status === 400 && /API_KEY_INVALID|API key not valid/i.test(result.body)) {
      return { ok: false, code: "provider_key", message: "A chave do Gemini não é válida. Confira o segredo GEMINI_API_KEY." };
    }
    if (result.status === 401 || result.status === 403) {
      return { ok: false, code: "provider_key", message: "A chave do Gemini foi recusada. Confira o segredo GEMINI_API_KEY." };
    }
    if (result.status < 200 || result.status >= 300) {
      console.error("[contractAssistant] Gemini", result.status, result.body.slice(0, 500));
      return { ok: false, code: "provider_error", message: "O Gemini não conseguiu responder agora. Tente de novo." };
    }

    let html = "";
    try {
      const json = JSON.parse(result.body) as {
        promptFeedback?: { blockReason?: string };
        candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
      };
      if (json.promptFeedback?.blockReason || json.candidates?.[0]?.finishReason === "SAFETY") {
        return {
          ok: false,
          code: "provider_blocked",
          message: "O Gemini recusou este pedido. Reformule com outras palavras.",
        };
      }
      html = stripCodeFences((json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join(""));
    } catch {
      html = "";
    }
    if (!html) {
      return { ok: false, code: "empty", message: "O Gemini devolveu uma resposta vazia. Tente de novo." };
    }

    // registra o uso (sem guardar o texto); é também o contador do limite diário
    await supabase.from("audit_logs").insert({
      actor_id: userId,
      action: ASSISTANT_AUDIT_ACTION,
      entity_type: "contract",
      entity_id: null,
      metadata: {
        mode: data.mode,
        shortcut: data.shortcutId ?? null,
        variation: data.variation,
        chars: html.length,
      },
    });

    return { ok: true, html, used: used + 1, limit: ASSISTANT_DAILY_LIMIT };
  });

export const getContractAssistantUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AssistantUsage> => {
    const { supabase, userId } = context;
    const gestor = await isGestor(supabase, userId);
    return {
      used: gestor ? await usedToday(supabase, userId) : 0,
      limit: ASSISTANT_DAILY_LIMIT,
      configured: Boolean(process.env.GEMINI_API_KEY),
      isGestor: gestor,
    };
  });
