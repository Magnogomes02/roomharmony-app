import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const Route = createFileRoute("/_app/calendario")({
  component: () => <PlaceholderPage title="Calendário" description="Agenda semanal de reservas." />,
});
