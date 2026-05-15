import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const Route = createFileRoute("/_app/conflitos")({
  component: () => <PlaceholderPage title="Conflitos" description="Conflitos de horário entre reservas." />,
});
