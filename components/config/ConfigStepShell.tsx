import type { ReactNode } from "react";
import Image from "next/image";
import { Check, CircleDot } from "lucide-react";
import type { ConfigGuildItem } from "@/components/config/ConfigServerSwitcher";
import { LandingFrameLines } from "@/components/landing/LandingFrameLines";
import { LandingGlowTag } from "@/components/landing/LandingGlowTag";

type ConfigStepShellProps = {
  stepNumber: 1 | 2 | 3 | 4;
  title: string;
  description: string;
  children: ReactNode;
  sidebar?: ReactNode;
  guild?: ConfigGuildItem | null;
  guildId?: string | null;
  topPaddingClass?: string;
};

type ConfigSidebarCardProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
  className?: string;
};

type ConfigFieldCardProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
};

type ConfigChecklistItemProps = {
  label: string;
  value: string;
  complete?: boolean;
};

function resolveSidebarToneClasses(
  tone: NonNullable<ConfigSidebarCardProps["tone"]>,
) {
  switch (tone) {
    case "success":
      return {
        border: "border-[rgba(106,226,90,0.18)]",
        eyebrow: "text-[#8BCF80]",
        glow: "bg-[radial-gradient(circle_at_top_left,rgba(106,226,90,0.14)_0%,transparent_60%)]",
      };
    case "warning":
      return {
        border: "border-[rgba(242,200,35,0.2)]",
        eyebrow: "text-[#F2C823]",
        glow: "bg-[radial-gradient(circle_at_top_left,rgba(242,200,35,0.12)_0%,transparent_60%)]",
      };
    case "danger":
      return {
        border: "border-[rgba(219,70,70,0.22)]",
        eyebrow: "text-[#D98484]",
        glow: "bg-[radial-gradient(circle_at_top_left,rgba(219,70,70,0.12)_0%,transparent_60%)]",
      };
    default:
      return {
        border: "border-[#151515]",
        eyebrow: "text-[#7C7C7C]",
        glow: "bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.05)_0%,transparent_60%)]",
      };
  }
}

function buildGuildFallbackLetter(guild: ConfigGuildItem | null | undefined) {
  const name = String(guild?.name || "").trim();
  return name ? name.slice(0, 1).toUpperCase() : "S";
}

function ConfigGuildSummaryCard({
  guild,
  guildId,
}: {
  guild?: ConfigGuildItem | null;
  guildId?: string | null;
}) {
  const fallbackGuildId = String(guildId || "").trim();

  return (
    <div className="relative overflow-hidden rounded-[28px] border border-[#151515] bg-[linear-gradient(180deg,rgba(10,10,10,0.96)_0%,rgba(6,6,6,0.98)_100%)] p-[18px] shadow-[0_24px_80px_rgba(0,0,0,0.32)]">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(116,176,255,0.12)_0%,transparent_58%)]"
      />
      <p className="relative z-10 text-[11px] font-medium tracking-[0.18em] uppercase text-[#6E6E6E]">
        Servidor em configuracao
      </p>

      <div className="relative z-10 mt-[16px] flex items-start gap-[14px]">
        <div className="relative flex h-[58px] w-[58px] shrink-0 items-center justify-center overflow-hidden rounded-[20px] border border-[rgba(255,255,255,0.08)] bg-[#101010] text-[20px] font-semibold text-[#ECECEC]">
          {guild?.icon_url ? (
            <Image
              src={guild.icon_url}
              alt={guild.name}
              fill
              sizes="58px"
              className="object-cover"
            />
          ) : (
            buildGuildFallbackLetter(guild)
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[18px] leading-[1.05] font-medium tracking-[-0.04em] text-[#F1F1F1]">
            {guild?.name || "Servidor selecionado"}
          </p>
          <p className="mt-[8px] truncate text-[12px] text-[#737373]">
            {fallbackGuildId ? `ID ${fallbackGuildId}` : "Identificador carregando"}
          </p>
        </div>
      </div>
    </div>
  );
}

export function ConfigStepShell({
  stepNumber,
  title,
  description,
  children,
  sidebar,
  guild,
  guildId,
  topPaddingClass = "pt-[118px]",
}: ConfigStepShellProps) {
  return (
    <main className="relative min-h-screen overflow-x-clip bg-[#040404] text-white">
      <LandingFrameLines />

      <div
        className={`relative mx-auto flex min-h-screen w-full max-w-[1582px] items-start justify-center px-[20px] pb-[42px] md:px-6 lg:px-8 xl:px-10 2xl:px-[20px] ${topPaddingClass}`}
      >
        <section className="w-full max-w-[1320px] flowdesk-stage-fade">
          <div className="mx-auto max-w-[920px] text-center">
            <LandingGlowTag>Configuracao do ticket | Etapa {stepNumber}</LandingGlowTag>

            <h1 className="mt-[24px] bg-[linear-gradient(90deg,#ECECEC_0%,#BCBCBC_100%)] bg-clip-text text-[38px] leading-[0.98] font-normal tracking-[-0.06em] text-transparent sm:text-[48px] lg:text-[58px]">
              {title}
            </h1>

            <p className="mx-auto mt-[16px] max-w-[760px] text-[15px] leading-[1.72] text-[#858585] sm:text-[16px]">
              {description}
            </p>
          </div>

          <div
            className={`mt-[34px] grid gap-[22px] ${
              sidebar ? "xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start" : ""
            }`}
          >
            <div className="min-w-0 space-y-[18px]">{children}</div>

            {sidebar ? (
              <aside className="space-y-[18px] xl:sticky xl:top-[108px]">
                <ConfigGuildSummaryCard guild={guild} guildId={guildId} />
                {sidebar}
              </aside>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

export function ConfigSidebarCard({
  eyebrow,
  title,
  description,
  children,
  tone = "neutral",
  className = "",
}: ConfigSidebarCardProps) {
  const toneClasses = resolveSidebarToneClasses(tone);

  return (
    <div
      className={`relative overflow-hidden rounded-[28px] border bg-[linear-gradient(180deg,rgba(10,10,10,0.98)_0%,rgba(7,7,7,0.98)_100%)] p-[18px] shadow-[0_22px_70px_rgba(0,0,0,0.28)] ${toneClasses.border} ${className}`.trim()}
    >
      <span aria-hidden="true" className={`pointer-events-none absolute inset-0 ${toneClasses.glow}`} />

      <div className="relative z-10">
        {eyebrow ? (
          <p className={`text-[11px] font-medium tracking-[0.18em] uppercase ${toneClasses.eyebrow}`}>
            {eyebrow}
          </p>
        ) : null}

        <p className={`${eyebrow ? "mt-[12px]" : ""} text-[20px] leading-[1.08] font-medium tracking-[-0.04em] text-[#F1F1F1]`}>
          {title}
        </p>

        {description ? (
          <p className="mt-[10px] text-[13px] leading-[1.65] text-[#7B7B7B]">
            {description}
          </p>
        ) : null}

        {children ? <div className="mt-[16px]">{children}</div> : null}
      </div>
    </div>
  );
}

export function ConfigFieldCard({
  eyebrow,
  title,
  description,
  icon,
  children,
  className = "",
}: ConfigFieldCardProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-[28px] border border-[#151515] bg-[linear-gradient(180deg,rgba(11,11,11,0.98)_0%,rgba(7,7,7,0.98)_100%)] p-[18px] shadow-[0_22px_70px_rgba(0,0,0,0.26)] ${className}`.trim()}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.04)_0%,transparent_62%)]"
      />

      <div className="relative z-10">
        <div className="flex items-start gap-[14px]">
          {icon ? (
            <div className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[16px] border border-[#171717] bg-[#0E0E0E] text-[#CFCFCF]">
              {icon}
            </div>
          ) : null}

          <div className="min-w-0">
            {eyebrow ? (
              <p className="text-[11px] font-medium tracking-[0.18em] uppercase text-[#676767]">
                {eyebrow}
              </p>
            ) : null}
            <p className={`${eyebrow ? "mt-[8px]" : ""} text-[19px] leading-[1.12] font-medium tracking-[-0.04em] text-[#F1F1F1]`}>
              {title}
            </p>
            {description ? (
              <p className="mt-[8px] text-[13px] leading-[1.62] text-[#7A7A7A]">
                {description}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-[18px]">{children}</div>
      </div>
    </div>
  );
}

export function ConfigChecklistItem({
  label,
  value,
  complete = false,
}: ConfigChecklistItemProps) {
  return (
    <div className="flex items-start gap-[10px] rounded-[18px] border border-[#151515] bg-[rgba(11,11,11,0.7)] px-[14px] py-[12px]">
      <span
        className={`mt-[2px] inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border ${
          complete
            ? "border-[rgba(106,226,90,0.24)] bg-[rgba(106,226,90,0.12)] text-[#B7E7AE]"
            : "border-[#2A2A2A] bg-[#101010] text-[#6B6B6B]"
        }`}
      >
        {complete ? <Check className="h-[11px] w-[11px]" strokeWidth={2.5} /> : <CircleDot className="h-[11px] w-[11px]" strokeWidth={2.2} />}
      </span>

      <div className="min-w-0">
        <p className="text-[13px] font-medium text-[#E3E3E3]">{label}</p>
        <p className="mt-[4px] truncate text-[12px] text-[#777777]">{value}</p>
      </div>
    </div>
  );
}
