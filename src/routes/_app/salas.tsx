import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const Route = createFileRoute("/_app/salas")({
  component: () => <PlaceholderPage title="Salas" description="Cadastro e gestão das salas clínicas." />,
});
