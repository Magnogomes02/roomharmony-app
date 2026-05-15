import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const Route = createFileRoute("/_app/auditoria")({
  component: () => <PlaceholderPage title="Auditoria" description="Histórico de eventos importantes do sistema." />,
});
