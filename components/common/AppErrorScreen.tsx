"use client";

import { AppStateScreen } from "@/components/common/AppStateScreen";

type AppErrorScreenProps = {
  title?: string;
  description?: string;
  retryLabel?: string;
  backLabel?: string;
  onRetry: () => void;
  onBack: () => void;
};

export function AppErrorScreen({
  title = "Nao foi possivel carregar esta pagina",
  description = "Tente novamente agora ou volte para continuar no painel com seguranca.",
  retryLabel = "Tentar novamente",
  backLabel = "Voltar",
  onRetry,
  onBack,
}: AppErrorScreenProps) {
  return (
    <AppStateScreen
      badgeLabel="Erro de carregamento"
      title={title}
      description={description}
      primaryAction={{
        label: retryLabel,
        onClick: onRetry,
      }}
      secondaryAction={{
        label: backLabel,
        onClick: onBack,
        tone: "dark",
      }}
    />
  );
}
