"use client";

import Image from "next/image";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { DiscordLoginButton } from "@/components/login/DiscordLoginButton";
import { GoogleLoginButton } from "@/components/login/GoogleLoginButton";
import { MicrosoftLoginButton } from "@/components/login/MicrosoftLoginButton";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { normalizeAuthEmail } from "@/lib/auth/email";
import {
  buildDiscordAuthStartHref,
  buildGoogleAuthStartHref,
  buildMicrosoftAuthStartHref,
  type LoginIntentMode,
} from "@/lib/auth/paths";
import {
  getPasswordPolicyChecklist,
  validatePasswordPolicy as validateClientPasswordPolicy,
} from "@/lib/auth/passwordPolicy";
import { isLikelyEmbeddedAuthBrowser } from "@/lib/auth/oauthBrowser";
import { PRIVACY_PATH, TERMS_PATH } from "@/lib/legal/content";

type LoginPanelProps = {
  nextPath?: string | null;
  loginMode?: LoginIntentMode;
  initialErrorMessage?: string | null;
  googleEnabled?: boolean;
  microsoftEnabled?: boolean;
  emailOtpLength?: number;
  currentSessionHint?: {
    displayName: string;
    email: string | null;
  } | null;
};

type EmailStartResponse = {
  ok: boolean;
  message?: string;
  email?: string;
  maskedEmail?: string;
  nextStep?: "password" | "set_password";
};

type EmailPasswordResponse = {
  ok: boolean;
  message?: string;
  nextStep?: "otp" | "session";
  passwordStep?: "password" | "set_password";
  challengeId?: string;
  maskedEmail?: string;
  expiresAt?: string;
  resendAvailableAt?: string;
  redirectTo?: string;
};

type EmailOtpResponse = {
  ok: boolean;
  message?: string;
  redirectTo?: string;
};

type LoginStage = "chooser" | "password" | "otp";

const inputShellClassName =
  "group relative flex h-[58px] w-full items-center rounded-[18px] border border-[rgba(255,255,255,0.06)] bg-[#090909] px-[18px] transition-[border-color,background-color,box-shadow] duration-200 focus-within:border-[rgba(255,255,255,0.13)] focus-within:bg-[#0C0C0C] focus-within:shadow-[0_0_0_4px_rgba(255,255,255,0.04)]";
const otpBoxClassName =
  "h-[62px] w-[62px] rounded-[18px] border border-[rgba(255,255,255,0.07)] bg-[#090909] text-center text-[26px] font-semibold uppercase text-white outline-none transition-[border-color,background-color,box-shadow,color,transform] duration-200 placeholder:text-transparent focus:border-[rgba(255,255,255,0.14)] focus:bg-[#0C0C0C] focus:shadow-[0_0_0_4px_rgba(255,255,255,0.04)] sm:h-[70px] sm:w-[70px] sm:text-[30px]";

function WhiteActionButton({
  label,
  loading,
  disabled,
  onClick,
  type = "button",
  hideLabelWhenLoading = true,
}: {
  label: string;
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  hideLabelWhenLoading?: boolean;
}) {
  const isVisuallyDisabled = Boolean(disabled) && !loading;

  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={`group relative inline-flex h-[52px] w-full items-center justify-center overflow-visible rounded-[14px] px-6 text-[16px] font-semibold disabled:cursor-not-allowed ${
        isVisuallyDisabled ? "text-[#B7B7B7]" : "text-[#101010]"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-0 rounded-[14px] transition-transform duration-150 ease-out ${
          isVisuallyDisabled
            ? "bg-[#111111]"
            : "bg-[linear-gradient(180deg,#FFFFFF_0%,#D8D8D8_100%)] group-hover:scale-[1.015] group-active:scale-[0.992]"
        }`}
      />
      <span className="relative z-10 inline-flex items-center justify-center gap-[10px]">
        {loading ? (
          hideLabelWhenLoading ? (
            <ButtonLoader size={18} colorClassName="text-[#101010]" />
          ) : (
            <>
              <ButtonLoader size={18} colorClassName="text-[#101010]" />
              <span>{label}</span>
            </>
          )
        ) : (
          <span>{label}</span>
        )}
      </span>
    </button>
  );
}

function PanelDivider() {
  return (
    <div className="mt-[20px] flex items-center gap-[12px]">
      <span className="h-px flex-1 bg-[rgba(255,255,255,0.07)]" />
      <span className="text-[11px] font-semibold tracking-[0.18em] text-[#777777]">OU</span>
      <span className="h-px flex-1 bg-[rgba(255,255,255,0.07)]" />
    </div>
  );
}

export function LoginPanel({
  nextPath = null,
  loginMode = "login",
  initialErrorMessage = null,
  googleEnabled = false,
  microsoftEnabled = false,
  emailOtpLength = 6,
  currentSessionHint = null,
}: LoginPanelProps) {
  const termsUrl = process.env.NEXT_PUBLIC_TERMS_URL || TERMS_PATH;
  const privacyUrl = process.env.NEXT_PUBLIC_PRIVACY_URL || PRIVACY_PATH;
  const [stage, setStage] = useState<LoginStage>("chooser");
  const [email, setEmail] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordStep, setPasswordStep] = useState<"password" | "set_password">("password");
  const [challengeId, setChallengeId] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpExpiresAt, setOtpExpiresAt] = useState<string | null>(null);
  const [otpResendAvailableAt, setOtpResendAvailableAt] = useState<string | null>(null);
  const [nowTimestamp, setNowTimestamp] = useState(() => Date.now());
  const [errorMessage, setErrorMessage] = useState<string | null>(initialErrorMessage);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [isSubmittingEmail, setIsSubmittingEmail] = useState(false);
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);
  const [isSubmittingOtp, setIsSubmittingOtp] = useState(false);
  const [isResendingOtp, setIsResendingOtp] = useState(false);
  const [rememberSession, setRememberSession] = useState(false);
  const [isEmbeddedAuthBrowser, setIsEmbeddedAuthBrowser] = useState(false);
  const otpInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const resolvedOtpLength = useMemo(
    () => Math.min(8, Math.max(6, Math.trunc(emailOtpLength || 6))),
    [emailOtpLength],
  );

  const discordHref = useMemo(
    () => buildDiscordAuthStartHref(nextPath, loginMode === "link" ? "link" : "login"),
    [loginMode, nextPath],
  );
  const googleHref = useMemo(
    () => buildGoogleAuthStartHref(nextPath, loginMode === "link" ? "link" : "login"),
    [loginMode, nextPath],
  );
  const microsoftHref = useMemo(
    () => buildMicrosoftAuthStartHref(nextPath, loginMode === "link" ? "link" : "login"),
    [loginMode, nextPath],
  );
  const normalizedEmail = useMemo(() => normalizeAuthEmail(email), [email]);
  const isEmailValid = useMemo(() => Boolean(normalizedEmail), [normalizedEmail]);
  const passwordChecklist = useMemo(() => getPasswordPolicyChecklist(password), [password]);
  const passwordPolicyError = useMemo(
    () =>
      passwordStep === "set_password"
        ? validateClientPasswordPolicy(password, confirmPassword)
        : null,
    [confirmPassword, password, passwordStep],
  );
  const otpCharacters = useMemo(
    () => Array.from({ length: resolvedOtpLength }, (_, index) => otpCode[index] || ""),
    [otpCode, resolvedOtpLength],
  );

  const resendDisabled = useMemo(() => {
    if (!otpResendAvailableAt) return false;
    return Date.parse(otpResendAvailableAt) > nowTimestamp;
  }, [nowTimestamp, otpResendAvailableAt]);

  const resendLabel = useMemo(() => {
    if (!otpResendAvailableAt) return "Reenviar codigo";
    const diffMs = Date.parse(otpResendAvailableAt) - nowTimestamp;
    if (!Number.isFinite(diffMs) || diffMs <= 0) return "Reenviar codigo";
    const seconds = Math.max(1, Math.ceil(diffMs / 1000));
    return `Reenviar em ${seconds}s`;
  }, [nowTimestamp, otpResendAvailableAt]);

  useEffect(() => {
    setIsEmbeddedAuthBrowser(isLikelyEmbeddedAuthBrowser(window.navigator.userAgent));
  }, []);

  useEffect(() => {
    if (stage !== "otp" || !otpResendAvailableAt) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNowTimestamp(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [otpResendAvailableAt, stage]);

  useEffect(() => {
    setErrorMessage(initialErrorMessage);
  }, [initialErrorMessage]);

  useEffect(() => {
    if (stage !== "otp") {
      return;
    }

    const focusIndex = Math.min(otpCode.length, resolvedOtpLength - 1);
    const frameId = window.requestAnimationFrame(() => {
      otpInputRefs.current[focusIndex]?.focus();
      otpInputRefs.current[focusIndex]?.select();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [otpCode.length, resolvedOtpLength, stage]);

  function focusOtpSlot(index: number) {
    const nextIndex = Math.max(0, Math.min(index, resolvedOtpLength - 1));
    otpInputRefs.current[nextIndex]?.focus();
    otpInputRefs.current[nextIndex]?.select();
  }

  function setOtpCodeAt(index: number, rawValue: string) {
    const nextValue = rawValue.toUpperCase().replace(/[^A-Z0-9]/g, "");

    if (!nextValue) {
      const truncated = otpCode.slice(0, index);
      setOtpCode(truncated);
      return;
    }

    if (nextValue.length > 1) {
      const merged = nextValue.slice(0, resolvedOtpLength);
      setOtpCode(merged);
      focusOtpSlot(Math.min(merged.length, resolvedOtpLength - 1));
      return;
    }

    const characters = Array.from(
      { length: resolvedOtpLength },
      (_, otpIndex) => otpCode[otpIndex] || "",
    );
    characters[index] = nextValue;
    const merged = characters.join("").slice(0, resolvedOtpLength);
    setOtpCode(merged);

    if (index < resolvedOtpLength - 1) {
      focusOtpSlot(index + 1);
    }
  }

  function handleOtpKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
    index: number,
  ) {
    if (event.key === "Backspace" && !otpCharacters[index] && index > 0) {
      event.preventDefault();
      const truncated = otpCode.slice(0, index - 1);
      setOtpCode(truncated);
      focusOtpSlot(index - 1);
      return;
    }

    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusOtpSlot(index - 1);
      return;
    }

    if (event.key === "ArrowRight" && index < resolvedOtpLength - 1) {
      event.preventDefault();
      focusOtpSlot(index + 1);
    }
  }

  function handleOtpPaste(
    event: React.ClipboardEvent<HTMLInputElement>,
    startIndex: number,
  ) {
    event.preventDefault();

    const pasted = event.clipboardData
      .getData("text")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, resolvedOtpLength - startIndex);

    if (!pasted) {
      return;
    }

    const characters = Array.from(
      { length: resolvedOtpLength },
      (_, otpIndex) => otpCode[otpIndex] || "",
    );

    Array.from(pasted).forEach((character, offset) => {
      characters[startIndex + offset] = character;
    });

    const merged = characters.join("").slice(0, resolvedOtpLength);
    setOtpCode(merged);
    focusOtpSlot(Math.min(startIndex + pasted.length, resolvedOtpLength - 1));
  }

  async function handleEmailContinue() {
    if (isSubmittingEmail) return;
    if (!normalizedEmail) {
      setErrorMessage("Informe um email corporativo valido para continuar.");
      return;
    }

    setIsSubmittingEmail(true);
    setErrorMessage(null);
    setInfoMessage(null);

    try {
      const response = await fetch("/api/auth/email/start", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          email: normalizedEmail,
        }),
      });
      const payload = (await response.json()) as EmailStartResponse;

      if (!response.ok || !payload.ok || !payload.email || !payload.nextStep) {
        throw new Error(payload.message || "Nao foi possivel continuar com este email.");
      }

      setEmail(payload.email);
      setMaskedEmail(payload.maskedEmail || payload.email);
      setPasswordStep(payload.nextStep);
      setPassword("");
      setConfirmPassword("");
      setStage("password");
      setInfoMessage(
        payload.nextStep === "set_password"
          ? "Crie uma senha forte para liberar o acesso por email nesta conta."
          : null,
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Nao foi possivel continuar com este email.",
      );
    } finally {
      setIsSubmittingEmail(false);
    }
  }

  async function handlePasswordContinue() {
    if (isSubmittingPassword) return;
    if (passwordStep === "set_password" && passwordPolicyError) {
      setErrorMessage(passwordPolicyError);
      return;
    }

    setIsSubmittingPassword(true);
    setErrorMessage(null);
    setInfoMessage(null);

    try {
      const response = await fetch("/api/auth/email/password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          email: normalizedEmail || email.trim().toLowerCase(),
          password,
          confirmPassword: passwordStep === "set_password" ? confirmPassword : undefined,
          next: nextPath,
        }),
      });
      const payload = (await response.json()) as EmailPasswordResponse;

      if (!response.ok || !payload.ok || !payload.challengeId || !payload.nextStep) {
        if (payload.nextStep !== "session") {
          throw new Error(payload.message || "Nao foi possivel validar sua senha.");
        }
      }

      if (payload.nextStep === "session" && payload.redirectTo) {
        window.location.replace(payload.redirectTo);
        return;
      }

      if (!payload.challengeId || !payload.nextStep) {
        throw new Error(payload.message || "Nao foi possivel validar sua senha.");
      }

      setChallengeId(payload.challengeId);
      setMaskedEmail(payload.maskedEmail || maskedEmail);
      setOtpCode("");
      setOtpExpiresAt(payload.expiresAt || null);
      setOtpResendAvailableAt(payload.resendAvailableAt || null);
      setStage("otp");
      setInfoMessage("Enviamos o codigo de acesso para o seu email.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Nao foi possivel validar sua senha.",
      );
    } finally {
      setIsSubmittingPassword(false);
    }
  }

  async function handleOtpContinue() {
    if (isSubmittingOtp) return;
    if (otpCode.trim().length < resolvedOtpLength) {
      setErrorMessage(`Digite os ${resolvedOtpLength} caracteres do codigo para continuar.`);
      return;
    }

    setIsSubmittingOtp(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/auth/email/otp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          challengeId,
          code: otpCode,
          next: nextPath,
          rememberSession,
        }),
      });
      const payload = (await response.json()) as EmailOtpResponse;

      if (!response.ok || !payload.ok || !payload.redirectTo) {
        throw new Error(payload.message || "Nao foi possivel validar o codigo.");
      }

      window.location.replace(payload.redirectTo);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Nao foi possivel validar o codigo.",
      );
    } finally {
      setIsSubmittingOtp(false);
    }
  }

  async function handleResendOtp() {
    if (isResendingOtp || resendDisabled) return;

    setIsResendingOtp(true);
    setErrorMessage(null);
    setInfoMessage(null);

    try {
      const response = await fetch("/api/auth/email/otp/resend", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          challengeId,
        }),
      });
      const payload = (await response.json()) as EmailPasswordResponse;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Nao foi possivel reenviar o codigo.");
      }

      setMaskedEmail(payload.maskedEmail || maskedEmail);
      setOtpExpiresAt(payload.expiresAt || otpExpiresAt);
      setOtpResendAvailableAt(payload.resendAvailableAt || otpResendAvailableAt);
      setInfoMessage("Novo codigo enviado com sucesso.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Nao foi possivel reenviar o codigo.",
      );
    } finally {
      setIsResendingOtp(false);
    }
  }

  function handleGoBack() {
    setErrorMessage(null);
    setInfoMessage(null);

    if (stage === "otp") {
      setStage("password");
      setOtpCode("");
      return;
    }

    setStage("chooser");
    setPassword("");
    setConfirmPassword("");
  }

  const chooserView = (
    <>
      <form
        className="mt-[22px] space-y-[14px]"
        onSubmit={(event) => {
          event.preventDefault();
          void handleEmailContinue();
        }}
      >
        <div className={inputShellClassName}>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
            onBlur={() => {
              const trimmed = email.trim().toLowerCase();
              if (trimmed && trimmed !== email) {
                setEmail(trimmed);
              }
            }}
            placeholder="voce@email.com"
            autoComplete="email"
            inputMode="email"
            maxLength={254}
            aria-invalid={Boolean(errorMessage && !isEmailValid)}
            className="w-full bg-transparent text-[15px] text-[#F1F1F1] outline-none placeholder:text-[#5A5A5A]"
          />
        </div>

        <WhiteActionButton
          label="Continuar"
          type="submit"
          loading={isSubmittingEmail}
          disabled={!isEmailValid}
        />
      </form>

      <PanelDivider />

      <div className="mt-[20px] space-y-[12px]">
        {googleEnabled ? (
          <GoogleLoginButton
            href={googleHref}
            disabled={isEmbeddedAuthBrowser}
          />
        ) : null}
        {microsoftEnabled ? (
          <MicrosoftLoginButton
            href={microsoftHref}
            disabled={isEmbeddedAuthBrowser}
          />
        ) : null}
        <DiscordLoginButton href={discordHref} />
      </div>

      {isEmbeddedAuthBrowser && (googleEnabled || microsoftEnabled) ? (
        <div className="mt-[14px] rounded-[18px] border border-[rgba(255,255,255,0.06)] bg-[#080808] px-[14px] py-[12px] text-[12px] leading-[1.7] text-[#A7A7A7]">
          Google e Microsoft bloqueiam login dentro de navegador embutido de apps como Discord e Instagram.
          Abra esta pagina no Chrome, Edge ou Safari para continuar com esses provedores.
        </div>
      ) : null}
    </>
  );

  const passwordView = (
    <>
      <button
        type="button"
        onClick={handleGoBack}
        className="mt-[18px] inline-flex items-center gap-[8px] text-[13px] font-medium text-[#A9A9A9] transition-colors hover:text-[#F2F2F2]"
      >
        <ChevronLeft className="h-[16px] w-[16px]" strokeWidth={2.1} />
        <span>{email}</span>
      </button>

      <form
        className="mt-[18px] space-y-[14px]"
        onSubmit={(event) => {
          event.preventDefault();
          void handlePasswordContinue();
        }}
      >
        <div className={inputShellClassName}>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            placeholder={passwordStep === "set_password" ? "Crie sua senha" : "Digite sua senha"}
            autoComplete={passwordStep === "set_password" ? "new-password" : "current-password"}
            maxLength={128}
            className="w-full bg-transparent text-[15px] text-[#F1F1F1] outline-none placeholder:text-[#5A5A5A]"
          />
        </div>

        {passwordStep === "set_password" ? (
          <div className={inputShellClassName}>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.currentTarget.value)}
              placeholder="Confirme sua senha"
              autoComplete="new-password"
              maxLength={128}
              className="w-full bg-transparent text-[15px] text-[#F1F1F1] outline-none placeholder:text-[#5A5A5A]"
            />
          </div>
        ) : null}

        {passwordStep === "set_password" ? (
          <div className="rounded-[20px] border border-[rgba(255,255,255,0.06)] bg-[#080808] px-[16px] py-[14px]">
            <p className="text-[12px] font-semibold tracking-[0.12em] text-[#6E6E6E] uppercase">
              Padrao minimo
            </p>
            <div className="mt-[10px] grid gap-[8px] text-[13px] text-[#909090]">
              {passwordChecklist.map((item) => (
                <div key={item.id} className="flex items-center gap-[8px]">
                  <span
                    aria-hidden="true"
                    className={`h-[7px] w-[7px] rounded-full ${
                      item.valid ? "bg-[#C9F77B]" : "bg-[#4D4D4D]"
                    }`}
                  />
                  <span className={item.valid ? "text-[#D8D8D8]" : undefined}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <WhiteActionButton
          label="Continuar"
          type="submit"
          loading={isSubmittingPassword}
          disabled={
            !password.trim() ||
            (passwordStep === "set_password" &&
              (!confirmPassword.trim() || Boolean(passwordPolicyError)))
          }
        />
      </form>
    </>
  );

  const otpView = (
    <>
      <button
        type="button"
        onClick={handleGoBack}
        className="mt-[18px] inline-flex items-center gap-[8px] text-[13px] font-medium text-[#A9A9A9] transition-colors hover:text-[#F2F2F2]"
      >
        <ChevronLeft className="h-[16px] w-[16px]" strokeWidth={2.1} />
        <span>{maskedEmail || email}</span>
      </button>

      <form
        className="mt-[18px] space-y-[14px]"
        onSubmit={(event) => {
          event.preventDefault();
          void handleOtpContinue();
        }}
      >
        <div className="flex items-center justify-center gap-[10px] sm:gap-[12px]">
          {otpCharacters.map((character, index) => {
            const isCurrentSlot =
              otpCode.length === index ||
              (otpCode.length >= resolvedOtpLength && index === resolvedOtpLength - 1);

            return (
              <input
                key={`otp-slot-${index}`}
                ref={(element) => {
                  otpInputRefs.current[index] = element;
                }}
                type="text"
                inputMode="text"
                autoComplete={index === 0 ? "one-time-code" : "off"}
                spellCheck={false}
                maxLength={1}
                value={character}
                aria-label={`Caractere ${index + 1} do codigo de verificacao`}
                onChange={(event) => {
                  setOtpCodeAt(index, event.currentTarget.value);
                }}
                onKeyDown={(event) => {
                  handleOtpKeyDown(event, index);
                }}
                onFocus={(event) => {
                  event.currentTarget.select();
                }}
                onPaste={(event) => {
                  handleOtpPaste(event, index);
                }}
                className={`${otpBoxClassName} ${
                  isCurrentSlot
                    ? "border-[rgba(255,255,255,0.16)] bg-[#0C0C0C] shadow-[0_0_0_4px_rgba(255,255,255,0.04)]"
                    : character
                      ? "border-[rgba(255,255,255,0.11)] text-white"
                      : "text-[#676767]"
                }`}
              />
            );
          })}
        </div>

        <label className="flex cursor-pointer items-start gap-[12px] rounded-[18px] border border-[rgba(255,255,255,0.06)] bg-[#090909] px-[16px] py-[14px] text-left transition-[border-color,background-color,box-shadow] duration-200 hover:border-[rgba(255,255,255,0.1)] hover:bg-[#0C0C0C]">
          <span className="relative mt-[2px] flex h-[18px] w-[18px] shrink-0 items-center justify-center">
            <input
              type="checkbox"
              checked={rememberSession}
              onChange={(event) => {
                setRememberSession(event.currentTarget.checked);
              }}
              className="peer absolute inset-0 cursor-pointer appearance-none rounded-[6px] border border-[rgba(255,255,255,0.12)] bg-[#050505] transition-colors duration-200 checked:border-[rgba(255,255,255,0.2)] checked:bg-white"
            />
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="pointer-events-none relative z-10 h-[12px] w-[12px] text-black opacity-0 transition-opacity duration-150 peer-checked:opacity-100"
            >
              <path
                d="M4 8.3 6.4 10.7 12 5.1"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="block">
            <span className="block text-[14px] font-medium text-[#F1F1F1]">
              Salvar sessao por 30 dias
            </span>
            <span className="mt-[4px] block text-[12px] leading-[1.6] text-[#7E7E7E]">
              Neste dispositivo, o login por email pode pular uma nova verificacao durante esse periodo.
            </span>
          </span>
        </label>

        <WhiteActionButton
          label="Confirmar codigo"
          type="submit"
          loading={isSubmittingOtp}
          disabled={otpCode.trim().length < resolvedOtpLength}
        />
      </form>

      <div className="mt-[14px] flex items-center justify-between gap-[12px] text-[13px] text-[#868686]">
        <span>
          {otpExpiresAt
            ? `Valido ate ${new Date(otpExpiresAt).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              })}`
            : "Verificacao por email"}
        </span>
        <button
          type="button"
          onClick={() => {
            void handleResendOtp();
          }}
          disabled={isResendingOtp || resendDisabled}
          className="font-medium text-[#CFCFCF] transition-colors hover:text-white disabled:cursor-not-allowed disabled:text-[#6A6A6A]"
        >
          {isResendingOtp ? "Enviando..." : resendLabel}
        </button>
      </div>
    </>
  );

  const title =
    loginMode === "link"
      ? "Vincular conta Discord"
      : stage === "otp"
        ? "Confirme o codigo"
        : "Entre em sua conta";

  return (
    <section className="relative w-full max-w-[560px]">
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
            <LandingReveal delay={170}>
              <Link
                href="/"
                className="relative mx-auto block h-[36px] w-[182px]"
                aria-label="Voltar para a pagina inicial da Flowdesk"
              >
                <Image
                  src="/cdn/logos/logo.png"
                  alt="Flowdesk"
                  fill
                  sizes="182px"
                  className="object-contain object-center"
                  priority
                />
              </Link>
            </LandingReveal>

            <LandingReveal delay={240}>
              <h1 className="mt-[28px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-center text-[30px] leading-[1] font-normal tracking-[-0.05em] text-transparent sm:text-[38px]">
                {title}
              </h1>
            </LandingReveal>

            {loginMode === "link" ? (
              <LandingReveal delay={340}>
                <div className="mt-[18px]">
                  <p className="text-center text-[14px] leading-[1.75] text-[#909090]">
                    Conecte seu Discord para liberar a area de servidores e vincular esta conta ao mesmo perfil.
                  </p>

                  {currentSessionHint?.email ? (
                    <div className="mt-[18px] rounded-[20px] border border-[rgba(255,255,255,0.06)] bg-[#090909] px-[16px] py-[14px] text-center">
                      <p className="text-[12px] uppercase tracking-[0.16em] text-[#686868]">
                        Conta atual
                      </p>
                      <p className="mt-[8px] text-[15px] font-medium text-[#F1F1F1]">
                        {currentSessionHint.displayName}
                      </p>
                      <p className="mt-[4px] text-[13px] text-[#8A8A8A]">
                        {currentSessionHint.email}
                      </p>
                    </div>
                  ) : null}

                  <div className="mt-[22px]">
                    <DiscordLoginButton
                      href={discordHref}
                      label="Vincular com Discord"
                    />
                  </div>
                </div>
              </LandingReveal>
            ) : (
              <LandingReveal delay={340}>
                <div>
                  {stage === "chooser" ? chooserView : null}
                  {stage === "password" ? passwordView : null}
                  {stage === "otp" ? otpView : null}
                </div>
              </LandingReveal>
            )}

            {infoMessage ? (
              <p
                role="status"
                className="mt-[16px] rounded-[18px] border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] px-[14px] py-[12px] text-center text-[13px] leading-[1.7] text-[#B4B4B4]"
              >
                {infoMessage}
              </p>
            ) : null}

            {errorMessage ? (
              <p
                role="alert"
                className="mt-[16px] rounded-[18px] border border-[rgba(214,155,155,0.18)] bg-[rgba(148,36,36,0.12)] px-[14px] py-[12px] text-center text-[13px] leading-[1.7] text-[#E1A9A9]"
              >
                {errorMessage}
              </p>
            ) : null}
          </div>
        </div>
      </LandingReveal>

      <LandingReveal delay={520}>
        <div className="mt-[14px] flex flex-wrap items-center justify-center gap-x-[16px] gap-y-[8px] text-[13px] leading-none font-normal">
          <Link
            href={termsUrl}
            className="flowdesk-login-legal-link"
            style={{ "--flowdesk-login-legal-delay": "0s" } as CSSProperties}
          >
            Termos
          </Link>
          <Link
            href={privacyUrl}
            className="flowdesk-login-legal-link"
            style={{ "--flowdesk-login-legal-delay": "1.1s" } as CSSProperties}
          >
            Politica de Privacidade
          </Link>
          <Link
            href={privacyUrl}
            className="flowdesk-login-legal-link"
            style={{ "--flowdesk-login-legal-delay": "2.2s" } as CSSProperties}
          >
            Cookies
          </Link>
        </div>
      </LandingReveal>
    </section>
  );
}
