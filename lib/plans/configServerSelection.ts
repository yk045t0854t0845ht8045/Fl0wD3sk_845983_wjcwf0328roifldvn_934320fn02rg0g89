type ConfigSelectionPlanState = {
  status: "inactive" | "trial" | "active" | "expired" | string | null;
  max_licensed_servers: number | null;
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
