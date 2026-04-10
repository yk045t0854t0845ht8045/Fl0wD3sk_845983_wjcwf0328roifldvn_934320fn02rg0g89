"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GuildSelect } from "@/components/config/GuildSelect";
import { BotMissingModal } from "@/components/config/BotMissingModal";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import { LandingFrameLines } from "@/components/landing/LandingFrameLines";
import { LandingGlowTag } from "@/components/landing/LandingGlowTag";

type GuildItem = {
  id: string;
  name: string;
  icon_url: string | null;
  owner: boolean;
  admin: boolean;
  description?: string | null;
};

type ConfigStepOneProps = {
  displayName: string;
  initialSelectedGuildId?: string | null;
  onSelectedGuildChange?: (guildId: string | null) => void;
  onProceedAfterValidation?: (
    guildId: string,
  ) => Promise<
    | {
        ok: true;
        target: "payment" | "servers";
      }
    | {
        ok: false;
        message: string;
      }
  >;
};

type GuildsApiResponse = {
  ok: boolean;
  guilds?: GuildItem[];
};

type BotPresenceApiResponse = {
  ok: boolean;
  canProceed?: boolean;
  reason?: "bot_not_found" | "missing_admin_permission";
  inviteUrl?: string;
  message?: string;
};

const DEFAULT_NEXT_STEP_URL = "/config";
const BOT_CHECK_INTERVAL_MS = 4_000;
const GUILDS_CACHE_STORAGE_KEY = "flowdesk_step1_guilds_cache_v4";
const GUILDS_CACHE_TTL_MS = 5 * 60 * 1000;
const GUILDS_REALTIME_SYNC_INTERVAL_MS = 20_000;

type GuildsCachePayload = {
  guilds: GuildItem[];
  cachedAt: number;
};

function readGuildsCache() {
  try {
    const raw = window.sessionStorage.getItem(GUILDS_CACHE_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as GuildsCachePayload;
    if (!parsed || !Array.isArray(parsed.guilds)) return null;
    if (!Number.isFinite(parsed.cachedAt)) return null;
    if (Date.now() - parsed.cachedAt > GUILDS_CACHE_TTL_MS) return null;

    return parsed.guilds;
  } catch {
    return null;
  }
}

function writeGuildsCache(guilds: GuildItem[]) {
  try {
    const payload: GuildsCachePayload = {
      guilds,
      cachedAt: Date.now(),
    };

    window.sessionStorage.setItem(
      GUILDS_CACHE_STORAGE_KEY,
      JSON.stringify(payload),
    );
  } catch {
    // Ignora erro de cache local.
  }
}

function resolveSelectionDescription(guild: GuildItem | null) {
  if (!guild) {
    return "Escolha um servidor acima para validar o bot e liberar a configuracao do Flowdesk.";
  }

  if (guild.owner) {
    return "A conta atual possui a posse deste servidor. Assim que validarmos o bot, o sistema decide automaticamente se este servidor ja pode ser liberado ou se precisa abrir o checkout.";
  }

  if (guild.admin) {
    return "Voce tem acesso administrativo neste servidor. O proximo passo confirma a presenca do bot e libera este servidor imediatamente quando sua conta ja tiver capacidade disponivel.";
  }

  return "Este servidor esta pronto para seguir. O proximo passo valida o bot e decide entre liberar a configuracao agora ou abrir o checkout.";
}

export function ConfigStepOne({
  displayName,
  initialSelectedGuildId = null,
  onSelectedGuildChange,
  onProceedAfterValidation,
}: ConfigStepOneProps) {
  const [guilds, setGuilds] = useState<GuildItem[]>([]);
  const [isLoadingGuilds, setIsLoadingGuilds] = useState(true);
  const [hasFreshGuildsSync, setHasFreshGuildsSync] = useState(false);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(
    initialSelectedGuildId,
  );
  const [isValidatingNext, setIsValidatingNext] = useState(false);
  const [nextActionError, setNextActionError] = useState<string | null>(null);
  const [isBotModalOpen, setIsBotModalOpen] = useState(false);
  const [botBlockReason, setBotBlockReason] = useState<
    "bot_not_found" | "missing_admin_permission"
  >("bot_not_found");
  const [botInviteUrl, setBotInviteUrl] = useState<string | null>(null);
  const [isModalChecking, setIsModalChecking] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollLockRef = useRef(false);
  const guildsRefreshLockRef = useRef(false);

  const refreshGuilds = useCallback(
    async (options?: { allowCachedFallback?: boolean; keepLoadingState?: boolean }) => {
      if (guildsRefreshLockRef.current) {
        return;
      }

      guildsRefreshLockRef.current = true;
      const allowCachedFallback = options?.allowCachedFallback ?? true;
      const keepLoadingState = options?.keepLoadingState ?? false;

      if (!keepLoadingState) {
        setIsLoadingGuilds(true);
      }

      try {
        const response = await fetch("/api/auth/me/guilds?excludePaid=1", {
          cache: "no-store",
        });
        const payload = (await response.json()) as GuildsApiResponse;

        if (!payload.ok) {
          throw new Error("Falha ao atualizar a lista de servidores.");
        }

        const nextGuilds = payload.guilds || [];
        setGuilds(nextGuilds);
        writeGuildsCache(nextGuilds);
        setHasFreshGuildsSync(true);
      } catch {
        if (allowCachedFallback) {
          const cachedGuilds = readGuildsCache();
          if (cachedGuilds) {
            setGuilds(cachedGuilds);
          }
        }
      } finally {
        guildsRefreshLockRef.current = false;
        setIsLoadingGuilds(false);
      }
    },
    [],
  );

  useEffect(() => {
    async function loadGuilds() {
      await refreshGuilds({ allowCachedFallback: true });
    }

    void loadGuilds();
  }, [refreshGuilds]);

  useEffect(() => {
    function handleWindowFocus() {
      void refreshGuilds({ allowCachedFallback: false, keepLoadingState: true });
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      void refreshGuilds({ allowCachedFallback: false, keepLoadingState: true });
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshGuilds({ allowCachedFallback: false, keepLoadingState: true });
    }, GUILDS_REALTIME_SYNC_INTERVAL_MS);

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshGuilds]);

  const selectedGuild = useMemo(
    () => guilds.find((guild) => guild.id === selectedGuildId) || null,
    [guilds, selectedGuildId],
  );

  const clearBotPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    pollLockRef.current = false;
  }, []);

  const requestBotPresence = useCallback(async (guildId: string) => {
    try {
      const response = await fetch("/api/auth/me/guilds/bot-presence", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ guildId }),
        cache: "no-store",
      });

      const payload = (await response.json()) as BotPresenceApiResponse;

      if (!response.ok) {
        return {
          ok: false,
          message: payload.message || "Nao foi possivel validar este servidor.",
        } satisfies BotPresenceApiResponse;
      }

      return payload;
    } catch {
      return {
        ok: false,
        message: "Falha de rede ao validar o servidor selecionado.",
      } satisfies BotPresenceApiResponse;
    }
  }, []);

  const goToNextStep = useCallback(async (guildId: string) => {
    clearBotPolling();
    setIsBotModalOpen(false);
    setBotInviteUrl(null);

    if (onProceedAfterValidation) {
      const result = await onProceedAfterValidation(guildId);
      if (!result.ok) {
        setNextActionError(result.message);
      }
      return;
    }

    window.location.assign(`${DEFAULT_NEXT_STEP_URL}?guild=${guildId}#/payment`);
  }, [clearBotPolling, onProceedAfterValidation]);

  const startRealtimeBotPolling = useCallback(
    (guildId: string) => {
      clearBotPolling();

      pollIntervalRef.current = setInterval(async () => {
        if (pollLockRef.current) return;

        pollLockRef.current = true;

        try {
          const payload = await requestBotPresence(guildId);

          if (payload.ok && payload.canProceed) {
            void goToNextStep(guildId);
          } else if (payload.ok) {
            if (payload.reason) {
              setBotBlockReason(payload.reason);
            }
            if (payload.inviteUrl) {
              setBotInviteUrl(payload.inviteUrl);
            }
          }
        } finally {
          pollLockRef.current = false;
        }
      }, BOT_CHECK_INTERVAL_MS);
    },
    [clearBotPolling, goToNextStep, requestBotPresence],
  );

  const handleNextClick = useCallback(async () => {
    if (!selectedGuild) return;

    setNextActionError(null);
    setIsValidatingNext(true);

    try {
      const payload = await requestBotPresence(selectedGuild.id);

      if (payload.ok && payload.canProceed) {
        await goToNextStep(selectedGuild.id);
        return;
      }

      if (payload.ok && !payload.canProceed) {
        if (payload.reason) {
          setBotBlockReason(payload.reason);
        }
        setBotInviteUrl(payload.inviteUrl || null);
        setIsBotModalOpen(true);
        startRealtimeBotPolling(selectedGuild.id);
        return;
      }

      setNextActionError(payload.message || "Nao foi possivel validar o servidor.");
    } finally {
      setIsValidatingNext(false);
    }
  }, [goToNextStep, requestBotPresence, selectedGuild, startRealtimeBotPolling]);

  const handleCloseBotModal = useCallback(() => {
    setIsBotModalOpen(false);
    setIsModalChecking(false);
    clearBotPolling();
  }, [clearBotPolling]);

  const handleContinueBotModal = useCallback(async () => {
    if (!selectedGuildId) return;

    if (botInviteUrl) {
      window.open(botInviteUrl, "_blank", "noopener,noreferrer");
    }

    setIsModalChecking(true);

    try {
      const payload = await requestBotPresence(selectedGuildId);

      if (payload.ok && payload.canProceed) {
        await goToNextStep(selectedGuildId);
        return;
      }

      if (payload.ok && payload.inviteUrl) {
        if (payload.reason) {
          setBotBlockReason(payload.reason);
        }
        setBotInviteUrl(payload.inviteUrl);
        startRealtimeBotPolling(selectedGuildId);
      }

      if (!payload.ok) {
        setNextActionError(payload.message || "Erro ao validar o servidor em tempo real.");
      }
    } finally {
      setIsModalChecking(false);
    }
  }, [
    botInviteUrl,
    goToNextStep,
    requestBotPresence,
    selectedGuildId,
    startRealtimeBotPolling,
  ]);

  useEffect(() => {
    return () => {
      clearBotPolling();
    };
  }, [clearBotPolling]);

  useEffect(() => {
    setNextActionError(null);
  }, [selectedGuildId]);

  useEffect(() => {
    if (!hasFreshGuildsSync || !selectedGuildId) return;
    if (guilds.some((guild) => guild.id === selectedGuildId)) return;

    setSelectedGuildId(null);
    onSelectedGuildChange?.(null);
    setNextActionError(
      "Este servidor ja possui uma licenca ativa em outra conta ou nao esta mais disponivel para nova configuracao.",
    );
  }, [guilds, hasFreshGuildsSync, onSelectedGuildChange, selectedGuildId]);

  useEffect(() => {
    if (initialSelectedGuildId === undefined) return;
    setSelectedGuildId(initialSelectedGuildId);
  }, [initialSelectedGuildId]);

  const handleSelectGuild = useCallback(
    (guildId: string) => {
      setSelectedGuildId(guildId);
      onSelectedGuildChange?.(guildId);
    },
    [onSelectedGuildChange],
  );

  const botModalTitle =
    botBlockReason === "missing_admin_permission"
      ? "Permissao de administrador ausente"
      : "Bot nao encontrado no servidor";

  const botModalDescription =
    botBlockReason === "missing_admin_permission"
      ? "O bot esta no servidor, mas sem permissao de administrador. Reautorize para continuar."
      : "Precisamos adicionar o bot neste servidor para continuar a configuracao.";
  return (
    <main className="relative min-h-screen overflow-x-clip bg-[#040404] text-white">
      <LandingFrameLines />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0.015)_24%,transparent_62%)]"
      />

      <div
        className={`relative mx-auto flex min-h-screen w-full max-w-[1582px] items-start justify-center px-[20px] pt-[88px] md:px-6 lg:px-8 xl:px-10 2xl:px-[20px] ${
          selectedGuild ? "pb-[178px]" : "pb-[34px]"
        }`}
      >
        <section className="w-full max-w-[1240px] flowdesk-stage-fade">
          <div className="mx-auto max-w-[820px] text-center">
            <LandingGlowTag>Ativacao da licenca | Etapa 1</LandingGlowTag>

            <h1 className="mt-[24px] bg-[linear-gradient(90deg,#E7E7E7_0%,#BFBFBF_100%)] bg-clip-text text-[38px] leading-[0.98] font-normal tracking-[-0.06em] text-transparent sm:text-[48px] lg:text-[56px]">
              Escolha o servidor que vai receber o Flowdesk
            </h1>

            <p className="mx-auto mt-[16px] max-w-[720px] text-[15px] leading-[1.7] text-[#8A8A8A] sm:text-[16px]">
              Escolha um servidor, valide o bot e siga para a liberacao. Quando sua conta ja tiver capacidade no plano atual, voce vai direto para Servers sem voltar ao checkout.
            </p>
          </div>

          <div className="mt-[34px]">
            <GuildSelect
              guilds={guilds}
              selectedGuildId={selectedGuildId}
              onSelect={handleSelectGuild}
              isLoading={isLoadingGuilds}
            />
          </div>

          {nextActionError && !selectedGuild ? (
            <div className="mt-[22px] rounded-[24px] border border-[rgba(219,70,70,0.22)] bg-[linear-gradient(180deg,rgba(20,9,9,0.92)_0%,rgba(12,6,6,0.96)_100%)] px-[18px] py-[16px] text-left shadow-[0_20px_65px_rgba(0,0,0,0.28)]">
              <p className="text-[12px] font-medium tracking-[0.18em] uppercase text-[#D98484]">
                Nao foi possivel continuar
              </p>
              <p className="mt-[10px] text-[14px] leading-[1.65] text-[#C8B0B0]">
                {nextActionError}
              </p>
            </div>
          ) : null}

          <span className="sr-only">{displayName}</span>
        </section>
      </div>

      {selectedGuild ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[22px] z-[55] flex justify-center px-4 md:px-6 lg:px-8">
          <div className="w-full max-w-[1220px]">
            <div className="pointer-events-auto relative w-full overflow-hidden rounded-[26px] shadow-[0_26px_90px_rgba(0,0,0,0.48)] backdrop-blur-[18px] flowdesk-sheet-up">
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute inset-0 rounded-[26px] border ${
                  nextActionError
                    ? "border-[rgba(219,70,70,0.38)]"
                    : "border-[#0E0E0E]"
                }`}
              />
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute inset-[-2px] rounded-[26px] ${
                  nextActionError
                    ? "flowdesk-tag-border-glow-danger"
                    : "flowdesk-tag-border-glow"
                }`}
              />
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute inset-[-1px] rounded-[26px] ${
                  nextActionError
                    ? "flowdesk-tag-border-core-danger"
                    : "flowdesk-tag-border-core"
                }`}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-[1px] rounded-[25px] bg-[#070707]"
              />

              <div className="relative z-10 flex flex-col gap-[16px] px-[18px] py-[16px] sm:px-[22px] sm:py-[18px] xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-[18px] leading-[1.08] font-medium tracking-[-0.04em] text-[#EDEDED]">
                    {selectedGuild.name} pronto para continuar
                  </p>
                  <p className="mt-[8px] max-w-[720px] text-[13px] leading-[1.62] text-[#7F7F7F]">
                    {resolveSelectionDescription(selectedGuild)}
                  </p>
                  {nextActionError ? (
                    <p className="mt-[10px] text-[13px] leading-[1.6] text-[#D88F8F]">
                      {nextActionError}
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-col-reverse gap-[10px] sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedGuildId(null);
                      onSelectedGuildChange?.(null);
                      clearBotPolling();
                      setNextActionError(null);
                    }}
                    className="group relative inline-flex h-[46px] items-center justify-center overflow-hidden whitespace-nowrap rounded-[12px] px-6 text-[15px] leading-none font-semibold transition-colors"
                  >
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-[12px] border border-[#1B1B1B] bg-[#111111] transition-colors"
                    />
                    <span className="relative z-10 inline-flex items-center justify-center whitespace-nowrap text-[#D0D0D0]">
                      Trocar servidor
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      void handleNextClick();
                    }}
                    disabled={isValidatingNext}
                    aria-busy={isValidatingNext}
                    className={`group relative inline-flex h-[46px] items-center justify-center overflow-hidden whitespace-nowrap rounded-[12px] px-6 text-[15px] leading-none font-semibold ${
                      isValidatingNext ? "cursor-not-allowed" : ""
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute inset-0 rounded-[12px] transition-transform duration-150 ease-out ${
                        isValidatingNext
                          ? "bg-[#111111]"
                          : "bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] group-hover:scale-[1.02] group-active:scale-[0.985]"
                      }`}
                    />
                    <span
                      className={`relative z-10 inline-flex items-center justify-center whitespace-nowrap ${
                        isValidatingNext ? "text-[#B7B7B7]" : "text-[#282828]"
                      }`}
                    >
                      {isValidatingNext ? (
                        <ButtonLoader
                          size={18}
                          colorClassName={
                            isValidatingNext ? "text-[#B7B7B7]" : "text-[#282828]"
                          }
                        />
                      ) : (
                        "Continuar"
                      )}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <BotMissingModal
        isOpen={isBotModalOpen}
        onClose={handleCloseBotModal}
        onContinue={() => {
          void handleContinueBotModal();
        }}
        isChecking={isModalChecking}
        title={botModalTitle}
        description={botModalDescription}
      />
    </main>
  );
}

