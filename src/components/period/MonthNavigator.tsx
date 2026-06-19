import { useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { addMonths, format, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MONTHS_PT } from "@/lib/paymentsService";

type ButtonVariant = ButtonProps["variant"];

interface MonthNavigatorProps {
  /** Any date within the reference month (typically already startOfMonth). */
  value: Date;
  /** Always called with startOfMonth(...) of the chosen date. */
  onChange: (date: Date) => void;
  buttonVariant?: ButtonVariant;
  className?: string;
}

const YEAR_RANGE_BEFORE = 5;
const YEAR_RANGE_AFTER = 5;

export function MonthNavigator({ value, onChange, buttonVariant = "outline", className }: MonthNavigatorProps) {
  const [open, setOpen] = useState(false);
  const currentYear = value.getFullYear();
  const years = Array.from(
    { length: YEAR_RANGE_BEFORE + YEAR_RANGE_AFTER + 1 },
    (_, i) => currentYear - YEAR_RANGE_BEFORE + i,
  );

  function goTo(monthIdx: number, year: number) {
    onChange(startOfMonth(new Date(year, monthIdx, 1)));
    setOpen(false);
  }

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <Button
        variant={buttonVariant}
        size="icon"
        onClick={() => onChange(startOfMonth(addMonths(value, -1)))}
        aria-label="Mês anterior"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant={buttonVariant} className="min-w-[170px] justify-between capitalize">
            {format(value, "MMMM 'de' yyyy", { locale: ptBR })}
            <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="center">
          <div className="grid grid-cols-2 gap-2">
            <Select value={String(value.getMonth())} onValueChange={(v) => goTo(Number(v), value.getFullYear())}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS_PT.map((m, i) => (
                  <SelectItem key={m} value={String(i)}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(value.getFullYear())} onValueChange={(v) => goTo(value.getMonth(), Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </PopoverContent>
      </Popover>
      <Button
        variant={buttonVariant}
        size="icon"
        onClick={() => onChange(startOfMonth(addMonths(value, 1)))}
        aria-label="Próximo mês"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Button variant={buttonVariant} onClick={() => onChange(startOfMonth(new Date()))}>
        Hoje
      </Button>
    </div>
  );
}
