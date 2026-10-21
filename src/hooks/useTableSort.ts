import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Ordenação padrão das tabelas e listas do app.
 *
 * Clique no título: crescente → decrescente → ordem original da tela. Uma
 * coluna por vez. A escolha é lembrada por tabela neste navegador.
 *
 *   const sort = useTableSort("financeiro.recebiveis", {
 *     profissional: (r) => profMap.get(r.professional_id),
 *     valor: (r) => Number(r.amount_due),
 *   });
 *   const rows = sort.apply(filtered);
 *   <SortableTableHead sort={sort} column="valor">Valor</SortableTableHead>
 */

export type SortDirection = "asc" | "desc";
export type SortValue = string | number | Date | boolean | null | undefined;
export type SortAccessors<T> = Record<string, (row: T) => SortValue>;

export interface SortState {
  column: string;
  direction: SortDirection;
}

export interface TableSort<T> {
  state: SortState | null;
  toggle: (column: string) => void;
  set: (state: SortState | null) => void;
  directionOf: (column: string) => SortDirection | null;
  apply: (rows: readonly T[]) => T[];
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

function normalize(v: SortValue): string | number | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

/** Compara dois valores; vazios ficam sempre por último, em qualquer sentido. */
export function compareSortValues(a: SortValue, b: SortValue, direction: SortDirection): number {
  const x = normalize(a);
  const y = normalize(b);
  if (x === null && y === null) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  const base =
    typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y));
  return direction === "asc" ? base : -base;
}

export function useTableSort<T>(storageKey: string, accessors: SortAccessors<T>): TableSort<T> {
  const [state, setState] = useState<SortState | null>(null);
  const key = `ordem.${storageKey}`;

  // leitura depois da montagem, para não divergir da renderização no servidor
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const saved = JSON.parse(raw) as SortState;
      if (saved && saved.column in accessors && (saved.direction === "asc" || saved.direction === "desc")) {
        setState(saved);
      }
    } catch {
      /* armazenamento indisponível: começa na ordem original */
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = useCallback(
    (next: SortState | null) => {
      setState(next);
      try {
        if (next) localStorage.setItem(key, JSON.stringify(next));
        else localStorage.removeItem(key);
      } catch {
        /* ignora: a ordem vale só nesta visita */
      }
    },
    [key],
  );

  const toggle = useCallback(
    (column: string) => {
      if (!state || state.column !== column) set({ column, direction: "asc" });
      else if (state.direction === "asc") set({ column, direction: "desc" });
      else set(null);
    },
    [state, set],
  );

  const directionOf = useCallback(
    (column: string) => (state?.column === column ? state.direction : null),
    [state],
  );

  const accessor = state ? accessors[state.column] : undefined;
  const apply = useMemo(
    () => (rows: readonly T[]) => {
      if (!state || !accessor) return [...rows];
      // ordenação estável: empates mantêm a ordem original da tela
      return rows
        .map((row, i) => ({ row, i, v: accessor(row) }))
        .sort((a, b) => compareSortValues(a.v, b.v, state.direction) || a.i - b.i)
        .map((x) => x.row);
    },
    [state, accessor],
  );

  return { state, toggle, set, directionOf, apply };
}
