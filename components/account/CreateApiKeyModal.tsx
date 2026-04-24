"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ConfigStepSelect } from "@/components/config/ConfigStepSelect";
import { LandingGlowTag } from "@/components/landing/LandingGlowTag";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import { useBodyScrollLock } from "@/lib/ui/useBodyScrollLock";

type CreateApiKeyModalProps = {
  isOpen: boolean;
  isProcessing: boolean;
  errorMessage?: string | null;
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    reason: string;
    expiresAt: string | null;
  }) => Promise<void>;
};

const REASON_OPTIONS = [
  "Desenvolvedor",
  "Freelancer",
  "Estudante",
  "Trabalho",
  "Agencia",
  "Startup",
  "Empresa",
  "Uso pessoal",
  "Automacao",
  "Integracao",
  "Outro",
] as const;

const EXPIRATION_OPTIONS = [
  { value: "today", label: "Hoje" },
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "60", label: "60 dias" },
  { value: "90", label: "90 dias" },
  { value: "custom", label: "Personalizado" },
  { value: "never", label: "Sem data de expiracao" },
] as const;

function formatDateMask(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);

  if (digits.length <= 2) {
    return digits;
  }

  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }

  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function buildEndOfDayDate(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function resolveExpirationDate(input: {
  preset: string;
  customDate: string;
}) {
  if (input.preset === "never") {
    return {
      ok: true as const,
      value: null,
    };
  }

  if (input.preset === "today") {
    return {
      ok: true as const,
      value: buildEndOfDayDate(new Date()).toISOString(),
    };
  }

  if (input.preset === "custom") {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input.customDate.trim());
    if (!match) {
      return {
        ok: false as const,
        message: "Informe uma data valida no formato 00/00/0000.",
      };
    }

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const candidate = new Date(year, month - 1, day);

    if (
      !Number.isFinite(candidate.getTime()) ||
      candidate.getFullYear() !== year ||
      candidate.getMonth() !== month - 1 ||
      candidate.getDate() !== day
    ) {
      return {
        ok: false as const,
        message: "A data personalizada informada nao e valida.",
      };
    }

    const normalized = buildEndOfDayDate(candidate);
    if (normalized.getTime() <= Date.now()) {
      return {
        ok: false as const,
        message: "Escolha uma data futura para a expiracao personalizada.",
      };
    }

    return {
      ok: true as const,
      value: normalized.toISOString(),
    };
  }

  const days = Number.parseInt(input.preset, 10);
  if (!Number.isFinite(days) || days <= 0) {
    return {
      ok: false as const,
      message: "Opcao de expiracao invalida.",
    };
  }

  const future = new Date();
  future.setDate(future.getDate() + days);

  return {
    ok: true as const,
    value: buildEndOfDayDate(future).toISOString(),
  };
}

export function CreateApiKeyModal({
  isOpen,
  ...dialogProps
}: CreateApiKeyModalProps) {
  useBodyScrollLock(isOpen);

  if (!isOpen) {
    return null;
  }

  const portalTarget = typeof document === "undefined" ? null : document.body;
  if (!portalTarget) {
    return null;
  }

  return createPortal(<CreateApiKeyModalDialog {...dialogProps} />, portalTarget);
}

function CreateApiKeyModalDialog({
  isProcessing,
  errorMessage,
  onClose,
  onSubmit,
}: Omit<CreateApiKeyModalProps, "isOpen">) {
  const [name, setName] = useState("");
  const [reason, setReason] = useState<string>(REASON_OPTIONS[0]);
  const [expirationPreset, setExpirationPreset] = useState<string>("never");
  const [customDate, setCustomDate] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isProcessing) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isProcessing, onClose]);

  const customDatePlaceholder = useMemo(() => "00/00/0000", []);
  const reasonSelectOptions = useMemo(
    () => REASON_OPTIONS.map((option) => ({ id: option, name: option })),
    [],
  );
  const expirationSelectOptions = useMemo(
    () =>
      EXPIRATION_OPTIONS.map((option) => ({
        id: option.value,
        name: option.label,
      })),
    [],
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setValidationError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setValidationError("Informe um nome para identificar a chave.");
      return;
    }

    const expiration = resolveExpirationDate({
      preset: expirationPreset,
      customDate,
    });

    if (!expiration.ok) {
      setValidationError(expiration.message);
      return;
    }

    await onSubmit({
      name: trimmedName,
      reason,
      expiresAt: expiration.value,
    });
  }

  const modalContent = (
    <div className="fixed inset-0 z-[2600] isolate overflow-y-auto overscroll-contain">
      <button
        type="button"
        aria-label="Fechar modal"
        className="absolute inset-0 bg-[rgba(0,0,0,0.84)] backdrop-blur-[7px]"
        onClick={isProcessing ? undefined : onClose}
      />

      <div className="relative z-[10] min-h-full px-[18px] py-[28px] md:px-6">
        <div className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-[820px] items-center justify-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Criar chave de API"
            className="flowdesk-stage-fade relative w-full overflow-hidden rounded-[32px] bg-transparent px-[22px] py-[22px] shadow-[0_34px_110px_rgba(0,0,0,0.52)] sm:px-[28px] sm:py-[28px]"
          >
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
                  <LandingGlowTag className="px-[18px]">
                    API FlowAI
                  </LandingGlowTag>
                  <div className="mt-[18px]">
                    <h2 className="bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[30px] leading-[0.98] font-normal tracking-[-0.05em] text-transparent sm:text-[36px]">
                      Criar nova chave de API
                    </h2>
                    <p className="mt-[14px] max-w-[620px] text-[14px] leading-[1.62] text-[#787878]">
                      Gere uma chave de API para autenticacao com nossa API.
                      Observe que suas chaves de API sao confidenciais e nao sao
                      compartilhadas dentro da sua organizacao.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  disabled={isProcessing}
                  className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-[14px] border border-[#171717] bg-[#0D0D0D] text-[#9C9C9C] transition-colors hover:border-[#242424] hover:text-[#E4E4E4] disabled:opacity-60"
                  aria-label="Fechar modal"
                >
                  <span className="text-[18px] leading-none">x</span>
                </button>
              </div>

              <form onSubmit={handleSubmit} className="mt-[24px] space-y-[18px]">
                <div className="rounded-[22px] border border-[#161616] bg-[#090909] px-[18px] py-[18px]">
                  <div className="space-y-[16px]">
                    <label className="flex flex-col gap-[8px]">
                      <span className="text-[12px] uppercase tracking-[0.16em] text-[#666666]">
                        Nome da chave
                      </span>
                      <input
                        type="text"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="Ex: Producao principal"
                        className="h-[50px] rounded-[14px] border border-[#181818] bg-[#0D0D0D] px-[16px] text-[14px] text-[#E6E6E6] outline-none transition-colors placeholder:text-[#5A5A5A] focus:border-[#2D2D2D]"
                      />
                    </label>

                    <div className="flex flex-col gap-[8px]">
                      <span className="text-[12px] uppercase tracking-[0.16em] text-[#666666]">
                        Razao
                      </span>
                      <ConfigStepSelect
                        label=""
                        placeholder="Selecione a razao"
                        options={reasonSelectOptions}
                        value={reason}
                        onChange={setReason}
                        controlHeightPx={50}
                        variant="immersive"
                      />
                    </div>

                    <div className="flex flex-col gap-[8px]">
                      <span className="text-[12px] uppercase tracking-[0.16em] text-[#666666]">
                        Expiracao
                      </span>
                      <ConfigStepSelect
                        label=""
                        placeholder="Selecione a expiracao"
                        options={expirationSelectOptions}
                        value={expirationPreset}
                        onChange={(value) => {
                          setExpirationPreset(value);
                          if (value !== "custom") {
                            setCustomDate("");
                          }
                        }}
                        controlHeightPx={50}
                        variant="immersive"
                      />
                    </div>

                    {expirationPreset === "custom" ? (
                      <label className="flex flex-col gap-[8px]">
                        <span className="text-[12px] uppercase tracking-[0.16em] text-[#666666]">
                          Data personalizada
                        </span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={customDate}
                          onChange={(event) =>
                            setCustomDate(formatDateMask(event.target.value))
                          }
                          placeholder={customDatePlaceholder}
                          className="h-[50px] rounded-[14px] border border-[#181818] bg-[#0D0D0D] px-[16px] text-[14px] text-[#E6E6E6] outline-none transition-colors placeholder:text-[#5A5A5A] focus:border-[#2D2D2D]"
                        />
                      </label>
                    ) : null}
                  </div>
                </div>

                {validationError || errorMessage ? (
                  <div className="rounded-[14px] border border-[rgba(219,70,70,0.16)] bg-[rgba(219,70,70,0.08)] px-[16px] py-[14px] text-[13px] text-[#FFB4B4]">
                    {validationError || errorMessage}
                  </div>
                ) : null}

                <div className="flex flex-col-reverse gap-[10px] sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isProcessing}
                    className="inline-flex h-[46px] items-center justify-center rounded-[14px] border border-[#171717] bg-[#0D0D0D] px-[18px] text-[14px] font-medium text-[#CACACA] transition-colors hover:border-[#232323] hover:bg-[#111111] hover:text-[#F1F1F1] disabled:opacity-60"
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    disabled={isProcessing}
                    aria-busy={isProcessing}
                    className="group relative inline-flex h-[46px] shrink-0 items-center justify-center overflow-visible whitespace-nowrap rounded-[12px] px-6 text-[14px] leading-none font-semibold disabled:cursor-not-allowed disabled:opacity-75"
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute inset-0 rounded-[12px] transition-transform duration-150 ease-out ${
                        isProcessing
                          ? "bg-[#d0d0d0]"
                          : "bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] group-hover:scale-[1.02] group-active:scale-[0.985]"
                      }`}
                    />
                    <span className="relative z-10 inline-flex items-center justify-center gap-[8px] whitespace-nowrap leading-none text-[#282828]">
                      {isProcessing ? (
                        <ButtonLoader size={16} colorClassName="text-[#282828]" />
                      ) : (
                        "Criar Chave"
                      )}
                    </span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return modalContent;
}
