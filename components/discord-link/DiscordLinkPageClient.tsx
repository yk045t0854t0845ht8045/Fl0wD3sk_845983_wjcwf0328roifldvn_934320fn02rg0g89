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
  const shouldRenderSwitchAccountAction = state.phase !== "success";
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
    <main className="min-h-screen bg-black text-[#F2F2F2] font-sans antialiased selection:bg-[#3b82f6]/30 selection:text-white flex items-center justify-center px-4 py-8 relative overflow-hidden">
      {/* Decorative Background */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-[-16%] h-[520px] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0.015)_34%,transparent_72%)]" />
        <div className="absolute left-1/2 top-[12%] h-[360px] w-[360px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.04)_0%,transparent_72%)] blur-3xl" />
      </div>

      <div className="w-full max-w-[460px] overflow-hidden rounded-[24px] border border-[#161616] bg-[#0A0A0A]/95 backdrop-blur-xl p-8 shadow-[0_32px_120px_rgba(0,0,0,0.66)] text-center relative z-10">
        {/* Decorative Top Ambient Light */}
        <div className="absolute -top-[120px] left-1/2 -translate-x-1/2 w-[280px] h-[280px] rounded-full bg-[#3b82f6]/10 blur-[90px] pointer-events-none" />

        {/* Logo */}
        <div className="relative mx-auto h-[32px] w-[148px]">
          <Image
            src="/cdn/logos/logo.png"
            alt="Flowdesk Logo"
            fill
            sizes="148px"
            className="object-contain object-center"
            priority
          />
        </div>

        {state.phase === "success" ? (
          <>
            <h1 className="mt-8 text-[28px] font-semibold tracking-tight text-white leading-tight">
              Conta vinculada!
            </h1>
            <p className="mt-2 text-[14px] text-[#8E8E8F]">
              Tudo pronto. Sua conta foi sincronizada no servidor.
            </p>

            <div className="mt-8 flex justify-center">
              <div className="relative w-16 h-16 bg-[#10b981]/10 rounded-full flex items-center justify-center border border-[#10b981]/20">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-8 h-8 text-[#10b981]">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
            </div>

            <p className="mt-6 text-[14px] leading-[1.8] text-[#9A9A9A]">
              Sua vinculacao foi concluida com sucesso. O cargo correspondente no Discord oficial sera sincronizado em instantes.
            </p>

            <a
              href={state.actionHref}
              className="mt-8 block w-full text-center py-3.5 rounded-[16px] bg-[#F3F3F3] hover:bg-white text-black transition-all duration-300 font-medium text-[14px] cursor-pointer"
            >
              {state.actionLabel}
            </a>
            {state.actionHref !== officialDiscordHref ? (
              <a
                href={officialDiscordHref}
                target="_blank"
                rel="noreferrer"
                className="mt-4 block text-[13px] font-medium text-[#8E8E8E] hover:text-[#DADADA] transition-colors duration-200"
              >
                Abrir Discord oficial
              </a>
            ) : null}
          </>
        ) : state.phase === "error" ? (
          <>
            <h1 className="mt-8 text-[28px] font-semibold tracking-tight text-white leading-tight">
              Falha na vinculacao
            </h1>
            <p className="mt-2 text-[14px] text-[#8E8E8F]">
              Ocorreu um problema ao sincronizar.
            </p>

            <div className="mt-8 flex justify-center">
              <div className="relative w-16 h-16 bg-[#ef4444]/10 rounded-full flex items-center justify-center border border-[#ef4444]/20">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-8 h-8 text-[#ef4444]">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
            </div>

            <p className="mt-6 text-[14px] leading-[1.8] text-[#9A9A9A]">
              {state.description}
            </p>
            {state.requestId ? (
              <p className="mt-2 text-[12px] text-[#6F6F6F]">
                Protocolo tecnico: <span className="text-[#AFAFAF]">{state.requestId}</span>
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => { void handleRetryAction(); }}
              className="mt-8 block w-full text-center py-3.5 rounded-[16px] bg-[#F3F3F3] hover:bg-white text-black transition-all duration-300 font-medium text-[14px] cursor-pointer"
            >
              {isExpiredSecureLink ? "Gerar novo link seguro" : "Tentar novamente"}
            </button>
          </>
        ) : (
          <>
            {/* Standard flow or human check pending */}
            <h1 className="mt-8 text-[28px] font-semibold tracking-tight text-white leading-tight">
              Que bom que você voltou
            </h1>
            <p className="mt-2 text-[14px] text-[#8E8E8F]">
              {shouldRenderHumanCheck
                ? "Escolha uma conta para continuar."
                : state.description}
            </p>

            {/* Currently Logged In Account Box */}
            <div className="mt-8">
              <button
                type="button"
                disabled={
                  humanCheckPhase === "loading" ||
                  humanCheckPhase === "verifying" ||
                  state.phase === "redirecting" ||
                  state.phase === "syncing"
                }
                onPointerMove={(event) => { registerHumanInteraction(event.pointerType); }}
                onPointerDown={(event) => { registerHumanInteraction(event.pointerType); }}
                onClick={() => {
                  registerHumanInteraction(humanCheckPointerTypeRef.current || "mouse");
                  if (shouldRenderHumanCheck) {
                    void handleHumanCheckConfirm();
                  } else {
                    void syncLink(false);
                  }
                }}
                className="group block w-full text-left p-4 rounded-[18px] bg-[#111112] enabled:hover:bg-[#161618] border border-[#202022] enabled:hover:border-[#38383a] transition-all duration-300 shadow-[inset_0_1px_1px_rgba(255,255,255,0.02)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-80"
              >
                <div className="flex items-center gap-4">
                  {/* User Avatar */}
                  <div className="relative flex-shrink-0">
                    {authenticatedUser?.avatarUrl ? (
                      <div className="w-13 h-13 rounded-full overflow-hidden border border-[#2a2a2c] group-hover:border-[#444] transition-colors duration-300">
                        <img
                          src={authenticatedUser.avatarUrl}
                          alt={accountDisplayName}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="w-13 h-13 rounded-full bg-gradient-to-tr from-[#3b82f6]/80 to-[#1d4ed8]/80 text-white font-semibold text-[15px] flex items-center justify-center border border-[#2a2a2c]">
                        {accountDisplayName.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    {/* Micro-dot Status indicator / spinner */}
                    {humanCheckPhase === "loading" || humanCheckPhase === "verifying" || state.phase === "syncing" || state.phase === "redirecting" ? (
                      <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-[#111112] rounded-full flex items-center justify-center border border-[#202022]">
                        <ButtonLoader size={10} colorClassName="text-[#3b82f6]" />
                      </div>
                    ) : (
                      <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-[#10b981] border-[2.5px] border-[#111112] group-hover:border-[#161618] transition-colors duration-300 rounded-full" />
                    )}
                  </div>

                  {/* User Meta info */}
                  <div className="flex-grow min-w-0">
                    <h2 className="text-[15px] font-medium text-white group-hover:text-[#3b82f6] transition-colors duration-300 truncate">
                      {accountDisplayName}
                    </h2>
                    <p className="text-[12px] text-[#8E8E8F] truncate mt-0.5">
                      {accountSubtitle}
                    </p>
                  </div>

                  {/* Arrow Indicator */}
                  <div className="flex-shrink-0 text-[#444] group-hover:text-white transition-colors duration-300 pr-1">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth="2.5"
                      stroke="currentColor"
                      className="w-4 h-4"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M8.25 4.5l7.5 7.5-7.5 7.5"
                      />
                    </svg>
                  </div>
                </div>
              </button>
            </div>

            {shouldRenderHumanCheck && humanCheckError ? (
              <p className="mt-3 text-[13px] leading-[1.75] text-[#D7A5A5]">{humanCheckError}</p>
            ) : null}

            {/* Separator "OU" */}
            {shouldRenderSwitchAccountAction ? (
              <>
                <div className="relative my-6 flex items-center justify-center">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-[#1a1a1c]" />
                  </div>
                  <span className="relative bg-[#0A0A0A] px-4 text-[11px] font-semibold text-[#555] uppercase tracking-[0.2em]">
                    OU
                  </span>
                </div>

                {/* Option 2: Logout and Log In to Another Account */}
                <div>
                  <button
                    type="button"
                    onClick={() => { void handleLogout(); }}
                    disabled={isLoggingOut}
                    className="block w-full text-center py-3.5 rounded-[16px] bg-transparent border border-[#222] text-white hover:bg-white hover:text-black hover:border-white transition-all duration-300 font-medium text-[14px] cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 shadow-sm"
                  >
                    {isLoggingOut ? "Saindo..." : "Entre em outra conta"}
                  </button>
                </div>
              </>
            ) : null}

            {state.phase === "syncing" && state.helperHref && state.helperLabel ? (
              <a
                href={state.helperHref}
                target="_blank"
                rel="noreferrer"
                className="mt-6 block w-full text-center py-3 rounded-[14px] border border-[#1a1a1c] bg-[#111112] text-white hover:bg-[#161618] hover:border-[#38383a] transition-all duration-300 text-[14px] font-medium"
              >
                {state.helperLabel}
              </a>
            ) : null}
          </>
        )}

        {/* Footer legal links */}
        <p className="mx-auto mt-8 max-w-[460px] text-center text-[12px] leading-[1.8] text-[#7B7B7B]">
          Ao continuar, voce concorda com nossos{" "}
          <Link href={footerLinks.termsUrl} className="text-[#CACACA] hover:text-white transition-colors duration-200">
            Termos
          </Link>{" "}
          e a nossa{" "}
          <Link href={footerLinks.privacyUrl} className="text-[#CACACA] hover:text-white transition-colors duration-200">
            Politica de Privacidade
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
