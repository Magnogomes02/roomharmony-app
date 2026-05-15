import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { user, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  useEffect(() => {
    if (user) navigate({ to: "/dashboard" });
  }, [user, navigate]);

  async function onSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) toast.error("Falha no login", { description: error });
    else toast.success("Bem-vindo!");
  }

  async function onSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await signUp(email, password, fullName);
    setLoading(false);
    if (error) toast.error("Falha no cadastro", { description: error });
    else toast.success("Cadastro realizado", { description: "Verifique seu e-mail se necessário." });
  }

  function fillDemo(role: "gestor" | "profissional" | "visualizador") {
    setEmail(`${role}@versaosaude.com`);
    setPassword("senha123");
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Painel esquerdo - apresentação */}
      <div className="hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-5 w-5" />
          </div>
          <span className="font-serif text-xl">Versão Saúde</span>
        </div>
        <div className="space-y-6">
          <h1 className="font-serif text-5xl leading-tight">
            Cuidado humano,<br />
            <span className="text-primary">gestão precisa.</span>
          </h1>
          <p className="max-w-md text-sidebar-foreground/70">
            Plataforma completa para clínicas que alugam salas a profissionais de saúde.
            Contratos, agenda, conflitos e auditoria em um só lugar.
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">
          © {new Date().getFullYear()} Versão Saúde · Protótipo MVP
        </p>
      </div>

      {/* Painel direito - formulário */}
      <div className="flex items-center justify-center p-6 lg:p-12">
        <Card className="w-full max-w-md border-border/60 shadow-sm">
          <CardHeader>
            <CardTitle className="font-serif text-2xl">Acessar plataforma</CardTitle>
            <CardDescription>Entre com sua conta ou cadastre-se</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="signin">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Entrar</TabsTrigger>
                <TabsTrigger value="signup">Cadastrar</TabsTrigger>
              </TabsList>

              <TabsContent value="signin">
                <form onSubmit={onSignIn} className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">E-mail</Label>
                    <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Senha</Label>
                    <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Entrando..." : "Entrar"}
                  </Button>

                  <div className="space-y-2 rounded-lg border border-dashed border-border bg-muted/40 p-3">
                    <p className="text-xs font-medium text-muted-foreground">Contas de demonstração (senha: senha123)</p>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => fillDemo("gestor")}>Gestor</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => fillDemo("profissional")}>Profissional</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => fillDemo("visualizador")}>Visualizador</Button>
                    </div>
                  </div>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form onSubmit={onSignUp} className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="fullName">Nome completo</Label>
                    <Input id="fullName" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email2">E-mail</Label>
                    <Input id="email2" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password2">Senha</Label>
                    <Input id="password2" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Cadastrando..." : "Cadastrar"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Novos usuários iniciam como <strong>Visualizador</strong>. Um gestor pode ajustar permissões depois.
                  </p>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
