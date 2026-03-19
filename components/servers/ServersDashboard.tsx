"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ConfigLogoutButton } from "@/components/config/ConfigLogoutButton";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import { ServerSettingsEditor } from "@/components/servers/ServerSettingsEditor";
import { serversScale } from "@/components/servers/serversScale";

type ServersDashboardProps = {
  displayName: string;
};

type ManagedServerStatus = "paid" | "expired" | "off";

type ManagedServer = {
  guildId: string;
  guildName: string;
  iconUrl: string | null;
  status: ManagedServerStatus;
  licensePaidAt: string;
  licenseExpiresAt: string;
  graceExpiresAt: string;
  daysUntilExpire: number;
  daysUntilOff: number;
};

type ServersApiResponse = {
  ok: boolean;
  message?: string;
  servers?: ManagedServer[];
};

type FilterOption = "all" | ManagedServerStatus;
type ServerEditorTab = "settings" | "payments" | "methods" | "plans";

type PendingServerOpenQuery = {
  guildId: string;
  tab: ServerEditorTab;
};

const STATUS_LABEL: Record<ManagedServerStatus, string> = {
  paid: "Pago",
  expired: "Expirado",
  off: "Desligado",
};

const FILTER_LABEL: Record<FilterOption, string> = {
  all: "Status",
  paid: "Pago",
  expired: "Expirados",
  off: "Desligado",
};

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeGuildIdFromQuery(value: string | null) {
  if (!value) return null;
  const guildId = value.trim();
  return /^\d{10,25}$/.test(guildId) ? guildId : null;
}

function normalizeEditorTabFromQuery(value: string | null): ServerEditorTab {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "payments") return "payments";
  if (normalized === "methods") return "methods";
  if (normalized === "plans") return "plans";
  return "settings";
}

function isSubsequence(query: string, target: string) {
  if (!query) return true;

  let queryIndex = 0;
  for (let targetIndex = 0; targetIndex < target.length; targetIndex += 1) {
    if (target[targetIndex] === query[queryIndex]) {
      queryIndex += 1;
      if (queryIndex >= query.length) return true;
    }
  }

  return false;
}

function getSearchScore(guildName: string, query: string) {
  if (!query) return 1;

  const normalizedName = normalizeSearchText(guildName);
  const compactName = normalizedName.replace(/\s+/g, "");
  const compactQuery = query.replace(/\s+/g, "");

  if (normalizedName === query) return 100;
  if (normalizedName.startsWith(query)) return 90;
  if (normalizedName.includes(query)) return 80;

  const queryTokens = query.split(/\s+/).filter(Boolean);
  if (
    queryTokens.length > 1 &&
    queryTokens.every((token) => normalizedName.includes(token))
  ) {
    return 65;
  }

  if (compactQuery && isSubsequence(compactQuery, compactName)) return 50;
  return 0;
}

function FallbackServerIcon() {
  return (
    <div
      className="flex items-center justify-center bg-[#151515] text-[#8A8A8A]"
      style={{
        width: `${serversScale.cardIconSize}px`,
        height: `${serversScale.cardIconSize}px`,
        borderRadius: `${serversScale.cardIconRadius}px`,
        fontSize: `${Math.max(10, Math.round(serversScale.cardIconSize * 0.38))}px`,
      }}
    >
      S
    </div>
  );
}

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{
        width: `${serversScale.copyIconSize}px`,
        height: `${serversScale.copyIconSize}px`,
      }}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{
        width: `${serversScale.copyIconSize}px`,
        height: `${serversScale.copyIconSize}px`,
      }}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 7 10 17l-5-5" />
    </svg>
  );
}

function NewBotIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{
        width: `${serversScale.newBotIconSize}px`,
        height: `${serversScale.newBotIconSize}px`,
      }}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function statusStyle(status: ManagedServerStatus) {
  if (status === "paid") {
    return {
      badgeText: "Pago",
      badgeClass:
        "border border-[#6AE25A] bg-[rgba(106,226,90,0.2)] text-[#6AE25A]",
    };
  }

  if (status === "expired") {
    return {
      badgeText: "Expirado",
      badgeClass:
        "border border-[#F2C823] bg-[rgba(242,200,35,0.2)] text-[#F2C823]",
    };
  }

  return {
    badgeText: "Desligado",
    badgeClass:
      "border border-[#DB4646] bg-[rgba(219,70,70,0.2)] text-[#DB4646]",
  };
}

function statusDescription(server: ManagedServer) {
  if (server.status === "paid") {
    return `Expira em: ${server.daysUntilExpire} dias`;
  }

  if (server.status === "expired") {
    return `Expirado resta: ${server.daysUntilOff} dias`;
  }

  return "Retorna imediatamente apos pagamento";
}

function ServerCardSkeleton({ index }: { index: number }) {
  return (
    <article
      className="flowdesk-fade-up-soft border border-[#2E2E2E] bg-[#0A0A0A] flowdesk-shimmer"
      style={{
        width: "100%",
        borderRadius: `${serversScale.cardRadius}px`,
        padding: `${serversScale.cardPadding}px`,
        animationDelay: `${index * 55}ms`,
      }}
    >
      <div className="flex items-start justify-between">
        <div
          className="flex min-w-0 items-center"
          style={{ gap: `${Math.round(serversScale.cardPadding * 0.85)}px` }}
        >
          <div
            className="shrink-0 rounded-[4px] bg-[#171717]"
            style={{
              width: `${serversScale.cardIconSize}px`,
              height: `${serversScale.cardIconSize}px`,
            }}
          />

          <div className="min-w-0">
            <div
              className="rounded-[3px] bg-[#171717]"
              style={{
                width: `${Math.round(serversScale.cardWidth * 0.34)}px`,
                height: `${Math.round(serversScale.cardNameSize * 1.05)}px`,
              }}
            />
            <div
              className="mt-[6px] rounded-[3px] bg-[#151515]"
              style={{
                width: `${Math.round(serversScale.cardWidth * 0.28)}px`,
                height: `${Math.round(serversScale.cardIdSize * 1.15)}px`,
              }}
            />
          </div>
        </div>

        <div
          className="rounded-[3px] bg-[#151515]"
          style={{
            width: `${Math.round(serversScale.cardMenuDotsSize * 1.55)}px`,
            height: `${Math.round(serversScale.cardMenuDotsSize * 1.1)}px`,
          }}
        />
      </div>

      <div
        className="flex items-center gap-[8px]"
        style={{ marginTop: `${serversScale.cardBottomSpacing}px` }}
      >
        <div
          className="rounded-[3px] bg-[#181818]"
          style={{
            width: `${serversScale.badgeWidth}px`,
            height: `${serversScale.badgeHeight}px`,
          }}
        />
        <div
          className="rounded-[3px] bg-[#151515]"
          style={{
            width: `${Math.round(serversScale.cardWidth * 0.3)}px`,
            height: `${Math.round(serversScale.statusDescriptionSize * 1.35)}px`,
          }}
        />
      </div>
    </article>
  );
}

export function ServersDashboard({ displayName }: ServersDashboardProps) {
  const [servers, setServers] = useState<ManagedServer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterOption>("all");
  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const [copiedGuildId, setCopiedGuildId] = useState<string | null>(null);
  const [openCardMenuGuildId, setOpenCardMenuGuildId] = useState<string | null>(null);
  const [selectedGuildIdForConfig, setSelectedGuildIdForConfig] = useState<string | null>(null);
  const [selectedEditorTabForConfig, setSelectedEditorTabForConfig] =
    useState<ServerEditorTab>("settings");
  const [pendingServerOpenQuery, setPendingServerOpenQuery] =
    useState<PendingServerOpenQuery | null>(null);
  const statusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queryGuildId = normalizeGuildIdFromQuery(params.get("guild"));
    if (!queryGuildId) return;

    setPendingServerOpenQuery({
      guildId: queryGuildId,
      tab: normalizeEditorTabFromQuery(params.get("tab")),
    });
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadServers() {
      try {
        const response = await fetch("/api/auth/me/servers", { cache: "no-store" });
        const payload = (await response.json()) as ServersApiResponse;

        if (!isMounted) return;

        if (!response.ok || !payload.ok) {
          throw new Error(payload.message || "Falha ao carregar servidores.");
        }

        setServers(payload.servers || []);
      } catch (error) {
        if (!isMounted) return;
        setErrorMessage(
          error instanceof Error ? error.message : "Erro ao carregar servidores.",
        );
        setServers([]);
      } finally {
        if (!isMounted) return;
        setIsLoading(false);
      }
    }

    void loadServers();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!pendingServerOpenQuery) return;
    if (isLoading) return;

    const targetExists = servers.some(
      (server) => server.guildId === pendingServerOpenQuery.guildId,
    );

    if (targetExists) {
      setSelectedGuildIdForConfig(pendingServerOpenQuery.guildId);
      setSelectedEditorTabForConfig(pendingServerOpenQuery.tab);
      setErrorMessage(null);
    }

    setPendingServerOpenQuery(null);
  }, [isLoading, pendingServerOpenQuery, servers]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target || !statusRef.current) return;
      if (!statusRef.current.contains(target)) {
        setIsStatusOpen(false);
      }

      if (target instanceof Element) {
        const cardMenuRoot = target.closest("[data-server-card-menu-root='true']");
        if (!cardMenuRoot) {
          setOpenCardMenuGuildId(null);
        }
      } else {
        setOpenCardMenuGuildId(null);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsStatusOpen(false);
        setOpenCardMenuGuildId(null);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const normalizedQuery = useMemo(
    () => normalizeSearchText(searchText),
    [searchText],
  );

  const filteredServers = useMemo(() => {
    return servers
      .map((server) => ({
        server,
        score: getSearchScore(server.guildName, normalizedQuery),
      }))
      .filter((item) => item.score > 0)
      .filter((item) => (statusFilter === "all" ? true : item.server.status === statusFilter))
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        return a.server.guildName.localeCompare(b.server.guildName, "pt-BR");
      })
      .map((item) => item.server);
  }, [normalizedQuery, servers, statusFilter]);

  const handleLogout = useCallback(async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);

    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login");
    }
  }, [isLoggingOut]);

  const handleCopyGuildId = useCallback(async (guildId: string) => {
    try {
      await navigator.clipboard.writeText(guildId);
      setCopiedGuildId(guildId);
      window.setTimeout(() => {
        setCopiedGuildId((current) => (current === guildId ? null : current));
      }, 1000);
    } catch {
      setCopiedGuildId(null);
    }
  }, []);

  const handleCardMenuCopyId = useCallback(
    (guildId: string) => {
      void handleCopyGuildId(guildId);
      setOpenCardMenuGuildId(null);
    },
    [handleCopyGuildId],
  );

  const handleCardMenuDeactivate = useCallback(() => {
    setOpenCardMenuGuildId(null);
    setErrorMessage("Opcao de desativacao sera liberada em breve.");
  }, []);

  const handleOpenServerConfig = useCallback(
    (guildId: string, tab: ServerEditorTab = "settings") => {
      setSelectedGuildIdForConfig(guildId);
      setSelectedEditorTabForConfig(tab);
      setErrorMessage(null);
    },
    [],
  );

  const selectedServer = useMemo(
    () => servers.find((server) => server.guildId === selectedGuildIdForConfig) || null,
    [selectedGuildIdForConfig, servers],
  );
  const isEditingServer = Boolean(selectedServer);

  return (
    <>
      <main
        className="min-h-screen bg-black px-6"
        style={{
          paddingTop: `${serversScale.pageTopPadding}px`,
          paddingBottom: `${serversScale.pageBottomPadding}px`,
        }}
      >
        <section
          className="mx-auto w-full flowdesk-fade-up-soft"
          style={{ maxWidth: `${serversScale.maxWidth}px` }}
        >
          {!isEditingServer ? (
            <>
              <div className="flex flex-col items-center">
            <div
              className="relative shrink-0"
              style={{
                width: `${serversScale.logoSize}px`,
                height: `${serversScale.logoSize}px`,
              }}
            >
              <Image
                src="/cdn/logos/logotipo.png"
                alt="Flowdesk"
                fill
                sizes={`${serversScale.logoSize}px`}
                className="object-contain"
                priority
              />
            </div>

            <h1
              className="whitespace-normal text-center leading-[1.15] font-medium text-[#D8D8D8] min-[1120px]:whitespace-nowrap"
              style={{
                marginTop: `${serversScale.titleTopSpacing}px`,
                fontSize: `${serversScale.titleSize}px`,
              }}
            >
              Escolha um servidor cliente para prosseguir a configuracao e gerenciamento
            </h1>
          </div>

              <div
                className="h-px w-full bg-[#242424]"
                style={{ marginTop: `${serversScale.separatorTopSpacing}px` }}
              />

              <div
                className="flex flex-col min-[1120px]:flex-row min-[1120px]:items-center min-[1120px]:justify-between"
                style={{
                  marginTop: `${serversScale.filtersTopSpacing}px`,
                  gap: `${serversScale.filtersGap}px`,
                }}
              >
            <div
              className="grid w-full grid-cols-1 min-[760px]:grid-cols-[1fr_auto] min-[1120px]:flex-1"
              style={{ gap: `${serversScale.filtersGap}px` }}
            >
              <input
                type="text"
                value={searchText}
                onChange={(event) => setSearchText(event.currentTarget.value)}
                placeholder="Pesquisar por servidor"
                className="border border-[#2E2E2E] bg-[#0A0A0A] text-[#D8D8D8] placeholder:text-[#3A3A3A] outline-none"
                style={{
                  height: `${serversScale.controlHeight}px`,
                  borderRadius: `${serversScale.controlRadius}px`,
                  paddingInline: `${serversScale.controlSidePadding}px`,
                  fontSize: `${serversScale.controlTextSize}px`,
                }}
              />

              <div
                ref={statusRef}
                className="relative"
                style={{ minWidth: `${serversScale.desktopStatusWidth}px` }}
              >
                <button
                  type="button"
                  onClick={() => setIsStatusOpen((current) => !current)}
                  className="flex w-full items-center justify-between border border-[#2E2E2E] bg-[#0A0A0A] text-[#D8D8D8] transition-[border-color,background-color] duration-200 hover:border-[#3A3A3A]"
                  style={{
                    height: `${serversScale.controlHeight}px`,
                    borderRadius: `${serversScale.controlRadius}px`,
                    paddingInline: `${serversScale.controlSidePadding}px`,
                    fontSize: `${serversScale.controlTextSize}px`,
                  }}
                >
                  <span>{FILTER_LABEL[statusFilter]}</span>
                  <Image
                    src="/icons/seta.png"
                    alt="Status"
                    width={serversScale.statusArrowSize}
                    height={serversScale.statusArrowSize}
                    className={
                      isStatusOpen
                        ? "rotate-180 transition-transform duration-300 ease-out"
                        : "rotate-0 transition-transform duration-300 ease-out"
                    }
                  />
                </button>

                {isStatusOpen ? (
                  <div
                    className="flowdesk-scale-in-soft absolute left-0 z-20 mt-2 w-full border border-[#2E2E2E] bg-[#0A0A0A] py-1"
                    style={{ borderRadius: `${serversScale.controlRadius}px` }}
                  >
                    {(["all", "paid", "expired", "off"] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          setStatusFilter(option);
                          setIsStatusOpen(false);
                        }}
                        className="w-full px-3 py-2 text-left text-[#D8D8D8] transition-colors hover:bg-[#121212]"
                        style={{ fontSize: `${serversScale.controlTextSize}px` }}
                      >
                        {FILTER_LABEL[option]}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                window.location.assign("/config/#/step/1");
              }}
              className="flex w-full items-center justify-center gap-2 border border-[#2E2E2E] bg-[#D8D8D8] font-medium text-black transition-opacity hover:opacity-90 min-[1120px]:ml-[44px] min-[1120px]:w-auto"
              style={{
                height: `${serversScale.controlHeight}px`,
                borderRadius: `${serversScale.controlRadius}px`,
                fontSize: `${serversScale.newBotTextSize}px`,
                minWidth: `${serversScale.desktopButtonWidth}px`,
              }}
            >
              <NewBotIcon />
              <span>Novo bot</span>
            </button>
              </div>
            </>
          ) : null}

          {selectedServer ? (
            <ServerSettingsEditor
              guildId={selectedServer.guildId}
              guildName={selectedServer.guildName}
              status={selectedServer.status}
              allServers={servers}
              initialTab={selectedEditorTabForConfig}
              standalone
              onClose={() => {
                setSelectedGuildIdForConfig(null);
                setSelectedEditorTabForConfig("settings");
                const url = new URL(window.location.href);
                if (url.searchParams.has("guild") || url.searchParams.has("tab")) {
                  url.searchParams.delete("guild");
                  url.searchParams.delete("tab");
                  window.history.replaceState(
                    null,
                    "",
                    `${url.pathname}${url.search}${url.hash}`,
                  );
                }
              }}
            />
          ) : null}

          {!isEditingServer ? (
            isLoading ? (
              <div style={{ marginTop: `${serversScale.cardsTopSpacing}px` }}>
                <div className="mb-5 flex items-center justify-center gap-2 text-[12px] text-[#7C7C7C]">
                  <ButtonLoader size={18} colorClassName="text-[#7C7C7C]" />
                  <span>Carregando servidores</span>
                </div>
                <div
                  className="grid grid-cols-1 min-[780px]:grid-cols-2 min-[1160px]:grid-cols-3"
                  style={{ gap: `${serversScale.cardsGap}px` }}
                >
                  {Array.from({ length: 6 }, (_, index) => (
                    <ServerCardSkeleton key={index} index={index} />
                  ))}
                </div>
              </div>
            ) : errorMessage ? (
              <p className="mt-8 text-center text-[12px] text-[#C2C2C2]">{errorMessage}</p>
            ) : filteredServers.length ? (
              <div
                className="grid grid-cols-1 min-[780px]:grid-cols-2 min-[1160px]:grid-cols-3"
                style={{
                  marginTop: `${serversScale.cardsTopSpacing}px`,
                  gap: `${serversScale.cardsGap}px`,
                }}
              >
                {filteredServers.map((server, index) => {
                  const style = statusStyle(server.status);
                  const isCopied = copiedGuildId === server.guildId;
                  const isSelected = selectedGuildIdForConfig === server.guildId;

                  return (
                    <article
                      key={server.guildId}
                      className={`flowdesk-fade-up-soft cursor-pointer border bg-[#0A0A0A] transition-[border-color,box-shadow] duration-300 ease-out hover:border-[#3A3A3A] hover:shadow-[0_0_0_1px_rgba(58,58,58,0.2)] ${
                        isSelected
                          ? "border-[#5A5A5A] shadow-[0_0_0_1px_rgba(90,90,90,0.25)]"
                          : "border-[#2E2E2E]"
                      }`}
                      style={{
                        width: "100%",
                        borderRadius: `${serversScale.cardRadius}px`,
                        padding: `${serversScale.cardPadding}px`,
                        animationDelay: `${Math.min(index, 12) * 45}ms`,
                      }}
                      onClick={() => handleOpenServerConfig(server.guildId)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleOpenServerConfig(server.guildId);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="flex items-start justify-between">
                        <div
                          className="flex min-w-0 items-center"
                          style={{ gap: `${Math.round(serversScale.cardPadding * 0.85)}px` }}
                        >
                          {server.iconUrl ? (
                            <Image
                              src={server.iconUrl}
                              alt={server.guildName}
                              width={serversScale.cardIconSize}
                              height={serversScale.cardIconSize}
                              className="object-cover"
                              style={{ borderRadius: `${serversScale.cardIconRadius}px` }}
                              unoptimized
                            />
                          ) : (
                            <FallbackServerIcon />
                          )}

                          <div className="min-w-0">
                            <p
                              className="truncate font-medium text-[#D8D8D8]"
                              style={{ fontSize: `${serversScale.cardNameSize}px` }}
                            >
                              {server.guildName}
                            </p>
                            <div className="mt-[2px] flex items-center gap-[4px]">
                              <span
                                className="text-[#686868]"
                                style={{ fontSize: `${serversScale.cardIdSize}px` }}
                              >
                                {server.guildId}
                              </span>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleCopyGuildId(server.guildId);
                                }}
                                className={`text-[#686868] transition-colors ${
                                  isCopied ? "text-[#6AE25A]" : "hover:text-[#A0A0A0]"
                                }`}
                                aria-label="Copiar ID do servidor"
                              >
                                <span
                                  className="relative inline-flex items-center justify-center"
                                  style={{
                                    width: `${serversScale.copyIconSize}px`,
                                    height: `${serversScale.copyIconSize}px`,
                                  }}
                                >
                                  <span
                                    className={`absolute inset-0 inline-flex items-center justify-center transition-all duration-200 ${
                                      isCopied ? "scale-75 opacity-0" : "scale-100 opacity-100"
                                    }`}
                                  >
                                    <CopyIcon />
                                  </span>
                                  <span
                                    className={`inline-flex items-center justify-center transition-all duration-200 ${
                                      isCopied
                                        ? "flowdesk-scale-in-soft scale-100 opacity-100"
                                        : "scale-75 opacity-0"
                                    }`}
                                  >
                                    <CheckIcon />
                                  </span>
                                </span>
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="relative" data-server-card-menu-root="true">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenCardMenuGuildId((current) =>
                                current === server.guildId ? null : server.guildId,
                              );
                            }}
                            className="inline-flex items-center justify-center leading-none text-[#2A2A2A] transition-colors hover:bg-[rgba(255,255,255,0.05)] hover:text-[#5A5A5A]"
                            style={{
                              width: `${Math.round(serversScale.cardMenuDotsSize * 1.35)}px`,
                              height: `${Math.round(serversScale.cardMenuDotsSize * 1.15)}px`,
                              borderRadius: "2px",
                              fontSize: `${serversScale.cardMenuDotsSize}px`,
                            }}
                            aria-label="Abrir menu do servidor"
                          >
                            ...
                          </button>

                          {openCardMenuGuildId === server.guildId ? (
                            <div className="flowdesk-scale-in-soft absolute right-0 top-[22px] z-20 min-w-[138px] rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] py-1">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleCardMenuCopyId(server.guildId);
                                }}
                                className="block w-full px-3 py-2 text-left text-[12px] text-[#D8D8D8] transition-colors hover:bg-[#121212]"
                              >
                                Copiar ID
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleCardMenuDeactivate();
                                }}
                                className="block w-full px-3 py-2 text-left text-[12px] text-[#D8D8D8] transition-colors hover:bg-[#121212]"
                              >
                                Desativar Bot
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div
                        className="flex items-center gap-[8px]"
                        style={{ marginTop: `${serversScale.cardBottomSpacing}px` }}
                      >
                        <span
                          className={`inline-flex items-center justify-center rounded-[3px] ${style.badgeClass}`}
                          style={{
                            width: `${serversScale.badgeWidth}px`,
                            height: `${serversScale.badgeHeight}px`,
                            fontSize: `${serversScale.badgeTextSize}px`,
                          }}
                        >
                          {style.badgeText}
                        </span>
                        <span
                          className="text-[#686868]"
                          style={{ fontSize: `${serversScale.statusDescriptionSize}px` }}
                        >
                          {statusDescription(server)}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="mt-8 text-center text-[12px] text-[#C2C2C2]">
                Nenhum servidor encontrado para esse filtro.
              </p>
            )
          ) : null}

          <span className="sr-only">{displayName}</span>
        </section>
      </main>

      <ConfigLogoutButton
        onClick={() => {
          void handleLogout();
        }}
        disabled={isLoggingOut}
      />
    </>
  );
}
