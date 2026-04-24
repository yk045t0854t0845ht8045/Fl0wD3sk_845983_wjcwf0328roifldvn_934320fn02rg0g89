import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  hasAcceptedTeamAccessToGuild,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import { updateSessionActiveGuild } from "@/lib/auth/session";
import { clearPlanStateCacheForUser } from "@/lib/account/managedPlanState";
import { ensureUserPaymentDeliveryReady } from "@/lib/payments/paymentReadiness";
import { buildAccountPlanUsageSnapshot } from "@/lib/plans/accountPlanUsage";
import {
  countPlanGuildsForUser,
  licenseGuildForUser,
} from "@/lib/plans/planGuilds";
import { getUserPlanState } from "@/lib/plans/state";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import {
  FlowSecureDtoError,
  flowSecureDto,
  parseFlowSecureDto,
} from "@/lib/security/flowSecure";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";

function normalizeGuildId(value: unknown) {
  if (typeof value !== "string") return null;
  const guildId = value.trim();
  return isGuildId(guildId) ? guildId : null;
}

export async function POST(request: Request) {
  const originGuard = ensureSameOriginJsonMutationRequest(request);
  if (originGuard) {
    return applyNoStoreHeaders(originGuard);
  }

  try {
    const sessionData = await resolveSessionAccessToken();
    if (!sessionData?.authSession) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Nao autenticado." },
          { status: 401 },
        ),
      );
    }

    if (!sessionData.accessToken) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Token OAuth ausente na sessao." },
          { status: 401 },
        ),
      );
    }

    let body: { guildId: string };
    try {
      body = parseFlowSecureDto(
        await request.json().catch(() => ({})),
        {
          guildId: flowSecureDto.discordSnowflake(),
        },
        {
          rejectUnknown: true,
        },
      );
    } catch (error) {
      if (!(error instanceof FlowSecureDtoError)) {
        throw error;
      }
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: error.issues[0] || error.message },
          { status: 400 },
        ),
      );
    }

    const guildId = normalizeGuildId(body.guildId);
    if (!guildId) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Servidor invalido." },
          { status: 400 },
        ),
      );
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

    const isActiveGuild = sessionData.authSession.activeGuildId === guildId;
    if (!accessibleGuild && !hasTeamAccess && !isActiveGuild) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Servidor nao encontrado para este usuario." },
          { status: 403 },
        ),
      );
    }

    const userId = sessionData.authSession.user.id;
    await ensureUserPaymentDeliveryReady({
      userId,
      guildId,
      source: "servers_claim_post",
    });

    const [userPlanState, licensedServersCount] = await Promise.all([
      getUserPlanState(userId),
      countPlanGuildsForUser(userId),
    ]);

    const usage = buildAccountPlanUsageSnapshot(userPlanState, licensedServersCount);
    const hasUsablePlan =
      (userPlanState?.status === "active" || userPlanState?.status === "trial") &&
      usage.canAddMoreServers;

    if (!hasUsablePlan || !userPlanState) {
      clearPlanStateCacheForUser(userId);
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            reason: "payment_required",
            message:
              "Seu plano atual nao possui capacidade disponivel para liberar outro servidor agora.",
            usage,
          },
          { status: 409 },
        ),
      );
    }

    const result = await licenseGuildForUser({
      userId,
      guildId,
      maxLicensedServers: Math.max(userPlanState.max_licensed_servers || 1, 1),
      currentPlanCode: userPlanState.plan_code,
      currentPlanState: userPlanState,
    });

    if (!result.ok) {
      const message =
        result.reason === "owned_by_other"
          ? "Este servidor ja esta licenciado em outra conta no momento."
          : result.reason === "limit_reached"
            ? "Seu plano atual atingiu o limite de servidores licenciados."
            : result.message || "Nao foi possivel liberar este servidor agora.";

      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            reason: result.reason,
            message,
            usage,
          },
          { status: result.reason === "owned_by_other" ? 409 : 400 },
        ),
      );
    }

    if (sessionData.authSession.activeGuildId !== guildId) {
      await updateSessionActiveGuild(sessionData.authSession.id, guildId);
    }

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        guildId,
        alreadyLicensed: result.alreadyLicensed,
        redirectPath: `/servers/${guildId}/`,
        usage: {
          ...usage,
          licensedServersCount: result.alreadyLicensed
            ? usage.licensedServersCount
            : usage.licensedServersCount + 1,
          remainingLicensedServers: result.alreadyLicensed
            ? usage.remainingLicensedServers
            : Math.max(usage.remainingLicensedServers - 1, 0),
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
            "Erro ao liberar servidor com o plano atual.",
          ),
        },
        { status: 500 },
      ),
    );
  }
}
