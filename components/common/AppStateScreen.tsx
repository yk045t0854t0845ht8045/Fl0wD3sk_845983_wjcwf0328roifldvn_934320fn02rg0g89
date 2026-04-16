"use client";

import { LandingGlowTag } from "@/components/landing/LandingGlowTag";

type ScreenAction = {
  label: string;
  onClick: () => void;
  tone?: "light" | "dark";
};

type AppStateScreenProps = {
  badgeLabel: string;
  title: string;
  description: string;
  primaryAction: ScreenAction;
  secondaryAction?: ScreenAction;
};

function ActionButton({
  label,
  onClick,
  tone = "light",
}: ScreenAction) {
  const backgroundClass =
    tone === "light"
      ? "bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)]"
      : "bg-[#111111]";
  const textClass = tone === "light" ? "text-[#282828]" : "text-[#B7B7B7]";

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative inline-flex h-[46px] items-center justify-center overflow-hidden rounded-[12px] px-6 text-[16px] leading-none font-semibold"
    >
      <span
        aria-hidden="true"
        className={`absolute inset-0 rounded-[12px] ${backgroundClass} transition-transform duration-150 ease-out group-hover:scale-[1.02] group-active:scale-[0.985]`}
      />
      <span className={`relative z-10 ${textClass}`}>{label}</span>
    </button>
  );
}

export function AppStateScreen({
  badgeLabel,
  title,
  description,
  primaryAction,
  secondaryAction,
}: AppStateScreenProps) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#040404] px-6 py-10 text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0.014)_28%,transparent_68%)]"
      />

      <section className="relative z-10 w-full max-w-[560px] text-center">
        <div className="mx-auto flex w-fit justify-center">
          <LandingGlowTag className="px-[26px]">{badgeLabel}</LandingGlowTag>
        </div>

        <h1 className="mt-[22px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[34px] leading-[1.02] font-normal tracking-[-0.05em] text-transparent md:text-[42px]">
          {title}
        </h1>

        <p className="mx-auto mt-[16px] max-w-[520px] text-[14px] leading-[1.65] text-[#7D7D7D] md:text-[15px]">
          {description}
        </p>

        <div className="mx-auto mt-[26px] grid max-w-[420px] grid-cols-1 gap-3 sm:grid-cols-2">
          <ActionButton {...primaryAction} />
          {secondaryAction ? <ActionButton {...secondaryAction} /> : null}
        </div>
      </section>
    </main>
  );
}
