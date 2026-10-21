import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { TableSort } from "@/hooks/useTableSort";

/**
 * Título de coluna ordenável (padrão do projeto). O título inteiro é o botão;
 * a seta mostra o sentido, e a seta dupla clara indica que a coluna pode ser
 * ordenada. Use junto com useTableSort.
 */
export function SortableTableHead<T>({
  sort,
  column,
  children,
  align = "left",
  className,
}: {
  sort: TableSort<T>;
  column: string;
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const direction = sort.directionOf(column);
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <TableHead
      aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
      className={cn(align === "right" && "text-right", className)}
    >
      <button
        type="button"
        onClick={() => sort.toggle(column)}
        className={cn(
          "-mx-2 inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-md px-2 font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8",
          direction ? "text-foreground" : "text-muted-foreground",
          align === "right" && "flex-row-reverse",
        )}
      >
        {children}
        <Icon
          aria-hidden="true"
          className={cn("h-3.5 w-3.5 shrink-0", direction ? "text-primary-ink" : "opacity-40")}
        />
        <span className="sr-only">
          {direction === "asc"
            ? ", ordenado de forma crescente"
            : direction === "desc"
              ? ", ordenado de forma decrescente"
              : ", clique para ordenar"}
        </span>
      </button>
    </TableHead>
  );
}
