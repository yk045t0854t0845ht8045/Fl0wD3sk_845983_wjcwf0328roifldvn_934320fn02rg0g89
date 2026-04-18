"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import { buildDiscordAuthStartHref, buildLoginHref } from "@/lib/auth/paths";
import {
  buildOfficialDiscordChannelUrl,
  OFFICIAL_DISCORD_INVITE_URL,
  OFFICIAL_DISCORD_LINK_PATH,
  OFFICIAL_DISCORD_LINK_START_PATH,
  OFFICIAL_DISCORD_LINKED_ROLE_NAME,
} from "@/lib/discordLink/config";
import { PRIVACY_PATH, TERMS_PATH } from "@/lib/legal/content";
import { buildBrowserRoutingTargetFromInternalPath } from "@/lib/routing/subdomains";

type LinkSyncResponse = {
  ok: boolean;
  authenticated?: boolean;
  status?: "pending" | "pending_member" | "linked" | "failed";
  linked?: boolean;
  requireHumanCheck?: boolean;
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

type HumanCheckResponse = {
  ok: boolean;
  authenticated?: boolean;
  verified?: boolean;
  challengeToken?: string | null;
  verificationToken?: string | null;
  minSolveMs?: number;
  message?: string;
  authenticatedUser?: LinkSyncResponse["authenticatedUser"];
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
  title: "Preparando a vinculacao segura",
  description:
    "Estamos validando sua sessao, protegendo a tentativa e preparando a sincronizacao com o Discord oficial.",
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
            "Sua conta ja esta protegida e vinculada. Estamos apenas conferindo a sincronizacao final com o Discord oficial.",
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
  const humanCheckTransitionTimerRef = useRef<number | null>(null);
  const syncLinkRef = useRef<((resetState?: boolean) => Promise<void>) | null>(null);
  const bootstrapHumanCheckRef = useRef<(() => Promise<void>) | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [hasLoadedAuthenticatedUser, setHasLoadedAuthenticatedUser] = useState(false);
  const [humanCheckPhase, setHumanCheckPhase] = useState<
    "loading" | "ready" | "verifying" | "verified"
  >(initialStatus === "linked" ? "verified" : "loading");
  const [humanCheckChallengeToken, setHumanCheckChallengeToken] = useState<string | null>(
    null,
  );
  const [humanCheckVerificationToken, setHumanCheckVerificationToken] = useState<string | null>(
    null,
  );
  const [humanCheckError, setHumanCheckError] = useState<string | null>(null);
  const [humanCheckMinimumSolveMs, setHumanCheckMinimumSolveMs] = useState(900);
  const humanCheckIssuedAtRef = useRef<number | null>(null);
  const humanCheckInteractionCountRef = useRef(0);
  const humanCheckPointerTypeRef = useRef("mouse");

  const clearRetryTimer = useCallback(() => {
    if (syncRetryTimerRef.current) {
      window.clearTimeout(syncRetryTimerRef.current);
      syncRetryTimerRef.current = null;
    }
  }, []);

  const clearHumanCheckTransitionTimer = useCallback(() => {
    if (humanCheckTransitionTimerRef.current) {
      window.clearTimeout(humanCheckTransitionTimerRef.current);
      humanCheckTransitionTimerRef.current = null;
    }
  }, []);

  const applyAuthenticatedUserPayload = useCallback(
    (
      user:
        | LinkSyncResponse["authenticatedUser"]
        | HumanCheckResponse["authenticatedUser"]
        | null,
    ) => {
      setAuthenticatedUser((user as AuthenticatedUserInfo) || null);
      setHasLoadedAuthenticatedUser(true);
    },
    [],
  );

  const registerHumanInteraction = useCallback((pointerType?: string | null) => {
    if (pointerType && pointerType.trim()) {
      humanCheckPointerTypeRef.current = pointerType.trim().slice(0, 24);
    }

    humanCheckInteractionCountRef.current = Math.min(
      humanCheckInteractionCountRef.current + 1,
      12,
    );
  }, []);

  const scheduleSecureLoginRedirect = useCallback(() => {
    setState({
      phase: "redirecting",
      title: "Reconectando a sessao segura",
      description:
        "Sua sessao autenticada nao foi encontrada neste navegador. Vamos abrir o login seguro da Flowdesk para continuar automaticamente.",
    });
    setHumanCheckPhase("loading");
    setHumanCheckChallengeToken(null);
    setHumanCheckVerificationToken(null);
    setHumanCheckError(null);

    if (redirectTimerRef.current) {
      window.clearTimeout(redirectTimerRef.current);
    }

    const nextPath = `${OFFICIAL_DISCORD_LINK_PATH}?access=${encodeURIComponent(accessToken)}`;
    redirectTimerRef.current = window.setTimeout(() => {
      window.location.assign(buildDiscordAuthStartHref(nextPath));
    }, 450);
  }, [accessToken]);

  const bootstrapHumanCheck = useCallback(async () => {
    clearRetryTimer();
    clearHumanCheckTransitionTimer();

    if (initialStatus === "linked") {
      setHumanCheckPhase("verified");
      setHumanCheckChallengeToken(null);
      setHumanCheckVerificationToken(null);
      setHumanCheckError(null);
      setHasLoadedAuthenticatedUser(true);
      return;
    }

    setHumanCheckPhase("loading");
    setHumanCheckError(null);

    const response = await fetch(
      `/api/auth/me/discord-link/human-check?access=${encodeURIComponent(accessToken)}`,
      {
        cache: "no-store",
      },
    );

    const requestId = response.headers.get("X-Request-Id");
    const payload = (await response.json().catch(() => null)) as HumanCheckResponse | null;
    applyAuthenticatedUserPayload(payload?.authenticatedUser || null);

    if (!response.ok || !payload?.ok) {
      setState({
        phase: "error",
        title: response.status === 403 ? "Este link seguro expirou" : "Falha ao preparar a verificacao",
        description:
          payload?.message ||
          "Nao foi possivel carregar a verificacao humana desta vinculacao agora.",
        requestId,
      });
      return;
    }

    if (payload.authenticated === false) {
      scheduleSecureLoginRedirect();
      return;
    }

    setHumanCheckMinimumSolveMs(
      Number.isFinite(payload.minSolveMs) ? Number(payload.minSolveMs) : 900,
    );

    if (payload.verified) {
      setHumanCheckPhase("verified");
      setHumanCheckChallengeToken(null);
      setHumanCheckVerificationToken(payload.verificationToken || null);
      void syncLinkRef.current?.(false);
      return;
    }

    humanCheckIssuedAtRef.current = performance.now();
    humanCheckInteractionCountRef.current = 0;
    humanCheckPointerTypeRef.current = "mouse";
    setHumanCheckChallengeToken(payload.challengeToken || null);
    setHumanCheckVerificationToken(null);
    setHumanCheckPhase("ready");
  }, [
    accessToken,
    applyAuthenticatedUserPayload,
    clearHumanCheckTransitionTimer,
    clearRetryTimer,
    initialStatus,
    scheduleSecureLoginRedirect,
  ]);

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
        humanVerificationToken: humanCheckVerificationToken,
      }),
    });

    const requestId = response.headers.get("X-Request-Id");
    const payload = (await response.json().catch(() => null)) as LinkSyncResponse | null;
    applyAuthenticatedUserPayload(payload?.authenticatedUser || null);

    if (response.status === 401) {
      scheduleSecureLoginRedirect();
      return;
    }

    if (response.status === 428 || payload?.requireHumanCheck) {
      setHumanCheckError(
        payload?.message || "Confirme a verificacao humana para continuar a vinculacao.",
      );
      void bootstrapHumanCheckRef.current?.();
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
        title:
          payload.status === "pending_member"
            ? "Entre no Discord oficial"
            : "Sincronizando acesso e cargo",
        description:
          payload.status === "pending_member"
            ? "Abra o Discord oficial com esta mesma conta. Assim que sua entrada for detectada, a Flowdesk conclui a vinculacao e sincroniza o cargo automaticamente."
            : "Sua conta foi localizada. Agora estamos sincronizando o acesso e liberando o cargo oficial com seguranca.",
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
      description:
        "Tudo certo. Sua conta foi confirmada e a Flowdesk finalizou a sincronizacao do acesso com o Discord oficial.",
      actionHref: payload.openDiscordUrl || buildOfficialDiscordChannelUrl(),
      actionLabel: "Voltar ao Discord oficial",
      roleName: payload.roleName || OFFICIAL_DISCORD_LINKED_ROLE_NAME,
    });
  }, [
    accessToken,
    applyAuthenticatedUserPayload,
    clearRetryTimer,
    humanCheckVerificationToken,
    initialStatus,
    scheduleSecureLoginRedirect,
  ]);

  useEffect(() => {
    syncLinkRef.current = syncLink;
  }, [syncLink]);

  useEffect(() => {
    bootstrapHumanCheckRef.current = bootstrapHumanCheck;
  }, [bootstrapHumanCheck]);

  const handleHumanCheckConfirm = useCallback(async () => {
    if (
      humanCheckPhase !== "ready" ||
      !humanCheckChallengeToken ||
      state.phase === "error" ||
      initialStatus === "linked"
    ) {
      return;
    }

    setHumanCheckPhase("verifying");
    setHumanCheckError(null);

    const dwellMs = Math.max(
      humanCheckMinimumSolveMs,
      Math.round((humanCheckIssuedAtRef.current ? performance.now() - humanCheckIssuedAtRef.current : 0) || 0),
    );
    const interactionCount = Math.max(1, humanCheckInteractionCountRef.current);
    const pointerType = humanCheckPointerTypeRef.current || "mouse";

    const response = await fetch("/api/auth/me/discord-link/human-check", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        accessToken,
        challengeToken: humanCheckChallengeToken,
        dwellMs,
        interactionCount,
        pointerType,
      }),
    });

    const requestId = response.headers.get("X-Request-Id");
    const payload = (await response.json().catch(() => null)) as HumanCheckResponse | null;
    applyAuthenticatedUserPayload(payload?.authenticatedUser || null);

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

      setHumanCheckPhase("ready");
      setHumanCheckError(
        payload?.message ||
          "Nao foi possivel confirmar a verificacao humana agora. Tente novamente.",
      );
      return;
    }

    setHumanCheckPhase("verified");
    setHumanCheckChallengeToken(null);
    setHumanCheckVerificationToken(payload.verificationToken || null);
    clearHumanCheckTransitionTimer();
    void syncLink(false);
  }, [
    accessToken,
    applyAuthenticatedUserPayload,
    clearHumanCheckTransitionTimer,
    humanCheckChallengeToken,
    humanCheckMinimumSolveMs,
    humanCheckPhase,
    initialStatus,
    state.phase,
    syncLink,
  ]);

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
      window.location.assign(buildLoginHref());
    }
  }, [isLoggingOut]);

  useEffect(() => {
    const bootTimer = window.setTimeout(() => {
      if (initialStatus === "linked") {
        setHasLoadedAuthenticatedUser(true);
        return;
      }

      void bootstrapHumanCheck();
    }, 0);

    return () => {
      window.clearTimeout(bootTimer);
      clearRetryTimer();
      clearHumanCheckTransitionTimer();
      if (redirectTimerRef.current) {
        window.clearTimeout(redirectTimerRef.current);
      }
    };
  }, [bootstrapHumanCheck, clearHumanCheckTransitionTimer, clearRetryTimer, initialStatus]);

  useEffect(() => {
    function handleForegroundReturn() {
      if (document.visibilityState !== "visible") {
        return;
      }

      if (initialStatus === "linked") {
        return;
      }

      if (state.phase === "redirecting" || redirectTimerRef.current) {
        return;
      }

      if (humanCheckPhase === "verified") {
        void syncLink(false);
        return;
      }

      void bootstrapHumanCheckRef.current?.();
    }

    window.addEventListener("pageshow", handleForegroundReturn);
    document.addEventListener("visibilitychange", handleForegroundReturn);
    window.addEventListener("focus", handleForegroundReturn);

    return () => {
      window.removeEventListener("pageshow", handleForegroundReturn);
      document.removeEventListener("visibilitychange", handleForegroundReturn);
      window.removeEventListener("focus", handleForegroundReturn);
    };
  }, [humanCheckPhase, initialStatus, state.phase, syncLink]);

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
  const shouldRenderHumanCheck =
    initialStatus !== "linked" &&
    state.phase !== "error" &&
    state.phase !== "success" &&
    state.phase !== "redirecting" &&
    humanCheckPhase !== "verified";
  const isExpiredSecureLink =
    state.phase === "error" &&
    (state.description.includes("link seguro") ||
      state.description.includes("nao esta mais disponivel") ||
      state.description.includes("expirou"));
  const officialDiscordHref = buildOfficialDiscordChannelUrl();
  const humanCheckSolveSeconds = Math.max(
    1,
    Math.ceil(humanCheckMinimumSolveMs / 1000),
  );
  const panelEyebrow = shouldRenderHumanCheck
    ? "Solicitacao de vinculacao"
    : state.phase === "success"
      ? "Conta vinculada"
      : state.phase === "error"
        ? "Falha na vinculacao"
        : state.phase === "redirecting"
          ? "Reconectando sessao"
          : "Sincronizando";
  const panelTitle = shouldRenderHumanCheck
    ? "Flowdesk quer vincular esta conta ao Discord oficial"
    : state.phase === "success"
      ? "Conta vinculada com sucesso"
      : state.phase === "syncing"
        ? "Aguardando confirmacao do Discord"
        : state.title;
  const panelDescription = shouldRenderHumanCheck
    ? "Confirme a verificacao humana para autorizar a sincronizacao da mesma conta autenticada no Flowdesk."
    : state.phase === "success"
      ? state.description
      : state.phase === "syncing"
        ? state.description
        : state.description;
  const accountDisplayName = authenticatedUser?.displayName || "Sua conta";
  const accountSubtitle = authenticatedUser
    ? `@${authenticatedUser.username}`
    : hasLoadedAuthenticatedUser
      ? "Conta autenticada"
      : "Carregando conta";
  const handleRetryAction = useCallback(() => {
    if (isExpiredSecureLink) {
      window.location.assign(
        buildBrowserRoutingTargetFromInternalPath(OFFICIAL_DISCORD_LINK_START_PATH, {
          fallbackArea: "public",
        }).href,
      );
      return;
    }

    if (humanCheckPhase !== "verified") {
      void bootstrapHumanCheck();
      return;
    }

    void syncLink();
  }, [bootstrapHumanCheck, humanCheckPhase, isExpiredSecureLink, syncLink]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-[#F2F2F2]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-[-16%] h-[520px] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0.015)_34%,transparent_72%)]" />
        <div className="absolute left-1/2 top-[12%] h-[360px] w-[360px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.04)_0%,transparent_72%)] blur-3xl" />
      </div>

      <section className="relative mx-auto flex min-h-screen w-full max-w-[760px] items-center justify-center px-4 py-8 sm:px-6">
        <div className="relative w-full overflow-hidden rounded-[32px] px-[24px] py-[24px] shadow-[0_32px_120px_rgba(0,0,0,0.44)] sm:px-[34px] sm:py-[34px]">
          <span className="pointer-events-none absolute inset-0 rounded-[32px] border border-[#0E0E0E]" />
          <span className="flowdesk-tag-border-glow pointer-events-none absolute inset-[-2px] rounded-[32px]" />
          <span className="flowdesk-tag-border-core pointer-events-none absolute inset-[-1px] rounded-[32px]" />
          <span className="pointer-events-none absolute inset-[1px] rounded-[31px] bg-[linear-gradient(180deg,rgba(8,8,8,0.98)_0%,rgba(4,4,4,0.98)_100%)]" />
          <div className="pointer-events-none absolute inset-x-[1px] top-[1px] h-[180px] rounded-t-[31px] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0.015)_34%,transparent_74%)]" />

          <div className="relative z-10">
            <Link href="/" className="relative mx-auto block h-[34px] w-[168px]" aria-label="Voltar para a pagina inicial da Flowdesk">
              <Image src="/cdn/logos/logo.png" alt="Flowdesk" fill sizes="168px" className="object-contain object-center" priority />
            </Link>

            <div className="mx-auto mt-[28px] flex max-w-[520px] items-center justify-center gap-3 sm:gap-5">
              <div className="min-w-0 flex-1">
                <div className="mx-auto flex h-[76px] w-[76px] items-center justify-center overflow-hidden rounded-full border border-[#171717] bg-[#0B0B0B] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <div className="relative h-[40px] w-[40px]">
                    <Image src="/cdn/logos/logotipo_.svg" alt="Flowdesk" fill sizes="40px" className="object-contain" priority />
                  </div>
                </div>
                <p className="mt-3 text-center text-[15px] font-medium tracking-[-0.03em] text-[#F2F2F2]">Flowdesk</p>
                <p className="mt-1 text-center text-[12px] text-[#818181]">Sistema oficial</p>
              </div>

              <div className="flex min-w-[84px] items-center gap-2 sm:min-w-[112px] sm:gap-3">
                <span className="h-px flex-1 bg-[#242424]" />
                <span className={`flex h-[34px] w-[34px] items-center justify-center rounded-full border text-[16px] font-semibold ${
                  state.phase === "success"
                    ? "border-[#EAEAEA] bg-[#F3F3F3] text-black"
                    : state.phase === "error"
                      ? "border-[#3B1E1E] bg-[#120B0B] text-[#E5B9B9]"
                      : "border-[#222222] bg-[#0D0D0D] text-[#E6E6E6]"
                }`}>
                  {state.phase === "success" ? "OK" : state.phase === "error" ? "!" : "."}
                </span>
                <span className="h-px flex-1 bg-[#242424]" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="mx-auto flex h-[76px] w-[76px] items-center justify-center overflow-hidden rounded-full border border-[#171717] bg-[#0B0B0B] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  {!shouldHideAuthenticatedUserCard && authenticatedUser?.avatarUrl ? (
                    <Image src={authenticatedUser.avatarUrl} alt={accountDisplayName} width={76} height={76} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-[26px] font-medium tracking-[-0.04em] text-[#F2F2F2]">{accountDisplayName.slice(0, 1).toUpperCase()}</span>
                  )}
                </div>
                <p className="mt-3 truncate text-center text-[15px] font-medium tracking-[-0.03em] text-[#F2F2F2]">
                  {shouldHideAuthenticatedUserCard ? "Conta Discord" : accountDisplayName}
                </p>
                <p className="mt-1 truncate text-center text-[12px] text-[#818181]">
                  {shouldHideAuthenticatedUserCard ? "Aguardando autenticacao" : accountSubtitle}
                </p>
              </div>
            </div>

            <div className="mx-auto mt-[30px] max-w-[520px] text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#707070]">{panelEyebrow}</p>
              <h1 className="mt-[14px] text-[30px] leading-[1.02] font-normal tracking-[-0.05em] text-[#F5F5F5] sm:text-[38px]">{panelTitle}</h1>
              <p className="mt-[14px] text-[14px] leading-[1.8] text-[#9A9A9A] sm:text-[15px]">{panelDescription}</p>
            </div>

            <div className="mx-auto mt-[28px] flex max-w-[420px] flex-col items-center border-t border-[#161616] pt-[28px] text-center">
              {shouldRenderHumanCheck ? (
                <>
                  <button
                    type="button"
                    disabled={humanCheckPhase === "loading" || humanCheckPhase === "verifying"}
                    onPointerMove={(event) => { registerHumanInteraction(event.pointerType); }}
                    onPointerDown={(event) => { registerHumanInteraction(event.pointerType); }}
                    onClick={() => {
                      registerHumanInteraction(humanCheckPointerTypeRef.current || "mouse");
                      void handleHumanCheckConfirm();
                    }}
                    className="inline-flex h-[54px] w-full items-center justify-center rounded-[16px] bg-[#F3F3F3] px-5 text-[15px] font-medium text-black transition hover:bg-white disabled:cursor-not-allowed disabled:bg-[#D8D8D8]"
                  >
                    {humanCheckPhase === "loading" ? <span className="inline-flex items-center gap-3"><ButtonLoader size={16} colorClassName="text-black" />Preparando verificacao</span> : humanCheckPhase === "verifying" ? <span className="inline-flex items-center gap-3"><ButtonLoader size={16} colorClassName="text-black" />Confirmando vinculacao</span> : "Continuar com esta conta"}
                  </button>
                  <p className="mt-4 text-[13px] leading-[1.75] text-[#8A8A8A]">A verificacao leva cerca de {humanCheckSolveSeconds}s e usa apenas a conta autenticada neste navegador.</p>
                  {humanCheckError ? <p className="mt-3 text-[13px] leading-[1.75] text-[#D7A5A5]">{humanCheckError}</p> : null}
                </>
              ) : state.phase === "success" ? (
                <>
                  <span className="flex h-[64px] w-[64px] items-center justify-center rounded-full border border-[#1A1A1A] bg-[#0B0B0B] text-[20px] font-medium text-[#F3F3F3]">OK</span>
                  <p className="mt-5 text-[14px] leading-[1.8] text-[#9A9A9A]">Sua vinculacao foi concluida. Aguarde alguns instantes enquanto o Discord oficial reconhece o acesso.</p>
                  <a href={state.actionHref} className="mt-6 inline-flex h-[54px] w-full items-center justify-center rounded-[16px] bg-[#F3F3F3] px-5 text-[15px] font-medium text-black transition hover:bg-white">{state.actionLabel}</a>
                  {state.actionHref !== officialDiscordHref ? <a href={officialDiscordHref} target="_blank" rel="noreferrer" className="mt-3 text-[13px] font-medium text-[#8E8E8E] transition-colors hover:text-[#DADADA]">Abrir Discord oficial</a> : null}
                </>
              ) : state.phase === "error" ? (
                <>
                  <span className="flex h-[64px] w-[64px] items-center justify-center rounded-full border border-[#2A1717] bg-[#120B0B] text-[28px] text-[#E5B9B9]">!</span>
                  <p className="mt-5 text-[14px] leading-[1.8] text-[#9A9A9A]">{state.description}</p>
                  {state.requestId ? <p className="mt-3 text-[12px] leading-[1.7] text-[#6F6F6F]">Protocolo tecnico: <span className="text-[#AFAFAF]">{state.requestId}</span></p> : null}
                  <button type="button" onClick={() => { void handleRetryAction(); }} className="mt-6 inline-flex h-[54px] w-full items-center justify-center rounded-[16px] bg-[#F3F3F3] px-5 text-[15px] font-medium text-black transition hover:bg-white">
                    {isExpiredSecureLink ? "Gerar novo link seguro" : "Tentar novamente"}
                  </button>
                </>
              ) : (
                <>
                  <span className="flex h-[64px] w-[64px] items-center justify-center rounded-full border border-[#1A1A1A] bg-[#0B0B0B]"><ButtonLoader size={24} colorClassName="text-[#F3F3F3]" /></span>
                  <p className="mt-5 text-[14px] leading-[1.8] text-[#9A9A9A]">{state.description}</p>
                  {state.phase === "syncing" && state.helperHref && state.helperLabel ? <a href={state.helperHref} target="_blank" rel="noreferrer" className="mt-5 inline-flex h-[48px] w-full items-center justify-center rounded-[14px] border border-[#1A1A1A] bg-[#0B0B0B] px-5 text-[14px] font-medium text-[#E2E2E2] transition-colors hover:border-[#2A2A2A] hover:bg-[#111111]">{state.helperLabel}</a> : null}
                </>
              )}
            </div>

            <p className="mx-auto mt-[26px] max-w-[460px] text-center text-[12px] leading-[1.8] text-[#7B7B7B]">
              Ao continuar, voce concorda com nossos <Link href={footerLinks.termsUrl} className="text-[#CACACA] transition-colors hover:text-white">Termos</Link> e a nossa <Link href={footerLinks.privacyUrl} className="text-[#CACACA] transition-colors hover:text-white">Politica de Privacidade</Link>.
            </p>

            <button
              type="button"
              onClick={() => { void handleLogout(); }}
              disabled={isLoggingOut}
              className="mx-auto mt-[16px] inline-flex h-[40px] items-center justify-center rounded-full px-[14px] text-[13px] font-medium text-[#9A9A9A] transition-colors hover:text-[#F3F3F3] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoggingOut ? "Saindo..." : "Trocar conta"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
