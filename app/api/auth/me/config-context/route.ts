import { NextResponse } from "next/server";
import {
  normalizeConfigStep,
  sanitizeConfigDraft,
} from "@/lib/auth/configContext";
import {
  getCurrentAuthSessionFromCookie,
  updateSessionConfigContext,
} from "@/lib/auth/session";
import {
  assertUserAdminInGuildOrNull,
  hasAcceptedTeamAccessToGuild,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import {
  extractAuditErrorMessage,
  sanitizeErrorMessage,
} from "@/lib/security/errors";
import { hasActivePaidConfigPlan } from "@/lib/plans/configAccess";
import { getUserPlanState } from "@/lib/plans/state";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  extendSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";
import { cleanupExpiredUnpaidServerSetups } from "@/lib/payments/setupCleanup";
import { getLockedGuildLicenseByGuildId } from "@/lib/payments/licenseStatus";

type ConfigContextBody = {
  activeGuildId?: unknown;
  activeStep?: unknown;
  draft?: unknown;
};

function normalizeGuildId(value: unknown) {
  if (typeof value !== "string") return null;
  const guildId = value.trim();
  return /^\d{10,25}$/.test(guildId) ? guildId : null;
}

export async function GET(request: Request) {
  const requestContext = createSecurityRequestContext(request);
  try {
    let session = await getCurrentAuthSessionFromCookie();
    if (!session) {
      return attachRequestId(applyNoStoreHeaders(NextResponse.json(
        { ok: false, message: "Nao autenticado." },
        { status: 401 },
      )), requestContext.requestId);
    }

    const userPlanState = await getUserPlanState(session.user.id);
    if (!hasActivePaidConfigPlan(userPlanState)) {
      return attachRequestId(
        applyNoStoreHeaders(
          NextResponse.json(
            {
              ok: false,
              message: "Plano ativo necessario para acessar o config.",
            },
            { status: 403 },
          ),
        ),
        requestContext.requestId,
      );
    }

    const cleanupSummary = await cleanupExpiredUnpaidServerSetups({
      userId: session.user.id,
      source: "config_context_get",
    });

    if (cleanupSummary.cleanedGuildIds.length) {
      const refreshedSession = await getCurrentAuthSessionFromCookie();
      if (refreshedSession) {
        session = refreshedSession;
      }
    }

    return attachRequestId(applyNoStoreHeaders(NextResponse.json({
      ok: true,
      activeGuildId: session.activeGuildId || null,
      activeStep: session.configCurrentStep || 1,
      draft: session.configDraft,
      updatedAt: session.configContextUpdatedAt || null,
    })), requestContext.requestId);
  } catch (error) {
    return attachRequestId(applyNoStoreHeaders(NextResponse.json(
      {
        ok: false,
        message: sanitizeErrorMessage(
          error,
          "Erro ao carregar contexto de configuracao.",
        ),
      },
      { status: 500 },
    )), requestContext.requestId);
  }
}

export async function PUT(request: Request) {
  const baseRequestContext = createSecurityRequestContext(request);
  let auditContext = baseRequestContext;
  try {
    const securityResponse = ensureSameOriginJsonMutationRequest(request);
    if (securityResponse) return attachRequestId(securityResponse, baseRequestContext.requestId);

    const session = await getCurrentAuthSessionFromCookie();
    if (!session) {
      return attachRequestId(applyNoStoreHeaders(NextResponse.json(
        { ok: false, message: "Nao autenticado." },
        { status: 401 },
      )), baseRequestContext.requestId);
    }

    const userPlanState = await getUserPlanState(session.user.id);
    if (!hasActivePaidConfigPlan(userPlanState)) {
      return attachRequestId(
        applyNoStoreHeaders(
          NextResponse.json(
            {
              ok: false,
              message: "Plano ativo necessario para acessar o config.",
            },
            { status: 403 },
          ),
        ),
        baseRequestContext.requestId,
      );
    }

    auditContext = extendSecurityRequestContext(baseRequestContext, {
      sessionId: session.id,
      userId: session.user.id,
    });
    const rateLimit = await enforceRequestRateLimit({
      action: "config_context_put",
      windowMs: 5 * 60 * 1000,
      maxAttempts: 80,
      context: auditContext,
    });
    if (!rateLimit.ok) {
      await logSecurityAuditEventSafe(auditContext, {
        action: "config_context_put",
        outcome: "blocked",
        metadata: {
          reason: "rate_limit",
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
      });
      const response = applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "Muitas atualizacoes de contexto em pouco tempo. Aguarde alguns instantes.",
          },
          { status: 429 },
        ),
      );
      response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
      return attachRequestId(response, baseRequestContext.requestId);
    }

    let body: ConfigContextBody = {};
    try {
      body = (await request.json()) as ConfigContextBody;
    } catch {
      return attachRequestId(applyNoStoreHeaders(NextResponse.json(
        { ok: false, message: "Payload JSON invalido." },
        { status: 400 },
      )), baseRequestContext.requestId);
    }

    const hasActiveGuildPatch = Object.prototype.hasOwnProperty.call(
      body,
      "activeGuildId",
    );
    const hasActiveStepPatch = Object.prototype.hasOwnProperty.call(
      body,
      "activeStep",
    );
    const hasDraftPatch = Object.prototype.hasOwnProperty.call(body, "draft");

    if (!hasActiveGuildPatch && !hasActiveStepPatch && !hasDraftPatch) {
      return attachRequestId(applyNoStoreHeaders(NextResponse.json(
        { ok: false, message: "Nenhuma alteracao informada." },
        { status: 400 },
      )), baseRequestContext.requestId);
    }

    const activeGuildId = hasActiveGuildPatch
      ? body.activeGuildId === null
        ? null
        : normalizeGuildId(body.activeGuildId)
      : undefined;

    if (hasActiveGuildPatch && body.activeGuildId !== null && !activeGuildId) {
      return attachRequestId(applyNoStoreHeaders(NextResponse.json(
        { ok: false, message: "Guild ID invalido." },
        { status: 400 },
      )), baseRequestContext.requestId);
    }

    let activeStep: ReturnType<typeof normalizeConfigStep> | undefined = undefined;
    if (hasActiveStepPatch) {
      activeStep = normalizeConfigStep(body.activeStep);
    }

    if (hasActiveStepPatch && !activeStep) {
      return attachRequestId(applyNoStoreHeaders(NextResponse.json(
        { ok: false, message: "Etapa ativa invalida." },
        { status: 400 },
      )), baseRequestContext.requestId);
    }

    const draft = hasDraftPatch ? sanitizeConfigDraft(body.draft) : undefined;

    if (activeGuildId) {
      const sessionData = await resolveSessionAccessToken();
      if (!sessionData?.authSession || sessionData.authSession.id !== session.id) {
        return attachRequestId(applyNoStoreHeaders(NextResponse.json(
          { ok: false, message: "Nao autenticado." },
          { status: 401 },
        )), baseRequestContext.requestId);
      }

      if (!sessionData.accessToken) {
        return attachRequestId(applyNoStoreHeaders(NextResponse.json(
          { ok: false, message: "Token OAuth ausente na sessao." },
          { status: 401 },
        )), baseRequestContext.requestId);
      }

      const accessibleGuild = await assertUserAdminInGuildOrNull(
        {
          authSession: sessionData.authSession,
          accessToken: sessionData.accessToken,
        },
        activeGuildId,
      );

      const hasTeamAccess = accessibleGuild
        ? false
        : await hasAcceptedTeamAccessToGuild(
            {
              authSession: sessionData.authSession,
              accessToken: sessionData.accessToken,
            },
            activeGuildId,
          );

      if (!accessibleGuild && !hasTeamAccess) {
        return attachRequestId(applyNoStoreHeaders(NextResponse.json(
          { ok: false, message: "Servidor nao encontrado para este usuario." },
          { status: 403 },
        )), baseRequestContext.requestId);
      }

      const lockedLicense = await getLockedGuildLicenseByGuildId(activeGuildId);
      if (lockedLicense && lockedLicense.userId !== session.user.id) {
        return attachRequestId(
          applyNoStoreHeaders(
            NextResponse.json(
              {
                ok: false,
                message:
                  "Este servidor ja possui uma licenca ativa em outra conta e nao pode iniciar uma nova configuracao agora.",
              },
              { status: 409 },
            ),
          ),
          baseRequestContext.requestId,
        );
      }
    }

    await logSecurityAuditEventSafe(auditContext, {
      action: "config_context_put",
      outcome: "started",
      metadata: {
        hasActiveGuildPatch,
        hasActiveStepPatch,
        hasDraftPatch,
      },
    });

    const updatedContext = await updateSessionConfigContext(session.id, {
      ...(hasActiveGuildPatch ? { activeGuildId } : {}),
      ...(hasActiveStepPatch && activeStep
        ? { configCurrentStep: activeStep }
        : {}),
      ...(hasDraftPatch ? { configDraft: draft } : {}),
    });

    await logSecurityAuditEventSafe(auditContext, {
      action: "config_context_put",
      outcome: "succeeded",
      metadata: {
        activeGuildId: updatedContext.activeGuildId,
        activeStep: updatedContext.configCurrentStep,
      },
    });

    return attachRequestId(applyNoStoreHeaders(NextResponse.json({
      ok: true,
      activeGuildId: updatedContext.activeGuildId,
      activeStep: updatedContext.configCurrentStep,
      draft: updatedContext.configDraft,
      updatedAt: updatedContext.configContextUpdatedAt || null,
    })), baseRequestContext.requestId);
  } catch (error) {
    await logSecurityAuditEventSafe(auditContext, {
      action: "config_context_put",
      outcome: "failed",
      metadata: {
        message: extractAuditErrorMessage(error),
      },
    });

    return attachRequestId(applyNoStoreHeaders(NextResponse.json(
      {
        ok: false,
        message: sanitizeErrorMessage(
          error,
          "Erro ao salvar contexto de configuracao.",
        ),
      },
      { status: 500 },
    )), baseRequestContext.requestId);
  }
}

