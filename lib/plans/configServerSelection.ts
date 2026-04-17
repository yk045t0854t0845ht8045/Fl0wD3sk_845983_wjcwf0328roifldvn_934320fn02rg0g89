type ConfigSelectionPlanState = {
  plan_code?: string | null;
  status: "inactive" | "trial" | "active" | "expired" | string | null;
  max_licensed_servers: number | null;
};

type ConfigRedirectBypassInput = {
  userPlanState: ConfigSelectionPlanState | null | undefined;
  targetPlanCode?: string | null;
  searchParams?:
    | URLSearchParams
    | Record<string, string | string[] | number | boolean | null | undefined>;
};

function normalizeLicensedServerCount(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function normalizeMaxLicensedServers(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.floor(value));
}

export function hasActiveConfigSelectionPlan(
  userPlanState: ConfigSelectionPlanState | null | undefined,
) {
  return userPlanState?.status === "active" || userPlanState?.status === "trial";
}

export function resolveConfigSelectionMaxLicensedServers(input: {
  userPlanState: ConfigSelectionPlanState | null | undefined;
  targetPlanMaxLicensedServers: number;
}) {
  const targetPlanMaxLicensedServers = normalizeMaxLicensedServers(
    input.targetPlanMaxLicensedServers,
  );

  if (!hasActiveConfigSelectionPlan(input.userPlanState)) {
    return targetPlanMaxLicensedServers;
  }

  const currentPlanMaxLicensedServers = normalizeMaxLicensedServers(
    input.userPlanState?.max_licensed_servers,
  );

  return Math.max(currentPlanMaxLicensedServers, targetPlanMaxLicensedServers);
}

export function shouldBlockConfigServerSelection(input: {
  userPlanState: ConfigSelectionPlanState | null | undefined;
  licensedServersCount: number;
  targetPlanMaxLicensedServers: number;
}) {
  if (!hasActiveConfigSelectionPlan(input.userPlanState)) {
    return false;
  }

  const licensedServersCount = normalizeLicensedServerCount(
    input.licensedServersCount,
  );
  const maxLicensedServers = resolveConfigSelectionMaxLicensedServers({
    userPlanState: input.userPlanState,
    targetPlanMaxLicensedServers: input.targetPlanMaxLicensedServers,
  });

  return licensedServersCount >= maxLicensedServers;
}

function readSearchParam(
  input: ConfigRedirectBypassInput["searchParams"],
  key: string,
) {
  if (!input) return null;

  if (input instanceof URLSearchParams) {
    const value = input.get(key);
    return typeof value === "string" ? value : null;
  }

  const value = (input as Record<string, unknown>)[key];
  if (value === null || value === undefined) return null;

  if (Array.isArray(value)) {
    const first = value[0];
    return first !== null && first !== undefined ? String(first) : null;
  }

  return String(value);
}

function isTruthyQueryFlag(value: string | null) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

/**
 * Determines if the configuration server selection flow should be bypassed
 * based on the user's current plan state and incoming search parameters.
 *
 * This is used to allow users to skip the server selection step when they are
 * performing a specific action like a renewal or coming from a direct link
 * that already implies a valid path.
 */
export function shouldBypassConfigServerSelectionBlock(
  input: ConfigRedirectBypassInput,
) {
  if (!input) return false;

  const { searchParams, userPlanState, targetPlanCode } = input;

  // If no search params are provided, we definitely shouldn't bypass based on them
  if (!searchParams) return false;

  const source =
    readSearchParam(searchParams, "source")?.trim().toLowerCase() || null;
  const renew = isTruthyQueryFlag(readSearchParam(searchParams, "renew"));
  const fresh = isTruthyQueryFlag(readSearchParam(searchParams, "fresh"));

  const hasActivePlan = hasActiveConfigSelectionPlan(userPlanState);

  // Bypass if user is specifically renewing
  if (renew) return true;

  // Bypass if coming from trusted navigation sources
  if (
    source === "servers-plans" ||
    source === "downgrade-regularization" ||
    source === "direct-billing"
  ) {
    return true;
  }

  const currentPlanCode =
    typeof userPlanState?.plan_code === "string"
      ? userPlanState.plan_code.trim().toLowerCase()
      : null;

  const normalizedTargetPlanCode =
    typeof targetPlanCode === "string"
      ? targetPlanCode.trim().toLowerCase()
      : null;

  // Bypass if it's a "fresh" selection and the user is actually changing plans
  if (
    fresh &&
    hasActivePlan &&
    normalizedTargetPlanCode &&
    currentPlanCode &&
    currentPlanCode !== normalizedTargetPlanCode
  ) {
    return true;
  }

  return false;
}
