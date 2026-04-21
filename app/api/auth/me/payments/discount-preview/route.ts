import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  hasAcceptedTeamAccessToGuild,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import { resolveDiscountPricing } from "@/lib/payments/discountPricing";
import {
  normalizeDiscountCodeRequestBody,
  resolveDiscountCodeValidationMessage,
} from "@/lib/payments/discountCodeInput";
import {
  applyFlowPointsToAmount,
  getUserPlanFlowPointsBalance,
  resolveFlowPointsBalanceAmount,
} from "@/lib/plans/change";
import {
  isPlanBillingPeriodCode,
  isPlanCode,
} from "@/lib/plans/catalog";
import {
  resolveDatabaseFailureMessage,
  resolveDatabaseFailureStatus,
} from "@/lib/security/databaseAvailability";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import {
  flowSecureDto,
  FlowSecureDtoError,
  parseFlowSecureDto,
} from "@/lib/security/flowSecure";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";
import {
  createCoalescedRouteKey,
  runCoalescedRouteResponse,
} from "@/lib/security/routeCoalescing";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  extendSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";

const DISCOUNT_PREVIEW_ROUTE_COALESCE_TTL_MS = 1_500;

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

async function ensureGuildAccess(guildId: string | null) {
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

  if (!guildId) {
    return {
      ok: true as const,
      sessionData: sessionData as NonNullable<
        Awaited<ReturnType<typeof resolveSessionAccessToken>>
      >,
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
  const requestContext = createSecurityRequestContext(request);
  let auditContext = requestContext;
  const respond = (body: unknown, init?: ResponseInit) =>
    attachRequestId(
      applyNoStoreHeaders(NextResponse.json(body, init)),
      requestContext.requestId,
    );

  const invalidMutationResponse = ensureSameOriginJsonMutationRequest(request);
  if (invalidMutationResponse) {
    return attachRequestId(
      applyNoStoreHeaders(invalidMutationResponse),
      requestContext.requestId,
    );
  }

  try {
    let payload: {
      guildId?: string | null;
      couponCode?: string | null;
      giftCardCode?: string | null;
      baseAmount?: number | null;
      currency?: string | null;
      planCode?: string | null;
      billingPeriodCode?: string | null;
    };
    try {
      payload = parseFlowSecureDto(
        normalizeDiscountCodeRequestBody(
          await request.json().catch(() => ({})),
        ),
        {
          guildId: flowSecureDto.optional(
            flowSecureDto.nullable(flowSecureDto.discordSnowflake()),
          ),
          couponCode: flowSecureDto.optional(
            flowSecureDto.nullable(
              flowSecureDto.string({
                maxLength: 64,
                pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
              }),
            ),
          ),
          giftCardCode: flowSecureDto.optional(
            flowSecureDto.nullable(
              flowSecureDto.string({
                maxLength: 64,
                pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
              }),
            ),
          ),
          baseAmount: flowSecureDto.optional(
            flowSecureDto.nullable(
              flowSecureDto.number({
                min: 0,
                max: 1_000_000,
              }),
            ),
          ),
          currency: flowSecureDto.optional(
            flowSecureDto.nullable(
              flowSecureDto.string({
                minLength: 3,
                maxLength: 8,
                pattern: /^[A-Za-z]{3,8}$/,
              }),
            ),
          ),
          planCode: flowSecureDto.optional(
            flowSecureDto.nullable(
              flowSecureDto.string({
                maxLength: 32,
                pattern: /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/,
              }),
            ),
          ),
          billingPeriodCode: flowSecureDto.optional(
            flowSecureDto.nullable(
              flowSecureDto.string({
                maxLength: 32,
                pattern: /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/,
              }),
            ),
          ),
        },
        {
          rejectUnknown: true,
        },
      );
    } catch (error) {
      return respond(
        {
          ok: false,
          message:
            error instanceof FlowSecureDtoError
              ? resolveDiscountCodeValidationMessage(
                  error.issues[0] || error.message,
                )
              : "Payload JSON invalido.",
        },
        { status: 400 },
      );
    }

    const guildId = normalizeGuildId(payload.guildId);

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) {
      return attachRequestId(
        applyNoStoreHeaders(access.response),
        requestContext.requestId,
      );
    }

    auditContext = extendSecurityRequestContext(requestContext, {
      sessionId: access.sessionData.authSession.id,
      userId: access.sessionData.authSession.user.id,
      guildId,
    });

    const mutationKey = createCoalescedRouteKey({
      namespace: "payment-discount-preview-post",
        parts: [
          access.sessionData.authSession.user.id,
          guildId || "__account__",
          payload.couponCode || "",
          payload.giftCardCode || "",
          normalizeAmount(payload.baseAmount),
          normalizeCurrency(payload.currency),
          normalizePlanCode(payload.planCode) || "",
          normalizeBillingPeriodCode(payload.billingPeriodCode) || "",
        ],
      });

    return await runCoalescedRouteResponse({
      key: mutationKey,
      ttlMs: DISCOUNT_PREVIEW_ROUTE_COALESCE_TTL_MS,
      producer: async () => {
        const rateLimit = await enforceRequestRateLimit({
          action: "payment_discount_preview_post",
          windowMs: 10 * 60 * 1000,
          maxAttempts: 45,
          context: auditContext,
        });
        if (!rateLimit.ok) {
          await logSecurityAuditEventSafe(auditContext, {
            action: "payment_discount_preview_post",
            outcome: "blocked",
            metadata: {
              reason: "rate_limit",
              retryAfterSeconds: rateLimit.retryAfterSeconds,
            },
          });

          const response = respond(
            {
              ok: false,
              message:
                "Muitas validacoes em pouco tempo. Aguarde alguns instantes e tente novamente.",
            },
            { status: 429 },
          );
          response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
          return response;
        }

        await logSecurityAuditEventSafe(auditContext, {
          action: "payment_discount_preview_post",
          outcome: "started",
        });

        const preview = await resolveDiscountPricing({
          baseAmount: normalizeAmount(payload.baseAmount),
          currency: normalizeCurrency(payload.currency),
          couponCode: payload.couponCode || null,
          giftCardCode: payload.giftCardCode || null,
          userId: access.sessionData.authSession.user.id,
          planCode: normalizePlanCode(payload.planCode),
          billingPeriodCode: normalizeBillingPeriodCode(
            payload.billingPeriodCode,
          ),
        });
        const flowPointsBalanceRecord = await getUserPlanFlowPointsBalance(
          access.sessionData.authSession.user.id,
        );
        const flowPointsBalance = resolveFlowPointsBalanceAmount(flowPointsBalanceRecord);
        const flowPointsPreview = applyFlowPointsToAmount({
          amount: preview.totalAmount,
          flowPointsBalance,
        });

        await logSecurityAuditEventSafe(auditContext, {
          action: "payment_discount_preview_post",
          outcome: "succeeded",
          metadata: {
            hasCoupon: Boolean(preview.coupon),
            hasGiftCard: Boolean(preview.giftCard),
          },
        });

        return respond({
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
        });
      },
    });
  } catch (error) {
    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_discount_preview_post",
      outcome: "failed",
      metadata: {
        message: sanitizeErrorMessage(
          error,
          "Erro ao validar cupom e gift card.",
        ),
      },
    });

    return respond(
      {
        ok: false,
        message: resolveDatabaseFailureMessage(
          error,
          sanitizeErrorMessage(
            error,
            "Erro ao validar cupom e gift card.",
          ),
        ),
      },
      { status: resolveDatabaseFailureStatus(error) },
    );
  }
}
