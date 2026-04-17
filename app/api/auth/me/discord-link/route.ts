import { NextRequest, NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import { resolveSessionAccessToken } from "@/lib/auth/discordGuildAccess";
import {
  OFFICIAL_DISCORD_GUILD_ID,
  OFFICIAL_DISCORD_LINKED_ROLE_ID,
  OFFICIAL_DISCORD_LINKED_ROLE_NAME,
} from "@/lib/discordLink/config";
import {
  validateDiscordLinkHumanVerification,
  validateDiscordLinkHumanVerificationToken,
} from "@/lib/discordLink/humanCheck";
import { validateDiscordLinkAccessToken } from "@/lib/discordLink/linkAccess";
import {
  getDiscordLinkRecordForUser,
  syncOfficialDiscordLink,
} from "@/lib/discordLink/service";
import {
  extractAuditErrorMessage,
  sanitizeErrorMessage,
} from "@/lib/security/errors";
import { ensureSameOriginJsonMutationRequest, applyNoStoreHeaders } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  extendSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";

function buildUnauthorizedResponse(requestId: string) {
  return attachRequestId(
    applyNoStoreHeaders(
      NextResponse.json(
        { ok: false, authenticated: false, message: "Nao autenticado." },
        { status: 401 },
      ),
    ),
    requestId,
  );
}

function buildDiscordAvatarUrl(
  discordUserId: string | null,
  avatarHash: string | null,
) {
  if (!avatarHash || !discordUserId) return null;
  const extension = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordUserId}/${avatarHash}.${extension}?size=160`;
}

export async function GET(request: NextRequest) {
  const requestContext = createSecurityRequestContext(request);
  const authSession = await getCurrentAuthSessionFromCookie();

  if (!authSession) {
    return buildUnauthorizedResponse(requestContext.requestId);
  }

  const authenticatedContext = extendSecurityRequestContext(requestContext, {
    sessionId: authSession.id,
    userId: authSession.user.id,
    guildId: OFFICIAL_DISCORD_GUILD_ID,
  });

  try {
    const linkRecord = await getDiscordLinkRecordForUser(authSession.user.id);

    return attachRequestId(
      applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          authenticated: true,
          status: linkRecord?.status || "pending",
          linked: linkRecord?.status === "linked",
          roleName: OFFICIAL_DISCORD_LINKED_ROLE_NAME,
          roleId: OFFICIAL_DISCORD_LINKED_ROLE_ID,
          guildId: OFFICIAL_DISCORD_GUILD_ID,
          linkRecord,
        }),
      ),
      authenticatedContext.requestId,
    );
  } catch (error) {
    await logSecurityAuditEventSafe(authenticatedContext, {
      action: "discord_link_status",
      outcome: "failed",
      metadata: {
        reason: extractAuditErrorMessage(error, "unknown"),
      },
    });

    return attachRequestId(
      applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            authenticated: true,
            message: sanitizeErrorMessage(
              error,
              "Erro ao consultar a vinculacao Discord.",
            ),
          },
          { status: 500 },
        ),
      ),
      authenticatedContext.requestId,
    );
  }
}

export async function POST(request: NextRequest) {
  const originGuard = ensureSameOriginJsonMutationRequest(request);
  if (originGuard) {
    return originGuard;
  }

  const requestContext = createSecurityRequestContext(request, {
    guildId: OFFICIAL_DISCORD_GUILD_ID,
  });
  const sessionContext = await resolveSessionAccessToken();

  if (!sessionContext?.authSession) {
    return buildUnauthorizedResponse(requestContext.requestId);
  }

  const authSession = sessionContext.authSession;
  const discordUserId = authSession.user.discord_user_id;

  const authenticatedContext = extendSecurityRequestContext(requestContext, {
    sessionId: authSession.id,
    userId: authSession.user.id,
    guildId: OFFICIAL_DISCORD_GUILD_ID,
  });

  if (!discordUserId) {
    return attachRequestId(
      applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            authenticated: true,
            message: "Esta conta ainda nao possui um Discord vinculado.",
          },
          { status: 409 },
        ),
      ),
      authenticatedContext.requestId,
    );
  }

  const rateLimit = await enforceRequestRateLimit({
    action: "discord_link_sync",
    windowMs: 10 * 60 * 1000,
    maxAttempts: 120,
    context: authenticatedContext,
  });

  if (!rateLimit.ok) {
    await logSecurityAuditEventSafe(authenticatedContext, {
      action: "discord_link_sync",
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
            "Muitas tentativas de vinculacao em sequencia. Aguarde alguns segundos e tente novamente.",
        },
        { status: 429 },
      ),
    );
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return attachRequestId(response, authenticatedContext.requestId);
  }

  await logSecurityAuditEventSafe(authenticatedContext, {
    action: "discord_link_sync",
    outcome: "started",
    metadata: {
      discordUserId: authSession.user.discord_user_id,
    },
  });

  try {
    const payload = await request.json().catch(() => ({}));
    const linkAccessToken =
      payload && typeof payload === "object" && typeof payload.accessToken === "string"
        ? payload.accessToken.trim()
        : null;
    const source =
      payload && typeof payload === "object" && typeof payload.source === "string"
        ? payload.source.trim().slice(0, 64)
        : "official_link_page";
    const humanVerificationToken =
      payload &&
      typeof payload === "object" &&
      typeof payload.humanVerificationToken === "string"
        ? payload.humanVerificationToken.trim()
        : null;
    const accessValidation = await validateDiscordLinkAccessToken(linkAccessToken);

    if (!accessValidation.ok) {
      await logSecurityAuditEventSafe(authenticatedContext, {
        action: "discord_link_sync",
        outcome: "blocked",
        metadata: {
          reason: accessValidation.reason,
        },
      });

      return attachRequestId(
        applyNoStoreHeaders(
          NextResponse.json(
            {
              ok: false,
              authenticated: true,
              message: accessValidation.message,
              authenticatedUser: {
                discordUserId: authSession.user.discord_user_id,
                username: authSession.user.username,
                displayName: authSession.user.display_name,
                avatarUrl: buildDiscordAvatarUrl(
                  authSession.user.discord_user_id,
                  authSession.user.avatar,
                ),
              },
            },
            { status: 403 },
          ),
        ),
        authenticatedContext.requestId,
      );
    }

    const humanVerification =
      humanVerificationToken
        ? validateDiscordLinkHumanVerificationToken({
            token: humanVerificationToken,
            accessNonce: accessValidation.payload.nonce,
          })
        : await validateDiscordLinkHumanVerification({
            accessNonce: accessValidation.payload.nonce,
          });

    if (!humanVerification.ok) {
      await logSecurityAuditEventSafe(authenticatedContext, {
        action: "discord_link_sync",
        outcome: "blocked",
        metadata: {
          reason: humanVerification.reason,
        },
      });

      return attachRequestId(
        applyNoStoreHeaders(
          NextResponse.json(
            {
              ok: false,
              authenticated: true,
              requireHumanCheck: true,
              message: humanVerification.message,
              authenticatedUser: {
                discordUserId,
                username: authSession.user.username,
                displayName: authSession.user.display_name,
                avatarUrl: buildDiscordAvatarUrl(
                  discordUserId,
                  authSession.user.avatar,
                ),
              },
            },
            { status: 428 },
          ),
        ),
        authenticatedContext.requestId,
      );
    }

    const result = await syncOfficialDiscordLink({
      userId: authSession.user.id,
      discordUserId,
      requestId: authenticatedContext.requestId,
      discordAccessToken: sessionContext.accessToken,
    });

    if (result.status === "failed") {
      await logSecurityAuditEventSafe(authenticatedContext, {
        action: "discord_link_sync",
        outcome: "failed",
        metadata: {
          source,
          reason: result.message,
        },
      });

      return attachRequestId(
        applyNoStoreHeaders(
          NextResponse.json(
            {
              ok: false,
              authenticated: true,
              message: result.message,
              status: result.status,
              openDiscordUrl: result.openDiscordUrl,
              inviteUrl: result.inviteUrl,
              authenticatedUser: {
                discordUserId,
                username: authSession.user.username,
                displayName: authSession.user.display_name,
                avatarUrl: buildDiscordAvatarUrl(
                  discordUserId,
                  authSession.user.avatar,
                ),
              },
              linkRecord: result.linkRecord,
            },
            { status: 500 },
          ),
        ),
        authenticatedContext.requestId,
      );
    }

    await logSecurityAuditEventSafe(authenticatedContext, {
      action: "discord_link_sync",
      outcome: "succeeded",
      metadata: {
        source,
        status: result.status,
        alreadyLinked: result.alreadyLinked,
      },
    });

    return attachRequestId(
      applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          authenticated: true,
          status: result.status,
          linked: result.status === "linked",
          message: result.message,
          alreadyLinked: result.alreadyLinked,
          roleName: result.roleName,
          roleId: OFFICIAL_DISCORD_LINKED_ROLE_ID,
          guildId: OFFICIAL_DISCORD_GUILD_ID,
          openDiscordUrl: result.openDiscordUrl,
          inviteUrl: result.inviteUrl,
          authenticatedUser: {
            discordUserId,
            username: authSession.user.username,
            displayName: authSession.user.display_name,
            avatarUrl: buildDiscordAvatarUrl(
              discordUserId,
              authSession.user.avatar,
            ),
          },
          pollAfterMs:
            result.status === "pending" || result.status === "pending_member"
              ? 5000
              : null,
          linkRecord: result.linkRecord,
        }),
      ),
      authenticatedContext.requestId,
    );
  } catch (error) {
    const message = sanitizeErrorMessage(
      error,
      "Erro inesperado ao vincular a conta Discord.",
    );

    await logSecurityAuditEventSafe(authenticatedContext, {
      action: "discord_link_sync",
      outcome: "failed",
      metadata: {
        reason: extractAuditErrorMessage(
          error,
          "Erro inesperado ao vincular a conta Discord.",
        ),
      },
    });

    return attachRequestId(
      applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            authenticated: true,
            message,
          },
          { status: 500 },
        ),
      ),
      authenticatedContext.requestId,
    );
  }
}
