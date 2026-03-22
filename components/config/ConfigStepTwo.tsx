"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ConfigStepSelect } from "@/components/config/ConfigStepSelect";
import { configStepTwoScale } from "@/components/config/configStepTwoScale";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import type { StepTwoDraft } from "@/lib/auth/configContext";
import { hasStepTwoDraftValues } from "@/lib/auth/configContext";

type ConfigStepTwoProps = {
  displayName: string;
  guildId: string | null;
  guildLicenseStatus?: "paid" | "expired" | "off" | "not_paid";
  initialDraft?: StepTwoDraft | null;
  onDraftChange?: (guildId: string, draft: StepTwoDraft) => void;
  onProceedToStepThree?: () => void;
  onGoBackToStepOne?: () => void;
};

type SelectOption = {
  id: string;
  name: string;
};

type GuildChannelsApiResponse = {
  ok: boolean;
  message?: string;
  channels?: {
    text: Array<{
      id: string;
      name: string;
      type: number;
      position: number;
    }>;
    categories: Array<{
      id: string;
      name: string;
      type: number;
      position: number;
    }>;
  };
};

type TicketSettingsSnapshot = {
  menuChannelId: string;
  ticketsCategoryId: string;
  logsCreatedChannelId: string;
  logsClosedChannelId: string;
};

type TicketSettingsApiResponse = {
  ok: boolean;
  message?: string;
  settings?: TicketSettingsSnapshot | null;
};

const DEFAULT_NEXT_STEP_URL = "/config/#/step/3";

function buildStepTwoDraft(
  data: Partial<StepTwoDraft> | null | undefined,
): StepTwoDraft {
  return {
    menuChannelId: data?.menuChannelId || null,
    ticketsCategoryId: data?.ticketsCategoryId || null,
    logsCreatedChannelId: data?.logsCreatedChannelId || null,
    logsClosedChannelId: data?.logsClosedChannelId || null,
  };
}

export function ConfigStepTwo({
  displayName,
  guildId,
  guildLicenseStatus = "not_paid",
  initialDraft = null,
  onDraftChange,
  onProceedToStepThree,
  onGoBackToStepOne,
}: ConfigStepTwoProps) {
  const latestInitialDraftRef = useRef(buildStepTwoDraft(initialDraft));
  const hasInitialDraftValuesRef = useRef(hasStepTwoDraftValues(initialDraft));
  const [textChannelOptions, setTextChannelOptions] = useState<SelectOption[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<SelectOption[]>([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState(true);
  const [menuChannelId, setMenuChannelId] = useState<string | null>(null);
  const [ticketsCategoryId, setTicketsCategoryId] = useState<string | null>(null);
  const [logsCreatedChannelId, setLogsCreatedChannelId] = useState<string | null>(null);
  const [logsClosedChannelId, setLogsClosedChannelId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isPlanLocked = guildLicenseStatus === "expired" || guildLicenseStatus === "off";

  useEffect(() => {
    latestInitialDraftRef.current = buildStepTwoDraft(initialDraft);
    hasInitialDraftValuesRef.current = hasStepTwoDraftValues(initialDraft);
  }, [initialDraft]);

  useEffect(() => {
    if (!guildId) {
      setTextChannelOptions([]);
      setCategoryOptions([]);
      setMenuChannelId(null);
      setTicketsCategoryId(null);
      setLogsCreatedChannelId(null);
      setLogsClosedChannelId(null);
      setIsLoadingChannels(false);
      return;
    }

    let isMounted = true;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, 12000);
    setIsLoadingChannels(true);
    setErrorMessage(null);

    async function loadChannelsAndSettings() {
      try {
        const [channelsResponse, settingsResponse] = await Promise.all([
          fetch(`/api/auth/me/guilds/channels?guildId=${guildId}`, {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch(`/api/auth/me/guilds/ticket-settings?guildId=${guildId}`, {
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);

        const channelsPayload = (await channelsResponse.json()) as GuildChannelsApiResponse;
        const settingsPayload = (await settingsResponse.json()) as TicketSettingsApiResponse;

        if (!isMounted) return;

        if (!channelsResponse.ok || !channelsPayload.ok || !channelsPayload.channels) {
          throw new Error(channelsPayload.message || "Falha ao carregar canais do servidor.");
        }

        const nextTextOptions = channelsPayload.channels.text.map((channel) => ({
          id: channel.id,
          name: `# ${channel.name}`,
        }));
        const nextCategoryOptions = channelsPayload.channels.categories.map((category) => ({
          id: category.id,
          name: category.name,
        }));

        setTextChannelOptions(nextTextOptions);
        setCategoryOptions(nextCategoryOptions);

        const fallbackSettings =
          settingsResponse.ok && settingsPayload.ok && settingsPayload.settings
            ? buildStepTwoDraft(settingsPayload.settings)
            : buildStepTwoDraft(null);

        const sourceDraft = hasInitialDraftValuesRef.current
          ? latestInitialDraftRef.current
          : fallbackSettings;

        const textChannelSet = new Set(nextTextOptions.map((option) => option.id));
        const categorySet = new Set(nextCategoryOptions.map((option) => option.id));

        setMenuChannelId(
          sourceDraft.menuChannelId && textChannelSet.has(sourceDraft.menuChannelId)
            ? sourceDraft.menuChannelId
            : null,
        );
        setTicketsCategoryId(
          sourceDraft.ticketsCategoryId && categorySet.has(sourceDraft.ticketsCategoryId)
            ? sourceDraft.ticketsCategoryId
            : null,
        );
        setLogsCreatedChannelId(
          sourceDraft.logsCreatedChannelId && textChannelSet.has(sourceDraft.logsCreatedChannelId)
            ? sourceDraft.logsCreatedChannelId
            : null,
        );
        setLogsClosedChannelId(
          sourceDraft.logsClosedChannelId && textChannelSet.has(sourceDraft.logsClosedChannelId)
            ? sourceDraft.logsClosedChannelId
            : null,
        );
      } catch (error) {
        if (!isMounted) return;
        if (error instanceof DOMException && error.name === "AbortError") {
          setErrorMessage("Tempo esgotado ao buscar canais do servidor. Tente novamente.");
          return;
        }
        setTextChannelOptions([]);
        setCategoryOptions([]);
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Erro ao buscar os canais do servidor selecionado.",
        );
      } finally {
        if (!isMounted) return;
        window.clearTimeout(timeoutId);
        setIsLoadingChannels(false);
      }
    }

    void loadChannelsAndSettings();

    return () => {
      isMounted = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [guildId]);

  useEffect(() => {
    if (!guildId || isLoadingChannels) return;

    onDraftChange?.(guildId, {
      menuChannelId,
      ticketsCategoryId,
      logsCreatedChannelId,
      logsClosedChannelId,
    });
  }, [
    guildId,
    isLoadingChannels,
    logsClosedChannelId,
    logsCreatedChannelId,
    menuChannelId,
    onDraftChange,
    ticketsCategoryId,
  ]);

  const canSave = useMemo(
    () =>
      Boolean(
        guildId &&
          menuChannelId &&
          ticketsCategoryId &&
          logsCreatedChannelId &&
          logsClosedChannelId &&
          !isLoadingChannels &&
          !isPlanLocked &&
          !isSaving,
      ),
    [
      guildId,
      menuChannelId,
      ticketsCategoryId,
      logsCreatedChannelId,
      logsClosedChannelId,
      isLoadingChannels,
      isPlanLocked,
      isSaving,
    ],
  );

  const proceedToStepThree = useCallback(() => {
    if (onProceedToStepThree) {
      onProceedToStepThree();
      return;
    }

    window.location.assign(DEFAULT_NEXT_STEP_URL);
  }, [onProceedToStepThree]);

  const handleSubmit = useCallback(async () => {
    if (!canSave || !guildId) return;

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/auth/me/guilds/ticket-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          guildId,
          menuChannelId,
          ticketsCategoryId,
          logsCreatedChannelId,
          logsClosedChannelId,
        }),
      });

      const payload = (await response.json()) as TicketSettingsApiResponse;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Falha ao salvar configuracoes.");
      }

      proceedToStepThree();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Erro inesperado ao salvar configuracao.",
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    canSave,
    guildId,
    logsClosedChannelId,
    logsCreatedChannelId,
    menuChannelId,
    proceedToStepThree,
    ticketsCategoryId,
  ]);

  if (!guildId) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 py-8">
        <section
          className="w-full"
          style={{ maxWidth: `${configStepTwoScale.maxWidth}px` }}
        >
          <p className="text-center text-[14px] text-[#D8D8D8]">
            Nenhum servidor foi selecionado na etapa anterior.
          </p>
          <div className="mt-5 flex justify-center">
            <button
              type="button"
              onClick={onGoBackToStepOne}
              className="h-[42px] rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-6 text-[12px] text-[#D8D8D8]"
            >
              Voltar para etapa 1
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-6 py-8">
      <section className="w-full" style={{ maxWidth: `${configStepTwoScale.maxWidth}px` }}>
        <div
          className="flex flex-col items-center"
          style={{ gap: `${configStepTwoScale.containerGap}px` }}
        >
          <div
            className="relative shrink-0"
            style={{
              width: `${configStepTwoScale.logoSize}px`,
              height: `${configStepTwoScale.logoSize}px`,
            }}
          >
            <Image
              src="/cdn/logos/logotipo_.svg"
              alt="Flowdesk"
              fill
              sizes={`${configStepTwoScale.logoSize}px`}
              className="object-contain"
              priority
            />
          </div>

          <h1
            className="whitespace-normal text-center font-medium text-[#D8D8D8] min-[960px]:whitespace-nowrap"
            style={{ fontSize: `${configStepTwoScale.titleSize}px` }}
          >
            Vamos personalizar sua experiencia com a Flowdesk
          </h1>

          <div
            className="w-full bg-[#242424]"
            style={{ height: `${configStepTwoScale.separatorHeight}px` }}
          />

          <div className="w-full" style={{ marginTop: `${configStepTwoScale.firstLabelTopSpacing}px` }}>
            <div
              className="flex flex-col"
              style={{ gap: `${configStepTwoScale.fieldGap}px` }}
            >
              <ConfigStepSelect
                label="Em qual canal ficara o menu principal para abrir os tickets?"
                placeholder="Escolha o canal da mensagem principal para abertura dos tickets"
                options={textChannelOptions}
                value={menuChannelId}
                onChange={setMenuChannelId}
                loading={isLoadingChannels}
                disabled={isSaving || isPlanLocked}
              />

              <ConfigStepSelect
                label="Em qual categoria os tickets vao ser abertos?"
                placeholder="Escolha uma categoria para abertura dos tickets"
                options={categoryOptions}
                value={ticketsCategoryId}
                onChange={setTicketsCategoryId}
                loading={isLoadingChannels}
                disabled={isSaving || isPlanLocked}
              />

              <ConfigStepSelect
                label="Em qual canal sera enviada as logs de criacao dos tickets"
                placeholder="Escolha um canal de log para criacao dos tickets"
                options={textChannelOptions}
                value={logsCreatedChannelId}
                onChange={setLogsCreatedChannelId}
                loading={isLoadingChannels}
                disabled={isSaving || isPlanLocked}
              />

              <ConfigStepSelect
                label="Em qual canal sera enviada as logs de fechamento dos tickets"
                placeholder="Escolha um canal de log para fechamento dos tickets"
                options={textChannelOptions}
                value={logsClosedChannelId}
                onChange={setLogsClosedChannelId}
                loading={isLoadingChannels}
                disabled={isSaving || isPlanLocked}
              />
            </div>
          </div>

          <div
            className="w-full bg-[#242424]"
            style={{ height: `${configStepTwoScale.separatorHeight}px` }}
          />

          <button
            type="button"
            onClick={() => {
              void handleSubmit();
            }}
            disabled={!canSave}
            aria-busy={isSaving}
            className="flex w-full items-center justify-center bg-[#D8D8D8] font-medium text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
            style={{
              height: `${configStepTwoScale.nextButtonHeight}px`,
              borderRadius: `${configStepTwoScale.controlRadius}px`,
              fontSize: `${configStepTwoScale.nextButtonTextSize}px`,
            }}
          >
            {isSaving ? <ButtonLoader size={24} /> : "Proximo"}
          </button>

          {errorMessage ? (
            <p className="text-center text-[12px] text-[#C2C2C2]">{errorMessage}</p>
          ) : null}

          {isPlanLocked ? (
            <p className="text-center text-[12px] text-[#C2C2C2]">
              Este servidor esta com plano expirado/desligado. Renove para liberar alteracoes.
            </p>
          ) : null}

          <span className="sr-only">{displayName}</span>
        </div>
      </section>
    </main>
  );
}
