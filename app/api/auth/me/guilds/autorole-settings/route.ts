import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  fetchGuildRolesByBot,
  hasAcceptedTeamAccessToGuild,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import { getGuildLicenseStatus } from "@/lib/payments/licenseStatus";
import { cleanupExpiredUnpaidServerSetups } from "@/lib/payments/setupCleanup";
import {
  createServerSaveDiagnosticContext,
  recordServerSaveDiagnostic,
  resolveServerSaveAccessMode,
} from "@/lib/servers/serverSaveDiagnostics";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

const MAX_AUTOROLE_ROLE_IDS = 20;

type AutoRoleAssignmentDelayMinutes = 0 | 10 | 20 | 30;

type AutoRoleSettingsBody = {
  guildId?: unknown;
  enabled?: unknown;
  roleIds?: unknown;
  assignmentDelayMinutes?: unknown;
  syncExistingMembers?: unknown;
};

type GuildAccessContext = {
  sessionData: NonNullable<Awaited<ReturnType<typeof resolveSessionAccessToken>>>;
  accessibleGuild: Awaited<ReturnType<typeof assertUserAdminInGuildOrNull>>;
  hasTeamAccess: boolean;
};

function getTrimmedId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRoleIdList(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => isGuildId(item)),
    ),
  ).slice(0, MAX_AUTOROLE_ROLE_IDS);
}

function normalizeAssignmentDelayMinutes(
  value: unknown,
): AutoRoleAssignmentDelayMinutes {
  return value === 10 || value === 20 || value === 30 ? value : 0;
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function upsertAutoRoleSettingsWithRetry(input: {
  guildId: string;
  enabled: boolean;
  roleIds: string[];
  assignmentDelayMinutes: AutoRoleAssignmentDelayMinutes;
  syncExistingMembers: boolean;
  configuredByUserId: number;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const maxAttempts = 2;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const nowIso = new Date().toISOString();
    const result = await supabase
      .from("guild_autorole_settings")
      .upsert(
        {
          guild_id: input.guildId,
          enabled: input.enabled,
          role_ids: input.roleIds,
          assignment_delay_minutes: input.assignmentDelayMinutes,
          configured_by_user_id: input.configuredByUserId,
          ...(input.syncExistingMembers && input.enabled && input.roleIds.length
            ? {
                existing_members_sync_requested_at: nowIso,
                existing_members_sync_started_at: null,
                existing_members_sync_completed_at: null,
                existing_members_sync_status: "pending",
                existing_members_sync_error: null,
              }
            : {}),
        },
        { onConflict: "guild_id" },
      )
      .select(
        "guild_id, enabled, role_ids, assignment_delay_minutes, existing_members_sync_requested_at, existing_members_sync_started_at, existing_members_sync_completed_at, existing_members_sync_status, existing_members_sync_error, updated_at",
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

  throw lastError || new Error("Falha ao salvar configuracoes de autorole.");
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
    context: {
      sessionData,
      accessibleGuild,
      hasTeamAccess,
    } satisfies GuildAccessContext,
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

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) {
      return access.response;
    }

    await cleanupExpiredUnpaidServerSetups({
      userId: access.context.sessionData.authSession.user.id,
      guildId,
      source: "guild_autorole_settings_get",
    });

    const supabase = getSupabaseAdminClientOrThrow();
    const result = await supabase
      .from("guild_autorole_settings")
      .select(
        "enabled, role_ids, assignment_delay_minutes, existing_members_sync_requested_at, existing_members_sync_started_at, existing_members_sync_completed_at, existing_members_sync_status, existing_members_sync_error, updated_at",
      )
      .eq("guild_id", guildId)
      .maybeSingle();

    if (result.error) {
      throw new Error(result.error.message);
    }

    if (!result.data) {
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
          enabled: Boolean(result.data.enabled),
          roleIds: Array.isArray(result.data.role_ids)
            ? result.data.role_ids.filter(
                (roleId): roleId is string => typeof roleId === "string",
              )
            : [],
          assignmentDelayMinutes: normalizeAssignmentDelayMinutes(
            result.data.assignment_delay_minutes,
          ),
          syncStatus:
            result.data.existing_members_sync_status === "pending" ||
            result.data.existing_members_sync_status === "processing" ||
            result.data.existing_members_sync_status === "completed" ||
            result.data.existing_members_sync_status === "failed"
              ? result.data.existing_members_sync_status
              : "idle",
          syncRequestedAt: result.data.existing_members_sync_requested_at,
          syncStartedAt: result.data.existing_members_sync_started_at,
          syncCompletedAt: result.data.existing_members_sync_completed_at,
          syncError: result.data.existing_members_sync_error,
          updatedAt: result.data.updated_at,
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
            "Erro ao carregar configuracoes de autorole.",
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

  let diagnostic = createServerSaveDiagnosticContext("autorole_settings");

  try {
    let body: AutoRoleSettingsBody = {};
    try {
      body = (await request.json()) as AutoRoleSettingsBody;
    } catch {
      recordServerSaveDiagnostic({
        context: diagnostic,
        outcome: "payload_invalid",
        httpStatus: 400,
        detail: "Payload JSON invalido.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Payload JSON invalido." },
          { status: 400 },
        ),
      );
    }

    const guildId = getTrimmedId(body.guildId);
    const enabled = typeof body.enabled === "boolean" ? body.enabled : true;
    const roleIds = normalizeRoleIdList(body.roleIds);
    const assignmentDelayMinutes = normalizeAssignmentDelayMinutes(
      body.assignmentDelayMinutes,
    );
    const syncExistingMembers = body.syncExistingMembers === true;

    diagnostic = createServerSaveDiagnosticContext("autorole_settings", guildId);

    if (!isGuildId(guildId)) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        outcome: "payload_invalid",
        httpStatus: 400,
        detail: "Guild ID invalido.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Guild ID invalido." },
          { status: 400 },
        ),
      );
    }

    if (enabled && !roleIds.length) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        outcome: "payload_invalid",
        httpStatus: 400,
        detail: "Nenhum cargo selecionado para autorole.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message: "Escolha pelo menos um cargo para ativar o autorole.",
          },
          { status: 400 },
        ),
      );
    }

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) {
      return access.response;
    }

    const authUserId = access.context.sessionData.authSession.user.id;
    const accessMode = resolveServerSaveAccessMode({
      accessibleGuild: access.context.accessibleGuild,
      hasTeamAccess: access.context.hasTeamAccess,
    });
    const canManageServer = Boolean(
      access.context.accessibleGuild?.owner || access.context.hasTeamAccess,
    );
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
              "Servidor com plano expirado/desligado. Regularize a conta para editar configuracoes.",
          },
          { status: 403 },
        ),
      );
    }

    if (licenseStatus === "not_paid") {
      const cleanupSummary = await cleanupExpiredUnpaidServerSetups({
        userId: authUserId,
        guildId,
        source: "guild_autorole_settings_post",
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

    const allowedRoleIds = new Set(
      rawRoles
        .filter((role) => !role.managed && role.id !== guildId)
        .map((role) => role.id),
    );
    const invalidRoleIds = roleIds.filter((roleId) => !allowedRoleIds.has(roleId));

    if (invalidRoleIds.length) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        authUserId,
        accessMode,
        licenseStatus,
        outcome: "validation_failed",
        httpStatus: 400,
        detail: "Cargo invalido ou indisponivel para autorole.",
        meta: {
          invalidRoleCount: invalidRoleIds.length,
        },
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "Um ou mais cargos selecionados nao podem ser usados no autorole. Remova cargos gerenciados, indisponiveis ou o cargo @everyone.",
          },
          { status: 400 },
        ),
      );
    }

    const savedSettings = await upsertAutoRoleSettingsWithRetry({
      guildId,
      enabled,
      roleIds,
      assignmentDelayMinutes,
      syncExistingMembers,
      configuredByUserId: authUserId,
    });

    recordServerSaveDiagnostic({
      context: diagnostic,
      authUserId,
      accessMode,
      licenseStatus,
      outcome: "saved",
      httpStatus: 200,
      detail: "Configuracoes de autorole salvas.",
      meta: {
        enabled,
        roleCount: roleIds.length,
        assignmentDelayMinutes,
        syncExistingMembers,
      },
    });

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        queuedExistingMembersSync:
          syncExistingMembers && enabled && roleIds.length > 0,
        settings: {
          enabled: Boolean(savedSettings.enabled),
          roleIds: Array.isArray(savedSettings.role_ids)
            ? savedSettings.role_ids.filter(
                (roleId): roleId is string => typeof roleId === "string",
              )
            : [],
          assignmentDelayMinutes: normalizeAssignmentDelayMinutes(
            savedSettings.assignment_delay_minutes,
          ),
          syncStatus:
            savedSettings.existing_members_sync_status === "pending" ||
            savedSettings.existing_members_sync_status === "processing" ||
            savedSettings.existing_members_sync_status === "completed" ||
            savedSettings.existing_members_sync_status === "failed"
              ? savedSettings.existing_members_sync_status
              : "idle",
          syncRequestedAt: savedSettings.existing_members_sync_requested_at,
          syncStartedAt: savedSettings.existing_members_sync_started_at,
          syncCompletedAt: savedSettings.existing_members_sync_completed_at,
          syncError: savedSettings.existing_members_sync_error,
          updatedAt: savedSettings.updated_at,
        },
      }),
    );
  } catch (error) {
    recordServerSaveDiagnostic({
      context: diagnostic,
      outcome: "failed",
      httpStatus: 500,
      detail:
        error instanceof Error ? error.message : "Falha ao salvar autorole.",
    });
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(
            error,
            "Falha ao salvar configuracoes de autorole.",
          ),
        },
        { status: 500 },
      ),
    );
  }
}
