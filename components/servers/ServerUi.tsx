"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function ServerSurface({
  children,
  className,
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <section
      className={cn(
        "flowdesk-server-surface rounded-[24px] border border-[#171717] bg-[linear-gradient(180deg,#0B0B0B_0%,#090909_100%)] shadow-[0_24px_80px_rgba(0,0,0,0.22)]",
        interactive &&
          "transition-[border-color,background-color,box-shadow,transform] duration-200 hover:border-[#242424] hover:bg-[linear-gradient(180deg,#0D0D0D_0%,#090909_100%)]",
        className,
      )}
    >
      {children}
    </section>
  );
}

type ServerButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ServerButtonSize = "sm" | "md" | "lg" | "icon";

const buttonVariantClass: Record<ServerButtonVariant, string> = {
  primary:
    "bg-[#F5F5F5] text-[#080808] shadow-[0_12px_30px_rgba(255,255,255,0.08)] hover:bg-white",
  secondary:
    "border border-[#242424] bg-[#0D0D0D] text-[#E6E6E6] hover:border-[#3A3A3A] hover:bg-[#121212]",
  ghost:
    "border border-transparent bg-transparent text-[#9B9B9B] hover:border-[#202020] hover:bg-[#101010] hover:text-[#F1F1F1]",
  danger:
    "border border-[#3A1E1E] bg-[#160B0B] text-[#F1A7A7] hover:border-[#5A2A2A] hover:bg-[#201010]",
};

const buttonSizeClass: Record<ServerButtonSize, string> = {
  sm: "h-[38px] rounded-[13px] px-[13px] text-[12px]",
  md: "h-[42px] rounded-[14px] px-[15px] text-[13px]",
  lg: "h-[44px] rounded-[14px] px-[16px] text-[13px]",
  icon: "h-[38px] w-[38px] rounded-[13px] p-0",
};

export function ServerButton({
  children,
  className,
  size = "md",
  variant = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: ServerButtonSize;
  variant?: ServerButtonVariant;
}) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "flowdesk-server-button inline-flex shrink-0 items-center justify-center gap-[8px] font-semibold leading-none outline-none transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-200 disabled:cursor-not-allowed disabled:opacity-45",
        buttonVariantClass[variant],
        buttonSizeClass[size],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function ServerIconFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-[15px] border border-[#232323] bg-[#111] text-[#EAEAEA]",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ServerTextInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "flowdesk-server-input h-[44px] w-full rounded-[14px] border border-[#252525] bg-[#0D0D0D] px-[14px] text-[14px] text-[#F1F1F1] outline-none transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-[#646464] focus:border-[#4A4A4A]",
        className,
      )}
    />
  );
}

export function ServerSectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <ServerSurface className="px-[18px] py-[18px] sm:px-[22px] sm:py-[22px]">
      <div className="flex flex-col gap-[16px] lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-[12px] uppercase tracking-[0.18em] text-[#5F5F5F]">
              {eyebrow}
            </p>
          ) : null}
          <h3 className="mt-[10px] text-[22px] leading-none font-medium tracking-[-0.04em] text-[#E4E4E4]">
            {title}
          </h3>
          {description ? (
            <p className="mt-[10px] max-w-[760px] text-[14px] leading-[1.6] text-[#7B7B7B]">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </div>
    </ServerSurface>
  );
}

export function ServerEmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-[22px] py-[44px] text-center">
      <ServerIconFrame className="mx-auto h-[58px] w-[58px] rounded-[18px]">
        {icon}
      </ServerIconFrame>
      <h4 className="mt-[18px] text-[16px] font-semibold text-[#EDEDED]">
        {title}
      </h4>
      <p className="mx-auto mt-[8px] max-w-[440px] text-[13px] leading-[1.6] text-[#777]">
        {description}
      </p>
      {action ? <div className="mt-[18px]">{action}</div> : null}
    </div>
  );
}

export function ServerDiscordRelinkState({
  description = "Sua autorizacao do Discord expirou ou foi revogada. Para proteger o servidor, precisamos confirmar novamente sua conta antes de carregar estas configuracoes.",
}: {
  description?: string;
}) {
  const handleRelink = () => {
    const next =
      typeof window === "undefined"
        ? "/servers"
        : `${window.location.pathname}${window.location.search}`;
    window.location.href = `/discord/link/start?next=${encodeURIComponent(next)}`;
  };

  return (
    <ServerEmptyState
      icon={<span className="text-[20px] font-bold">DC</span>}
      title="Revincule o Discord"
      description={description}
      action={
        <ServerButton onClick={handleRelink} variant="primary">
          Revincular Discord
        </ServerButton>
      }
    />
  );
}
