"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfigLogoutButton } from "@/components/config/ConfigLogoutButton";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import {
  buildOfficialDiscordChannelUrl,
  OFFICIAL_DISCORD_INVITE_URL,
  OFFICIAL_DISCORD_LINK_PATH,
  OFFICIAL_DISCORD_LINK_START_PATH,
  OFFICIAL_DISCORD_LINKED_ROLE_NAME,
} from "@/lib/discordLink/config";
import { PRIVACY_PATH, TERMS_PATH } from "@/lib/legal/content";

type LinkSyncResponse = {
  ok: boolean;
  authenticated?: boolean;
  status?: "pending" | "pending_member" | "linked" | "failed";
  linked?: boolean;
  message?: string;
  alreadyLinked?: boolean;
  roleName?: string;
  openDiscordUrl?: string;
  inviteUrl?: string;
  pollAfterMs?: number | null;
  authenticatedUser?: {
    discordUserId: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
};

type ViewState =
  | {
      phase: "checking" | "redirecting" | "syncing";
      title: string;
      description: string;
      helperHref?: string | null;
      helperLabel?: string | null;
    }
  | {
      phase: "success";
      title: string;
      description: string;
      actionHref: string;
      actionLabel: string;
      roleName: string;
    }
  | {
      phase: "error";
      title: string;
      description: string;
      requestId: string | null;
    };

const INITIAL_CHECKING_STATE: ViewState = {
  phase: "checking",
  title: "Validando vinculacao da conta",
  description:
    "Estamos confirmando o login seguro e sincronizando sua conta com o Discord oficial.",
};

type DiscordLinkPageClientProps = {
  accessToken: string;
  initialStatus?: string | null;
};

export function DiscordLinkPageClient({
  accessToken,
  initialStatus = null,
}: DiscordLinkPageClientProps) {
  type AuthenticatedUserInfo = NonNullable<LinkSyncResponse["authenticatedUser"]>;
  const [state, setState] = useState<ViewState>(
    initialStatus === "linked"
      ? {
          phase: "success",
          title: "Conta vinculada com sucesso",
          description:
            "Sua vinculacao foi concluida. Estamos apenas confirmando a sincronizacao final com o Discord oficial.",
          actionHref: buildOfficialDiscordChannelUrl(),
          actionLabel: "Voltar ao Discord oficial",
          roleName: OFFICIAL_DISCORD_LINKED_ROLE_NAME,
        }
      : {
          ...INITIAL_CHECKING_STATE,
        },
  );
  const [authenticatedUser, setAuthenticatedUser] = useState<AuthenticatedUserInfo | null>(null);
  const redirectTimerRef = useRef<number | null>(null);
  const syncRetryTimerRef = useRef<number | null>(null);
  const syncLinkRef = useRef<((resetState?: boolean) => Promise<void>) | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [hasLoadedAuthenticatedUser, setHasLoadedAuthenticatedUser] = useState(false);

  const clearRetryTimer = useCallback(() => {
    if (syncRetryTimerRef.current) {
      window.clearTimeout(syncRetryTimerRef.current);
      syncRetryTimerRef.current = null;
    }
  }, []);

  const syncLink = useCallback(async (resetState = true) => {
    if (resetState) {
      setState(INITIAL_CHECKING_STATE);
    }

    clearRetryTimer();

    const response = await fetch("/api/auth/me/discord-link", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        source: "official_link_page",
        accessToken,
      }),
    });

    const requestId = response.headers.get("X-Request-Id");
    const payload = (await response.json().catch(() => null)) as LinkSyncResponse | null;
    setAuthenticatedUser(payload?.authenticatedUser || null);
    setHasLoadedAuthenticatedUser(true);

    if (response.status === 401) {
      setState({
        phase: "redirecting",
        title: "Abrindo login seguro",
        description:
          "Sua sessao nao foi encontrada. Vamos abrir o login do Flowdesk para continuar a vinculacao automaticamente.",
      });

      if (redirectTimerRef.current) {
        window.clearTimeout(redirectTimerRef.current);
      }

      const nextPath = `${OFFICIAL_DISCORD_LINK_PATH}?access=${encodeURIComponent(accessToken)}`;
      redirectTimerRef.current = window.setTimeout(() => {
        window.location.assign(
          `/api/auth/discord?next=${encodeURIComponent(nextPath)}`,
        );
      }, 500);

      return;
    }

    if (!response.ok || !payload?.ok) {
      if (response.status === 403) {
        setState({
          phase: "error",
          title: "Este link seguro expirou",
          description:
            payload?.message ||
            "A sessao segura desta vinculacao nao esta mais disponivel. Gere um novo link seguro para continuar.",
          requestId,
        });
        return;
      }

      setState({
        phase: "error",
        title: "Nao foi possivel concluir a vinculacao",
        description:
          payload?.message ||
          "O Flowdesk nao conseguiu sincronizar sua conta agora. Tente novamente em instantes.",
        requestId,
      });
      return;
    }

    if (payload.status === "pending" || payload.status === "pending_member") {
      if (initialStatus === "linked") {
        const linkedUrl = `${OFFICIAL_DISCORD_LINK_PATH}?access=${encodeURIComponent(accessToken)}&status=linked`;
        window.history.replaceState({}, "", linkedUrl);
      }

      setState({
        phase: "syncing",
        title: INITIAL_CHECKING_STATE.title,
        description: INITIAL_CHECKING_STATE.description,
        helperHref:
          payload.openDiscordUrl ||
          payload.inviteUrl ||
          buildOfficialDiscordChannelUrl() ||
          OFFICIAL_DISCORD_INVITE_URL,
        helperLabel: "Abrir Discord oficial",
      });

      syncRetryTimerRef.current = window.setTimeout(() => {
        void syncLinkRef.current?.(false);
      }, Math.max(1800, payload.pollAfterMs || 2500));

      return;
    }

    const linkedUrl = `${OFFICIAL_DISCORD_LINK_PATH}?access=${encodeURIComponent(accessToken)}&status=linked`;
    window.history.replaceState({}, "", linkedUrl);

    setState({
      phase: "success",
      title: "Vinculacao concluida",
      description: "",
      actionHref: payload.openDiscordUrl || buildOfficialDiscordChannelUrl(),
      actionLabel: "Voltar ao Discord oficial",
      roleName: payload.roleName || OFFICIAL_DISCORD_LINKED_ROLE_NAME,
    });
  }, [accessToken, clearRetryTimer, initialStatus]);

  useEffect(() => {
    syncLinkRef.current = syncLink;
  }, [syncLink]);

  const handleLogout = useCallback(async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
    } finally {
      window.location.assign("/login");
    }
  }, [isLoggingOut]);

  useEffect(() => {
    const bootTimer = window.setTimeout(() => {
      void syncLink(false);
    }, 0);

    return () => {
      window.clearTimeout(bootTimer);
      clearRetryTimer();
      if (redirectTimerRef.current) {
        window.clearTimeout(redirectTimerRef.current);
      }
    };
  }, [clearRetryTimer, syncLink]);

  useEffect(() => {
    function handleForegroundReturn() {
      if (document.visibilityState !== "visible") {
        return;
      }

      void syncLink(false);
    }

    window.addEventListener("pageshow", handleForegroundReturn);
    document.addEventListener("visibilitychange", handleForegroundReturn);
    window.addEventListener("focus", handleForegroundReturn);

    return () => {
      window.removeEventListener("pageshow", handleForegroundReturn);
      document.removeEventListener("visibilitychange", handleForegroundReturn);
      window.removeEventListener("focus", handleForegroundReturn);
    };
  }, [syncLink]);

  const footerLinks = useMemo(
    () => ({
      termsUrl: process.env.NEXT_PUBLIC_TERMS_URL || TERMS_PATH,
      privacyUrl: process.env.NEXT_PUBLIC_PRIVACY_URL || PRIVACY_PATH,
    }),
    [],
  );
  const shouldHideAuthenticatedUserCard =
    state.phase === "error" &&
    (state.description.includes("link seguro") ||
      state.description.includes("nao esta mais disponivel") ||
      state.description.includes("expirou"));

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-black px-6 py-10">
      <section className="w-full max-w-[760px]">
        <div className="mx-auto flex w-full flex-col items-center gap-7">
          <div className="relative h-[68px] w-[68px] shrink-0">
            <Image
              src="/cdn/logos/logotipo.png"
              alt="Flowdesk"
              fill
              sizes="68px"
              className="object-contain"
              priority
            />
          </div>

          <div className="flex w-full flex-col items-center gap-3 text-center">
            <h1 className="text-[32px] leading-[1.1] font-medium text-[#D8D8D8] sm:text-[44px]">
              Vincule sua conta com o Discord
            </h1>
            <p className="max-w-[720px] text-[14px] leading-[1.6] text-[#A2A2A2] sm:text-[15px]">
              O Flowdesk usa o mesmo login Discord para validar sua identidade, sincronizar
              o acesso ao painel e liberar automaticamente o cargo oficial no servidor de
              suporte.
            </p>
            {!shouldHideAuthenticatedUserCard && !hasLoadedAuthenticatedUser ? (
              <div className="mt-2 flex w-full max-w-[620px] items-center gap-3 rounded-[14px] border border-[#242424] bg-[#0A0A0A] px-4 py-3 text-left flowdesk-shimmer">
                <div className="h-[38px] w-[38px] rounded-full bg-[#151515]" />
                <div className="flex flex-1 flex-col gap-2">
                  <div className="h-[12px] w-[168px] rounded-full bg-[#181818]" />
                  <div className="h-[10px] w-[94px] rounded-full bg-[#151515]" />
                  <div className="h-[10px] w-full max-w-[430px] rounded-full bg-[#141414]" />
                </div>
              </div>
            ) : null}

            {authenticatedUser && !shouldHideAuthenticatedUserCard ? (
              <div className="mt-2 flex w-full max-w-[620px] items-center gap-3 rounded-[14px] border border-[#242424] bg-[#0A0A0A] px-4 py-3 text-left">
                {authenticatedUser.avatarUrl ? (
                  <Image
                    src={authenticatedUser.avatarUrl}
                    alt={authenticatedUser.displayName}
                    width={38}
                    height={38}
                    className="rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-[#151515] text-[14px] font-medium text-[#D8D8D8]">
                    {authenticatedUser.displayName.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="text-[12px] leading-[1.65] text-[#8F8F8F]">
                  <p className="font-medium text-[#D8D8D8]">
                    Conta detectada: {authenticatedUser.displayName}
                  </p>
                  <p>@{authenticatedUser.username}</p>
                  <p>
                    Se o Discord aberto no navegador ou launcher estiver em outra conta,
                    troque para esta conta antes de concluir a vinculacao.
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          <div className="h-px w-full bg-[#242424]" />

          <div className="flex w-full flex-col items-center gap-5 text-center">
            {state.phase === "error" ? (
              <>
                <h2 className="text-[22px] leading-[1.2] font-medium text-[#D8D8D8] sm:text-[26px]">
                  {state.title}
                </h2>
                {state.description ? (
                  <p className="max-w-[640px] text-[14px] leading-[1.75] text-[#A8A8A8]">
                    {state.description}
                  </p>
                ) : null}
              </>
            ) : null}

            <div
              className={`flex h-[320px] w-full items-center justify-center rounded-[3px] border border-[#242424] bg-[#080808] p-8 ${
                state.phase === "success" ? "flowdesk-success-glow" : "flowdesk-panel-glow"
              }`}
            >
              {state.phase === "success" ? (
                <Image
                  src="/cdn/icons/check.png"
                  alt="Vinculacao concluida"
                  width={146}
                  height={146}
                  className="h-[146px] w-[146px] object-contain"
                  priority
                />
              ) : (
                <ButtonLoader size={46} colorClassName="text-[#D8D8D8]" />
              )}
            </div>

            {state.phase === "error" && state.requestId ? (
              <p className="text-[12px] leading-[1.6] text-[#7E7E7E]">
                Protocolo tecnico: <span className="text-[#B8B8B8]">{state.requestId}</span>
              </p>
            ) : null}

            <div className="flex w-full max-w-[420px] flex-col gap-3 pt-1">
              {state.phase === "success" ? (
                <a
                  href={state.actionHref}
                  className="inline-flex h-[52px] items-center justify-center rounded-[14px] bg-[#F3F3F3] px-5 text-[15px] font-medium text-black transition hover:bg-white"
                >
                  {state.actionLabel}
                </a>
              ) : null}

              {state.phase === "syncing" && state.helperHref && state.helperLabel ? (
                <a
                  href={state.helperHref}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[13px] font-medium text-[#8E8E8E] underline-offset-4 hover:text-[#D4D4D4] hover:underline"
                >
                  {state.helperLabel}
                </a>
              ) : null}

              {state.phase === "error" ? (
                <button
                  type="button"
                  onClick={() => {
                    if (
                      state.description.includes("link seguro") ||
                      state.description.includes("nao esta mais disponivel") ||
                      state.description.includes("expirou")
                    ) {
                      window.location.assign(OFFICIAL_DISCORD_LINK_START_PATH);
                      return;
                    }

                    void syncLink();
                  }}
                  className="inline-flex h-[52px] items-center justify-center rounded-[14px] bg-[#F3F3F3] px-5 text-[15px] font-medium text-black transition hover:bg-white"
                >
                  {state.description.includes("link seguro") ||
                  state.description.includes("nao esta mais disponivel") ||
                  state.description.includes("expirou")
                    ? "Gerar novo link seguro"
                    : "Tentar novamente"}
                </button>
              ) : null}
            </div>
          </div>

          <div className="h-px w-full bg-[#242424]" />

          <p className="max-w-[760px] text-center text-[12px] leading-[1.8] text-[#727272]">
            Ao continuar, voce concorda com nossos{" "}
            <Link href={footerLinks.termsUrl} className="text-[#BDBDBD] hover:underline">
              Termos de Uso
            </Link>{" "}
            e{" "}
            <Link href={footerLinks.privacyUrl} className="text-[#BDBDBD] hover:underline">
              Politica de Privacidade
            </Link>
            . O Flowdesk vincula apenas a conta autenticada no login para manter a
            sincronizacao segura entre site e Discord.
          </p>
        </div>
      </section>
      <ConfigLogoutButton
        onClick={() => {
          void handleLogout();
        }}
        disabled={isLoggingOut}
      />
    </main>
  );
}
