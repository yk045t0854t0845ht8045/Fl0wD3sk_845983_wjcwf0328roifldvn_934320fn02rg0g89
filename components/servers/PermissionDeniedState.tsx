"use client";

import { LandingGlowTag } from "@/components/landing/LandingGlowTag";
import { ServerButton } from "@/components/servers/ServerUi";

type PermissionDeniedStateProps = {
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction: () => void;
};

export function PermissionDeniedState({
  title = "Voce nao tem permissao para acessar esta sessao",
  description = "A conta vinculada definiu que seu cargo nao pode visualizar ou editar estas configuracoes. Entre em contato com o dono do plano para solicitar acesso.",
  actionLabel = "Voltar para o inicio",
  onAction,
}: PermissionDeniedStateProps) {
  return (
    <div className="flowdesk-servers-ui flex min-h-[65vh] flex-col items-center justify-center px-[18px] py-[120px] text-center md:py-[180px]">
      <div className="mx-auto flex w-fit justify-center">
        <LandingGlowTag className="px-[26px]">Acesso Restrito</LandingGlowTag>
      </div>

      <h1 className="mt-[22px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[30px] leading-[1.15] font-normal tracking-[-0.05em] text-transparent md:text-[38px]">
        {title.split("acessar").map((part, index) => (
          <span key={index}>
            {part}
            {index === 0 && <br className="hidden md:block" />}
            {index === 0 && "acessar"}
          </span>
        ))}
      </h1>

      <p className="mx-auto mt-[16px] max-w-[500px] text-[14px] leading-[1.65] text-[#7D7D7D] md:text-[15px]">
        {description}
      </p>

      <ServerButton
        onClick={onAction}
        variant="primary"
        size="lg"
        className="mt-[28px] h-[46px] px-8 text-[15px]"
      >
        {actionLabel}
      </ServerButton>
    </div>
  );
}
