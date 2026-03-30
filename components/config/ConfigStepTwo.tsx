"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  FileText,
  Folder,
  MessageSquare,
} from "lucide-react";
import {
  ConfigFieldCard,
  ConfigStepShell,
} from "@/components/config/ConfigStepShell";
import { ConfigStepSelect } from "@/components/config/ConfigStepSelect";
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
      <ConfigStepShell
        stepNumber={2}
        title="Estruture os canais que sustentam o atendimento"
        description="A segunda etapa define onde o painel aparece, onde os tickets nascem e para onde os eventos operacionais vao."
      >
        <div className="rounded-[28px] border border-[#151515] bg-[linear-gradient(180deg,rgba(10,10,10,0.98)_0%,rgba(7,7,7,0.98)_100%)] p-[18px] shadow-[0_22px_70px_rgba(0,0,0,0.26)]">
          <p className="text-[20px] leading-[1.08] font-medium tracking-[-0.04em] text-[#F1F1F1]">
            Nenhum servidor selecionado
          </p>
          <p className="mt-[10px] text-[13px] leading-[1.65] text-[#7B7B7B]">
            Volte para a etapa anterior, escolha um servidor e retome a configuracao com o contexto certo.
          </p>

          <button
            type="button"
            onClick={onGoBackToStepOne}
            className="mt-[16px] inline-flex h-[46px] items-center justify-center rounded-[14px] border border-[#171717] bg-[#0D0D0D] px-[18px] text-[14px] font-medium text-[#CACACA] transition-colors hover:border-[#232323] hover:bg-[#111111] hover:text-[#F1F1F1]"
          >
            Voltar para etapa 1
          </button>
        </div>
      </ConfigStepShell>
    );
  }

  return (
    <ConfigStepShell
      stepNumber={2}
      title="Estruture os canais que sustentam o atendimento"
      description="Agora a Flowdesk precisa entender o mapa do seu servidor. Defina onde o painel principal fica, em qual categoria os tickets nascem e quais canais recebem o historico operacional."
    >
      <div className="grid gap-[18px] lg:grid-cols-2">
        <ConfigFieldCard
          eyebrow="Entrada"
          title="Canal do menu principal"
          description="Escolha o canal onde o Flowdesk vai publicar o painel inicial para abertura de tickets."
          icon={<MessageSquare className="h-[18px] w-[18px]" strokeWidth={2.1} />}
        >
          <ConfigStepSelect
            label="Canal do menu principal"
            placeholder="Escolha o canal da mensagem principal"
            options={textChannelOptions}
            value={menuChannelId}
            onChange={setMenuChannelId}
            loading={isLoadingChannels}
            disabled={isSaving || isPlanLocked}
            variant="immersive"
          />
        </ConfigFieldCard>

        <ConfigFieldCard
          eyebrow="Estrutura"
          title="Categoria dos tickets"
          description="Todos os atendimentos privados vao nascer dentro dessa categoria."
          icon={<Folder className="h-[18px] w-[18px]" strokeWidth={2.1} />}
        >
          <ConfigStepSelect
            label="Categoria onde os tickets vao nascer"
            placeholder="Escolha uma categoria para os tickets"
            options={categoryOptions}
            value={ticketsCategoryId}
            onChange={setTicketsCategoryId}
            loading={isLoadingChannels}
            disabled={isSaving || isPlanLocked}
            variant="immersive"
          />
        </ConfigFieldCard>

        <ConfigFieldCard
          eyebrow="Observabilidade"
          title="Logs de criacao"
          description="Aqui entram os registros de abertura e o contexto inicial de cada ticket."
          icon={<FileText className="h-[18px] w-[18px]" strokeWidth={2.1} />}
        >
          <ConfigStepSelect
            label="Canal de logs de criacao"
            placeholder="Escolha o canal para logs de criacao"
            options={textChannelOptions}
            value={logsCreatedChannelId}
            onChange={setLogsCreatedChannelId}
            loading={isLoadingChannels}
            disabled={isSaving || isPlanLocked}
            variant="immersive"
          />
        </ConfigFieldCard>

        <ConfigFieldCard
          eyebrow="Encerramento"
          title="Logs de fechamento"
          description="Use um canal dedicado para o historico final, fechamento e transcript dos atendimentos."
          icon={<Archive className="h-[18px] w-[18px]" strokeWidth={2.1} />}
        >
          <ConfigStepSelect
            label="Canal de logs de fechamento"
            placeholder="Escolha o canal para logs de fechamento"
            options={textChannelOptions}
            value={logsClosedChannelId}
            onChange={setLogsClosedChannelId}
            loading={isLoadingChannels}
            disabled={isSaving || isPlanLocked}
            variant="immersive"
          />
        </ConfigFieldCard>
      </div>

      {errorMessage ? (
        <p className="text-[13px] leading-[1.6] text-[#D88F8F]">{errorMessage}</p>
      ) : null}

      {isPlanLocked ? (
        <p className="text-[13px] leading-[1.6] text-[#C9B27A]">
          Este servidor esta expirado ou desligado. Renove a licenca para liberar alteracoes.
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-[10px] pt-[4px] sm:flex-row sm:justify-between">
        <button
          type="button"
          onClick={onGoBackToStepOne}
          className="inline-flex h-[48px] items-center justify-center gap-[8px] rounded-[14px] border border-[#171717] bg-[#0D0D0D] px-6 text-[14px] font-medium text-[#CACACA] transition-colors hover:border-[#232323] hover:bg-[#111111] hover:text-[#F1F1F1]"
        >
          <ArrowLeft className="h-[16px] w-[16px]" strokeWidth={2.3} />
          Trocar servidor
        </button>

        <button
          type="button"
          onClick={() => {
            void handleSubmit();
          }}
          disabled={!canSave}
          aria-busy={isSaving}
          className={`group relative inline-flex h-[48px] items-center justify-center overflow-hidden rounded-[14px] px-6 text-[15px] font-semibold ${
            canSave ? "" : "cursor-not-allowed"
          }`}
        >
          <span
            aria-hidden="true"
            className={`absolute inset-0 rounded-[14px] transition-transform duration-150 ease-out ${
              canSave
                ? "bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] group-hover:scale-[1.02] group-active:scale-[0.985]"
                : "bg-[#111111]"
            }`}
          />
          <span
            className={`relative z-10 inline-flex items-center justify-center gap-[8px] ${
              canSave ? "text-[#202020]" : "text-[#7B7B7B]"
            }`}
          >
            {isSaving ? (
              <ButtonLoader
                size={18}
                colorClassName={canSave ? "text-[#202020]" : "text-[#7B7B7B]"}
              />
            ) : (
              <>
                Salvar e continuar
                <ArrowRight className="h-[16px] w-[16px]" strokeWidth={2.4} />
              </>
            )}
          </span>
        </button>
      </div>

      <span className="sr-only">{displayName}</span>
    </ConfigStepShell>
  );
}
