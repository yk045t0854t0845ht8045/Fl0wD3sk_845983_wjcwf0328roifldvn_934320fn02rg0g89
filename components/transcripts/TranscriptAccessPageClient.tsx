"use client";

import type {
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LandingGlowTag } from "@/components/landing/LandingGlowTag";
import { LandingReveal } from "@/components/landing/LandingReveal";

type TranscriptAccessPageClientProps = {
  protocol: string;
  initialSessionExpiresAt: string | null;
  isUnavailable?: boolean;
};

const EMPTY_DIGITS = ["", "", "", ""] as const;

function formatRemainingTime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function TranscriptAccessPageClient({
  protocol,
  initialSessionExpiresAt,
  isUnavailable = false,
}: TranscriptAccessPageClientProps) {
  const [digits, setDigits] = useState<string[]>([...EMPTY_DIGITS]);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [frameSeed, setFrameSeed] = useState(0);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(
    initialSessionExpiresAt,
  );
  const [remainingLabel, setRemainingLabel] = useState<string | null>(null);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const lastSubmittedCodeRef = useRef<string | null>(null);

  const code = useMemo(() => digits.join(""), [digits]);
  const hasActiveSession = useMemo(() => {
    if (isUnavailable) return false;
    if (!sessionExpiresAt) return false;
    return new Date(sessionExpiresAt).getTime() > Date.now();
  }, [isUnavailable, sessionExpiresAt]);

  useEffect(() => {
    if (!hasActiveSession || !sessionExpiresAt) {
      setRemainingLabel(null);
      return;
    }

    const updateRemaining = () => {
      const expiresAtMs = new Date(sessionExpiresAt).getTime();
      const delta = expiresAtMs - Date.now();

      if (delta <= 0) {
        setRemainingLabel("00:00");
        setSessionExpiresAt(null);
        setFrameSeed((current) => current + 1);
        setMessage("A sessao expirou. Digite o codigo novamente.");
        setIsError(true);
        setDigits([...EMPTY_DIGITS]);
        void fetch(`/api/transcripts/${encodeURIComponent(protocol)}/logout`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        }).catch(() => null);
        return;
      }

      setRemainingLabel(formatRemainingTime(delta));
    };

    updateRemaining();
    const interval = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(interval);
  }, [hasActiveSession, protocol, sessionExpiresAt]);

  function updateDigit(index: number, nextValue: string) {
    const safeValue = nextValue.replace(/\D/g, "").slice(-1);
    setDigits((current) => {
      const nextDigits = [...current];
      nextDigits[index] = safeValue;
      return nextDigits;
    });

    if (safeValue && index < inputRefs.current.length - 1) {
      inputRefs.current[index + 1]?.focus();
      inputRefs.current[index + 1]?.select();
    }
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
      inputRefs.current[index - 1]?.select();
      return;
    }

    if (event.key === "ArrowLeft" && index > 0) {
      inputRefs.current[index - 1]?.focus();
      return;
    }

    if (event.key === "ArrowRight" && index < inputRefs.current.length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const pastedDigits = event.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, 4)
      .split("");

    if (!pastedDigits.length) return;

    event.preventDefault();
    setDigits([
      pastedDigits[0] || "",
      pastedDigits[1] || "",
      pastedDigits[2] || "",
      pastedDigits[3] || "",
    ]);

    const nextIndex = Math.min(pastedDigits.length, 3);
    inputRefs.current[nextIndex]?.focus();
    inputRefs.current[nextIndex]?.select();
  }

  const validateCode = useCallback(async (submittedCode: string) => {
    if (isUnavailable || submittedCode.length !== 4 || isSubmitting || hasActiveSession) {
      return;
    }

    setIsSubmitting(true);
    setMessage(null);
    setIsError(false);
    lastSubmittedCodeRef.current = submittedCode;

    try {
      const response = await fetch(
        `/api/transcripts/${encodeURIComponent(protocol)}/verify`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ code: submittedCode }),
        },
      );

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string; expiresAt?: string }
        | null;

      if (!response.ok || !payload?.ok || !payload.expiresAt) {
        throw new Error(payload?.message || "Codigo invalido.");
      }

      setDigits([...EMPTY_DIGITS]);
      setSessionExpiresAt(payload.expiresAt);
      setFrameSeed((current) => current + 1);
      setMessage("Transcript liberado com sucesso.");
      setIsError(false);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Nao foi possivel validar o codigo.",
      );
      setIsError(true);
      setDigits([...EMPTY_DIGITS]);
      window.setTimeout(() => {
        inputRefs.current[0]?.focus();
        inputRefs.current[0]?.select();
      }, 20);
    } finally {
      setIsSubmitting(false);
    }
  }, [hasActiveSession, isSubmitting, isUnavailable, protocol]);

  useEffect(() => {
    if (isUnavailable || hasActiveSession || code.length !== 4 || isSubmitting) {
      if (code.length < 4) {
        lastSubmittedCodeRef.current = null;
      }
      return;
    }

    if (lastSubmittedCodeRef.current === code) {
      return;
    }

    void validateCode(code);
  }, [code, hasActiveSession, isSubmitting, isUnavailable, validateCode]);

  async function handleLockNow() {
    setSessionExpiresAt(null);
    setFrameSeed((current) => current + 1);
    setDigits([...EMPTY_DIGITS]);
    setMessage("Sessao bloqueada. Digite o codigo para continuar.");
    setIsError(false);

    await fetch(`/api/transcripts/${encodeURIComponent(protocol)}/logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    }).catch(() => null);
  }

  return (
    <div className="relative z-10 flex w-full justify-center">
      <div
        className={`relative w-full ${
          hasActiveSession ? "max-w-[1420px]" : "max-w-[560px]"
        }`}
      >
        <LandingReveal delay={100}>
          <div className="relative overflow-hidden rounded-[32px] bg-transparent px-[26px] py-[28px] shadow-[0_28px_90px_rgba(0,0,0,0.44)] sm:px-[34px] sm:py-[36px]">
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
              className="pointer-events-none absolute inset-[1px] rounded-[31px] bg-[linear-gradient(180deg,rgba(8,8,8,0.98)_0%,rgba(4,4,4,0.98)_100%)]"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-[1px] top-[1px] h-[180px] rounded-t-[31px] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0.02)_32%,transparent_74%)]"
            />

            <div className="relative z-10">
              <div className="mx-auto flex w-fit justify-center">
                <LandingGlowTag className="px-[26px]">
                  {hasActiveSession ? "Transcript liberado" : "Transcript protegido"}
                </LandingGlowTag>
              </div>

              {isUnavailable ? (
                <>
                  <h1 className="mt-[28px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-center text-[32px] leading-[0.98] font-normal tracking-[-0.05em] text-transparent sm:text-[40px]">
                    Transcript
                    <br />
                    indisponivel
                  </h1>

                  <p className="mx-auto mt-[18px] max-w-[410px] text-center text-[14px] leading-[1.6] text-[#7D7D7D] sm:text-[15px]">
                    Este ticket nao possui transcript disponivel para consulta.
                    <br />
                    Normalmente isso acontece quando o atendimento teve poucas mensagens.
                  </p>

                  <div className="mx-auto mt-[24px] max-w-[390px] rounded-[20px] border border-[#141414] bg-[#090909] px-5 py-4 text-center text-[13px] leading-[1.7] text-[#8A8A8A]">
                    Protocolo <span className="text-[#CFCFCF]">{protocol}</span>
                  </div>
                </>
              ) : !hasActiveSession ? (
                <>
                  <h1 className="mt-[28px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-center text-[32px] leading-[0.98] font-normal tracking-[-0.05em] text-transparent sm:text-[40px]">
                    Digite o codigo
                    <br />
                    de 4 digitos
                  </h1>

                  <p className="mx-auto mt-[18px] max-w-[390px] text-center text-[14px] leading-[1.6] text-[#7D7D7D] sm:text-[15px]">
                    O codigo foi enviado no privado do solicitante.
                    <br />
                    Depois da validacao, o transcript fica liberado por 10 minutos.
                  </p>

                  <form
                    onSubmit={(event: FormEvent<HTMLFormElement>) => event.preventDefault()}
                    className="mt-[26px]"
                  >
                    <div
                      className="mx-auto flex max-w-[352px] items-center justify-center gap-3 sm:gap-4"
                      onPaste={handlePaste}
                    >
                      {digits.map((digit, index) => (
                        <input
                          key={`${protocol}-digit-${index}`}
                          ref={(element) => {
                            inputRefs.current[index] = element;
                          }}
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          pattern="[0-9]*"
                          maxLength={1}
                          value={digit}
                          onChange={(event) => updateDigit(index, event.target.value)}
                          onKeyDown={(event) => handleKeyDown(index, event)}
                          className={`flowdesk-stage-fade h-[72px] w-[68px] rounded-[22px] border text-center text-[30px] leading-none font-semibold outline-none transition ${
                            isError
                              ? "border-[#7A1C1C] bg-[#140909] text-[#F1D3D3]"
                              : "border-[#141414] bg-[#090909] text-white focus:border-[#3A3A3A]"
                          }`}
                          aria-label={`Digito ${index + 1} do codigo`}
                        />
                      ))}
                    </div>

                    {message ? (
                      <p
                        className={`mx-auto mt-[16px] max-w-[420px] text-center text-[13px] leading-[1.6] ${
                          isError ? "text-[#CF8D8D]" : "text-[#8C8C8C]"
                        }`}
                      >
                        {message}
                      </p>
                    ) : null}

                    {isSubmitting ? (
                      <p className="mx-auto mt-[18px] text-center text-[13px] leading-[1.6] text-[#8C8C8C]">
                        Validando codigo...
                      </p>
                    ) : null}
                  </form>
                </>
              ) : (
                <>
                  <div className="mt-[22px] flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <h1 className="bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[34px] leading-[0.98] font-normal tracking-[-0.05em] text-transparent sm:text-[44px]">
                        Transcript do ticket
                      </h1>
                      <p className="mt-[12px] text-[14px] leading-[1.7] text-[#7D7D7D] sm:text-[15px]">
                        Protocolo <span className="text-[#BDBDBD]">{protocol}</span>
                      </p>
                    </div>

                    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                      <div className="rounded-[12px] border border-[#141414] bg-[#090909] px-4 py-3 text-[13px] leading-[1.4] text-[#909090]">
                        Sessao expira em{" "}
                        <span className="font-semibold text-[#E1E1E1]">
                          {remainingLabel || "00:00"}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={handleLockNow}
                        className="group relative inline-flex h-[46px] items-center justify-center overflow-hidden rounded-[12px] px-6 text-[16px] leading-none font-semibold"
                      >
                        <span
                          aria-hidden="true"
                          className="absolute inset-0 rounded-[12px] bg-[#111111] transition-transform duration-150 ease-out group-hover:scale-[1.02] group-active:scale-[0.985]"
                        />
                        <span className="relative z-10 text-[#B7B7B7]">
                          Bloquear agora
                        </span>
                      </button>
                    </div>
                  </div>

                  <div className="mt-[24px] overflow-hidden rounded-[28px] border border-[#111111] bg-[#070707] shadow-[0_30px_100px_rgba(0,0,0,0.35)]">
                    <iframe
                      key={`${protocol}-${frameSeed}`}
                      title={`Transcript ${protocol}`}
                      src={`/api/transcripts/${encodeURIComponent(protocol)}/content`}
                      className="h-[76vh] min-h-[620px] w-full bg-white"
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </LandingReveal>
      </div>
    </div>
  );
}
