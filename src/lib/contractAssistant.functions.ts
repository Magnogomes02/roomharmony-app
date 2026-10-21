import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  ASSISTANT_AUDIT_ACTION,
  ASSISTANT_LIMIT_AUDIT_ACTION,
  ASSISTANT_MAX_REQUEST,
  ASSISTANT_MAX_SELECTION,
  ASSISTANT_SHORTCUTS,
  PROVIDER_NAME,
  releaseLabel,
  stripCodeFences,
  type AssistantChoice,
  type AssistantProvider,
} from "@/lib/contractAssistant";
import { CONTRACT_TEMPLATE_VARIABLES } from "@/lib/contractTemplates";

/**
 * Assistente de contratos: roda só no servidor. A chave do Gemini
 * (GEMINI_API_KEY) e as instruções do modelo nunca chegam ao navegador.
 * Só gestores usam. Não há limite nosso: os limites são os do Google e do
 * Groq. Quando um limite do dia é atingido, isso vai para a auditoria e a IA
 * fica marcada como esgotada até liberar, para todos os gestores.
 */

export type AssistantErrorCode =
  | "forbidden"
  | "limit"
  | "not_configured"
  | "provider_quota"
  | "provider_limit"
  | "provider_key"
  | "provider_blocked"
  | "provider_region"
  | "provider_model"
  | "provider_error"
  | "empty";

export type { AssistantChoice, AssistantProvider };
export interface ProviderState {
  /** pedidos deste gestor hoje, só informativo */
  used: number;
  configured: boolean;
  /** limite do dia atingido; liberado a partir deste horário (ISO) */
  exhaustedUntil?: string;
  /** saldo do dia informado pelo próprio provedor (só o Groq informa) */
  remaining?: number;
  dailyLimit?: number;
}
export type ProviderUsage = Record<AssistantProvider, ProviderState>;

/** Limite do provedor atingido: do dia (marca a IA como esgotada) ou do minuto (passa logo). */
interface QuotaHit {
  scope: "day" | "minute";
  resetAt?: string;
  retrySec?: number;
}

type Failure = Extract<AssistantResult, { ok: false }> & { quota?: QuotaHit };
type Generated = {
  ok: true;
  html: string;
  model: string;
  provider: AssistantProvider;
  rate?: { remaining: number; limit: number; resetAt?: string };
};

export type AssistantResult =
  | {
      ok: true;
      html: string;
      usage: ProviderUsage;
      provider: AssistantProvider;
      /** no Automático, por que a resposta não veio do Gemini */
      fallbackFrom?: "busy" | "limit";
    }
  | {
      ok: false;
      code: AssistantErrorCode;
      message: string;
      /** motivo técnico devolvido pelo provedor (status, código e mensagem), para diagnóstico */
      detail?: string;
      usage?: ProviderUsage;
    };

export interface AssistantUsage {
  providers: ProviderUsage;
  isGestor: boolean;
}

// preferidos, nesta ordem; GEMINI_MODEL (segredo opcional) passa na frente de todos.
// O "lite" entra cedo: costuma ficar livre quando os "flash" estão sobrecarregados.
const DEFAULT_MODELS = ["gemini-3.8-flash", "gemini-flash-latest", "gemini-flash-lite-latest"];

function apiBase(): string {
  return process.env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com";
}

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

/**
 * Estado de cada IA: pedidos deste gestor hoje, limite do dia atingido
 * (de qualquer gestor, enquanto não liberar) e o último saldo informado pelo
 * Groq. Tudo vem da auditoria; registros antigos, sem provedor, são do Gemini.
 */
async function providerState(supabase: Db, userId: string): Promise<ProviderUsage> {
  const since = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("audit_logs")
    .select("actor_id, action, created_at, metadata")
    .in("action", [ASSISTANT_AUDIT_ACTION, ASSISTANT_LIMIT_AUDIT_ACTION])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1000);
  const state: ProviderUsage = {
    gemini: { used: 0, configured: Boolean(process.env.GEMINI_API_KEY) },
    groq: { used: 0, configured: Boolean(process.env.GROQ_API_KEY) },
  };
  const dayStart = startOfClinicDayIso();
  const now = Date.now();
  let groqRateSeen = false;
  for (const row of data ?? []) {
    const meta = (row.metadata ?? {}) as {
      provider?: string;
      reset_at?: string;
      groq_remaining?: number;
      groq_limit?: number;
      groq_reset_at?: string;
    };
    const provider: AssistantProvider = meta.provider === "groq" ? "groq" : "gemini";
    if (row.action === ASSISTANT_LIMIT_AUDIT_ACTION) {
      const until = meta.reset_at ? Date.parse(meta.reset_at) : NaN;
      const current = state[provider].exhaustedUntil;
      if (until > now && (!current || until > Date.parse(current))) {
        state[provider].exhaustedUntil = new Date(until).toISOString();
      }
      continue;
    }
    if (row.actor_id === userId && Date.parse(row.created_at) >= Date.parse(dayStart)) {
      state[provider].used++;
    }
    // linhas em ordem decrescente: a primeira com saldo do Groq é a mais recente
    if (!groqRateSeen && provider === "groq" && typeof meta.groq_remaining === "number") {
      groqRateSeen = true;
      const resetAt = meta.groq_reset_at ? Date.parse(meta.groq_reset_at) : NaN;
      if (!(resetAt <= now)) {
        state.groq.remaining = meta.groq_remaining;
        state.groq.dailyLimit = meta.groq_limit;
      }
    }
  }
  return state;
}

/** Próxima meia-noite no horário do Pacífico, quando o Google renova as cotas do dia. */
function nextPacificMidnight(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const elapsed = (get("hour") * 3600 + get("minute") * 60 + get("second")) * 1000;
  return new Date(now.getTime() - elapsed - now.getMilliseconds() + 24 * 60 * 60 * 1000);
}

/** Durações do Groq: "7.66s", "2m59.56s", "1h2m3s", "500ms". */
function parseDurationSec(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (/^[\d.]+$/.test(v)) return Number(v);
  if (/^[\d.]+ms$/.test(v)) return Number(v.slice(0, -2)) / 1000;
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?$/.exec(v);
  if (!m || !m[0]) return undefined;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

function systemInstruction(): string {
  const vars = CONTRACT_TEMPLATE_VARIABLES.map((v) => `{{${v.key}}} — ${v.description}`).join("\n");
  return [
    "Você é um assistente de redação jurídica para uma clínica de saúde no Brasil que subloca salas (consultórios) a profissionais de saúde por turno (manhã, tarde e noite).",
    "Escreva em português do Brasil, com linguagem jurídica formal, clara e objetiva, coerente com a legislação brasileira aplicável (Código Civil, LGPD e normas sanitárias, quando pertinentes). Não cite números de artigos ou de normas se não tiver certeza deles.",
    "As partes são, por padrão, o LOCADOR (a clínica) e o LOCATÁRIO (o profissional). Se o texto do gestor usar outros termos para as partes (por exemplo, SUBLOCADOR e SUBLOCATÁRIO), use exatamente esses termos.",
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
  provider: z.enum(["auto", "gemini", "groq"]).default("auto"),
});

function userPrompt(input: z.infer<typeof inputSchema>): string {
  const shortcut = ASSISTANT_SHORTCUTS.find((s) => s.id === input.shortcutId);
  const ask = input.request || shortcut?.request || "";
  const variation =
    input.variation > 0
      ? "\n\nOfereça uma redação alternativa à anterior, com outra estrutura de parágrafos, mantendo o mesmo conteúdo jurídico."
      : "";
  if (input.mode === "improve") {
    return (
      [
        "Reescreva o trecho de contrato abaixo com linguagem jurídica mais precisa e clara.",
        "Preserve o sentido, as obrigações, os valores, os termos usados para as partes (como SUBLOCADOR e SUBLOCATÁRIO) e TODAS as variáveis {{...}} existentes. Não acrescente obrigações novas.",
        "Se o trecho não tiver um subtítulo, não crie um; devolva apenas o texto reescrito em <p> (e listas, se houver).",
        ask ? `Orientação do gestor: ${ask}` : "",
        `TRECHO:\n${input.selection ?? ""}`,
      ]
        .filter(Boolean)
        .join("\n\n") + variation
    );
  }
  return `Redija uma cláusula contratual para: ${ask}${variation}`;
}

interface GoogleError {
  code: number;
  status: string;
  message: string;
  reason: string;
  /** cotas violadas (QuotaFailure), ex.: GenerateRequestsPerDayPerProjectPerModel-FreeTier */
  quotaIds: string[];
  /** espera sugerida (RetryInfo), em segundos */
  retrySec?: number;
}

/** Lê o erro no formato do Google: { error: { code, status, message, details: [{ reason }] } }. */
function parseGoogleError(httpStatus: number, body: string): GoogleError {
  try {
    const e = (
      JSON.parse(body) as {
        error?: {
          code?: number;
          status?: string;
          message?: string;
          details?: {
            reason?: string;
            retryDelay?: string;
            violations?: { quotaId?: string }[];
          }[];
        };
      }
    ).error;
    const details = e?.details ?? [];
    return {
      code: e?.code ?? httpStatus,
      status: e?.status ?? "",
      message: e?.message ?? body.slice(0, 300),
      reason: details.find((d) => d.reason)?.reason ?? "",
      quotaIds: details.flatMap((d) => d.violations ?? []).flatMap((v) => v.quotaId ?? []),
      retrySec: parseDurationSec(details.find((d) => d.retryDelay)?.retryDelay),
    };
  } catch {
    return { code: httpStatus, status: "", message: body.slice(0, 300), reason: "", quotaIds: [] };
  }
}

/** 429 do Google: sem cota gratuita para o modelo ("limit: 0"), limite do dia ou do minuto. */
function classifyGemini429(err: GoogleError): "none" | "day" | "minute" {
  if (/limit: 0\b/.test(err.message)) return "none";
  const ids = `${err.quotaIds.join(" ")} ${err.message}`;
  return /PerDay|per day|daily/i.test(ids) ? "day" : "minute";
}

function describe(err: GoogleError, model: string): string {
  const head = [`HTTP ${err.code}`, err.status, err.reason, err.quotaIds[0]]
    .filter(Boolean)
    .join(" · ");
  // nunca devolve a chave, mesmo se o Google a ecoar
  const message = err.message.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[chave]").slice(0, 400);
  return `${head} — ${message} (modelo ${model})`;
}

// modelos disponíveis para a chave; guardado enquanto o servidor estiver de pé
let discovered: { at: number; models: string[] } | null = null;

/**
 * Lista os modelos "flash" de texto que esta chave pode usar (ListModels).
 * Estáveis antes de prévias; ignora variantes de imagem, áudio e "live".
 */
async function discoverModels(apiKey: string): Promise<string[]> {
  if (discovered && Date.now() - discovered.at < 6 * 60 * 60 * 1000) return discovered.models;
  try {
    const res = await fetch(`${apiBase()}/v1beta/models?pageSize=200`, {
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      models?: { name?: string; supportedGenerationMethods?: string[] }[];
    };
    const models = (json.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => (m.name ?? "").replace(/^models\//, ""))
      .filter((n) => /flash/.test(n) && !/image|audio|tts|live|embedding|exp/.test(n))
      .sort((a, b) => rank(a) - rank(b) || b.localeCompare(a, "en", { numeric: true }));
    discovered = { at: Date.now(), models };
    return models;
  } catch {
    return [];
  }
}

function rank(name: string): number {
  return (/preview/.test(name) ? 2 : 0) + (/lite/.test(name) ? 1 : 0);
}

// modelos a pular por um tempo (por cópia do servidor): descontinuados (404),
// sem cota gratuita (429 "limit: 0") ou com o limite do dia ou do minuto atingido
const skipUntil = new Map<string, { until: number; status: number; scope?: QuotaHit["scope"] }>();

function skipped(model: string) {
  const s = skipUntil.get(model);
  return s && s.until > Date.now() ? s : null;
}

/**
 * Conclusão das tentativas: se todos os modelos esbarraram em limite, devolve
 * o limite que vale (o do minuto, se algum libera logo; senão o do dia).
 */
function quotaFrom(
  outcomes: { status: number; scope?: QuotaHit["scope"]; until?: number; retrySec?: number }[],
): QuotaHit | undefined {
  const limited = outcomes.filter((o) => o.status === 429 && o.scope);
  if (!limited.length || outcomes.some((o) => o.status !== 429 && o.status !== 404)) {
    return undefined;
  }
  const minute = limited.filter((o) => o.scope === "minute");
  if (minute.length) {
    return { scope: "minute", retrySec: Math.min(...minute.map((o) => o.retrySec ?? 60)) };
  }
  const until = Math.min(...limited.map((o) => o.until ?? nextPacificMidnight().getTime()));
  return { scope: "day", resetAt: new Date(until).toISOString() };
}

async function candidateModels(apiKey: string): Promise<string[]> {
  const available = await discoverModels(apiKey);
  const preferred = available.length
    ? DEFAULT_MODELS.filter((m) => available.includes(m))
    : DEFAULT_MODELS;
  // primeiro lite disponível logo depois dos preferidos, caso nenhum alias lite exista
  const lite = available.find((m) => /lite/.test(m) && !/preview/.test(m));
  const list = [process.env.GEMINI_MODEL, ...preferred, lite, ...available].filter(
    (m): m is string => Boolean(m),
  );
  return [...new Set(list)].slice(0, 6);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type GeminiCall =
  | { ok: true; body: string; model: string }
  | {
      ok: false;
      status: number;
      error: GoogleError;
      model: string;
      tried: string[];
      quota?: QuotaHit;
    };

/**
 * Chama o Gemini tentando os modelos em ordem. Passa ao próximo quando o
 * modelo não existe para a chave (404) ou esbarra em limite (429; as cotas
 * do Google são por modelo); tenta mais uma vez, após 1 s, quando o modelo
 * está sobrecarregado (500/503) e, se continuar, passa ao próximo.
 */
async function callGemini(
  apiKey: string,
  prompt: string,
  temperature: number,
): Promise<GeminiCall> {
  const models = await candidateModels(apiKey);
  let last: Extract<GeminiCall, { ok: false }> | null = null;
  const tried: string[] = [];
  const outcomes: Parameters<typeof quotaFrom>[0] = [];
  for (const model of models) {
    const skip = skipped(model);
    if (skip) {
      outcomes.push({ status: skip.status, scope: skip.scope, until: skip.until });
      continue;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(
        `${apiBase()}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemInstruction() }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            // os modelos "flash" atuais pensam antes de responder e isso conta neste teto
            generationConfig: { temperature, maxOutputTokens: 8192 },
          }),
          signal: AbortSignal.timeout(45_000),
        },
      );
      const body = await res.text();
      if (res.ok) return { ok: true, body, model };
      const error = parseGoogleError(res.status, body);
      last = { ok: false, status: res.status, error, model, tried };
      console.error("[contractAssistant] Gemini", describe(error, model));
      if ((res.status === 500 || res.status === 503) && attempt < 1) {
        await wait(1000);
        continue;
      }
      break;
    }
    if (!last) break;
    tried.push(`${model} ${last.status}`);
    if (last.status === 404) {
      skipUntil.set(model, { until: Date.now() + 24 * 60 * 60 * 1000, status: 404 });
      outcomes.push({ status: 404 });
      continue;
    }
    if (last.status === 429) {
      const kind = classifyGemini429(last.error);
      const until =
        kind === "day"
          ? nextPacificMidnight().getTime()
          : Date.now() + (kind === "none" ? 60 * 60 : (last.error.retrySec ?? 60)) * 1000;
      const scope = kind === "none" ? undefined : kind;
      skipUntil.set(model, { until, status: 429, scope });
      outcomes.push({ status: 429, scope, until, retrySec: last.error.retrySec });
      continue;
    }
    outcomes.push({ status: last.status });
    if (last.status === 500 || last.status === 503) continue;
    break;
  }
  const quota = quotaFrom(outcomes);
  if (last) return { ...last, quota };
  if (quota) {
    return {
      ok: false,
      status: 429,
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "limite já registrado para todos os modelos",
        reason: "",
        quotaIds: [],
      },
      model: "-",
      tried,
      quota,
    };
  }
  return (
    last ?? {
      ok: false,
      status: 404,
      error: {
        code: 404,
        status: "NOT_FOUND",
        message: "nenhum modelo flash disponível",
        reason: "",
        quotaIds: [],
      },
      model: "-",
      tried,
    }
  );
}

function providerFailure(call: Extract<GeminiCall, { ok: false }>): Failure {
  const detail = `${describe(call.error, call.model)}${call.tried.length > 1 ? ` · modelos tentados: ${call.tried.join(", ")}` : ""}`;
  // vale o motivo mais informativo: se algum modelo só estava sobrecarregado, é isso que importa
  const overloaded = call.tried.some((t) => / 50[03]$/.test(t));
  const { error } = call;
  const status = overloaded && call.status !== 400 ? 503 : call.status;
  const text = `${error.status} ${error.reason} ${error.message}`;
  if (/API_KEY_INVALID|API key not valid|API_KEY_/i.test(text)) {
    return {
      ok: false,
      code: "provider_key",
      detail,
      message: "A chave do Gemini não é válida. Confira o segredo GEMINI_API_KEY.",
    };
  }
  if (/location is not supported|FAILED_PRECONDITION/i.test(text)) {
    return {
      ok: false,
      code: "provider_region",
      detail,
      message:
        "O Google não liberou o plano gratuito do Gemini para a região do servidor que fez o pedido. Veja os detalhes técnicos.",
    };
  }
  if (status === 401 || status === 403) {
    return {
      ok: false,
      code: "provider_key",
      detail,
      message: /SERVICE_DISABLED|has not been used|disabled/i.test(text)
        ? "A API do Gemini está desativada no projeto da chave. Ative a Generative Language API no Google Cloud ou crie a chave pelo Google AI Studio."
        : "A chave do Gemini foi recusada. Confira o segredo GEMINI_API_KEY.",
    };
  }
  if (call.quota) return quotaFailure("gemini", call.quota, detail);
  if (status === 429) {
    return {
      ok: false,
      code: "provider_quota",
      detail,
      message: /limit: 0/i.test(text)
        ? "Esta chave não tem cota gratuita para os modelos do Gemini disponíveis. Veja os detalhes técnicos."
        : "O limite gratuito do Gemini foi atingido por agora. Tente de novo em alguns minutos.",
    };
  }
  if (status === 404) {
    return {
      ok: false,
      code: "provider_model",
      detail,
      message: "Nenhum modelo do Gemini está disponível para esta chave.",
    };
  }
  if (status === 500 || status === 503) {
    return {
      ok: false,
      code: "provider_error",
      detail,
      message:
        call.tried.length > 1
          ? `Os modelos gratuitos do Gemini estão sobrecarregados agora (tentamos ${call.tried.length}). Isso costuma passar em alguns minutos.`
          : "O Gemini está sobrecarregado agora. Tente de novo em instantes.",
    };
  }
  return {
    ok: false,
    code: "provider_error",
    detail,
    message: "O Gemini recusou o pedido. Veja os detalhes técnicos.",
  };
}

function quotaFailure(provider: AssistantProvider, quota: QuotaHit, detail?: string): Failure {
  const name = PROVIDER_NAME[provider];
  return {
    ok: false,
    code: "provider_limit",
    quota,
    detail,
    message:
      quota.scope === "day"
        ? `O ${name} atingiu o limite do dia; libera ${releaseLabel(quota.resetAt!)}.`
        : `O ${name} recebeu muitos pedidos em pouco tempo. Aguarde ${Math.ceil(quota.retrySec ?? 60)} s e tente de novo.`,
  };
}

async function runGemini(
  apiKey: string,
  prompt: string,
  temperature: number,
): Promise<Generated | Failure> {
  let call: GeminiCall;
  try {
    call = await callGemini(apiKey, prompt, temperature);
  } catch (err) {
    const timedOut = err instanceof Error && /timeout|abort/i.test(`${err.name} ${err.message}`);
    console.error("[contractAssistant] fetch", err);
    return {
      ok: false,
      code: "provider_error",
      detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      message: timedOut
        ? "O Gemini demorou demais para responder. Tente de novo."
        : "O servidor não conseguiu falar com o Gemini. Tente de novo.",
    };
  }
  if (!call.ok) return providerFailure(call);

  let html = "";
  let finishReason = "";
  try {
    const json = JSON.parse(call.body) as {
      promptFeedback?: { blockReason?: string };
      candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
    };
    finishReason = json.candidates?.[0]?.finishReason ?? json.promptFeedback?.blockReason ?? "";
    if (json.promptFeedback?.blockReason || /SAFETY|PROHIBITED|BLOCKLIST/.test(finishReason)) {
      return {
        ok: false,
        code: "provider_blocked",
        message: "O Gemini recusou este pedido. Reformule com outras palavras.",
      };
    }
    html = stripCodeFences(
      (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join(""),
    );
  } catch {
    html = "";
  }
  if (!html) {
    return {
      ok: false,
      code: "empty",
      detail: `finishReason ${finishReason || "-"} (modelo ${call.model})`,
      message: "O Gemini devolveu uma resposta vazia. Tente de novo.",
    };
  }
  return { ok: true, html, model: call.model, provider: "gemini" };
}

// Groq (API compatível com a da OpenAI): plano gratuito sem cartão; GROQ_MODEL troca o modelo
const GROQ_MODELS = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"];

/** Provedor reserva, usado quando o Gemini falha. Mesmas instruções e mesmo formato de saída. */
async function runGroq(
  apiKey: string,
  prompt: string,
  temperature: number,
): Promise<Generated | Failure> {
  const base = process.env.GROQ_API_BASE ?? "https://api.groq.com/openai";
  const models = [...new Set([process.env.GROQ_MODEL, ...GROQ_MODELS].filter(Boolean))] as string[];
  const tried: string[] = [];
  const outcomes: Parameters<typeof quotaFrom>[0] = [];
  for (const model of models) {
    const skip = skipped(model);
    if (skip) {
      outcomes.push({ status: skip.status, scope: skip.scope, until: skip.until });
      continue;
    }
    let res: Response;
    try {
      res = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature,
          max_completion_tokens: 8192,
          messages: [
            { role: "system", content: systemInstruction() },
            { role: "user", content: prompt },
          ],
        }),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (err) {
      tried.push(`${model} ${err instanceof Error ? err.name : "erro"}`);
      outcomes.push({ status: 0 });
      continue;
    }
    const body = await res.text();
    if (!res.ok) {
      const err = parseGroqError(res.status, body);
      console.error("[contractAssistant] Groq", `HTTP ${res.status} — ${err} (modelo ${model})`);
      tried.push(`${model} ${res.status}`);
      if (res.status === 429) {
        // o Groq diz no texto qual limite estourou: "requests per day (RPD)", "per minute"...
        const day = /per day|\bRPD\b|\bTPD\b/i.test(err);
        const retrySec =
          parseDurationSec(res.headers.get("retry-after")) ??
          parseDurationSec(res.headers.get("x-ratelimit-reset-requests"));
        const until = Date.now() + (retrySec ?? (day ? 60 * 60 : 60)) * 1000;
        const scope = day ? ("day" as const) : ("minute" as const);
        skipUntil.set(model, { until, status: 429, scope });
        outcomes.push({ status: 429, scope, until, retrySec });
        continue;
      }
      outcomes.push({ status: res.status });
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          code: "provider_key",
          detail: `HTTP ${res.status} — ${err}`,
          message: "A chave do Groq foi recusada. Confira o segredo GROQ_API_KEY.",
        };
      }
      continue;
    }
    let text = "";
    try {
      const json = JSON.parse(body) as { choices?: { message?: { content?: string } }[] };
      text = json.choices?.[0]?.message?.content ?? "";
    } catch {
      text = "";
    }
    // alguns modelos abertos devolvem o raciocínio entre <think>...</think>
    const html = stripCodeFences(text.replace(/<think>[\s\S]*?<\/think>/gi, ""));
    if (html) {
      // saldo de pedidos do dia para este modelo, informado em toda resposta
      const remaining = Number(res.headers.get("x-ratelimit-remaining-requests"));
      const limit = Number(res.headers.get("x-ratelimit-limit-requests"));
      const resetSec = parseDurationSec(res.headers.get("x-ratelimit-reset-requests"));
      const rate =
        res.headers.has("x-ratelimit-remaining-requests") && limit > 0
          ? {
              remaining,
              limit,
              resetAt:
                resetSec !== undefined
                  ? new Date(Date.now() + resetSec * 1000).toISOString()
                  : undefined,
            }
          : undefined;
      return { ok: true, html, model, provider: "groq", rate };
    }
    tried.push(`${model} vazio`);
    outcomes.push({ status: 200 });
  }
  const quota = quotaFrom(outcomes);
  if (quota) return quotaFailure("groq", quota, `modelos tentados: ${tried.join(", ") || "-"}`);
  return {
    ok: false,
    code: "provider_error",
    detail: `modelos tentados: ${tried.join(", ")}`,
    message: "O assistente não conseguiu resposta agora. Tente de novo em alguns minutos.",
  };
}

function parseGroqError(status: number, body: string): string {
  try {
    const e = (JSON.parse(body) as { error?: { message?: string; code?: string } }).error;
    return [e?.code, e?.message].filter(Boolean).join(" · ").slice(0, 300) || `HTTP ${status}`;
  } catch {
    return body.slice(0, 300);
  }
}

export const askContractAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data, context }): Promise<AssistantResult> => {
    const { supabase, userId } = context;
    if (!(await isGestor(supabase, userId))) {
      return {
        ok: false,
        code: "forbidden",
        message: "O Assistente de contratos é exclusivo para gestores.",
      };
    }
    if (data.mode === "improve" && !data.selection?.trim()) {
      return {
        ok: false,
        code: "empty",
        message: "Selecione no editor o trecho que deseja aprimorar.",
      };
    }
    if (data.mode === "draft" && !data.request && !data.shortcutId) {
      return { ok: false, code: "empty", message: "Descreva a cláusula ou escolha um atalho." };
    }

    const usage = await providerState(supabase, userId);
    const order: AssistantProvider[] =
      data.provider === "auto" ? ["gemini", "groq"] : [data.provider];
    const configured = order.filter((p) => usage[p].configured);
    if (!configured.length) {
      return {
        ok: false,
        code: "not_configured",
        message:
          data.provider === "groq"
            ? "O Groq não está configurado: falta o segredo GROQ_API_KEY no servidor."
            : "O assistente ainda não está configurado: falta o segredo GEMINI_API_KEY no servidor.",
        usage,
      };
    }
    const open = configured.filter((p) => !usage[p].exhaustedUntil);
    if (!open.length) {
      const first = configured.map((p) => usage[p].exhaustedUntil!).sort()[0];
      return {
        ok: false,
        code: "provider_limit",
        message:
          configured.length > 1
            ? `O Gemini e o Groq atingiram o limite do dia; o primeiro libera ${releaseLabel(first)}.`
            : `O ${PROVIDER_NAME[configured[0]]} atingiu o limite do dia; libera ${releaseLabel(first)}.${
                data.provider !== "auto" ? " Escolha outra IA ou o Automático." : ""
              }`,
        usage,
      };
    }

    const prompt = userPrompt(data);
    const temperature = data.variation > 0 ? 0.8 : 0.4;
    let gen: Generated | null = null;
    const failures: Failure[] = [];
    let geminiDayLimit = false;
    // no Automático, a próxima IA só entra quando a anterior falha (sobrecarga, limite, modelo, rede)
    for (const p of open) {
      const key = (p === "gemini" ? process.env.GEMINI_API_KEY : process.env.GROQ_API_KEY)!;
      const res =
        p === "gemini"
          ? await runGemini(key, prompt, temperature)
          : await runGroq(key, prompt, temperature);
      if (res.ok) {
        gen = res;
        break;
      }
      if (res.quota?.scope === "day") {
        // vale para todos os gestores até liberar; fica no histórico da Auditoria
        usage[p] = { ...usage[p], exhaustedUntil: res.quota.resetAt };
        if (p === "gemini") geminiDayLimit = true;
        await supabase.from("audit_logs").insert({
          actor_id: userId,
          action: ASSISTANT_LIMIT_AUDIT_ACTION,
          entity_type: "contract",
          entity_id: null,
          metadata: {
            provider: p,
            scope: "day",
            reset_at: res.quota.resetAt ?? null,
            detail: (res.detail ?? "").slice(0, 500),
          },
        });
      }
      failures.push({ ...res, detail: `${PROVIDER_NAME[p]}: ${res.detail ?? res.message}` });
      if (res.code === "provider_blocked") break;
    }
    if (!gen) {
      const first: Failure = { ...failures[0], quota: undefined };
      if (failures.length === 1) return { ...first, usage };
      const keyError = failures.find((f) => f.code === "provider_key");
      const allLimited = failures.every((f) => f.code === "provider_limit");
      return {
        ...first,
        message:
          keyError?.message ??
          (allLimited
            ? failures.map((f) => f.message).join(" ")
            : "O Gemini e o Groq estão ocupados agora. Tente de novo em alguns minutos."),
        detail: failures.map((f) => f.detail).join(" · "),
        usage,
      };
    }
    const { html } = gen;
    const fallbackFrom =
      data.provider === "auto" && gen.provider === "groq" && usage.gemini.configured
        ? geminiDayLimit || !open.includes("gemini")
          ? ("limit" as const)
          : ("busy" as const)
        : undefined;

    // registra o uso (sem guardar o texto); o contador do painel é só informativo
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
        provider: gen.provider,
        model: gen.model,
        ...(gen.rate
          ? {
              groq_remaining: gen.rate.remaining,
              groq_limit: gen.rate.limit,
              groq_reset_at: gen.rate.resetAt ?? null,
            }
          : {}),
      },
    });

    const after: ProviderUsage = {
      ...usage,
      [gen.provider]: {
        ...usage[gen.provider],
        used: usage[gen.provider].used + 1,
        ...(gen.rate ? { remaining: gen.rate.remaining, dailyLimit: gen.rate.limit } : {}),
      },
    };
    return { ok: true, html, usage: after, provider: gen.provider, fallbackFrom };
  });

export const getContractAssistantUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AssistantUsage> => {
    const { supabase, userId } = context;
    const gestor = await isGestor(supabase, userId);
    const providers: ProviderUsage = gestor
      ? await providerState(supabase, userId)
      : {
          gemini: { used: 0, configured: false },
          groq: { used: 0, configured: false },
        };
    return { providers, isGestor: gestor };
  });
