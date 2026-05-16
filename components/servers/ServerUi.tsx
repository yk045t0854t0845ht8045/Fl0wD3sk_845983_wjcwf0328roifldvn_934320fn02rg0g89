"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import {
  buildDiscordAuthStartHref,
  getCurrentBrowserInternalPath,
} from "@/lib/auth/paths";

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
    const next = getCurrentBrowserInternalPath("/servers");
    window.location.assign(buildDiscordAuthStartHref(next, "link"));
  };

  return (
    <div className="relative overflow-hidden rounded-[30px] px-[22px] py-[22px] shadow-[0_28px_90px_rgba(0,0,0,0.34)] sm:px-[28px] sm:py-[28px]">
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[30px] border border-[#111]" />
      <span aria-hidden="true" className="pointer-events-none absolute inset-[1px] rounded-[29px] bg-[linear-gradient(180deg,rgba(8,8,8,0.985)_0%,rgba(4,4,4,0.985)_100%)]" />
      <div className="relative z-10">
        <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#9BB7FF]">
          Login Discord necessario
        </p>
        <h4 className="mt-[12px] text-[26px] leading-[1] font-medium tracking-[-0.05em] text-[#EFEFEF]">
          Vincule sua conta Discord
        </h4>
        <p className="mt-[12px] max-w-[560px] text-[14px] leading-[1.62] text-[#858585]">
          {description}
        </p>
        <button
          type="button"
          onClick={handleRelink}
          className="group relative mt-[24px] inline-flex h-[46px] shrink-0 items-center justify-center overflow-visible whitespace-nowrap rounded-[12px] px-6 text-[14px] leading-none font-semibold"
        >
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-[12px] bg-[#F3F3F3] transition-transform duration-150 ease-out group-hover:scale-[1.02] group-active:scale-[0.985]"
          />
          <span className="relative z-10 inline-flex items-center justify-center whitespace-nowrap leading-none text-[#111111]">
            Vincular com Discord
          </span>
        </button>
      </div>
    </div>
  );
}

export function ServerDeleteConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Excluir",
  isDeleting = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  isDeleting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[2600] isolate overflow-y-auto overscroll-contain">
      <button
        type="button"
        aria-label="Fechar modal"
        className="absolute inset-0 bg-[rgba(0,0,0,0.84)] backdrop-blur-[7px]"
        onClick={onCancel}
      />
      <div className="relative z-[10] flex min-h-full items-center justify-center px-[18px] py-[28px]">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="flowdesk-stage-fade relative w-full max-w-[620px] overflow-hidden rounded-[30px] px-[22px] py-[22px] shadow-[0_34px_110px_rgba(0,0,0,0.52)] sm:px-[28px] sm:py-[28px]"
        >
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[30px] border border-[#111]" />
          <span aria-hidden="true" className="pointer-events-none absolute inset-[1px] rounded-[29px] bg-[linear-gradient(180deg,rgba(8,8,8,0.985)_0%,rgba(4,4,4,0.985)_100%)]" />
          <div className="relative z-10">
            <div className="flex items-start justify-between gap-[14px]">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#DB6B6B]">
                  Exclusao
                </p>
                <h2 className="mt-[12px] text-[28px] leading-[1] font-medium tracking-[-0.05em] text-[#EFEFEF]">
                  {title}
                </h2>
                <p className="mt-[12px] max-w-[520px] text-[14px] leading-[1.62] text-[#858585]">
                  {description}
                </p>
              </div>
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[14px] border border-[#171717] bg-[#0D0D0D] text-[#9C9C9C] transition-colors hover:border-[#242424] hover:text-[#E4E4E4]"
                aria-label="Fechar modal"
              >
                <span className="text-[18px] leading-none">x</span>
              </button>
            </div>
            <div className="mt-[24px] flex flex-col-reverse gap-[10px] sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onCancel}
                disabled={isDeleting}
                className="inline-flex h-[46px] items-center justify-center rounded-[14px] border border-[#171717] bg-[#0D0D0D] px-[18px] text-[14px] font-medium text-[#CACACA] transition-colors hover:border-[#232323] hover:bg-[#111111] hover:text-[#F1F1F1] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={isDeleting}
                aria-busy={isDeleting}
                className="group relative inline-flex h-[46px] shrink-0 items-center justify-center overflow-visible whitespace-nowrap rounded-[12px] px-6 text-[14px] leading-none font-semibold disabled:cursor-not-allowed disabled:opacity-75"
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-0 rounded-[12px] transition-transform duration-150 ease-out ${
                    isDeleting
                      ? "bg-[#1a0a0a]"
                      : "bg-[linear-gradient(180deg,#e05252_0%,#b52f2f_100%)] group-hover:scale-[1.02] group-active:scale-[0.985]"
                  }`}
                />
                <span className={`relative z-10 inline-flex items-center justify-center gap-[8px] whitespace-nowrap leading-none ${isDeleting ? "text-[#c49a9a]" : "text-white"}`}>
                  {isDeleting ? (
                    <ButtonLoader size={16} colorClassName="text-[#c49a9a]" />
                  ) : (
                    <Trash2 className="h-[15px] w-[15px]" />
                  )}
                  {confirmLabel}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ServerDangerZone({
  title,
  description,
  actionLabel,
  disabled = false,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  disabled?: boolean;
  onAction: () => void;
}) {
  return (
    <ServerSurface className="border-[#2A1717] bg-[linear-gradient(180deg,#0D0808_0%,#080707_100%)] p-[18px] sm:p-[22px]">
      <div className="flex flex-col gap-[16px] sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#A95757]">
            Zona de exclusao
          </p>
          <h4 className="mt-[9px] text-[16px] font-semibold text-[#F0E6E6]">
            {title}
          </h4>
          <p className="mt-[7px] max-w-[720px] text-[13px] leading-[1.55] text-[#8A7373]">
            {description}
          </p>
        </div>
        <ServerButton
          variant="danger"
          disabled={disabled}
          onClick={onAction}
          className="self-start sm:self-auto"
        >
          <Trash2 className="h-[15px] w-[15px]" />
          {actionLabel}
        </ServerButton>
      </div>
    </ServerSurface>
  );
}
