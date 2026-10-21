import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Sparkles } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  ASSISTANT_LOW_BALANCE,
  ASSISTANT_MAX_REQUEST,
  ASSISTANT_SHORTCUTS,
  PROVIDER_NAME,
  findUnknownPlaceholders,
  releaseLabel,
  replaceUnknownPlaceholders,
  sanitizeAssistantHtml,
  type AssistantChoice,
  type AssistantMode,
  type AssistantProvider,
} from "@/lib/contractAssistant";
import {
  askContractAssistant,
  getContractAssistantUsage,
  type AssistantUsage,
} from "@/lib/contractAssistant.functions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Texto selecionado no editor ao abrir o painel (vazio = sem seleção). */
  selectionText: string;
  onInsert: (html: string) => void;
  onReplace: (html: string) => void;
}

interface Pending {
  mode: AssistantMode;
  request: string;
  shortcutId?: string;
  variation: number;
}

const CHOICE_KEY = "assistente-contratos:ia";
const PROVIDERS: AssistantProvider[] = ["gemini", "groq"];

function readChoice(): AssistantChoice {
  try {
    const v = localStorage.getItem(CHOICE_KEY);
    return v === "gemini" || v === "groq" ? v : "auto";
  } catch {
    return "auto";
  }
}

/** Destaca as variáveis na prévia: conhecidas em dourado, desconhecidas em vermelho. */
function highlightPlaceholders(html: string, unknown: string[]): string {
  return html.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (full, key: string) =>
    unknown.includes(key)
      ? `<mark class="rounded bg-destructive/15 px-0.5 text-destructive">${full}</mark>`
      : `<mark class="rounded bg-secondary px-0.5 text-secondary-foreground">${full}</mark>`,
  );
}

export function ContractAssistantPanel({
  open,
  onOpenChange,
  selectionText,
  onInsert,
  onReplace,
}: Props) {
  const isMobile = useIsMobile();
  const hasSelection = selectionText.trim().length > 0;
  const [mode, setMode] = useState<AssistantMode>("draft");
  const [request, setRequest] = useState("");
  const [usage, setUsage] = useState<AssistantUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; detail?: string; retry: boolean } | null>(
    null,
  );
  const [html, setHtml] = useState("");
  const [answeredBy, setAnsweredBy] = useState<{
    provider: AssistantProvider;
    fallbackFrom?: "busy" | "limit";
  } | null>(null);
  const [choice, setChoiceState] = useState<AssistantChoice>("auto");
  useEffect(() => setChoiceState(readChoice()), []);
  function setChoice(next: AssistantChoice) {
    setChoiceState(next);
    try {
      localStorage.setItem(CHOICE_KEY, next);
    } catch {
      // sem armazenamento local: vale só nesta sessão
    }
  }
  const [last, setLast] = useState<Pending | null>(null);
  // pedido em andamento; "Cancelar" descarta a resposta que chegar depois
  const requestSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    setMode(hasSelection ? "improve" : "draft");
    setHtml("");
    setError(null);
    setRequest("");
    getContractAssistantUsage()
      .then(setUsage)
      .catch(() => setUsage(null));
  }, [open, hasSelection]);

  const unknown = useMemo(() => (html ? findUnknownPlaceholders(html) : []), [html]);
  const configured = usage ? PROVIDERS.filter((p) => usage.providers[p].configured) : [];
  // limite do dia de cada IA, enquanto não liberar
  const exhausted = (p: AssistantProvider) => {
    const until = usage?.providers[p].exhaustedUntil;
    return until && Date.parse(until) > Date.now() ? until : null;
  };
  const hasRoom = (p: AssistantProvider) =>
    !!usage && usage.providers[p].configured && !exhausted(p);
  const firstRelease = configured
    .map(exhausted)
    .filter((u): u is string => !!u)
    .sort()[0];
  const blockedReason = !usage
    ? null
    : !usage.isGestor
      ? "O Assistente de contratos é exclusivo para gestores."
      : configured.length === 0
        ? "O assistente ainda não está configurado: falta o segredo GEMINI_API_KEY no servidor."
        : choice === "auto"
          ? configured.some(hasRoom)
            ? null
            : configured.length > 1
              ? `O Gemini e o Groq atingiram o limite do dia. O primeiro libera ${releaseLabel(firstRelease)}.`
              : `O ${PROVIDER_NAME[configured[0]]} atingiu o limite do dia. Libera ${releaseLabel(firstRelease)}.`
          : !usage.providers[choice].configured
            ? `O ${PROVIDER_NAME[choice]} não está configurado. Escolha o Automático.`
            : !hasRoom(choice)
              ? `O ${PROVIDER_NAME[choice]} atingiu o limite do dia; libera ${releaseLabel(exhausted(choice)!)}. Escolha outra IA ou o Automático.`
              : null;
  // o Groq informa o saldo do dia; avisa quando restar pouco
  const groq = usage?.providers.groq;
  const groqLow =
    !!groq?.configured &&
    !exhausted("groq") &&
    groq.remaining !== undefined &&
    !!groq.dailyLimit &&
    groq.remaining <= groq.dailyLimit * ASSISTANT_LOW_BALANCE;

  async function run(next: Pending) {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    setLast(next);
    try {
      const res = await askContractAssistant({
        data: {
          mode: next.mode,
          request: next.request,
          shortcutId: next.shortcutId,
          selection: next.mode === "improve" ? selectionText : undefined,
          variation: next.variation,
          provider: choice,
        },
      });
      if (seq !== requestSeq.current) return;
      if (res.ok) {
        setHtml(sanitizeAssistantHtml(res.html));
        setAnsweredBy({ provider: res.provider, fallbackFrom: res.fallbackFrom });
        setUsage((u) => (u ? { ...u, providers: res.usage } : u));
      } else {
        setError({
          message: res.message,
          detail: res.detail,
          retry: ![
            "forbidden",
            "limit",
            "not_configured",
            "provider_key",
            "provider_region",
            "provider_model",
          ].includes(res.code),
        });
        if (res.usage) setUsage((u) => (u ? { ...u, providers: res.usage! } : u));
      }
    } catch {
      if (seq !== requestSeq.current) return;
      setError({
        message: "Não foi possível falar com o servidor. Verifique a conexão e tente de novo.",
        retry: true,
      });
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }

  function cancel() {
    requestSeq.current++;
    setLoading(false);
  }

  function apply(kind: "insert" | "replace") {
    if (!html || unknown.length > 0) return;
    if (kind === "insert") onInsert(html);
    else onReplace(html);
    onOpenChange(false);
  }

  const canSubmit =
    !loading && !blockedReason && (mode === "improve" ? hasSelection : request.trim().length > 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "flex flex-col gap-0 p-0",
          isMobile ? "max-h-[88vh] rounded-t-xl" : "w-full sm:max-w-md",
        )}
      >
        <SheetHeader className="border-b p-4 pr-12 text-left">
          <SheetTitle className="flex items-center gap-2 font-serif text-xl">
            <Sparkles className="h-5 w-5 text-primary-ink" aria-hidden="true" /> Assistente de
            contratos
          </SheetTitle>
          <SheetDescription>
            Use só variáveis como {"{{LOCATARIO_NOME}}"}; não cole nomes, CPF ou outros dados reais.
          </SheetDescription>
          {usage?.isGestor &&
            configured.length > 0 &&
            (configured.some(exhausted) ? (
              // com uma IA no limite, cada IA em sua linha, para o horário de liberação não quebrar
              <ul className="space-y-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                {configured.map((p) => (
                  <li key={p} className={cn(exhausted(p) && "text-warning-ink")}>
                    {exhausted(p)
                      ? `${PROVIDER_NAME[p]}: limite do dia atingido · libera ${releaseLabel(exhausted(p)!)}`
                      : `${PROVIDER_NAME[p]}: ${usage.providers[p].used} ${usage.providers[p].used === 1 ? "pedido" : "pedidos"} hoje`}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs font-medium tabular-nums text-muted-foreground">
                Hoje:{" "}
                {configured
                  .map((p) => `${PROVIDER_NAME[p]} ${usage.providers[p].used}`)
                  .join(" · ")}
              </p>
            ))}
          {groqLow && (
            <p role="status" className="text-xs font-medium tabular-nums text-warning-ink">
              Groq: {groq!.remaining === 1 ? "resta 1 pedido" : `restam ${groq!.remaining} pedidos`}{" "}
              hoje.
            </p>
          )}
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <Tabs
            value={mode}
            onValueChange={(v) => {
              setMode(v as AssistantMode);
              setHtml("");
              setError(null);
            }}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="draft">Redigir cláusula</TabsTrigger>
              <TabsTrigger value="improve" disabled={!hasSelection}>
                Aprimorar seleção
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {!hasSelection && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Para aprimorar um trecho, selecione-o no editor antes de abrir o assistente.
            </p>
          )}

          {configured.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span id="assistente-ia" className="text-sm font-medium">
                IA
              </span>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                aria-labelledby="assistente-ia"
                value={choice}
                onValueChange={(v) => v && setChoice(v as AssistantChoice)}
                className="justify-start"
              >
                <ToggleGroupItem
                  value="auto"
                  title="Gemini primeiro; Groq se o Gemini falhar ou acabar"
                >
                  Automático
                </ToggleGroupItem>
                {PROVIDERS.map((p) => (
                  <ToggleGroupItem key={p} value={p}>
                    {PROVIDER_NAME[p]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )}

          {blockedReason && (
            <p
              role="status"
              className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-warning-ink"
            >
              {blockedReason}
            </p>
          )}

          {mode === "draft" ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <p className="text-sm font-medium">Atalhos</p>
                <div className="flex flex-wrap gap-2">
                  {ASSISTANT_SHORTCUTS.map((s) => (
                    <Button
                      key={s.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={loading || !!blockedReason}
                      onClick={() =>
                        run({ mode: "draft", request: "", shortcutId: s.id, variation: 0 })
                      }
                    >
                      {s.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="assistente-pedido">Ou descreva a cláusula</Label>
                <Textarea
                  id="assistente-pedido"
                  rows={3}
                  maxLength={ASSISTANT_MAX_REQUEST}
                  value={request}
                  placeholder="Ex.: rescisão com aviso prévio de 30 dias e retenção de caução"
                  onChange={(e) => setRequest(e.target.value)}
                />
              </div>
              <Button
                type="button"
                className="w-full"
                disabled={!canSubmit}
                onClick={() => run({ mode: "draft", request: request.trim(), variation: 0 })}
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" /> Redigir
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Trecho selecionado</p>
                <blockquote className="max-h-32 overflow-y-auto whitespace-pre-line rounded-md border-l-2 border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
                  {selectionText}
                </blockquote>
              </div>
              <div className="space-y-2">
                <Label htmlFor="assistente-orientacao">O que melhorar? (opcional)</Label>
                <Textarea
                  id="assistente-orientacao"
                  rows={2}
                  maxLength={ASSISTANT_MAX_REQUEST}
                  value={request}
                  placeholder="Ex.: deixar mais claro o prazo de aviso"
                  onChange={(e) => setRequest(e.target.value)}
                />
              </div>
              <Button
                type="button"
                className="w-full"
                disabled={!canSubmit}
                onClick={() => run({ mode: "improve", request: request.trim(), variation: 0 })}
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" /> Aprimorar
              </Button>
            </div>
          )}

          {loading && (
            <div role="status" className="space-y-3 rounded-md border bg-card p-4">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Redigindo…
              </p>
              <div className="space-y-2" aria-hidden="true">
                <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-3 w-full animate-pulse rounded bg-muted" />
                <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={cancel}>
                Cancelar
              </Button>
            </div>
          )}

          {error && !loading && (
            <div
              role="alert"
              className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
            >
              <p className="flex items-start gap-2 text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{" "}
                {error.message}
              </p>
              {error.detail && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none font-medium">
                    Detalhes técnicos
                  </summary>
                  <p className="mt-1 break-words font-mono">{error.detail}</p>
                </details>
              )}
              {error.retry && last && (
                <Button type="button" variant="outline" size="sm" onClick={() => run(last)}>
                  Tentar de novo
                </Button>
              )}
            </div>
          )}

          {html && !loading && (
            <div className="space-y-3">
              <p className="text-sm font-medium">Prévia</p>
              <div
                className="prose prose-sm max-w-none rounded-md border bg-card p-4 [&_h3]:text-base [&_h3]:font-bold [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6"
                // HTML já limpo por sanitizeAssistantHtml (só p, h3, strong, em, u, listas)
                dangerouslySetInnerHTML={{ __html: highlightPlaceholders(html, unknown) }}
              />
              {unknown.length > 0 && (
                <div
                  role="alert"
                  className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
                >
                  <p className="text-destructive">
                    O texto usa{" "}
                    {unknown.length === 1
                      ? "uma variável que não existe"
                      : "variáveis que não existem"}{" "}
                    no sistema ({unknown.map((u) => `{{${u}}}`).join(", ")}); no PDF{" "}
                    {unknown.length === 1 ? "ela sairia vazia" : "elas sairiam vazias"}.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setHtml(replaceUnknownPlaceholders(html))}
                  >
                    Trocar por campo a preencher
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Texto sugerido por IA. Revise antes de usar; não substitui orientação jurídica.
                {answeredBy &&
                  ` Gerado pelo ${PROVIDER_NAME[answeredBy.provider]}${
                    answeredBy.fallbackFrom === "busy"
                      ? " (o Gemini estava ocupado)"
                      : answeredBy.fallbackFrom === "limit"
                        ? " (o Gemini atingiu o limite do dia)"
                        : ""
                  }.`}
              </p>
            </div>
          )}
        </div>

        {html && !loading && (
          <div className="flex flex-wrap gap-2 border-t p-4">
            <Button type="button" onClick={() => apply("insert")} disabled={unknown.length > 0}>
              Inserir no cursor
            </Button>
            {hasSelection && (
              <Button
                type="button"
                variant="outline"
                onClick={() => apply("replace")}
                disabled={unknown.length > 0}
              >
                Substituir seleção
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              disabled={!last || !!blockedReason}
              onClick={() => last && run({ ...last, variation: last.variation + 1 })}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Gerar outra versão
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
