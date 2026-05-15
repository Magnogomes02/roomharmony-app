import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const Route = createFileRoute("/_app/contratos")({
  component: () => <PlaceholderPage title="Contratos" description="Contratos de locação com recorrência semanal." />,
});
