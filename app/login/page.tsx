import { LoginPanel } from "@/components/login/LoginPanel";
import { LandingFrameLines } from "@/components/landing/LandingFrameLines";
import {
  LOGIN_ERROR_FLASH_HEADER_NAME,
  decodeLoginErrorFlashPayload,
} from "@/lib/auth/loginFlash";
import {
  getConfiguredEmailOtpLength,
  isGoogleAuthConfigured,
  isMicrosoftAuthConfigured,
  normalizeInternalNextPath,
} from "@/lib/auth/config";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

type LoginPageProps = {
  searchParams?: Promise<{
    next?: string | string[];
    mode?: string | string[];
    error?: string | string[];
    otp?: string | string[];
    challenge?: string | string[];
    maskedEmail?: string | string[];
    expiresAt?: string | string[];
    resendAt?: string | string[];
    provider?: string | string[];
  }>;
};

function takeFirstQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

type OtpProvider = "discord" | "google" | "microsoft";

function resolveLoginErrorMessage(
  errorCode: string | null,
  loginMode: "login" | "link",
) {
  if (!errorCode) return null;

  switch (errorCode) {
    case "slow_down":
      return "Muitas tentativas seguidas. Aguarde alguns segundos e tente novamente.";
    case "discord_invalid_state":
      return loginMode === "link"
        ? "A tentativa de vinculacao expirou ou ficou invalida. Tente conectar o Discord novamente."
        : "Sua autenticacao com Discord expirou ou ficou invalida. Tente novamente.";
    case "discord_conflict":
      return "Esta conta do Discord ja esta vinculada a outra conta Flowdesk.";
    case "discord_unverified_email":
      return "Sua conta Discord precisa ter email verificado para concluir o acesso.";
    case "discord_auth_failed":
      return loginMode === "link"
        ? "Nao foi possivel vincular sua conta Discord agora. Tente novamente."
        : "Nao foi possivel entrar com Discord agora. Tente novamente.";
    case "google_invalid_state":
      return "Sua autenticacao com Google expirou ou ficou invalida. Tente novamente.";
    case "google_conflict":
      return "Esta conta Google ja esta vinculada a outra conta Flowdesk.";
    case "google_unverified_email":
      return "Sua conta Google precisa ter um email verificado para continuar.";
    case "google_not_configured":
      return "O login com Google ainda nao esta configurado neste ambiente.";
    case "google_embedded_browser":
      return "O Google bloqueia login dentro do navegador embutido do app. Abra esta pagina no Chrome, Safari ou Edge para continuar.";
    case "google_auth_failed":
      return "Nao foi possivel entrar com Google agora. Tente novamente.";
    case "microsoft_invalid_state":
      return "Sua autenticacao com Microsoft expirou ou ficou invalida. Tente novamente.";
    case "microsoft_conflict":
      return "Esta conta Microsoft ja esta vinculada a outra conta Flowdesk.";
    case "microsoft_missing_email":
      return "Sua conta Microsoft precisa retornar um email valido para continuar.";
    case "microsoft_not_configured":
      return "O login com Microsoft ainda nao esta configurado neste ambiente.";
    case "microsoft_embedded_browser":
      return "O Microsoft bloqueia login dentro do navegador embutido do app. Abra esta pagina no Chrome, Safari ou Edge para continuar.";
    case "microsoft_auth_failed":
      return "Nao foi possivel entrar com Microsoft agora. Tente novamente.";
    default:
      return null;
  }
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const query = searchParams ? await searchParams : {};
  const requestHeaders = await headers();
  const nextPath = normalizeInternalNextPath(takeFirstQueryValue(query.next));
  const loginMode = takeFirstQueryValue(query.mode) === "link" ? "link" : "login";
  const initialOtpChallengeId = takeFirstQueryValue(query.challenge)?.trim() || null;
  const rawOtpProvider = takeFirstQueryValue(query.provider);
  const initialOtpProvider: OtpProvider | null =
    rawOtpProvider === "discord" ||
    rawOtpProvider === "google" ||
    rawOtpProvider === "microsoft"
      ? rawOtpProvider
      : null;
  const initialOtpState =
    takeFirstQueryValue(query.otp) === "1" && initialOtpChallengeId
      ? {
          challengeId: initialOtpChallengeId,
          maskedEmail: takeFirstQueryValue(query.maskedEmail) || "",
          expiresAt: takeFirstQueryValue(query.expiresAt),
          resendAvailableAt: takeFirstQueryValue(query.resendAt),
          source: "social" as const,
          provider: initialOtpProvider,
        }
      : null;
  const loginErrorFlash = decodeLoginErrorFlashPayload(
    requestHeaders.get(LOGIN_ERROR_FLASH_HEADER_NAME),
  );
  const errorCode = loginErrorFlash?.code || takeFirstQueryValue(query.error);
  const initialErrorMessage = resolveLoginErrorMessage(
    errorCode,
    loginMode,
  );
  const googleEnabled = isGoogleAuthConfigured();
  const microsoftEnabled = isMicrosoftAuthConfigured();
  const emailOtpLength = getConfiguredEmailOtpLength();
  const currentUser = await getCurrentUserFromSessionCookie();

  if (loginMode === "link" && currentUser?.discord_user_id) {
    redirect(nextPath || "/servers");
  }

  return (
    <main className="relative min-h-screen overflow-x-clip bg-[#040404] text-white">
      <LandingFrameLines />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04)_0%,rgba(255,255,255,0.01)_24%,transparent_62%)]"
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1582px] items-center justify-center px-[20px] pt-[88px] pb-[30px] md:px-6 lg:px-8 xl:px-10 2xl:px-[20px]">
        <div className="relative z-10 flex w-full justify-center">
          <div className="relative w-full max-w-[560px]">
            <LoginPanel
              nextPath={nextPath}
              loginMode={loginMode}
              initialErrorMessage={initialErrorMessage}
              initialErrorEventKey={loginErrorFlash?.id || errorCode}
              googleEnabled={googleEnabled}
              microsoftEnabled={microsoftEnabled}
              emailOtpLength={emailOtpLength}
              initialOtpState={initialOtpState}
              currentSessionHint={
                currentUser
                  ? {
                      displayName: currentUser.display_name,
                      email: currentUser.email,
                    }
                  : null
              }
            />
          </div>
        </div>
      </div>
    </main>
  );
}
