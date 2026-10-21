import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Diálogos de confirmação do app, no lugar de window.confirm/prompt/alert:
 * mesmo visual do sistema, texto em português e foco gerenciado.
 *
 *   const { confirm, prompt } = useConfirm();
 *   if (!(await confirm({ title: "Excluir parcela?", destructive: true }))) return;
 *   const motivo = await prompt({ title: "Cancelar recibo", inputLabel: "Motivo" });
 */

interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface PromptOptions extends ConfirmOptions {
  inputLabel: string;
  placeholder?: string;
  /** Padrão: true. Sem texto, o botão de confirmar fica desativado. */
  required?: boolean;
}

interface NoticeOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
}

interface ConfirmApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
  notice: (options: NoticeOptions) => Promise<void>;
}

type Request =
  | { kind: "confirm"; options: ConfirmOptions }
  | { kind: "prompt"; options: PromptOptions }
  | { kind: "notice"; options: NoticeOptions };

const ConfirmContext = createContext<ConfirmApi | null>(null);

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const [text, setText] = useState("");
  const resolver = useRef<((value: boolean | string | null) => void) | null>(null);

  const open = useCallback((next: Request) => {
    // um pedido novo encerra o anterior como cancelado
    resolver.current?.(next.kind === "prompt" ? null : false);
    setText("");
    setRequest(next);
    return new Promise<boolean | string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const finish = useCallback((value: boolean | string | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setRequest(null);
  }, []);

  const api: ConfirmApi = {
    confirm: (options) => open({ kind: "confirm", options }) as Promise<boolean>,
    prompt: (options) => open({ kind: "prompt", options }) as Promise<string | null>,
    notice: (options) => open({ kind: "notice", options }).then(() => undefined),
  };

  const options = request?.options;
  const isPrompt = request?.kind === "prompt";
  const isNotice = request?.kind === "notice";
  const destructive = !!(options && "destructive" in options && options.destructive);
  const required = isPrompt ? (request.options.required ?? true) : false;
  const canConfirm = !required || text.trim().length > 0;

  function confirmNow() {
    if (!request || !canConfirm) return;
    finish(isPrompt ? text.trim() : true);
  }

  return (
    <ConfirmContext.Provider value={api}>
      {children}
      <AlertDialog
        open={!!request}
        onOpenChange={(o) => {
          if (!o) finish(isPrompt ? null : false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">{options?.title}</AlertDialogTitle>
            {options?.description && (
              <AlertDialogDescription className="whitespace-pre-line">
                {options.description}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          {isPrompt && (
            <div className="space-y-2">
              <Label htmlFor="confirm-dialog-text">
                {request.options.inputLabel}
                {required && <span aria-hidden="true"> *</span>}
              </Label>
              <Textarea
                id="confirm-dialog-text"
                rows={3}
                autoFocus
                value={text}
                placeholder={request.options.placeholder}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) confirmNow();
                }}
              />
            </div>
          )}
          <AlertDialogFooter>
            {!isNotice && (
              <AlertDialogCancel>
                {(options && "cancelLabel" in options && options.cancelLabel) || "Cancelar"}
              </AlertDialogCancel>
            )}
            <AlertDialogAction
              disabled={!canConfirm}
              className={cn(destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
              onClick={(e) => {
                e.preventDefault();
                confirmNow();
              }}
            >
              {options?.confirmLabel ?? (isNotice ? "Entendi" : "Confirmar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmApi {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm precisa estar dentro de <ConfirmDialogProvider>");
  return ctx;
}
