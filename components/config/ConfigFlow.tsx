"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfigStepOne } from "@/components/config/ConfigStepOne";
import { ConfigStepTwo } from "@/components/config/ConfigStepTwo";
import { ConfigStepThree } from "@/components/config/ConfigStepThree";
import { ConfigStepFour } from "@/components/config/ConfigStepFour";
import {
  ConfigServerSwitcher,
  type ConfigGuildItem,
} from "@/components/config/ConfigServerSwitcher";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import {
  normalizePlanBillingPeriodCodeFromSlug,
  normalizePlanCodeFromSlug,
  resolvePlanPricing,
  type PlanBillingPeriodCode,
  type PlanCode,
} from "@/lib/plans/catalog";
import { buildServersPlansPath } from "@/lib/plans/addServerFlow";
import {
  buildConfigUrlWithHashRoute,
  normalizeConfigHashRoute,
} from "@/lib/plans/configRouting";
import { shouldBlockConfigServerSelection } from "@/lib/plans/configServerSelection";
import type {
  ConfigDraft,
  ConfigStep,
  StepFourDraft,
  StepThreeDraft,
  StepTwoDraft,
  StoredConfigContext,
} from "@/lib/auth/configContext";
import {
  CONFIG_CONTEXT_STORAGE_KEY,
  LEGACY_GUILD_STORAGE_KEY,
  createEmptyConfigDraft,
  hasStepFourDraftValues,
  mergeConfigDraft,
  sanitizeStoredConfigContext,
} from "@/lib/auth/configContext";

type ConfigFlowProps = {
  displayName: string;
  initialPlanCode: PlanCode;
  initialBillingPeriodCode?: PlanBillingPeriodCode;
  hasExplicitInitialPlan?: boolean;
};

type ConfigContextPatch = {
  activeGuildId?: string | null;
  activeStep?: ConfigStep;
  draft?: ConfigDraft;
};

type ConfigContextApiResponse = {
  ok: boolean;
  activeGuildId?: string | null;
  activeStep?: ConfigStep;
  draft?: ConfigDraft;
  updatedAt?: string | null;
};

type GuildsApiResponse = {
  ok: boolean;
  guilds?: Array<
    ConfigGuildItem & {
      hasSavedSetup?: boolean;
      lastConfiguredAt?: string | null;
    }
  >;
};

type ManagedServerStatus = "paid" | "expired" | "off" | "pending_payment";

type ServersApiResponse = {
  ok: boolean;
  servers?: Array<{
    guildId: string;
    guildName: string;
    iconUrl: string | null;
    status: ManagedServerStatus;
  }>;
};

type PaymentStateOrder = {
  orderNumber: number;
  guildId: string;
  method: "pix" | "card";
  status: string;
  providerPaymentId?: string | null;
  providerExternalReference?: string | null;
  providerStatus: string | null;
  providerStatusDetail: string | null;
  hasPixQr: boolean;
  paidAt: string | null;
  expiresAt: string | null;
  checkoutAccessToken?: string | null;
  createdAt: string;
  updatedAt: string;
  licenseExpiresAt?: string;
};

type PaymentStateApiResponse = {
  ok: boolean;
  guildId?: string;
  activeLicense?: PaymentStateOrder | null;
  latestOrder?: PaymentStateOrder | null;
};

type PlanStateApiResponse = {
  ok: boolean;
  plan?: {
    status?: string | null;
    maxLicensedServers?: number | null;
  } | null;
  usage?: {
    licensedServersCount?: number;
    hasReachedLicensedServersLimit?: boolean;
  } | null;
};

type ClaimServerApiResponse =
  | {
      ok: true;
      guildId: string;
      alreadyLicensed: boolean;
      redirectPath: string;
    }
  | {
      ok: false;
      reason?: string;
      message?: string;
    };

const STEP_ONE_HASH = "#/step/1";
const STEP_TWO_HASH = "#/step/2";
const STEP_THREE_HASH = "#/step/3";
const STEP_FOUR_LEGACY_HASH = "#/step/4";
const PAYMENT_HASH = "#/payment";
const CONTEXT_SYNC_DEBOUNCE_MS = 420;
const CHECKOUT_QUERY_KEYS = [
  "status",
  "code",
  "guild",
  "method",
  "checkoutToken",
  "payment_id",
  "paymentId",
  "paymentRef",
  "collection_id",
  "collection_status",
  "external_reference",
  "payment_type",
  "merchant_order_id",
  "preference_id",
  "site_id",
  "processing_mode",
  "merchant_account_id",
] as const;

function normalizeNullableCheckoutQueryValue(value: string | null) {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;

  const lowered = normalized.toLowerCase();
  if (
    lowered === "null" ||
    lowered === "undefined" ||
    lowered === "nan"
  ) {
    return null;
  }

  return normalized;
}

function normalizeFlowStep(step: ConfigStep): ConfigStep {
  return step === 4 ? 4 : 1;
}

function resolveHashForStep(step: ConfigStep) {
  const normalizedStep = normalizeFlowStep(step);
  if (normalizedStep === 4) return PAYMENT_HASH;
  return STEP_ONE_HASH;
}

function normalizeStepHash(hash: string) {
  return normalizeConfigHashRoute(hash)
    .trim()
    .toLowerCase()
    .split("?")[0]
    .replace(/\/+$/, "");
}

function shouldForceFreshStart(url: URL) {
  const freshValue = url.searchParams.get("fresh")?.trim().toLowerCase();
  if (freshValue === "1" || freshValue === "true" || freshValue === "yes") {
    return true;
  }

  const sourceValue = url.searchParams.get("source")?.trim().toLowerCase();
  return sourceValue === "landing";
}

function parseStepFromHash(hash: string): ConfigStep {
  const normalized = normalizeStepHash(hash);
  if (normalized === STEP_ONE_HASH) return 1;
  if (normalized === STEP_TWO_HASH) return 1;
  if (normalized === STEP_THREE_HASH) return 1;
  if (normalized === STEP_FOUR_LEGACY_HASH || normalized === PAYMENT_HASH) return 4;

  const dynamicStepMatch = normalized.match(/^#\/step\/([1-4])$/);
  if (dynamicStepMatch) {
    return normalizeFlowStep(Number(dynamicStepMatch[1]) as ConfigStep);
  }

  return 1;
}

function normalizeGuildIdFromQuery(value: string | null) {
  if (!value) return null;
  const guildId = value.trim();
  return /^\d{10,25}$/.test(guildId) ? guildId : null;
}

function resolveConfigPlanFromPathname(input: {
  pathname: string;
  fallbackPlanCode: PlanCode;
  fallbackBillingPeriodCode: PlanBillingPeriodCode;
}) {
  const segments = input.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const configIndex = segments.findIndex(
    (segment) => segment.toLowerCase() === "config",
  );
  const planSlug = configIndex >= 0 ? segments[configIndex + 1] || null : null;
  const billingSlug = configIndex >= 0 ? segments[configIndex + 2] || null : null;

  return resolvePlanPricing(
    normalizePlanCodeFromSlug(planSlug, input.fallbackPlanCode),
    normalizePlanBillingPeriodCodeFromSlug(
      billingSlug,
      input.fallbackBillingPeriodCode,
    ),
  );
}

function hasStepHash(hash: string) {
  const normalized = normalizeStepHash(hash);
  return (
    normalized === STEP_ONE_HASH ||
    normalized === STEP_TWO_HASH ||
    normalized === STEP_THREE_HASH ||
    normalized === STEP_FOUR_LEGACY_HASH ||
    normalized === PAYMENT_HASH ||
    /^#\/step\/[1-4]$/.test(normalized)
  );
}

function parseContextUpdatedAtMs(context: StoredConfigContext | null) {
  if (!context?.updatedAt) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(context.updatedAt);
  if (!Number.isFinite(parsed)) return Number.NEGATIVE_INFINITY;
  return parsed;
}

function mergeStoredContexts(
  localContext: StoredConfigContext | null,
  serverContext: StoredConfigContext | null,
) {
  if (!localContext && !serverContext) {
    return toStoredConfigContext({
      activeGuildId: null,
      activeStep: 1,
      draft: createEmptyConfigDraft(),
      updatedAt: null,
    });
  }

  if (!localContext && serverContext) return serverContext;
  if (!serverContext && localContext) return localContext;

  const safeLocal = localContext as StoredConfigContext;
  const safeServer = serverContext as StoredConfigContext;

  const localUpdatedAtMs = parseContextUpdatedAtMs(safeLocal);
  const serverUpdatedAtMs = parseContextUpdatedAtMs(safeServer);
  const localIsPrimary = localUpdatedAtMs >= serverUpdatedAtMs;

  const primary = localIsPrimary ? safeLocal : safeServer;
  const secondary = localIsPrimary ? safeServer : safeLocal;
  const mergedActiveGuildId = primary.activeGuildId || secondary.activeGuildId || null;
  const mergedStep =
    mergedActiveGuildId && primary.activeStep === 1 && secondary.activeStep > 1
      ? secondary.activeStep
      : primary.activeStep;

  return toStoredConfigContext({
    activeGuildId: mergedActiveGuildId,
    activeStep: mergedStep,
    draft: mergeConfigDraft(secondary.draft, primary.draft),
    updatedAt: primary.updatedAt || secondary.updatedAt || null,
  });
}

function writeLocalConfigContext(context: StoredConfigContext) {
  try {
    window.sessionStorage.setItem(CONFIG_CONTEXT_STORAGE_KEY, JSON.stringify(context));
  } catch {
    // Ignora erro de armazenamento local.
  }

  if (context.activeGuildId) {
    window.sessionStorage.setItem(LEGACY_GUILD_STORAGE_KEY, context.activeGuildId);
  } else {
    window.sessionStorage.removeItem(LEGACY_GUILD_STORAGE_KEY);
  }
}

function readLocalConfigContext() {
  try {
    const raw = window.sessionStorage.getItem(CONFIG_CONTEXT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      const sanitized = sanitizeStoredConfigContext(parsed);
      if (sanitized) return sanitized;
    }
  } catch {
    // Ignora payload local invalido.
  }

  const legacyGuildId = window.sessionStorage.getItem(LEGACY_GUILD_STORAGE_KEY);
  if (!legacyGuildId) return null;

  return {
    activeGuildId: legacyGuildId,
    activeStep: 1 as ConfigStep,
    draft: createEmptyConfigDraft(),
    updatedAt: null,
  } satisfies StoredConfigContext;
}

function toStoredConfigContext(input: {
  activeGuildId: string | null;
  activeStep: ConfigStep;
  draft: ConfigDraft;
  updatedAt: string | null;
}) {
  return {
    activeGuildId: input.activeGuildId,
    activeStep: normalizeFlowStep(input.activeStep),
    draft: input.draft,
    updatedAt: input.updatedAt,
  } satisfies StoredConfigContext;
}

function mergeContextPatch(
  currentPatch: ConfigContextPatch | null,
  nextPatch: ConfigContextPatch,
) {
  if (!currentPatch) {
    return { ...nextPatch };
  }

  const merged: ConfigContextPatch = { ...currentPatch, ...nextPatch };
  if (Object.prototype.hasOwnProperty.call(nextPatch, "draft")) {
    merged.draft = nextPatch.draft;
  }

  return merged;
}

function setStepHash(step: ConfigStep) {
  const targetHash = resolveHashForStep(step);
  const currentHash = window.location.hash;
  if (normalizeStepHash(currentHash) === normalizeStepHash(targetHash)) return;

  const url = new URL(window.location.href);
  url.hash = targetHash;
  window.history.replaceState(
    null,
    "",
    buildConfigUrlWithHashRoute(url.pathname, url.search, url.hash),
  );

  // Fallback extra para navegadores/estados que nao refletirem o replaceState de hash.
  if (normalizeStepHash(window.location.hash) !== normalizeStepHash(targetHash)) {
    window.location.hash = targetHash.replace(/^#/, "");
  }
}

function normalizePaymentStatusForQuery(status: string | null | undefined) {
  const normalized = normalizeNullableCheckoutQueryValue(status || null)?.toLowerCase() || "";
  if (!normalized) return "pending";
  return normalized;
}

function readCheckoutStatusQuery(url: URL) {
  const guildId = normalizeGuildIdFromQuery(url.searchParams.get("guild"));
  const codeRaw = normalizeNullableCheckoutQueryValue(url.searchParams.get("code")) || "";
  const statusRaw = normalizeNullableCheckoutQueryValue(
    url.searchParams.get("status"),
  );
  const status = normalizePaymentStatusForQuery(statusRaw);

  if (!guildId || !/^\d+$/.test(codeRaw) || !statusRaw) {
    return null;
  }

  return {
    guildId,
    code: Number(codeRaw),
    status,
    checkoutToken: normalizeNullableCheckoutQueryValue(
      url.searchParams.get("checkoutToken"),
    ),
    paymentId:
      normalizeNullableCheckoutQueryValue(url.searchParams.get("paymentId")) ||
      normalizeNullableCheckoutQueryValue(url.searchParams.get("payment_id")) ||
      normalizeNullableCheckoutQueryValue(url.searchParams.get("collection_id")) ||
      null,
    paymentRef: normalizeNullableCheckoutQueryValue(
      url.searchParams.get("paymentRef"),
    ),
  };
}

function updateCheckoutStatusQuery(
  input:
    | {
        status: string;
        code: number;
        guildId: string;
        method?: "pix" | "card" | null;
        checkoutToken?: string | null;
        paymentId?: string | null;
        paymentRef?: string | null;
      }
    | null,
) {
  const url = new URL(window.location.href);

  if (!input) {
    for (const key of CHECKOUT_QUERY_KEYS) {
      url.searchParams.delete(key);
    }
  } else {
    url.searchParams.set("status", normalizePaymentStatusForQuery(input.status));
    url.searchParams.set("code", String(input.code));
    url.searchParams.set("guild", input.guildId);
    if (input.method) {
      url.searchParams.set("method", input.method);
    } else {
      url.searchParams.delete("method");
    }
    if (input.checkoutToken) {
      url.searchParams.set("checkoutToken", input.checkoutToken);
    } else {
      url.searchParams.delete("checkoutToken");
    }
    if (input.paymentId) {
      url.searchParams.set("paymentId", input.paymentId);
    } else {
      url.searchParams.delete("paymentId");
    }
    if (input.paymentRef) {
      url.searchParams.set("paymentRef", input.paymentRef);
    } else {
      url.searchParams.delete("paymentRef");
    }
  }

  window.history.replaceState(
    null,
    "",
    buildConfigUrlWithHashRoute(url.pathname, url.search, url.hash),
  );
}

function resolvePreferredStepForGuild(draft: ConfigDraft, guildId: string): ConfigStep {
  const stepFourDraft = draft.stepFourByGuild[guildId];
  if (hasStepFourDraftValues(stepFourDraft)) return 4;

  return 1;
}

export function ConfigFlow({
  displayName,
  initialPlanCode,
  initialBillingPeriodCode = "monthly",
  hasExplicitInitialPlan = false,
}: ConfigFlowProps) {
  const [currentStep, setCurrentStep] = useState<ConfigStep>(1);
  const [isTransitioningStep, setIsTransitioningStep] = useState(false);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null);
  const [configDraft, setConfigDraft] = useState<ConfigDraft>(createEmptyConfigDraft());
  const [isConfigContextLoading, setIsConfigContextLoading] = useState(true);
  const [isContextHydrated, setIsContextHydrated] = useState(false);
  const [availableGuilds, setAvailableGuilds] = useState<ConfigGuildItem[]>([]);
  const [isGuildListLoading, setIsGuildListLoading] = useState(true);
  const [isSwitchingGuild, setIsSwitchingGuild] = useState(false);
  const [managedServers, setManagedServers] = useState<
    Array<{
      guildId: string;
      guildName: string;
      iconUrl: string | null;
      status: ManagedServerStatus;
    }>
  >([]);
  const [managedServerStatusByGuild, setManagedServerStatusByGuild] = useState<
    Record<string, ManagedServerStatus>
  >({});
  const [forceFreshCheckout, setForceFreshCheckout] = useState(false);
  const [isStepOneAccessCheckLoading, setIsStepOneAccessCheckLoading] =
    useState(false);

  const contextSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContextPatchRef = useRef<ConfigContextPatch | null>(null);
  const contextRef = useRef<StoredConfigContext>(
    toStoredConfigContext({
      activeGuildId: null,
      activeStep: 1,
      draft: createEmptyConfigDraft(),
      updatedAt: null,
    }),
  );

  const flushPendingContextSync = useCallback(async () => {
    const patch = pendingContextPatchRef.current;
    if (!patch) return;

    pendingContextPatchRef.current = null;

    try {
      const response = await fetch("/api/auth/me/config-context", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patch),
      });

      if (!response.ok) {
        throw new Error("Falha ao sincronizar contexto.");
      }
    } catch {
      pendingContextPatchRef.current = mergeContextPatch(
        pendingContextPatchRef.current,
        patch,
      );
    }
  }, []);

  const scheduleContextSync = useCallback(
    (patch: ConfigContextPatch, immediate = false) => {
      if (!isContextHydrated) return;

      pendingContextPatchRef.current = mergeContextPatch(
        pendingContextPatchRef.current,
        patch,
      );

      if (contextSyncTimerRef.current) {
        clearTimeout(contextSyncTimerRef.current);
        contextSyncTimerRef.current = null;
      }

      if (immediate) {
        void flushPendingContextSync();
        return;
      }

      contextSyncTimerRef.current = setTimeout(() => {
        contextSyncTimerRef.current = null;
        void flushPendingContextSync();
      }, CONTEXT_SYNC_DEBOUNCE_MS);
    },
    [flushPendingContextSync, isContextHydrated],
  );

  const updateLocalContext = useCallback((patch: ConfigContextPatch) => {
    const previous = contextRef.current;
    const next = toStoredConfigContext({
      activeGuildId: Object.prototype.hasOwnProperty.call(patch, "activeGuildId")
        ? patch.activeGuildId || null
        : previous.activeGuildId,
      activeStep: Object.prototype.hasOwnProperty.call(patch, "activeStep")
        ? patch.activeStep || previous.activeStep
        : previous.activeStep,
      draft: Object.prototype.hasOwnProperty.call(patch, "draft")
        ? patch.draft || createEmptyConfigDraft()
        : previous.draft,
      updatedAt: new Date().toISOString(),
    });

    contextRef.current = next;
    writeLocalConfigContext(next);

    return next;
  }, []);

  const setAndSyncContext = useCallback(
    (patch: ConfigContextPatch, immediate = false) => {
      const next = updateLocalContext(patch);

      if (Object.prototype.hasOwnProperty.call(patch, "activeGuildId")) {
        setSelectedGuildId(next.activeGuildId);
      }

      if (Object.prototype.hasOwnProperty.call(patch, "activeStep")) {
        setCurrentStep(next.activeStep);
      }

      if (Object.prototype.hasOwnProperty.call(patch, "draft")) {
        setConfigDraft(next.draft);
      }

      scheduleContextSync(patch, immediate);
    },
    [scheduleContextSync, updateLocalContext],
  );

  useEffect(() => {
    function syncStepFromHash() {
      const currentUrl = new URL(window.location.href);
      const checkoutQuery = shouldForceFreshStart(currentUrl)
        ? null
        : readCheckoutStatusQuery(currentUrl);

      if (checkoutQuery) {
        setCurrentStep(4);
        if (normalizeStepHash(window.location.hash) !== normalizeStepHash(PAYMENT_HASH)) {
          setStepHash(4);
        }
        return;
      }

      const hash = window.location.hash;
      if (!hasStepHash(hash)) return;
      setCurrentStep(normalizeFlowStep(parseStepFromHash(hash)));
    }

    let isMounted = true;

    async function loadConfigContext() {
      const initialUrl = new URL(window.location.href);
      const shouldForceFresh = shouldForceFreshStart(initialUrl);
      setForceFreshCheckout(shouldForceFresh);
      const localContext = shouldForceFresh ? null : readLocalConfigContext();
      const initialHash = window.location.hash;
      const initialHashStep = parseStepFromHash(initialHash);
      const shouldRespectHash = hasStepHash(initialHash);
      const checkoutQuery = shouldForceFresh ? null : readCheckoutStatusQuery(initialUrl);
      const queryGuildId = normalizeGuildIdFromQuery(
        initialUrl.searchParams.get("guild"),
      );
      let serverContext: StoredConfigContext | null = null;

      try {
        if (!shouldForceFresh) {
          const response = await fetch("/api/auth/me/config-context", {
            cache: "no-store",
          });
          const payload = (await response.json()) as ConfigContextApiResponse;

          if (response.ok && payload.ok) {
            const sanitizedServerContext = sanitizeStoredConfigContext({
              activeGuildId: payload.activeGuildId,
              activeStep: payload.activeStep,
              draft: payload.draft,
              updatedAt: payload.updatedAt,
            });
            if (sanitizedServerContext) {
              serverContext = toStoredConfigContext({
                activeGuildId: sanitizedServerContext.activeGuildId,
                activeStep: sanitizedServerContext.activeStep,
                draft: sanitizedServerContext.draft,
                updatedAt: sanitizedServerContext.updatedAt,
              });
            }
          }
        }
      } catch {
        // Usa apenas contexto local em caso de falha de rede.
      } finally {
        if (!isMounted) return;

        if (shouldForceFresh) {
          try {
            window.sessionStorage.removeItem(CONFIG_CONTEXT_STORAGE_KEY);
            window.sessionStorage.removeItem(LEGACY_GUILD_STORAGE_KEY);
            window.sessionStorage.removeItem("flowdesk_payment_order_cache_v1");
            window.sessionStorage.removeItem("flowdesk_approved_redirected_orders_v1");
            window.sessionStorage.removeItem("flowdesk_pending_card_redirect_v1");
          } catch {
            // Melhor esforco para limpeza de cache local.
          }
        }

        const mergedContext = shouldForceFresh
          ? toStoredConfigContext({
              activeGuildId: null,
              activeStep: 1,
              draft: createEmptyConfigDraft(),
              updatedAt: null,
            })
          : mergeStoredContexts(localContext, serverContext);
        const resolvedActiveGuildId =
          shouldForceFresh
            ? queryGuildId
            : checkoutQuery?.guildId || queryGuildId || mergedContext.activeGuildId;
        const resolvedActiveStep =
          shouldForceFresh
            ? 4
            : checkoutQuery
              ? 4
              : shouldRespectHash && (resolvedActiveGuildId || initialHashStep === 4)
                ? normalizeFlowStep(initialHashStep)
                : queryGuildId
                  ? 1
                  : normalizeFlowStep(mergedContext.activeStep);
        const hydratedContext = toStoredConfigContext({
          activeGuildId: resolvedActiveGuildId,
          activeStep: resolvedActiveStep,
          draft: shouldForceFresh ? createEmptyConfigDraft() : mergedContext.draft,
          updatedAt: mergedContext.updatedAt,
        });

        contextRef.current = hydratedContext;
        setSelectedGuildId(hydratedContext.activeGuildId);
        setConfigDraft(hydratedContext.draft);

        setCurrentStep(hydratedContext.activeStep);
        if (checkoutQuery) {
          setStepHash(4);
        } else if (!shouldRespectHash && hydratedContext.activeStep !== 1) {
          setStepHash(hydratedContext.activeStep);
        }

        writeLocalConfigContext(hydratedContext);
        setIsContextHydrated(true);
        setIsConfigContextLoading(false);

        if (shouldForceFresh) {
          const cleanedUrl = new URL(window.location.href);
          cleanedUrl.searchParams.delete("fresh");
          cleanedUrl.searchParams.delete("source");
          for (const key of CHECKOUT_QUERY_KEYS) {
            cleanedUrl.searchParams.delete(key);
          }
          window.history.replaceState(
            null,
            "",
            buildConfigUrlWithHashRoute(
              cleanedUrl.pathname,
              cleanedUrl.search,
              cleanedUrl.hash,
            ),
          );
        }

        const shouldBackfillServerActiveGuild =
          Boolean(
            hydratedContext.activeGuildId &&
              (!serverContext?.activeGuildId ||
                serverContext.activeGuildId !== hydratedContext.activeGuildId),
          );

        if (shouldBackfillServerActiveGuild) {
          void fetch("/api/auth/me/config-context", {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              activeGuildId: hydratedContext.activeGuildId,
              activeStep: hydratedContext.activeStep,
            }),
            keepalive: true,
          }).catch(() => {
            // Melhor esforco para manter o servidor ativo sincronizado.
          });
        }
      }
    }

    syncStepFromHash();
    void loadConfigContext();
    window.addEventListener("hashchange", syncStepFromHash);

    return () => {
      isMounted = false;
      window.removeEventListener("hashchange", syncStepFromHash);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadGuilds() {
      try {
        const response = await fetch("/api/auth/me/guilds", {
          cache: "no-store",
        });
        const payload = (await response.json()) as GuildsApiResponse;

        if (!isMounted) return;
        if (response.ok && payload.ok) {
          setAvailableGuilds(payload.guilds || []);
          return;
        }
      } catch {
        // Ignora erro temporario; card permanece sem lista.
      } finally {
        if (isMounted) {
          setIsGuildListLoading(false);
        }
      }
    }

    void loadGuilds();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    async function loadManagedServerStatuses() {
      try {
        const response = await fetch("/api/auth/me/servers", {
          cache: "no-store",
        });
        const payload = (await response.json()) as ServersApiResponse;

        if (!response.ok || !payload.ok || !payload.servers) {
          return;
        }

        const nextStatusMap: Record<string, ManagedServerStatus> = {};
        for (const server of payload.servers) {
          nextStatusMap[server.guildId] = server.status;
        }

        setManagedServers(payload.servers);
        setManagedServerStatusByGuild(nextStatusMap);
      } catch {
        // Mantem fallback local em caso de falha de rede.
      }
    }

    void loadManagedServerStatuses();
  }, []);

  useEffect(() => {
    if (!isTransitioningStep) return;

    const timeoutId = window.setTimeout(() => {
      setIsTransitioningStep(false);
    }, 320);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [currentStep, isTransitioningStep]);

  useEffect(() => {
    if (!isContextHydrated) return;

    const previousStep = contextRef.current.activeStep;
    if (previousStep === currentStep) return;

    const next = updateLocalContext({ activeStep: currentStep });
    setSelectedGuildId(next.activeGuildId);
    setConfigDraft(next.draft);
    scheduleContextSync({ activeStep: currentStep });
  }, [currentStep, isContextHydrated, scheduleContextSync, updateLocalContext]);

  useEffect(() => {
    if (!isContextHydrated) return;

    const currentHash = window.location.hash;
    const expectedHash = resolveHashForStep(currentStep);
    const isLegacyStepFourHash =
      currentStep === 4 && currentHash === STEP_FOUR_LEGACY_HASH;

    if (currentHash === expectedHash || isLegacyStepFourHash) return;

    setStepHash(currentStep);
  }, [currentStep, isContextHydrated]);

  useEffect(() => {
    if (!isContextHydrated || isConfigContextLoading || currentStep !== 1) {
      setIsStepOneAccessCheckLoading(false);
      return;
    }

    let isMounted = true;
    const controller = new AbortController();
    setIsStepOneAccessCheckLoading(true);

    void (async () => {
      try {
        const targetPlan = resolveConfigPlanFromPathname({
          pathname: window.location.pathname,
          fallbackPlanCode: initialPlanCode,
          fallbackBillingPeriodCode: initialBillingPeriodCode,
        });
        const response = await fetch("/api/auth/me/plan-state", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as
          | PlanStateApiResponse
          | null;

        if (!isMounted) return;

        const shouldBlockSelection =
          response.ok &&
          payload?.ok &&
          shouldBlockConfigServerSelection({
            userPlanState: payload.plan
              ? {
                  status: payload.plan.status || "inactive",
                  max_licensed_servers:
                    typeof payload.plan.maxLicensedServers === "number"
                      ? payload.plan.maxLicensedServers
                      : 0,
                }
              : null,
            licensedServersCount:
              typeof payload.usage?.licensedServersCount === "number"
                ? payload.usage.licensedServersCount
                : 0,
            targetPlanMaxLicensedServers:
              targetPlan.entitlements.maxLicensedServers,
          });

        if (shouldBlockSelection) {
          window.location.replace(buildServersPlansPath());
          return;
        }
      } catch (error) {
        if (
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          return;
        }
      } finally {
        if (!isMounted) return;
        setIsStepOneAccessCheckLoading(false);
      }
    })();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [
    currentStep,
    initialBillingPeriodCode,
    initialPlanCode,
    isConfigContextLoading,
    isContextHydrated,
  ]);

  useEffect(() => {
    return () => {
      if (contextSyncTimerRef.current) {
        clearTimeout(contextSyncTimerRef.current);
        contextSyncTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    function flushOnPageHide() {
      const patch = pendingContextPatchRef.current;
      if (!patch) return;

      pendingContextPatchRef.current = null;

      void fetch("/api/auth/me/config-context", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patch),
        keepalive: true,
      }).catch(() => {
        pendingContextPatchRef.current = mergeContextPatch(
          pendingContextPatchRef.current,
          patch,
        );
      });
    }

    window.addEventListener("pagehide", flushOnPageHide);
    return () => {
      window.removeEventListener("pagehide", flushOnPageHide);
    };
  }, []);

  const handleGuildSelectionChange = useCallback(
    (guildId: string | null) => {
      if (currentStep !== 1) return;

      updateCheckoutStatusQuery(null);
      setAndSyncContext(
        {
          activeGuildId: guildId,
          activeStep: 1,
        },
        false,
      );
    },
    [currentStep, setAndSyncContext],
  );

  const handleProceedAfterValidation = useCallback(
    async (guildId: string) => {
      const continueToPayment = () => {
        updateCheckoutStatusQuery(null);
        setAndSyncContext(
          {
            activeGuildId: guildId,
            activeStep: 4,
          },
          true,
        );

        setIsTransitioningStep(true);
        setStepHash(4);

        return { ok: true as const, target: "payment" as const };
      };

      try {
        return await (async () => {
          const targetPlan = resolveConfigPlanFromPathname({
            pathname: window.location.pathname,
            fallbackPlanCode: initialPlanCode,
            fallbackBillingPeriodCode: initialBillingPeriodCode,
          });
          const response = await fetch("/api/auth/me/plan-state", {
            cache: "no-store",
          });
          const payload = (await response.json().catch(() => null)) as
            | PlanStateApiResponse
            | null;

          const shouldBlockSelection =
            response.ok &&
            payload?.ok &&
            shouldBlockConfigServerSelection({
              userPlanState: payload.plan
                ? {
                    status: payload.plan.status || "inactive",
                    max_licensed_servers:
                      typeof payload.plan.maxLicensedServers === "number"
                        ? payload.plan.maxLicensedServers
                        : 0,
                  }
                : null,
              licensedServersCount:
                typeof payload.usage?.licensedServersCount === "number"
                  ? payload.usage.licensedServersCount
                  : 0,
              targetPlanMaxLicensedServers:
                targetPlan.entitlements.maxLicensedServers,
            });

          if (shouldBlockSelection) {
            window.location.replace(buildServersPlansPath());
            return { ok: true as const, target: "payment" as const };
          }

          const hasCapacityInCurrentPlan =
            response.ok &&
            payload?.ok &&
            (payload.plan?.status === "active" || payload.plan?.status === "trial") &&
            !payload.usage?.hasReachedLicensedServersLimit;

          if (hasCapacityInCurrentPlan) {
            const claimResponse = await fetch("/api/auth/me/servers/claim", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ guildId }),
            });
            const claimPayload =
              (await claimResponse.json().catch(() => null)) as ClaimServerApiResponse | null;

            if (claimResponse.ok && claimPayload?.ok) {
              updateCheckoutStatusQuery(null);
              setAndSyncContext(
                {
                  activeGuildId: guildId,
                  activeStep: 1,
                },
                true,
              );
              window.location.assign(claimPayload.redirectPath || `/servers/${guildId}/`);
              return { ok: true as const, target: "servers" as const };
            }

            if (claimPayload && !claimPayload.ok) {
              if (
                claimPayload.reason === "payment_required" ||
                claimPayload.reason === "limit_reached"
              ) {
                return continueToPayment();
              }

              return {
                ok: false as const,
                message:
                  claimPayload.message ||
                  "Nao foi possivel liberar este servidor com o plano atual.",
              };
            }

            return {
              ok: false as const,
              message: "Nao foi possivel validar a liberacao deste servidor agora.",
            };
          }

          return continueToPayment();
        })();
      } catch {
        return continueToPayment();
      }
    },
    [initialBillingPeriodCode, initialPlanCode, setAndSyncContext],
  );

  const handleProceedToStepThree = useCallback(() => {
    updateCheckoutStatusQuery(null);
    setAndSyncContext({ activeStep: 3 }, true);
    setIsTransitioningStep(true);
    setStepHash(3);
  }, [setAndSyncContext]);

  const handleProceedToStepFour = useCallback(() => {
    updateCheckoutStatusQuery(null);
    setAndSyncContext({ activeStep: 4 }, true);
    setIsTransitioningStep(true);
    setStepHash(4);
  }, [setAndSyncContext]);

  const handleGoBackToStepOne = useCallback(() => {
    updateCheckoutStatusQuery(null);
    setAndSyncContext({ activeStep: 1 }, true);
    setStepHash(1);
  }, [setAndSyncContext]);

  const handleStepFourApproved = useCallback(() => {
    // Detectamos se o usuário chegou aqui por causa de um limite de servidores atingido.
    // Se sim, o profissional é mandá-lo de volta para o passo 1 para cadastrar o novo servidor imediatamente.
    const searchParams = new URLSearchParams(window.location.search);
    const isServerLimitUpgrade = searchParams.get("reason") === "server-limit";

    if (isServerLimitUpgrade) {
      // Se for upgrade por limite, manda pro passo 1 para cadastrar o novo servidor
      setAndSyncContext({ activeStep: 1 }, true);
      setIsTransitioningStep(true);
      setStepHash(1);
      return;
    }

    // Se o usuário já tem servidores gerenciados (sem ser por limite), manda pro dashboard com cache-buster
    if (managedServers.length > 0) {
      window.location.assign(`/servers/?v=${Date.now()}`);
      return;
    }

    // Primeira vez: passo 1
    setAndSyncContext({ activeStep: 1 }, true);
    setIsTransitioningStep(true);
    setStepHash(1);
  }, [managedServers, setAndSyncContext]);

  void handleStepFourApproved;

  const handleResolvedStepFourApproved = useCallback((order?: {
    planTransitionKind?: "new" | "current" | "upgrade" | "downgrade" | null;
  }) => {
    const planTransitionKind = order?.planTransitionKind || null;
    const shouldReturnToConfigStepOne =
      planTransitionKind === "new" || planTransitionKind === "upgrade";
    const searchParams = new URLSearchParams(window.location.search);
    const isServerLimitUpgrade = searchParams.get("reason") === "server-limit";

    if (shouldReturnToConfigStepOne || isServerLimitUpgrade) {
      setAndSyncContext({ activeStep: 1 }, true);
      setIsTransitioningStep(true);
      setStepHash(1);
      return;
    }

    if (managedServers.length > 0) {
      window.location.assign(`/servers/?v=${Date.now()}`);
      return;
    }

    setAndSyncContext({ activeStep: 1 }, true);
    setIsTransitioningStep(true);
    setStepHash(1);
  }, [managedServers, setAndSyncContext]);

  const handleServerSwitcherSelect = useCallback(
    async (guildId: string) => {
      if (!guildId) return;

      if (selectedGuildId === guildId && !isConfigContextLoading) {
        return;
      }

      setIsSwitchingGuild(true);

      try {
        let paymentState: PaymentStateApiResponse | null = null;
        try {
          const response = await fetch(
            `/api/auth/me/payments/state?guildId=${guildId}`,
            {
              cache: "no-store",
            },
          );
          const payload = (await response.json()) as PaymentStateApiResponse;
          if (response.ok && payload.ok) {
            paymentState = payload;
          }
        } catch {
          paymentState = null;
        }

        const preferredStep = resolvePreferredStepForGuild(contextRef.current.draft, guildId);
        const activeLicenseOrder = paymentState?.activeLicense || null;
        const latestOrder = paymentState?.latestOrder || null;

        let targetStep = preferredStep;
        let checkoutQuery:
          | {
              status: string;
              code: number;
              guildId: string;
              method?: "pix" | "card" | null;
              checkoutToken?: string | null;
              paymentId?: string | null;
              paymentRef?: string | null;
            }
          | null = null;

        if (activeLicenseOrder?.orderNumber && activeLicenseOrder.checkoutAccessToken) {
          targetStep = 4;
          checkoutQuery = {
            status: activeLicenseOrder.status || "approved",
            code: activeLicenseOrder.orderNumber,
            guildId,
            method: activeLicenseOrder.method,
            checkoutToken: activeLicenseOrder.checkoutAccessToken || null,
            paymentId: activeLicenseOrder.providerPaymentId || null,
            paymentRef: activeLicenseOrder.providerExternalReference || null,
          };
        } else if (latestOrder?.orderNumber && latestOrder.checkoutAccessToken) {
          targetStep = 4;
          checkoutQuery = {
            status: latestOrder.status || "pending",
            code: latestOrder.orderNumber,
            guildId,
            method: latestOrder.method,
            checkoutToken: latestOrder.checkoutAccessToken || null,
            paymentId: latestOrder.providerPaymentId || null,
            paymentRef: latestOrder.providerExternalReference || null,
          };
        } else if (activeLicenseOrder?.orderNumber || latestOrder?.orderNumber) {
          targetStep = 4;
        } else if (preferredStep === 1) {
          targetStep = 1;
        }

        updateCheckoutStatusQuery(checkoutQuery);
        setAndSyncContext(
          {
            activeGuildId: guildId,
            activeStep: targetStep,
          },
          true,
        );

        if (targetStep !== currentStep) {
          setIsTransitioningStep(true);
        }

        setStepHash(targetStep);
      } finally {
        setIsSwitchingGuild(false);
      }
    },
    [currentStep, isConfigContextLoading, selectedGuildId, setAndSyncContext],
  );

  const handleStepTwoDraftChange = useCallback(
    (guildId: string, draft: StepTwoDraft) => {
      const nextDraft = {
        ...contextRef.current.draft,
        stepTwoByGuild: {
          ...contextRef.current.draft.stepTwoByGuild,
          [guildId]: draft,
        },
      } satisfies ConfigDraft;

      setAndSyncContext({ draft: nextDraft }, false);
    },
    [setAndSyncContext],
  );

  const handleStepThreeDraftChange = useCallback(
    (guildId: string, draft: StepThreeDraft) => {
      const nextDraft = {
        ...contextRef.current.draft,
        stepThreeByGuild: {
          ...contextRef.current.draft.stepThreeByGuild,
          [guildId]: draft,
        },
      } satisfies ConfigDraft;

      setAndSyncContext({ draft: nextDraft }, false);
    },
    [setAndSyncContext],
  );

  const handleStepFourDraftChange = useCallback(
    (guildId: string, draft: StepFourDraft) => {
      const nextDraft = {
        ...contextRef.current.draft,
        stepFourByGuild: {
          ...contextRef.current.draft.stepFourByGuild,
          [guildId]: draft,
        },
      } satisfies ConfigDraft;

      setAndSyncContext({ draft: nextDraft }, false);
    },
    [setAndSyncContext],
  );

  const stepTwoDraft = useMemo(() => {
    if (!selectedGuildId) return null;

    const draft = configDraft.stepTwoByGuild[selectedGuildId];
    return draft || null;
  }, [configDraft.stepTwoByGuild, selectedGuildId]);

  const stepThreeDraft = useMemo(() => {
    if (!selectedGuildId) return null;

    const draft = configDraft.stepThreeByGuild[selectedGuildId];
    return draft || null;
  }, [configDraft.stepThreeByGuild, selectedGuildId]);

  const stepFourDraft = useMemo(() => {
    if (!selectedGuildId) return null;

    const draft = configDraft.stepFourByGuild[selectedGuildId];
    return draft || null;
  }, [configDraft.stepFourByGuild, selectedGuildId]);

  const selectedGuildLicenseStatus = useMemo(() => {
    if (!selectedGuildId) return "not_paid" as const;
    return managedServerStatusByGuild[selectedGuildId] || "not_paid";
  }, [managedServerStatusByGuild, selectedGuildId]);
  const switcherGuilds = useMemo(() => {
    const mergedGuilds = new Map<string, ConfigGuildItem>();

    for (const guild of availableGuilds) {
      mergedGuilds.set(guild.id, {
        ...guild,
        managedStatus: managedServerStatusByGuild[guild.id] || null,
      });
    }

    for (const server of managedServers) {
      const current = mergedGuilds.get(server.guildId);
      mergedGuilds.set(server.guildId, {
        id: server.guildId,
        name: current?.name || server.guildName,
        icon_url: current?.icon_url || server.iconUrl,
        hasSavedSetup: current?.hasSavedSetup || server.status !== "paid",
        lastConfiguredAt: current?.lastConfiguredAt || null,
        managedStatus: server.status,
      });
    }

    const priorityByStatus: Record<ManagedServerStatus, number> = {
      paid: 0,
      pending_payment: 1,
      expired: 2,
      off: 3,
    };

    return Array.from(mergedGuilds.values()).sort((left, right) => {
      const leftPriority =
        left.managedStatus !== null && left.managedStatus !== undefined
          ? priorityByStatus[left.managedStatus]
          : left.hasSavedSetup
            ? 3
            : 4;
      const rightPriority =
        right.managedStatus !== null && right.managedStatus !== undefined
          ? priorityByStatus[right.managedStatus]
          : right.hasSavedSetup
            ? 3
            : 4;

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return left.name.localeCompare(right.name, "pt-BR");
    });
  }, [availableGuilds, managedServerStatusByGuild, managedServers]);
  const stepContent = useMemo(() => {
    if ((isConfigContextLoading && currentStep !== 1) || isStepOneAccessCheckLoading) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-black">
          <ButtonLoader size={36} />
        </main>
      );
    }

    if (currentStep === 4) {
      return (
        <ConfigStepFour
          displayName={displayName}
          guildId={selectedGuildId}
          initialPlanCode={initialPlanCode}
          initialBillingPeriodCode={initialBillingPeriodCode}
          hasExplicitInitialPlan={hasExplicitInitialPlan}
          forceFreshCheckout={forceFreshCheckout}
          initialDraft={stepFourDraft}
          onDraftChange={handleStepFourDraftChange}
          onApproved={handleResolvedStepFourApproved}
        />
      );
    }

    if (currentStep === 3) {
      return (
        <ConfigStepThree
          displayName={displayName}
          guildId={selectedGuildId}
          guildLicenseStatus={selectedGuildLicenseStatus}
          initialDraft={stepThreeDraft}
          onDraftChange={handleStepThreeDraftChange}
          onProceedToStepFour={handleProceedToStepFour}
          onGoBackToStepOne={handleGoBackToStepOne}
        />
      );
    }

    if (currentStep === 2) {
      return (
        <ConfigStepTwo
          displayName={displayName}
          guildId={selectedGuildId}
          guildLicenseStatus={selectedGuildLicenseStatus}
          initialDraft={stepTwoDraft}
          onDraftChange={handleStepTwoDraftChange}
          onProceedToStepThree={handleProceedToStepThree}
          onGoBackToStepOne={handleGoBackToStepOne}
        />
      );
    }

    return (
        <ConfigStepOne
          displayName={displayName}
          initialSelectedGuildId={selectedGuildId}
          onSelectedGuildChange={handleGuildSelectionChange}
          onProceedAfterValidation={handleProceedAfterValidation}
        />
      );
  }, [
    currentStep,
    displayName,
    forceFreshCheckout,
    handleGoBackToStepOne,
    handleGuildSelectionChange,
    handleProceedAfterValidation,
    handleProceedToStepFour,
    handleProceedToStepThree,
    handleResolvedStepFourApproved,
    handleStepFourDraftChange,
    hasExplicitInitialPlan,
    handleStepThreeDraftChange,
    handleStepTwoDraftChange,
    initialBillingPeriodCode,
    initialPlanCode,
    isConfigContextLoading,
    isStepOneAccessCheckLoading,
    selectedGuildId,
    selectedGuildLicenseStatus,
    stepFourDraft,
    stepThreeDraft,
    stepTwoDraft,
  ]);

  return (
    <>
      {currentStep !== 1 && currentStep !== 4 ? (
        <ConfigServerSwitcher
          guilds={switcherGuilds}
          selectedGuildId={selectedGuildId}
          isLoading={isGuildListLoading}
          isSwitching={isSwitchingGuild}
          onSelectGuild={(guildId) => {
            void handleServerSwitcherSelect(guildId);
          }}
        />
      ) : null}

      <div>{stepContent}</div>

      {isTransitioningStep ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
          <ButtonLoader size={36} />
        </div>
      ) : null}
    </>
  );
}
