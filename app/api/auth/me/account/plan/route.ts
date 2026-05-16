import { NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import { getUserPlanState } from "@/lib/plans/state";
import { resolvePlanDefinition } from "@/lib/plans/catalog";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import { applyNoStoreHeaders } from "@/lib/security/http";

const ACCOUNT_PLAN_CACHE_TTL_MS = 5 * 60 * 1000;

type AccountPlanResponsePlan = {
  code: string;
  name: string;
  status: string;
  expiresAt: string | null;
  activatedAt: string | null;
  billingCycleDays: number;
  recurrenceLabel: string;
  isActive: boolean;
  maxLicensedServers: number;
};

const accountPlanResponseCache = new Map<
  number,
  { plan: AccountPlanResponsePlan; timestamp: number }
>();

function isLocalDevRuntime() {
  return process.env.NODE_ENV !== "production";
}

function isMissingOptionalLocalTableError(error: unknown) {
  const record =
    error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const code = typeof record.code === "string" ? record.code : "";
  const message =
    typeof record.message === "string" ? record.message.toLowerCase() : "";

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("could not find the table") ||
    message.includes("relation") ||
    message.includes("does not exist")
  );
}

async function getUserPlanStateForLocalRuntime(userId: number) {
  try {
    return await getUserPlanState(userId);
  } catch (error) {
    if (isLocalDevRuntime() && isMissingOptionalLocalTableError(error)) {
      return null;
    }
    throw error;
  }
}

function buildFallbackPlan(): AccountPlanResponsePlan {
  const planDefinition = resolvePlanDefinition("basic");

  return {
    code: "basic",
    name: planDefinition?.name ?? "Flowdesk",
    status: "inactive",
    expiresAt: null,
    activatedAt: null,
    billingCycleDays: 0,
    recurrenceLabel: "N/A",
    isActive: false,
    maxLicensedServers: 0,
  };
}

function buildPlanResponse(
  planState: Awaited<ReturnType<typeof getUserPlanState>>,
): AccountPlanResponsePlan {
  const planCode = planState?.plan_code ?? "basic";
  const planDefinition = resolvePlanDefinition(planCode);
  const billingCycleDays = planState?.billing_cycle_days ?? 0;
  let recurrenceLabel = "N/A";

  if (billingCycleDays > 0) {
    if (billingCycleDays <= 31) recurrenceLabel = "Mensal";
    else if (billingCycleDays <= 92) recurrenceLabel = "Trimestral";
    else if (billingCycleDays <= 185) recurrenceLabel = "Semestral";
    else recurrenceLabel = "Anual";
  }

  return {
    code: planCode,
    name: planDefinition?.name ?? planState?.plan_name ?? planCode,
    status: planState?.status ?? "inactive",
    expiresAt: planState?.expires_at ?? null,
    activatedAt: planState?.activated_at ?? null,
    billingCycleDays,
    recurrenceLabel,
    isActive: planState?.status === "active" || planState?.status === "trial",
    maxLicensedServers: planState?.max_licensed_servers ?? 0,
  };
}

export async function GET() {
  let userId: number | null = null;

  try {
    const authSession = await getCurrentAuthSessionFromCookie();
    if (!authSession) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Nao autenticado." }, { status: 401 }),
      );
    }

    userId = authSession.user.id;
    const planState = await getUserPlanStateForLocalRuntime(userId);
    const plan = buildPlanResponse(planState);
    accountPlanResponseCache.set(userId, {
      plan,
      timestamp: Date.now(),
    });

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        plan,
        sync: {
          degraded: false,
          usedCache: false,
        },
      }),
    );
  } catch (error) {
    const cached = userId ? accountPlanResponseCache.get(userId) : null;
    const canUseCache =
      cached && Date.now() - cached.timestamp <= ACCOUNT_PLAN_CACHE_TTL_MS;

    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: true,
          message: sanitizeErrorMessage(error, "Erro ao carregar plano."),
          plan: canUseCache ? cached.plan : buildFallbackPlan(),
          sync: {
            degraded: true,
            usedCache: Boolean(canUseCache),
          },
        },
        { status: 200 },
      ),
    );
  }
}
