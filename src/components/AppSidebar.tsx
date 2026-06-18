import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  DoorOpen,
  FileText,
  Calendar,
  AlertTriangle,
  ArrowRightLeft,
  Settings,
  ScrollText,
  DollarSign,
  TrendingDown,
  LogOut,
  Sparkles,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

const navItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, roles: ["gestor", "profissional", "visualizador"] },
  { title: "Profissionais", url: "/profissionais", icon: Users, roles: ["gestor", "visualizador"] },
  { title: "Salas", url: "/salas", icon: DoorOpen, roles: ["gestor", "visualizador"] },
  { title: "Contratos", url: "/contratos", icon: FileText, roles: ["gestor", "profissional", "visualizador"] },
  { title: "Calendário", url: "/calendario", icon: Calendar, roles: ["gestor", "profissional", "visualizador"] },
  { title: "Conflitos", url: "/conflitos", icon: AlertTriangle, roles: ["gestor"] },
  { title: "Realocação", url: "/realocacao", icon: ArrowRightLeft, roles: ["gestor"] },
  { title: "Financeiro", url: "/financeiro", icon: DollarSign, roles: ["gestor", "visualizador"] },
  { title: "Contas a Pagar", url: "/contas-a-pagar", icon: TrendingDown, roles: ["gestor", "visualizador"] },
  { title: "Preferências", url: "/preferencias", icon: Settings, roles: ["gestor"] },
  { title: "Auditoria", url: "/auditoria", icon: ScrollText, roles: ["gestor"] },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { role, signOut, user } = useAuth();

  const visibleItems = navItems.filter((i) => !role || i.roles.includes(role));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-5 w-5" />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="font-serif text-base leading-tight">Versão Saúde</span>
              <span className="text-xs text-sidebar-foreground/60">Gestão clínica</span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operação</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => {
                const active = pathname === item.url || pathname.startsWith(item.url + "/");
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                      <Link to={item.url} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        {!collapsed && user && (
          <div className="px-2 pb-2 pt-1">
            <p className="truncate text-xs text-sidebar-foreground/70">{user.email}</p>
            <p className="text-xs uppercase tracking-wide text-primary">{role ?? "—"}</p>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={signOut}
          className="justify-start text-sidebar-foreground hover:bg-sidebar-accent"
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span className="ml-2">Sair</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
