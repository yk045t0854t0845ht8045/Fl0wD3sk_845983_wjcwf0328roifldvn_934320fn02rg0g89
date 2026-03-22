"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { GuildSelect } from "@/components/config/GuildSelect";
import { BotMissingModal } from "@/components/config/BotMissingModal";
import { configStepScale } from "@/components/config/configStepScale";
import { ButtonLoader } from "@/components/login/ButtonLoader";

type GuildItem = {
  id: string;
  name: string;
  icon_url: string | null;
  owner: boolean;
  admin: boolean;
};

type ConfigStepOneProps = {
  displayName: string;
  initialSelectedGuildId?: string | null;
  onSelectedGuildChange?: (guildId: string | null) => void;
  onProceedToStepTwo?: (guildId: string) => void;
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

const DEFAULT_NEXT_STEP_URL = "/config/#/step/2";
const BOT_CHECK_INTERVAL_MS = 4_000;
const GUILDS_CACHE_STORAGE_KEY = "flowdesk_step1_guilds_cache_v3";
const GUILDS_CACHE_TTL_MS = 5 * 60 * 1000;

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

export function ConfigStepOne({
  displayName,
  initialSelectedGuildId = null,
  onSelectedGuildChange,
  onProceedToStepTwo,
}: ConfigStepOneProps) {
  const [guilds, setGuilds] = useState<GuildItem[]>([]);
  const [isLoadingGuilds, setIsLoadingGuilds] = useState(true);
  const [hasFreshGuildsSync, setHasFreshGuildsSync] = useState(false);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(
    initialSelectedGuildId,
  );
  const [isOpen, setIsOpen] = useState(true);
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

  useEffect(() => {
    let isMounted = true;

    async function loadGuilds() {
      const cachedGuilds = readGuildsCache();
      if (cachedGuilds && cachedGuilds.length) {
        setGuilds(cachedGuilds);
        setIsLoadingGuilds(false);
      }

      try {
        const response = await fetch("/api/auth/me/guilds?excludePaid=1", {
          cache: "no-store",
        });
        const payload = (await response.json()) as GuildsApiResponse;

        if (!isMounted) return;

        if (payload.ok) {
          const nextGuilds = payload.guilds || [];
          setGuilds(nextGuilds);
          writeGuildsCache(nextGuilds);
          setHasFreshGuildsSync(true);
          return;
        }

        if (!cachedGuilds) {
          setGuilds([]);
        }
      } catch {
        if (!isMounted) return;

        if (!cachedGuilds) {
          setGuilds([]);
        }
      } finally {
        if (!isMounted) return;
        setIsLoadingGuilds(false);
      }
    }

    loadGuilds();

    return () => {
      isMounted = false;
    };
  }, []);

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

  const goToNextStep = useCallback((guildId: string) => {
    clearBotPolling();
    setIsBotModalOpen(false);
    setBotInviteUrl(null);

    if (onProceedToStepTwo) {
      onProceedToStepTwo(guildId);
      return;
    }

    window.location.assign(`${DEFAULT_NEXT_STEP_URL}?guild=${guildId}`);
  }, [clearBotPolling, onProceedToStepTwo]);

  const startRealtimeBotPolling = useCallback(
    (guildId: string) => {
      clearBotPolling();

      pollIntervalRef.current = setInterval(async () => {
        if (pollLockRef.current) return;

        pollLockRef.current = true;

        try {
          const payload = await requestBotPresence(guildId);

          if (payload.ok && payload.canProceed) {
            goToNextStep(guildId);
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

    const payload = await requestBotPresence(selectedGuild.id);

    setIsValidatingNext(false);

    if (payload.ok && payload.canProceed) {
      goToNextStep(selectedGuild.id);
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

    const payload = await requestBotPresence(selectedGuildId);

    if (payload.ok && payload.canProceed) {
      setIsModalChecking(false);
      goToNextStep(selectedGuildId);
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

    setIsModalChecking(false);
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
    <main className="flex min-h-screen items-center justify-center bg-black px-6 py-8">
      <section className="w-full" style={{ maxWidth: `${configStepScale.maxWidth}px` }}>
        <div className="flex flex-col items-center" style={{ gap: `${configStepScale.spacing}px` }}>
          <div
            className="relative shrink-0"
            style={{
              width: `${configStepScale.logoSize}px`,
              height: `${configStepScale.logoSize}px`,
            }}
          >
            <Image
              src="/cdn/logos/logotipo_.svg"
              alt="Flowdesk"
              fill
              sizes={`${configStepScale.logoSize}px`}
              className="object-contain"
              priority
            />
          </div>

          <h1
            className="whitespace-normal text-center leading-[1.15] font-medium text-[#D8D8D8] min-[960px]:whitespace-nowrap"
            style={{ fontSize: `${configStepScale.titleSize}px` }}
          >
            Escolha qual servidor deseja adicionar o Flowdesk
          </h1>

          <div
            className="w-full bg-[#242424]"
            style={{ height: `${configStepScale.separatorHeight}px` }}
          />

          <GuildSelect
            guilds={guilds}
            selectedGuildId={selectedGuildId}
            onSelect={handleSelectGuild}
            isOpen={isOpen}
            onToggle={() => setIsOpen((value) => !value)}
            isLoading={isLoadingGuilds}
          />

          <div
            className="w-full bg-[#242424]"
            style={{ height: `${configStepScale.separatorHeight}px` }}
          />

          <button
            type="button"
            onClick={() => {
              void handleNextClick();
            }}
            disabled={!selectedGuild || isValidatingNext}
            aria-busy={isValidatingNext}
            className="flex w-full items-center justify-center bg-[#D8D8D8] font-medium text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
            style={{
              height: `${configStepScale.nextButtonHeight}px`,
              borderRadius: `${configStepScale.controlRadius}px`,
              fontSize: `${configStepScale.nextButtonTextSize}px`,
            }}
          >
            {isValidatingNext ? <ButtonLoader size={24} /> : "Proximo"}
          </button>

          {nextActionError ? (
            <p className="text-center text-[12px] text-[#C2C2C2]">{nextActionError}</p>
          ) : null}

          <span className="sr-only">{displayName}</span>
        </div>
      </section>

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
