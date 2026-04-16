"use client";

import { useRouter } from "next/navigation";
import { AppStateScreen } from "@/components/common/AppStateScreen";

type AppMaintenanceScreenProps = {
  badgeLabel?: string;
  title?: string;
  description?: string;
  refreshLabel?: string;
  backLabel?: string;
  fallbackHref?: string;
};

export function AppMaintenanceScreen({
  badgeLabel = "Em breve disponivel",
  title = "Esta area esta em manutencao",
  description = "Estamos ajustando esta parte da Flowdesk para liberar tudo com mais estabilidade. Tente novamente em instantes ou volte para continuar navegando.",
  refreshLabel = "Atualizar pagina",
  backLabel = "Voltar",
  fallbackHref = "/",
}: AppMaintenanceScreenProps) {
  const router = useRouter();

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }

    router.push(fallbackHref);
  };

  return (
    <AppStateScreen
      badgeLabel={badgeLabel}
      title={title}
      description={description}
      primaryAction={{
        label: refreshLabel,
        onClick: () => router.refresh(),
      }}
      secondaryAction={{
        label: backLabel,
        onClick: handleBack,
        tone: "dark",
      }}
    />
  );
}
