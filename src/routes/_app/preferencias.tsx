import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const Route = createFileRoute("/_app/preferencias")({
  component: () => <PlaceholderPage title="Preferências" description="Configurações globais do sistema." />,
});
