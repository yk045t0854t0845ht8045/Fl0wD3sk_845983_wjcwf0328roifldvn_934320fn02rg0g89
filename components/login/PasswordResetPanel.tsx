"use client";

import Image from "next/image";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import {
  getPasswordPolicyChecklist,
  validatePasswordPolicy,
} from "@/lib/auth/passwordPolicy";
import {
  useNotificationEffect,
  useNotifications,
} from "@/components/notifications/NotificationsProvider";

const inputShellClassName =
  "group relative flex h-[58px] w-full items-center rounded-[18px] border border-[rgba(255,255,255,0.06)] bg-[#090909] px-[18px] transition-[border-color,background-color,box-shadow] duration-200 focus-within:border-[rgba(255,255,255,0.13)] focus-within:bg-[#0C0C0C] focus-within:shadow-[0_0_0_4px_rgba(255,255,255,0.04)]";

type TokenStatus = "checking" | "valid" | "expired" | "invalid";

function PasswordVisibilityButton({
  visible,
  onClick,
  label,
}: {
  visible: boolean;
  onClick: () => void;
  label: string;
}) {
  const Icon = visible ? EyeOff : Eye;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="ml-[10px] inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-[#7D7D7D] transition-colors hover:bg-[rgba(255,255,255,0.04)] hover:text-[#F1F1F1]"
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
    </button>
  );
}

export function PasswordResetPanel({ token }: { token: string }) {
  const notifications = useNotifications();
  const [status, setStatus] = useState<TokenStatus>("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const checklist = useMemo(() => getPasswordPolicyChecklist(password), [password]);
  const passwordError = useMemo(
    () => validatePasswordPolicy(password, confirmPassword),
    [confirmPassword, password],
  );

  useNotificationEffect(errorMessage, {
    title: "Redefinicao de senha",
    tone: "error",
    durationMs: 5200,
  });

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const response = await fetch(
          `/api/auth/email/password-reset/complete?token=${encodeURIComponent(token)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as {
          ok?: boolean;
          reason?: string | null;
          email?: string | null;
        };
        if (!mounted) return;

        if (response.ok && payload.ok) {
          setStatus("valid");
          setEmail(payload.email || "");
          return;
        }

        setStatus(payload.reason === "expired" ? "expired" : "invalid");
      } catch {
        if (mounted) setStatus("invalid");
      }
    })();

    return () => {
      mounted = false;
    };
  }, [token]);

  async function handleSubmit() {
    if (isSubmitting) return;
    if (passwordError) {
      setErrorMessage(passwordError);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/auth/email/password-reset/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          token,
          password,
          confirmPassword,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        message?: string;
        email?: string;
        redirectTo?: string;
      };

      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.message || "Nao foi possivel trocar sua senha.");
      }

      notifications.success("Senha alterada com sucesso.", {
        title: "Tudo certo",
        durationMs: 2600,
      });
      window.setTimeout(() => {
        window.location.replace(
          payload.redirectTo ||
            `/login?email=${encodeURIComponent(payload.email || email)}`,
        );
      }, 700);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Nao foi possivel trocar sua senha.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const statusMessage =
    status === "checking"
      ? "Validando seu link seguro..."
      : status === "expired"
        ? "Este link expirou. Solicite uma nova redefinicao pelo login."
        : status === "invalid"
          ? "Este link nao e mais valido ou ja foi utilizado."
          : "Digite uma nova senha para concluir a troca.";

  return (
    <section className="relative w-full max-w-[560px]">
      <LandingReveal delay={100}>
        <div className="relative overflow-hidden rounded-[32px] bg-transparent px-[26px] py-[28px] shadow-[0_28px_90px_rgba(0,0,0,0.44)] sm:px-[34px] sm:py-[36px]">
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[32px] border border-[#0E0E0E]" />
          <span aria-hidden="true" className="flowdesk-tag-border-glow pointer-events-none absolute inset-[-2px] rounded-[32px]" />
          <span aria-hidden="true" className="flowdesk-tag-border-core pointer-events-none absolute inset-[-1px] rounded-[32px]" />
          <span aria-hidden="true" className="pointer-events-none absolute inset-[1px] rounded-[31px] bg-[linear-gradient(180deg,rgba(8,8,8,0.98)_0%,rgba(4,4,4,0.98)_100%)]" />

          <div className="relative z-10">
            <Link href="/" className="relative mx-auto block h-[36px] w-[182px]" aria-label="Flowdesk">
              <Image src="/cdn/logos/logo.png" alt="Flowdesk" fill sizes="182px" className="object-contain object-center" priority />
            </Link>

            <h1 className="mt-[28px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-center text-[30px] leading-[1] font-normal tracking-[-0.05em] text-transparent sm:text-[38px]">
              Nova senha
            </h1>
            <p className="mt-[14px] text-center text-[14px] leading-[1.7] text-[#909090]">
              {statusMessage}
            </p>

            {status === "checking" ? (
              <div className="mt-[24px] flex justify-center">
                <ButtonLoader size={22} colorClassName="text-[#D8D8D8]" />
              </div>
            ) : null}

            {status === "valid" ? (
              <form
                className="mt-[22px] space-y-[14px]"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSubmit();
                }}
              >
                {email ? (
                  <div className="rounded-[18px] border border-[rgba(255,255,255,0.06)] bg-[#090909] px-[16px] py-[13px] text-center text-[13px] text-[#A9A9A9]">
                    {email}
                  </div>
                ) : null}

                <div className={inputShellClassName}>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.currentTarget.value)}
                    placeholder="Nova senha"
                    autoComplete="new-password"
                    maxLength={128}
                    className="min-w-0 flex-1 bg-transparent text-[15px] text-[#F1F1F1] outline-none placeholder:text-[#5A5A5A]"
                  />
                  <PasswordVisibilityButton
                    visible={showPassword}
                    onClick={() => setShowPassword((current) => !current)}
                    label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  />
                </div>

                <div className={inputShellClassName}>
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.currentTarget.value)}
                    placeholder="Confirmar senha"
                    autoComplete="new-password"
                    maxLength={128}
                    className="min-w-0 flex-1 bg-transparent text-[15px] text-[#F1F1F1] outline-none placeholder:text-[#5A5A5A]"
                  />
                  <PasswordVisibilityButton
                    visible={showConfirmPassword}
                    onClick={() => setShowConfirmPassword((current) => !current)}
                    label={showConfirmPassword ? "Ocultar confirmacao" : "Mostrar confirmacao"}
                  />
                </div>

                <div className="rounded-[20px] border border-[rgba(255,255,255,0.06)] bg-[#080808] px-[16px] py-[14px]">
                  <p className="text-[12px] font-semibold tracking-[0.12em] text-[#6E6E6E] uppercase">
                    Padrao minimo
                  </p>
                  <div className="mt-[10px] grid gap-[8px] text-[13px] text-[#909090]">
                    {checklist.map((item) => (
                      <div key={item.id} className="flex items-center gap-[8px]">
                        <span aria-hidden="true" className={`h-[7px] w-[7px] rounded-full ${item.valid ? "bg-[#C9F77B]" : "bg-[#4D4D4D]"}`} />
                        <span className={item.valid ? "text-[#D8D8D8]" : undefined}>{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || Boolean(passwordError)}
                  className="group relative inline-flex h-[52px] w-full items-center justify-center overflow-visible rounded-[14px] px-6 text-[16px] font-semibold text-[#101010] disabled:cursor-not-allowed disabled:text-[#B7B7B7]"
                >
                  <span aria-hidden="true" className={`absolute inset-0 rounded-[14px] ${isSubmitting || passwordError ? "bg-[#111111]" : "bg-[linear-gradient(180deg,#FFFFFF_0%,#D8D8D8_100%)] group-hover:scale-[1.015]"}`} />
                  <span className="relative z-10">
                    {isSubmitting ? <ButtonLoader size={18} colorClassName="text-[#101010]" /> : "Alterar senha"}
                  </span>
                </button>
              </form>
            ) : null}

            {status === "expired" || status === "invalid" ? (
              <Link
                href="/login"
                className="mt-[22px] inline-flex h-[52px] w-full items-center justify-center rounded-[14px] bg-[linear-gradient(180deg,#FFFFFF_0%,#D8D8D8_100%)] px-6 text-[16px] font-semibold text-[#101010]"
              >
                Voltar para o login
              </Link>
            ) : null}
          </div>
        </div>
      </LandingReveal>
    </section>
  );
}
