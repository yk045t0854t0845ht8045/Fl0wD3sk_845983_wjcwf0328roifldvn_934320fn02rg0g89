"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ConfigStepSelect } from "@/components/config/ConfigStepSelect";
import { ConfigStepMultiSelect } from "@/components/config/ConfigStepMultiSelect";
import { configStepTwoScale } from "@/components/config/configStepTwoScale";
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
            Agora vamos aprimorar os sistemas de administracao
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
                label="Qual cargo tera permissao de administracao no ticket?"
                placeholder="Escolha os cargos com permissao de dono / administracao no ticket"
                options={roleOptions}
                value={adminRoleId}
                onChange={setAdminRoleId}
                loading={isLoadingRoles}
                disabled={isSaving || isPlanLocked}
              />

              <ConfigStepMultiSelect
                label="Quais cargos poderao assumir os tickets?"
                placeholder="Escolha quais cargos poderao assumir os tickets"
                options={roleOptions}
                values={claimRoleIds}
                onChange={setClaimRoleIds}
                loading={isLoadingRoles}
                disabled={isSaving || isPlanLocked}
              />

              <ConfigStepMultiSelect
                label="Quais cargos poderao fechar os tickets?"
                placeholder="Escolha quais cargos poderao fechar os tickets"
                options={roleOptions}
                values={closeRoleIds}
                onChange={setCloseRoleIds}
                loading={isLoadingRoles}
                disabled={isSaving || isPlanLocked}
              />

              <ConfigStepMultiSelect
                label="Quais cargos poderao enviar notificacao ao usuario no ticket?"
                placeholder="Escolha quais cargos poderao enviar notificacao ao usuario nos tickets"
                options={roleOptions}
                values={notifyRoleIds}
                onChange={setNotifyRoleIds}
                loading={isLoadingRoles}
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
