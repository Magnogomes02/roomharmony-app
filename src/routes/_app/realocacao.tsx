import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const Route = createFileRoute("/_app/realocacao")({
  component: () => <PlaceholderPage title="Realocação" description="Realocar reservas para outras salas/horários." />,
});
