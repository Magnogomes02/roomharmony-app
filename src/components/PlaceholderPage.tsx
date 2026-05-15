import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Construction } from "lucide-react";

interface Props {
  title: string;
  description: string;
}

export function PlaceholderPage({ title, description }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
      </div>
      <Card className="border-dashed">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-primary">
              <Construction className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="font-serif text-xl">Módulo em construção</CardTitle>
              <p className="text-sm text-muted-foreground">
                Esta tela faz parte da estrutura base e será implementada nas próximas rodadas.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            A fundação está pronta: banco de dados, autenticação, papéis e navegação. Peça a próxima
            funcionalidade quando quiser avançar.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
