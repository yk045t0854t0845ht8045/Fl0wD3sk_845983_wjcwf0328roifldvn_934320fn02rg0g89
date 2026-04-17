import { LoginPanel } from "@/components/login/LoginPanel";
import { LandingFrameLines } from "@/components/landing/LandingFrameLines";
import { normalizeInternalNextPath } from "@/lib/auth/config";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";
import { redirect } from "next/navigation";

type LoginPageProps = {
  searchParams?: Promise<{
    next?: string | string[];
    mode?: string | string[];
    error?: string | string[];
  }>;
};

function takeFirstQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

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
    case "discord_auth_failed":
      return loginMode === "link"
        ? "Nao foi possivel vincular sua conta Discord agora. Tente novamente."
        : "Nao foi possivel entrar com Discord agora. Tente novamente.";
    default:
      return null;
  }
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const query = searchParams ? await searchParams : {};
  const nextPath = normalizeInternalNextPath(takeFirstQueryValue(query.next));
  const loginMode = takeFirstQueryValue(query.mode) === "link" ? "link" : "login";
  const initialErrorMessage = resolveLoginErrorMessage(
    takeFirstQueryValue(query.error),
    loginMode,
  );
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
