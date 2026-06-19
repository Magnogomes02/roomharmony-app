import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { addDays, format, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

type ButtonVariant = ButtonProps["variant"];

interface WeekNavigatorProps {
  /** Already normalized to the Monday (weekStartsOn: 1) at midnight of the reference week. */
  value: Date;
  /** Always called with the normalized Monday-midnight of the chosen week. */
  onChange: (weekStart: Date) => void;
  buttonVariant?: ButtonVariant;
  className?: string;
}

function normalizeWeekStart(d: Date): Date {
  const s = startOfWeek(d, { weekStartsOn: 1 });
  s.setHours(0, 0, 0, 0);
  return s;
}

export function WeekNavigator({ value, onChange, buttonVariant = "ghost", className }: WeekNavigatorProps) {
  const weekEnd = addDays(value, 6);

  return (
    <div className={`flex items-center gap-1 ${className ?? ""}`}>
      <Button
        variant={buttonVariant}
        size="icon"
        onClick={() => onChange(normalizeWeekStart(addDays(value, -7)))}
        aria-label="Semana anterior"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant={buttonVariant} size="sm" className="gap-1 whitespace-nowrap">
            {format(value, "dd 'de' MMM", { locale: ptBR })} – {format(weekEnd, "dd 'de' MMM yyyy", { locale: ptBR })}
            <ChevronDown className="h-3.5 w-3.5 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="center">
          <Calendar
            mode="single"
            selected={value}
            onSelect={(d) => d && onChange(normalizeWeekStart(d))}
            locale={ptBR}
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
      <Button
        variant={buttonVariant}
        size="icon"
        onClick={() => onChange(normalizeWeekStart(addDays(value, 7)))}
        aria-label="Próxima semana"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Button variant={buttonVariant} size="sm" onClick={() => onChange(normalizeWeekStart(new Date()))}>
        Hoje
      </Button>
    </div>
  );
}
