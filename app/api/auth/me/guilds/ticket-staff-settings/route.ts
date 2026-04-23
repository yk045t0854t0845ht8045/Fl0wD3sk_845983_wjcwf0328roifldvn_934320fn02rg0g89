import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  fetchGuildRolesByBot,
  isGuildId,
  resolveSessionAccessToken,
  type DiscordGuildRole,
} from "@/lib/auth/discordGuildAccess";
import { 
  getEffectiveDashboardPermissions, 
  type TeamRolePermission 
} from "@/lib/teams/userTeams";
import {
  getGuildLicenseStatus,
} from "@/lib/payments/licenseStatus";
import { cleanupExpiredUnpaidServerSetups } from "@/lib/payments/setupCleanup";
import {
  createServerSaveDiagnosticContext,
  recordServerSaveDiagnostic,
  resolveServerSaveAccessMode,
} from "@/lib/servers/serverSaveDiagnostics";
import { invalidateDashboardSettingsCache } from "@/lib/servers/serverDashboardSettingsCache";
import {
  readServerSettingsVaultSnapshot,
  writeServerSettingsVaultSnapshot,
} from "@/lib/servers/serverSettingsVault";
import {
  extractAuditErrorMessage,
  sanitizeErrorMessage,
} from "@/lib/security/errors";
import {
  FlowSecureDtoError,
  flowSecureDto,
  parseFlowSecureDto,
} from "@/lib/security/flowSecure";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

const MAX_ROLE_SELECTIONS = 25;

function normalizeRoleId(value: unknown) {
  if (typeof value !== "string") return null;
  const roleId = value.trim();
  return isGuildId(roleId) ? roleId : null;
}

function normalizeRoleIdList(value: unknown) {
  if (!Array.isArray(value)) return [];

  const unique = new Set<string>();
  for (const item of value) {
    const roleId = normalizeRoleId(item);
    if (!roleId) continue;
    unique.add(roleId);
  }

  return Array.from(unique);
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function upsertTicketStaffSettingsWithRetry(input: {
  guildId: string;
  adminRoleId: string;
  claimRoleIds: string[];
  closeRoleIds: string[];
  notifyRoleIds: string[];
  configuredByUserId: number;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const maxAttempts = 2;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await supabase
      .from("guild_ticket_staff_settings")
      .upsert(
        {
          guild_id: input.guildId,
          admin_role_id: input.adminRoleId,
          claim_role_ids: input.claimRoleIds,
          close_role_ids: input.closeRoleIds,
          notify_role_ids: input.notifyRoleIds,
          configured_by_user_id: input.configuredByUserId,
        },
        { onConflict: "guild_id" },
      )
      .select(
        "guild_id, admin_role_id, claim_role_ids, close_role_ids, notify_role_ids, updated_at",
      )
      .single();

    if (!result.error) {
      return result.data;
    }

    lastError = new Error(result.error.message);

    if (attempt < maxAttempts) {
      await wait(240 * attempt);
    }
  }

  throw lastError || new Error("Falha ao salvar configuracoes de staff.");
}

async function ensureGuildAccess(guildId: string, requiredPermission: TeamRolePermission) {
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

  const { permissions: dashboardPerms, isTeamServer } = await getEffectiveDashboardPermissions({
    authUserId: sessionData.authSession.user.id,
    guildId: guildId,
  });

  const accessibleGuild = await assertUserAdminInGuildOrNull(
    {
      authSession: sessionData.authSession,
      accessToken: sessionData.accessToken,
    },
    guildId,
  );

  const hasFullAccess = dashboardPerms === "full";
  const hasSpecificPerm = dashboardPerms instanceof Set && dashboardPerms.has(requiredPermission);
  
  // Rule: Team server requires Team Permission. Personal server requires Discord Admin.
  const canManage = hasFullAccess || hasSpecificPerm || (!isTeamServer && accessibleGuild);

  if (!canManage) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Voce nao possui permissao para gerenciar este modulo." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true as const,
    context: {
      sessionData,
      accessibleGuild,
      hasTeamAccess: isTeamServer,
      dashboardPerms,
    },
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const guildId = (url.searchParams.get("guildId") || "").trim();

    if (!isGuildId(guildId)) {
      return applyNoStoreHeaders(
        NextResponse.json(
        { ok: false, message: "Guild ID invalido." },
        { status: 400 },
        ),
      );
    }

    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
    if (!access.ok) {
      return access.response;
    }

    await cleanupExpiredUnpaidServerSetups({
      userId: access.context.sessionData.authSession.user.id,
      guildId,
      source: "guild_ticket_staff_settings_get",
    });

    const supabase = getSupabaseAdminClientOrThrow();
    const [result, secureSnapshotResult] = await Promise.all([
      supabase
        .from("guild_ticket_staff_settings")
        .select(
          "admin_role_id, claim_role_ids, close_role_ids, notify_role_ids, updated_at",
        )
        .eq("guild_id", guildId)
        .maybeSingle(),
      readServerSettingsVaultSnapshot<Record<string, unknown>>({
        guildId,
        moduleKey: "ticket_staff_settings",
      }),
    ]);

    if (result.error) {
      throw new Error(result.error.message);
    }

    const secureSnapshot =
      secureSnapshotResult?.payload &&
      typeof secureSnapshotResult.payload === "object"
        ? (secureSnapshotResult.payload as Record<string, unknown>)
        : null;
    if (secureSnapshot) {
      return applyNoStoreHeaders(
        NextResponse.json({
        ok: true,
        settings: {
          adminRoleId:
            typeof secureSnapshot.adminRoleId === "string"
              ? secureSnapshot.adminRoleId
              : null,
          claimRoleIds: Array.isArray(secureSnapshot.claimRoleIds)
            ? secureSnapshot.claimRoleIds.filter((roleId): roleId is string => typeof roleId === "string")
            : [],
          closeRoleIds: Array.isArray(secureSnapshot.closeRoleIds)
            ? secureSnapshot.closeRoleIds.filter((roleId): roleId is string => typeof roleId === "string")
            : [],
          notifyRoleIds: Array.isArray(secureSnapshot.notifyRoleIds)
            ? secureSnapshot.notifyRoleIds.filter((roleId): roleId is string => typeof roleId === "string")
            : [],
          updatedAt: secureSnapshotResult?.updatedAt || null,
        },
        }),
      );
    }

    const data = result.data;
    if (!data) {
      return applyNoStoreHeaders(
        NextResponse.json({
        ok: true,
        settings: null,
        }),
      );
    }

    return applyNoStoreHeaders(
      NextResponse.json({
      ok: true,
      settings: {
        adminRoleId: data.admin_role_id,
        claimRoleIds: Array.isArray(data.claim_role_ids)
          ? data.claim_role_ids.filter((roleId): roleId is string => typeof roleId === "string")
          : [],
        closeRoleIds: Array.isArray(data.close_role_ids)
          ? data.close_role_ids.filter((roleId): roleId is string => typeof roleId === "string")
          : [],
        notifyRoleIds: Array.isArray(data.notify_role_ids)
          ? data.notify_role_ids.filter((roleId): roleId is string => typeof roleId === "string")
          : [],
        updatedAt: data.updated_at,
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
          "Erro ao carregar configuracoes de staff.",
        ),
      },
      { status: 500 },
      ),
    );
  }
}

export async function POST(request: Request) {
  const invalidMutationResponse = ensureSameOriginJsonMutationRequest(request);
  if (invalidMutationResponse) {
    return applyNoStoreHeaders(invalidMutationResponse);
  }

  let diagnostic = createServerSaveDiagnosticContext("ticket_staff_settings");

  try {
    let body: {
      guildId: string;
      adminRoleId: string;
      claimRoleIds: string[];
      closeRoleIds: string[];
      notifyRoleIds: string[];
    };
    try {
      body = parseFlowSecureDto(
        await request.json().catch(() => ({})),
        {
          guildId: flowSecureDto.discordSnowflake(),
          adminRoleId: flowSecureDto.discordSnowflake(),
          claimRoleIds: flowSecureDto.array(flowSecureDto.discordSnowflake(), {
            minLength: 1,
            maxLength: MAX_ROLE_SELECTIONS,
          }),
          closeRoleIds: flowSecureDto.array(flowSecureDto.discordSnowflake(), {
            minLength: 1,
            maxLength: MAX_ROLE_SELECTIONS,
          }),
          notifyRoleIds: flowSecureDto.array(flowSecureDto.discordSnowflake(), {
            minLength: 1,
            maxLength: MAX_ROLE_SELECTIONS,
          }),
        },
        {
          rejectUnknown: true,
        },
      );
    } catch (error) {
      if (!(error instanceof FlowSecureDtoError)) {
        throw error;
      }
      recordServerSaveDiagnostic({
        context: diagnostic,
        outcome: "payload_invalid",
        httpStatus: 400,
        detail: error.issues[0] || error.message,
      });
      return applyNoStoreHeaders(
        NextResponse.json(
        { ok: false, message: error.issues[0] || error.message },
        { status: 400 },
        ),
      );
    }

    const guildId = normalizeRoleId(body.guildId);
    const adminRoleId = normalizeRoleId(body.adminRoleId);
    const claimRoleIds = normalizeRoleIdList(body.claimRoleIds);
    const closeRoleIds = normalizeRoleIdList(body.closeRoleIds);
    const notifyRoleIds = normalizeRoleIdList(body.notifyRoleIds);
    diagnostic = createServerSaveDiagnosticContext(
      "ticket_staff_settings",
      guildId || undefined,
    );

    if (!guildId || !adminRoleId) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        outcome: "payload_invalid",
        httpStatus: 400,
        detail: "Guild ID e cargo admin sao obrigatorios.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
        { ok: false, message: "Guild ID e cargo admin sao obrigatorios." },
        { status: 400 },
        ),
      );
    }

    if (!claimRoleIds.length || !closeRoleIds.length || !notifyRoleIds.length) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        outcome: "payload_invalid",
        httpStatus: 400,
        detail: "Os grupos de cargos precisam de ao menos uma selecao.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
        {
          ok: false,
          message:
            "Os cargos de assumir, fechar e notificar precisam ter pelo menos uma selecao.",
        },
        { status: 400 },
        ),
      );
    }

    if (
      claimRoleIds.length > MAX_ROLE_SELECTIONS ||
      closeRoleIds.length > MAX_ROLE_SELECTIONS ||
      notifyRoleIds.length > MAX_ROLE_SELECTIONS
    ) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        outcome: "payload_invalid",
        httpStatus: 400,
        detail: `Cada grupo suporta ate ${MAX_ROLE_SELECTIONS} selecoes.`,
      });
      return applyNoStoreHeaders(
        NextResponse.json(
        {
          ok: false,
          message: `Cada grupo de cargos suporta ate ${MAX_ROLE_SELECTIONS} selecoes.`,
        },
        { status: 400 },
        ),
      );
    }

    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
    if (!access.ok) {
      return access.response;
    }

    const authUserId = access.context.sessionData.authSession.user.id;
    const accessMode = resolveServerSaveAccessMode({
      accessibleGuild: access.context.accessibleGuild,
      hasTeamAccess: access.context.hasTeamAccess,
    });
    const canManageServer = true; // ensureGuildAccess already checked this
    if (!canManageServer) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        authUserId,
        accessMode,
        outcome: "view_only",
        httpStatus: 403,
        detail: "Conta em modo somente visualizacao.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "Esta conta esta em modo somente visualizacao para este servidor.",
          },
          { status: 403 },
        ),
      );
    }

    let licenseStatus = await getGuildLicenseStatus(guildId);
    if (licenseStatus !== "paid") {
      licenseStatus = await getGuildLicenseStatus(guildId, { forceFresh: true });
    }

    if (licenseStatus === "expired" || licenseStatus === "off") {
      recordServerSaveDiagnostic({
        context: diagnostic,
        authUserId,
        accessMode,
        licenseStatus,
        outcome: "license_blocked",
        httpStatus: 403,
        detail: "Servidor com plano expirado ou desligado para edicao.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
        {
          ok: false,
          message:
            "Servidor com plano expirado/desligado. Renove o pagamento para editar configuracoes.",
        },
        { status: 403 },
        ),
      );
    }

    if (licenseStatus === "not_paid") {
      const cleanupSummary = await cleanupExpiredUnpaidServerSetups({
        userId: authUserId,
        guildId,
        source: "guild_ticket_staff_settings_post",
      });

      if (cleanupSummary.cleanedGuildIds.includes(guildId)) {
        recordServerSaveDiagnostic({
          context: diagnostic,
          authUserId,
          accessMode,
          licenseStatus,
          outcome: "cleanup_expired",
          httpStatus: 409,
          detail: "Setup expirado apos 30 minutos sem pagamento.",
          meta: {
            cleanedGuildCount: cleanupSummary.cleanedGuildIds.length,
          },
        });
        return applyNoStoreHeaders(
          NextResponse.json(
          {
            ok: false,
            message:
              "A configuracao desse servidor expirou apos 30 minutos sem pagamento. Recomece a ativacao para continuar.",
          },
          { status: 409 },
          ),
        );
      }
    }

    const rawRoles = await fetchGuildRolesByBot(guildId);
    if (!rawRoles) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        authUserId,
        accessMode,
        licenseStatus,
        outcome: "bot_access_missing",
        httpStatus: 403,
        detail: "Bot sem acesso aos cargos do servidor.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
        { ok: false, message: "Bot nao possui acesso aos cargos deste servidor." },
        { status: 403 },
        ),
      );
    }

    const validRoleIds = new Set(
      rawRoles
        .filter((role: DiscordGuildRole) => role.id !== guildId && !role.managed)
        .map((role: DiscordGuildRole) => role.id),
    );

    if (
      !validRoleIds.has(adminRoleId) ||
      claimRoleIds.some((roleId) => !validRoleIds.has(roleId)) ||
      closeRoleIds.some((roleId) => !validRoleIds.has(roleId)) ||
      notifyRoleIds.some((roleId) => !validRoleIds.has(roleId))
    ) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        authUserId,
        accessMode,
        licenseStatus,
        outcome: "validation_failed",
        httpStatus: 400,
        detail: "Um ou mais cargos selecionados sao invalidos.",
        meta: {
          availableRoleCount: validRoleIds.size,
        },
      });
      return applyNoStoreHeaders(
        NextResponse.json(
        { ok: false, message: "Um ou mais cargos selecionados sao invalidos." },
        { status: 400 },
        ),
      );
    }

    const savedSettings = await upsertTicketStaffSettingsWithRetry({
      guildId,
      adminRoleId,
      claimRoleIds,
      closeRoleIds,
      notifyRoleIds,
      configuredByUserId: authUserId,
    });
    const secureUpdated = await writeServerSettingsVaultSnapshot({
      guildId,
      moduleKey: "ticket_staff_settings",
      configuredByUserId: authUserId,
      payload: {
        guildId,
        adminRoleId,
        claimRoleIds,
        closeRoleIds,
        notifyRoleIds,
      },
    });
    invalidateDashboardSettingsCache({ guildId });

    recordServerSaveDiagnostic({
      context: diagnostic,
      authUserId,
      accessMode,
      licenseStatus,
      outcome: "saved",
      httpStatus: 200,
      detail: "Configuracoes de staff salvas com sucesso.",
      meta: {
        roleCount: rawRoles.length,
      },
    });

    return applyNoStoreHeaders(
      NextResponse.json({
      ok: true,
      settings: {
        guildId,
        adminRoleId,
        claimRoleIds,
        closeRoleIds,
        notifyRoleIds,
        updatedAt: secureUpdated?.updatedAt || savedSettings.updated_at,
      },
      }),
    );
  } catch (error) {
    recordServerSaveDiagnostic({
      context: diagnostic,
      outcome: "failed",
      httpStatus: 500,
      detail: extractAuditErrorMessage(
        error,
        "Erro ao salvar configuracoes de staff.",
      ),
    });
    return applyNoStoreHeaders(
      NextResponse.json(
      {
        ok: false,
        message: sanitizeErrorMessage(
          error,
          "Erro ao salvar configuracoes de staff.",
        ),
      },
      { status: 500 },
      ),
    );
  }
}

