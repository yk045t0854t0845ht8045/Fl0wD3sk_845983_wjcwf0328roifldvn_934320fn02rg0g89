import { NextResponse } from "next/server";
import { resolveSessionAccessToken } from "@/lib/auth/discordGuildAccess";
import { getUserPlanState } from "@/lib/plans/state";
import { resolvePlanDefinition } from "@/lib/plans/catalog";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import { applyNoStoreHeaders } from "@/lib/security/http";

export async function GET() {
  try {
    const sessionData = await resolveSessionAccessToken();
    if (!sessionData?.authSession) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Não autenticado." }, { status: 401 }),
      );
    }

    const userId = sessionData.authSession.user.id;
    const planState = await getUserPlanState(userId);

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

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        plan: {
          code: planCode,
          name: planDefinition?.name ?? planState?.plan_name ?? planCode,
          status: planState?.status ?? "inactive",
          expiresAt: planState?.expires_at ?? null,
          activatedAt: planState?.activated_at ?? null,
          billingCycleDays,
          recurrenceLabel,
          isActive: planState?.status === "active" || planState?.status === "trial",
          maxLicensedServers: planState?.max_licensed_servers ?? 0,
        },
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        { ok: false, message: sanitizeErrorMessage(error, "Erro ao carregar plano.") },
        { status: 500 },
      ),
    );
  }
}
