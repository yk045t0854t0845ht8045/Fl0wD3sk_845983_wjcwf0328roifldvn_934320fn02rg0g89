import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  hasAcceptedTeamAccessToGuild,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import { resolveDiscountPricing } from "@/lib/payments/discountPricing";
import {
  applyFlowPointsToAmount,
  getUserPlanFlowPointsBalance,
  resolveFlowPointsBalanceAmount,
} from "@/lib/plans/change";
import {
  isPlanBillingPeriodCode,
  isPlanCode,
} from "@/lib/plans/catalog";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";

type DiscountPreviewBody = {
  guildId?: unknown;
  couponCode?: unknown;
  giftCardCode?: unknown;
  baseAmount?: unknown;
  currency?: unknown;
  planCode?: unknown;
  billingPeriodCode?: unknown;
};

function normalizeGuildId(value: unknown) {
  if (typeof value !== "string") return null;
  const guildId = value.trim();
  return isGuildId(guildId) ? guildId : null;
}

function normalizeAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value * 100) / 100;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.round(parsed * 100) / 100;
    }
  }

  return 9.99;
}

function normalizeCurrency(value: unknown) {
  if (typeof value !== "string") return "BRL";
  return value.trim().toUpperCase() || "BRL";
}

function normalizePlanCode(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isPlanCode(normalized) ? normalized : null;
}

function normalizeBillingPeriodCode(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isPlanBillingPeriodCode(normalized) ? normalized : null;
}

async function ensureGuildAccess(guildId: string) {
  const sessionData = await resolveSessionAccessToken();
  if (!sessionData?.authSession) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Nao autenticado." },
        { status: 401 },
      ),
    };
  }

  if (!sessionData.accessToken) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Token OAuth ausente na sessao." },
        { status: 401 },
      ),
    };
  }

  const accessibleGuild = await assertUserAdminInGuildOrNull(
    {
      authSession: sessionData.authSession,
      accessToken: sessionData.accessToken,
    },
    guildId,
  );

  const hasTeamAccess = accessibleGuild
    ? false
    : await hasAcceptedTeamAccessToGuild(
        {
          authSession: sessionData.authSession,
          accessToken: sessionData.accessToken,
        },
        guildId,
      );

  if (!accessibleGuild && !hasTeamAccess && sessionData.authSession.activeGuildId !== guildId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Servidor nao encontrado para este usuario." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true as const,
    sessionData: sessionData as NonNullable<
      Awaited<ReturnType<typeof resolveSessionAccessToken>>
    >,
  };
}

export async function POST(request: Request) {
  const invalidMutationResponse = ensureSameOriginJsonMutationRequest(request);
  if (invalidMutationResponse) {
    return applyNoStoreHeaders(invalidMutationResponse);
  }

  try {
    let body: DiscountPreviewBody = {};
    try {
      body = (await request.json()) as DiscountPreviewBody;
    } catch {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Payload JSON invalido." },
          { status: 400 },
        ),
      );
    }

    const guildId = normalizeGuildId(body.guildId);
    if (!guildId) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Guild ID invalido para o carrinho." },
          { status: 400 },
        ),
      );
    }

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) {
      return applyNoStoreHeaders(access.response);
    }

    const preview = await resolveDiscountPricing({
      baseAmount: normalizeAmount(body.baseAmount),
      currency: normalizeCurrency(body.currency),
      couponCode: typeof body.couponCode === "string" ? body.couponCode : null,
      giftCardCode: typeof body.giftCardCode === "string" ? body.giftCardCode : null,
      userId: access.sessionData.authSession.user.id,
      planCode: normalizePlanCode(body.planCode),
      billingPeriodCode: normalizeBillingPeriodCode(body.billingPeriodCode),
    });
    const flowPointsBalanceRecord = await getUserPlanFlowPointsBalance(
      access.sessionData.authSession.user.id,
    );
    const flowPointsBalance = resolveFlowPointsBalanceAmount(flowPointsBalanceRecord);
    const flowPointsPreview = applyFlowPointsToAmount({
      amount: preview.totalAmount,
      flowPointsBalance,
    });

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        message: preview.message,
        preview: {
          ...preview,
          totalAmount: flowPointsPreview.remainingAmount,
          flowPoints: {
            appliedAmount: flowPointsPreview.appliedAmount,
            balanceBefore: flowPointsBalance,
            balanceAfter: flowPointsPreview.nextBalanceAmount,
          },
        },
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(
            error,
            "Erro ao validar cupom e gift card.",
          ),
        },
        { status: 500 },
      ),
    );
  }
}
