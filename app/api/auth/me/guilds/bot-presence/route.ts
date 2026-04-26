import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth/config";
import {
  assertUserAdminInGuildOrNull,
  buildBotInviteUrl,
  hasAcceptedTeamAccessToGuild,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import { updateSessionActiveGuild } from "@/lib/auth/session";
import { getLockedGuildLicenseByGuildId } from "@/lib/payments/licenseStatus";
import { invalidateManagedServersCacheForUser } from "@/lib/servers/managedServers";
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
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  extendSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";

type DiscordGuildMember = {
  roles: string[];
  permissions?: string;
};

type DiscordGuildRole = {
  id: string;
  permissions: string;
};

type BotGuildStatus = {
  inGuild: boolean;
  hasAdministrator: boolean;
};

const DISCORD_ADMINISTRATOR = BigInt(8);

async function getBotGuildStatus(guildId: string): Promise<BotGuildStatus> {
  const botToken = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
  if (!botToken) {
    throw new Error("DISCORD_BOT_TOKEN nao configurado no ambiente do site.");
  }

  const memberResponse = await fetch(
    `https://discord.com/api/guilds/${guildId}/members/${authConfig.discordClientId}`,
    {
      headers: {
        Authorization: `Bot ${botToken}`,
      },
      cache: "no-store",
    },
  );

  if (memberResponse.status === 404 || memberResponse.status === 403) {
    return { inGuild: false, hasAdministrator: false };
  }

  if (!memberResponse.ok) {
    const text = await memberResponse.text();
    throw new Error(`Falha ao validar bot no servidor: ${text}`);
  }

  const member = (await memberResponse.json()) as DiscordGuildMember;

  if (member.permissions) {
    try {
      const bits = BigInt(member.permissions);
      return {
        inGuild: true,
        hasAdministrator:
          (bits & DISCORD_ADMINISTRATOR) === DISCORD_ADMINISTRATOR,
      };
    } catch {
      // Continua para validacao por roles.
    }
  }

  const rolesResponse = await fetch(`https://discord.com/api/guilds/${guildId}/roles`, {
    headers: {
      Authorization: `Bot ${botToken}`,
    },
    cache: "no-store",
  });

  if (rolesResponse.status === 403) {
    return { inGuild: true, hasAdministrator: false };
  }

  if (!rolesResponse.ok) {
    const text = await rolesResponse.text();
    throw new Error(`Falha ao validar permissoes do bot: ${text}`);
  }

  const roles = (await rolesResponse.json()) as DiscordGuildRole[];
  const roleMap = new Map(roles.map((role) => [role.id, role]));
  const memberRoleIds = new Set<string>([guildId, ...(member.roles || [])]);
  let aggregatePermissions = BigInt(0);

  for (const roleId of memberRoleIds) {
    const role = roleMap.get(roleId);
    if (!role) continue;

    try {
      aggregatePermissions |= BigInt(role.permissions);
    } catch {
      // Ignora role com permissao invalida.
    }
  }

  return {
    inGuild: true,
    hasAdministrator:
      (aggregatePermissions & DISCORD_ADMINISTRATOR) === DISCORD_ADMINISTRATOR,
  };
}

export async function POST(request: Request) {
  const baseRequestContext = createSecurityRequestContext(request);
  const respond = (body: unknown, init?: ResponseInit) =>
    attachRequestId(
      applyNoStoreHeaders(NextResponse.json(body, init)),
      baseRequestContext.requestId,
    );

  try {
    const originGuard = ensureSameOriginJsonMutationRequest(request);
    if (originGuard) {
      return attachRequestId(
        applyNoStoreHeaders(originGuard),
        baseRequestContext.requestId,
      );
    }

    const sessionData = await resolveSessionAccessToken();
    if (!sessionData?.authSession) {
      return respond(
        { ok: false, message: "Nao autenticado." },
        { status: 401 },
      );
    }

    const auditContext = extendSecurityRequestContext(baseRequestContext, {
      sessionId: sessionData.authSession.id,
      userId: sessionData.authSession.user.id,
    });

    if (!sessionData.accessToken) {
      return respond(
        { ok: false, message: "Token OAuth ausente na sessao." },
        { status: 401 },
      );
    }

    const rateLimit = await enforceRequestRateLimit({
      action: "auth_bot_presence_validate",
      windowMs: 10 * 60 * 1000,
      maxAttempts: 20,
      context: auditContext,
    });

    if (!rateLimit.ok) {
      await logSecurityAuditEventSafe(auditContext, {
        action: "auth_bot_presence_validate",
        outcome: "blocked",
        metadata: {
          reason: "rate_limit",
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
      });

      const response = respond(
        { ok: false, message: "Muitas tentativas. Tente novamente em instantes." },
        { status: 429 },
      );
      response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
      return response;
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

      await logSecurityAuditEventSafe(auditContext, {
        action: "auth_bot_presence_validate",
        outcome: "blocked",
        metadata: {
          reason: error.issues[0] || error.message,
        },
      });

      return respond(
        { ok: false, message: error.issues[0] || error.message },
        { status: 400 },
      );
    }

    const guildId = body.guildId;

    const guildAuditContext = extendSecurityRequestContext(auditContext, {
      guildId,
    });

    await logSecurityAuditEventSafe(guildAuditContext, {
      action: "auth_bot_presence_validate",
      outcome: "started",
      metadata: {
        guildId,
      },
    });

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
      await logSecurityAuditEventSafe(guildAuditContext, {
        action: "auth_bot_presence_validate",
        outcome: "blocked",
        metadata: {
          reason: "guild_access_denied",
        },
      });

      return respond(
        { ok: false, message: "Servidor nao encontrado para este usuario." },
        { status: 403 },
      );
    }

    const lockedLicense = await getLockedGuildLicenseByGuildId(guildId);
    if (
      lockedLicense &&
      lockedLicense.userId !== sessionData.authSession.user.id
    ) {
      await logSecurityAuditEventSafe(guildAuditContext, {
        action: "auth_bot_presence_validate",
        outcome: "blocked",
        metadata: {
          reason: "locked_license_conflict",
          licenseOwnerUserId: lockedLicense.userId,
        },
      });

      return respond(
        {
          ok: false,
          message:
            "Este servidor ja possui uma licenca ativa em outra conta e nao pode ser adicionado novamente agora.",
        },
        { status: 409 },
      );
    }

    if (sessionData.authSession.activeGuildId !== guildId) {
      await updateSessionActiveGuild(sessionData.authSession.id, guildId);
    }
    invalidateManagedServersCacheForUser(sessionData.authSession.user.id);

    const botStatus = await getBotGuildStatus(guildId);
    const canProceed = botStatus.inGuild && botStatus.hasAdministrator;

    await logSecurityAuditEventSafe(guildAuditContext, {
      action: "auth_bot_presence_validate",
      outcome: "succeeded",
      metadata: {
        guildId,
        canProceed,
        inGuild: botStatus.inGuild,
        hasAdministrator: botStatus.hasAdministrator,
      },
    });

    if (canProceed) {
      return respond({ ok: true, canProceed: true });
    }

    return respond({
      ok: true,
      canProceed: false,
      reason: botStatus.inGuild ? "missing_admin_permission" : "bot_not_found",
      inviteUrl: buildBotInviteUrl(guildId),
    });
  } catch (error) {
    return respond(
      {
        ok: false,
        message: sanitizeErrorMessage(
          error,
          "Erro ao validar presenca do bot no servidor.",
        ),
      },
      { status: 500 },
    );
  }
}
