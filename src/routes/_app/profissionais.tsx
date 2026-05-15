import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const Route = createFileRoute("/_app/profissionais")({
  component: () => <PlaceholderPage title="Profissionais" description="Cadastro e gestão de profissionais de saúde." />,
});
