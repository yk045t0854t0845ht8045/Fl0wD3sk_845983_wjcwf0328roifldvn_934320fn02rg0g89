"use client";

import { LandingGlowTag } from "@/components/landing/LandingGlowTag";

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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#040404] px-6 py-10 text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0.014)_28%,transparent_68%)]"
      />

      <section className="relative z-10 w-full max-w-[560px] text-center">
        <div className="mx-auto flex w-fit justify-center">
          <LandingGlowTag className="px-[26px]">Erro de carregamento</LandingGlowTag>
        </div>

        <h1 className="mt-[22px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[34px] leading-[1.02] font-normal tracking-[-0.05em] text-transparent md:text-[42px]">
          {title}
        </h1>

        <p className="mx-auto mt-[16px] max-w-[520px] text-[14px] leading-[1.65] text-[#7D7D7D] md:text-[15px]">
          {description}
        </p>

        <div className="mx-auto mt-[26px] grid max-w-[420px] grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onRetry}
            className="group relative inline-flex h-[46px] items-center justify-center overflow-hidden rounded-[12px] px-6 text-[16px] leading-none font-semibold"
          >
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-[12px] bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] transition-transform duration-150 ease-out group-hover:scale-[1.02] group-active:scale-[0.985]"
            />
            <span className="relative z-10 text-[#282828]">{retryLabel}</span>
          </button>

          <button
            type="button"
            onClick={onBack}
            className="group relative inline-flex h-[46px] items-center justify-center overflow-hidden rounded-[12px] px-6 text-[16px] leading-none font-semibold"
          >
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-[12px] bg-[#111111] transition-transform duration-150 ease-out group-hover:scale-[1.02] group-active:scale-[0.985]"
            />
            <span className="relative z-10 text-[#B7B7B7]">{backLabel}</span>
          </button>
        </div>
      </section>
    </main>
  );
}
