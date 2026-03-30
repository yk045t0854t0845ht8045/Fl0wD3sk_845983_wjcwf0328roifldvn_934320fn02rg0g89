"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Bell, Lock, Shield, Users } from "lucide-react";
import { ConfigFieldCard, ConfigStepShell } from "@/components/config/ConfigStepShell";
import { ConfigStepMultiSelect } from "@/components/config/ConfigStepMultiSelect";
import { ConfigStepSelect } from "@/components/config/ConfigStepSelect";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import type { StepThreeDraft } from "@/lib/auth/configContext";
import { hasStepThreeDraftValues } from "@/lib/auth/configContext";

type ConfigStepThreeProps = {
  displayName: string;
  guildId: string | null;
  guildLicenseStatus?: "paid" | "expired" | "off" | "not_paid";
  initialDraft?: StepThreeDraft | null;
  onDraftChange?: (guildId: string, draft: StepThreeDraft) => void;
  onProceedToStepFour?: () => void;
  onGoBackToStepOne?: () => void;
};

type SelectOption = {
  id: string;
  name: string;
};

type GuildRolesApiResponse = {
  ok: boolean;
  message?: string;
  roles?: SelectOption[];
};

type StaffSettingsApiResponse = {
  ok: boolean;
  message?: string;
  settings?: {
    adminRoleId: string;
    claimRoleIds: string[];
    closeRoleIds: string[];
    notifyRoleIds: string[];
  } | null;
};

type TicketSettingsApiResponse = {
  ok: boolean;
  message?: string;
  settings?: {
    menuChannelId: string | null;
    panelLayout?: unknown;
  } | null;
};

type TicketPanelMessageApiResponse = {
  ok: boolean;
  message?: string;
  channelId?: string;
  messageId?: string;
  mode?: "created" | "updated";
};

const DEFAULT_NEXT_STEP_URL = "/config/#/payment";

function buildStepThreeDraft(
  value: Partial<StepThreeDraft> | null | undefined,
): StepThreeDraft {
  return {
    adminRoleId: value?.adminRoleId || null,
    claimRoleIds: Array.isArray(value?.claimRoleIds) ? value.claimRoleIds : [],
    closeRoleIds: Array.isArray(value?.closeRoleIds) ? value.closeRoleIds : [],
    notifyRoleIds: Array.isArray(value?.notifyRoleIds) ? value.notifyRoleIds : [],
  };
}

function filterRoleIdList(roleIds: string[], allowedRoleIds: Set<string>) {
  return roleIds.filter((roleId, index, array) => {
    if (!allowedRoleIds.has(roleId)) return false;
    return array.indexOf(roleId) === index;
  });
}

async function publishTicketPanelBeforeCheckout(guildId: string) {
  const settingsResponse = await fetch(
    `/api/auth/me/guilds/ticket-settings?guildId=${encodeURIComponent(guildId)}`,
    {
      cache: "no-store",
    },
  );
  const settingsPayload = (await settingsResponse.json()) as TicketSettingsApiResponse;

  if (!settingsResponse.ok || !settingsPayload.ok) {
    throw new Error(
      settingsPayload.message || "Nao foi possivel carregar os canais do ticket.",
    );
  }

  const menuChannelId = settingsPayload.settings?.menuChannelId || null;
  const panelLayout = settingsPayload.settings?.panelLayout;

  if (!menuChannelId || !Array.isArray(panelLayout) || !panelLayout.length) {
    throw new Error(
      "Finalize a configuracao dos canais do ticket antes de abrir o checkout.",
    );
  }

  const panelResponse = await fetch("/api/auth/me/guilds/ticket-panel-message", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      guildId,
      menuChannelId,
      panelLayout,
    }),
  });
  const panelPayload = (await panelResponse.json()) as TicketPanelMessageApiResponse;

  if (!panelResponse.ok || !panelPayload.ok) {
    throw new Error(
      panelPayload.message || "Nao foi possivel publicar o painel do ticket.",
    );
  }

  return panelPayload;
}

export function ConfigStepThree({
  displayName,
  guildId,
  guildLicenseStatus = "not_paid",
  initialDraft = null,
  onDraftChange,
  onProceedToStepFour,
  onGoBackToStepOne,
}: ConfigStepThreeProps) {
  const latestInitialDraftRef = useRef(buildStepThreeDraft(initialDraft));
  const hasInitialDraftValuesRef = useRef(hasStepThreeDraftValues(initialDraft));
  const [roleOptions, setRoleOptions] = useState<SelectOption[]>([]);
  const [isLoadingRoles, setIsLoadingRoles] = useState(true);
  const [adminRoleId, setAdminRoleId] = useState<string | null>(null);
  const [claimRoleIds, setClaimRoleIds] = useState<string[]>([]);
  const [closeRoleIds, setCloseRoleIds] = useState<string[]>([]);
  const [notifyRoleIds, setNotifyRoleIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isPlanLocked = guildLicenseStatus === "expired" || guildLicenseStatus === "off";

  useEffect(() => {
    latestInitialDraftRef.current = buildStepThreeDraft(initialDraft);
    hasInitialDraftValuesRef.current = hasStepThreeDraftValues(initialDraft);
  }, [initialDraft]);

  useEffect(() => {
    if (!guildId) {
      setRoleOptions([]);
      setAdminRoleId(null);
      setClaimRoleIds([]);
      setCloseRoleIds([]);
      setNotifyRoleIds([]);
      setIsLoadingRoles(false);
      return;
    }

    let isMounted = true;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, 12000);
    setIsLoadingRoles(true);
    setErrorMessage(null);

    async function loadRolesAndSettings() {
      try {
        const [rolesResponse, settingsResponse] = await Promise.all([
          fetch(`/api/auth/me/guilds/roles?guildId=${guildId}`, {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch(`/api/auth/me/guilds/ticket-staff-settings?guildId=${guildId}`, {
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);

        const rolesPayload = (await rolesResponse.json()) as GuildRolesApiResponse;
        const settingsPayload = (await settingsResponse.json()) as StaffSettingsApiResponse;

        if (!isMounted) return;

        if (!rolesResponse.ok || !rolesPayload.ok || !rolesPayload.roles) {
          throw new Error(rolesPayload.message || "Falha ao carregar cargos do servidor.");
        }

        setRoleOptions(rolesPayload.roles);

        const fallbackDraft =
          settingsResponse.ok && settingsPayload.ok && settingsPayload.settings
            ? buildStepThreeDraft(settingsPayload.settings)
            : buildStepThreeDraft(null);

        const sourceDraft = hasInitialDraftValuesRef.current
          ? latestInitialDraftRef.current
          : fallbackDraft;

        const allowedRoleIds = new Set(rolesPayload.roles.map((role) => role.id));

        setAdminRoleId(
          sourceDraft.adminRoleId && allowedRoleIds.has(sourceDraft.adminRoleId)
            ? sourceDraft.adminRoleId
            : null,
        );
        setClaimRoleIds(filterRoleIdList(sourceDraft.claimRoleIds, allowedRoleIds));
        setCloseRoleIds(filterRoleIdList(sourceDraft.closeRoleIds, allowedRoleIds));
        setNotifyRoleIds(filterRoleIdList(sourceDraft.notifyRoleIds, allowedRoleIds));
      } catch (error) {
        if (!isMounted) return;
        if (error instanceof DOMException && error.name === "AbortError") {
          setErrorMessage("Tempo esgotado ao buscar cargos do servidor. Tente novamente.");
          return;
        }
        setRoleOptions([]);
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Erro ao carregar cargos para configuracao.",
        );
      } finally {
        if (!isMounted) return;
        window.clearTimeout(timeoutId);
        setIsLoadingRoles(false);
      }
    }

    void loadRolesAndSettings();

    return () => {
      isMounted = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [guildId]);

  useEffect(() => {
    if (!guildId || isLoadingRoles) return;

    onDraftChange?.(guildId, {
      adminRoleId,
      claimRoleIds,
      closeRoleIds,
      notifyRoleIds,
    });
  }, [
    adminRoleId,
    claimRoleIds,
    closeRoleIds,
    guildId,
    isLoadingRoles,
    notifyRoleIds,
    onDraftChange,
  ]);

  const canSave = useMemo(
    () =>
      Boolean(
        guildId &&
          adminRoleId &&
          claimRoleIds.length &&
          closeRoleIds.length &&
          notifyRoleIds.length &&
          !isLoadingRoles &&
          !isPlanLocked &&
          !isSaving,
      ),
    [
      adminRoleId,
      claimRoleIds.length,
      closeRoleIds.length,
      guildId,
      isLoadingRoles,
      isPlanLocked,
      isSaving,
      notifyRoleIds.length,
    ],
  );

  const proceedToStepFour = useCallback(() => {
    if (onProceedToStepFour) {
      onProceedToStepFour();
      return;
    }

    window.location.assign(DEFAULT_NEXT_STEP_URL);
  }, [onProceedToStepFour]);

  const handleSubmit = useCallback(async () => {
    if (!canSave || !guildId || !adminRoleId) return;

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/auth/me/guilds/ticket-staff-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          guildId,
          adminRoleId,
          claimRoleIds,
          closeRoleIds,
          notifyRoleIds,
        }),
      });

      const payload = (await response.json()) as StaffSettingsApiResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Falha ao salvar configuracoes de staff.");
      }

      await publishTicketPanelBeforeCheckout(guildId);
      proceedToStepFour();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Erro inesperado ao salvar configuracao de staff.",
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    adminRoleId,
    canSave,
    claimRoleIds,
    closeRoleIds,
    guildId,
    notifyRoleIds,
    proceedToStepFour,
  ]);

  if (!guildId) {
    return (
      <ConfigStepShell
        stepNumber={3}
        title="Defina quem opera, assume e encerra atendimentos"
        description="A terceira etapa organiza as permissoes do staff para que o fluxo de tickets funcione com clareza operacional."
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
      stepNumber={3}
      title="Defina quem opera, assume e encerra atendimentos"
      description="Com os canais mapeados, agora falta dizer quem tem autoridade dentro do ticket. Essa camada organiza administracao, ownership, encerramento e notificacoes da equipe."
    >
      <div className="grid gap-[18px] lg:grid-cols-2">
        <ConfigFieldCard
          eyebrow="Administracao"
          title="Cargo administrador do ticket"
          description="Esse cargo concentra a autoridade operacional principal dentro do sistema de atendimento."
          icon={<Shield className="h-[18px] w-[18px]" strokeWidth={2.1} />}
        >
          <ConfigStepSelect
            label="Cargo administrador do ticket"
            placeholder="Escolha o cargo com administracao principal"
            options={roleOptions}
            value={adminRoleId}
            onChange={setAdminRoleId}
            loading={isLoadingRoles}
            disabled={isSaving || isPlanLocked}
            variant="immersive"
          />
        </ConfigFieldCard>

        <ConfigFieldCard
          eyebrow="Ownership"
          title="Quem pode assumir tickets"
          description="Escolha os cargos que podem pegar ownership de um atendimento em andamento."
          icon={<Users className="h-[18px] w-[18px]" strokeWidth={2.1} />}
        >
          <ConfigStepMultiSelect
            label="Cargos que podem assumir tickets"
            placeholder="Escolha os cargos que assumem tickets"
            options={roleOptions}
            values={claimRoleIds}
            onChange={setClaimRoleIds}
            loading={isLoadingRoles}
            disabled={isSaving || isPlanLocked}
            variant="immersive"
          />
        </ConfigFieldCard>

        <ConfigFieldCard
          eyebrow="Encerramento"
          title="Quem pode fechar tickets"
          description="Defina os cargos confiaveis para concluir o atendimento e disparar o fechamento."
          icon={<Lock className="h-[18px] w-[18px]" strokeWidth={2.1} />}
        >
          <ConfigStepMultiSelect
            label="Cargos que podem fechar tickets"
            placeholder="Escolha os cargos que fecham tickets"
            options={roleOptions}
            values={closeRoleIds}
            onChange={setCloseRoleIds}
            loading={isLoadingRoles}
            disabled={isSaving || isPlanLocked}
            variant="immersive"
          />
        </ConfigFieldCard>

        <ConfigFieldCard
          eyebrow="Contato"
          title="Quem pode notificar o usuario"
          description="Escolha os cargos autorizados a chamar ou notificar o usuario durante o atendimento."
          icon={<Bell className="h-[18px] w-[18px]" strokeWidth={2.1} />}
        >
          <ConfigStepMultiSelect
            label="Cargos que podem notificar usuarios"
            placeholder="Escolha os cargos que notificam usuarios"
            options={roleOptions}
            values={notifyRoleIds}
            onChange={setNotifyRoleIds}
            loading={isLoadingRoles}
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
                Salvar e ir para pagamento
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
