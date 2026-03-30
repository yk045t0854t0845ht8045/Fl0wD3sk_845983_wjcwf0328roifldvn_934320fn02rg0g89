"use client";

import { useEffect } from "react";
import { LandingGlowTag } from "@/components/landing/LandingGlowTag";
import { ButtonLoader } from "@/components/login/ButtonLoader";

type BotMissingModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onContinue: () => void;
  isChecking: boolean;
  title: string;
  description: string;
};

export function BotMissingModal({
  isOpen,
  onClose,
  onContinue,
  isChecking,
  title,
  description,
}: BotMissingModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isPermissionIssue = title.toLowerCase().includes("permiss");
  const eyebrow = isPermissionIssue ? "Permissoes do bot" : "Integracao do bot";

  return (
    <div className="fixed inset-0 z-[80] isolate flex items-center justify-center px-[18px] py-[28px]">
      <button
        type="button"
        aria-label="Fechar modal do bot"
        className="absolute inset-0 bg-[rgba(0,0,0,0.84)] backdrop-blur-[5px]"
        onClick={onClose}
      />

      <div className="relative z-[10] w-full max-w-[720px] flowdesk-stage-fade">
        <div className="relative overflow-hidden rounded-[32px] bg-transparent px-[22px] py-[22px] shadow-[0_34px_110px_rgba(0,0,0,0.52)] sm:px-[28px] sm:py-[28px]">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[32px] border border-[#0E0E0E]"
          />
          <span
            aria-hidden="true"
            className="flowdesk-tag-border-glow pointer-events-none absolute inset-[-2px] rounded-[32px]"
          />
          <span
            aria-hidden="true"
            className="flowdesk-tag-border-core pointer-events-none absolute inset-[-1px] rounded-[32px]"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-[1px] rounded-[31px] bg-[linear-gradient(180deg,rgba(8,8,8,0.985)_0%,rgba(4,4,4,0.985)_100%)]"
          />

          <div className="relative z-10">
            <div className="flex flex-col gap-[14px] sm:flex-row sm:items-start sm:justify-between">
              <div>
                <LandingGlowTag className="px-[18px]">{eyebrow}</LandingGlowTag>

                <div className="mt-[18px]">
                  <h2 className="bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[30px] leading-[0.98] font-normal tracking-[-0.05em] text-transparent sm:text-[36px]">
                    {title}
                  </h2>
                  <p className="mt-[14px] max-w-[560px] text-[14px] leading-[1.62] text-[#787878]">
                    {description}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-[14px] border border-[#171717] bg-[#0D0D0D] text-[#9C9C9C] transition-colors hover:border-[#242424] hover:text-[#E4E4E4]"
                aria-label="Fechar modal"
              >
                <span className="text-[18px] leading-none">x</span>
              </button>
            </div>

            <div className="mt-[24px] flex flex-col-reverse gap-[10px] sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-[46px] items-center justify-center rounded-[14px] border border-[#171717] bg-[#0D0D0D] px-[18px] text-[14px] font-medium text-[#CACACA] transition-colors hover:border-[#232323] hover:bg-[#111111] hover:text-[#F1F1F1]"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={onContinue}
                disabled={isChecking}
                aria-busy={isChecking}
                className={`group relative inline-flex h-[46px] shrink-0 items-center justify-center overflow-visible whitespace-nowrap rounded-[12px] px-6 text-[14px] leading-none font-semibold disabled:cursor-not-allowed disabled:opacity-75`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-0 rounded-[12px] transition-transform duration-150 ease-out ${
                    isChecking
                      ? "bg-[#111111]"
                      : "bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] group-hover:scale-[1.02] group-active:scale-[0.985]"
                  }`}
                />
                <span
                  className={`relative z-10 inline-flex items-center justify-center gap-[8px] whitespace-nowrap leading-none ${
                    isChecking ? "text-[#B7B7B7]" : "text-[#111111]"
                  }`}
                >
                  {isChecking ? (
                    <ButtonLoader
                      size={16}
                      colorClassName={isChecking ? "text-[#B7B7B7]" : "text-[#111111]"}
                    />
                  ) : (
                    "Continuar"
                  )}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
