import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type StatusTone = "warning" | "primary" | "success" | "destructive" | "muted";

export interface StatusToggleOption<T extends string> {
  value: T;
  label: string;
  tone: StatusTone;
  count?: number;
}

// bolinha cheia (status visível) na cor do status
const DOT_ON: Record<StatusTone, string> = {
  warning: "border-warning bg-warning",
  primary: "border-primary bg-primary",
  success: "border-success bg-success",
  destructive: "border-destructive bg-destructive",
  muted: "border-muted-foreground bg-muted-foreground",
};

/**
 * Filtro de status por clique: cada status é um botão liga/desliga e só a
 * bolinha muda (cheia na cor do status quando visível, vazada e cinza quando
 * oculto). Todos começam visíveis.
 */
export function StatusToggleFilter<T extends string>({
  options,
  selected,
  onToggle,
  label = "Filtrar por status",
}: {
  options: StatusToggleOption<T>[];
  selected: ReadonlySet<T>;
  onToggle: (value: T) => void;
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.has(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(o.value)}
            className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-3.5 text-sm font-medium text-foreground transition-colors hover:border-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:h-8 md:px-3"
          >
            <span
              aria-hidden="true"
              className={cn(
                "h-2.5 w-2.5 shrink-0 rounded-full border-2 transition-colors",
                on ? DOT_ON[o.tone] : "border-muted-foreground/60 bg-transparent",
              )}
            />
            {o.label}
            {o.count !== undefined && (
              <span className="tabular-nums text-muted-foreground">{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Conjunto de status visíveis, lembrado neste navegador. Começa com todos;
 * valores desconhecidos no armazenamento são ignorados. A leitura acontece
 * depois da montagem para não divergir da renderização no servidor.
 */
export function useVisibleStatuses<T extends string>(storageKey: string, all: readonly T[]) {
  const [selected, setSelected] = useState<Set<T>>(() => new Set(all));

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = (JSON.parse(raw) as unknown[]).filter((v): v is T => all.includes(v as T));
      setSelected(new Set(saved));
    } catch {
      /* armazenamento indisponível: mantém todos visíveis */
    }
  }, [storageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function persist(next: Set<T>) {
    setSelected(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify([...next]));
    } catch {
      /* ignora: a seleção vale só nesta visita */
    }
  }

  function toggle(value: T) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    persist(next);
  }

  function showAll() {
    persist(new Set(all));
  }

  return { selected, toggle, showAll };
}
