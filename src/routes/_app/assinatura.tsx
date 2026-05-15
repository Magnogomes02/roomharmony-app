import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const Route = createFileRoute("/_app/assinatura")({
  component: () => <PlaceholderPage title="Assinatura digital" description="Visualização e assinatura de contratos." />,
});
