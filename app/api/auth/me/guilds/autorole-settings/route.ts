import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  fetchGuildMemberSummaryByBot,
  fetchGuildRolesByBot,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import { 
  getEffectiveDashboardPermissions, 
  type TeamRolePermission 
} from "@/lib/teams/userTeams";
import { getGuildLicenseStatus } from "@/lib/payments/licenseStatus";
import { cleanupExpiredUnpaidServerSetups } from "@/lib/payments/setupCleanup";
import {
  createServerSaveDiagnosticContext,
  recordServerSaveDiagnostic,
  resolveServerSaveAccessMode,
} from "@/lib/servers/serverSaveDiagnostics";
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
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

const MAX_AUTOROLE_ROLE_IDS = 20;
const MAX_AUTOROLE_CONSOLE_ENTRIES = 12;

type AutoRoleSyncStatus = "idle" | "pending" | "processing" | "completed" | "failed";
type AutoRoleConsoleEntryStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

type AutoRoleSettingsRow = {
  enabled: boolean;
  role_ids: unknown;
  assignment_delay_minutes: number | null;
  existing_members_sync_requested_at: string | null;
  existing_members_sync_started_at: string | null;
  existing_members_sync_completed_at: string | null;
  existing_members_sync_status: string | null;
  existing_members_sync_error: string | null;
  updated_at: string | null;
};

type AutoRoleQueueConsoleRow = {
  id: number;
  member_id: string;
  status: string;
  last_error: string | null;
  processed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  due_at: string | null;
};

type AutoRoleConsoleEntry = {
  queueId: string;
  memberId: string;
  status: AutoRoleConsoleEntryStatus;
  detail: string | null;
  occurredAt: string | null;
  displayName: string;
  mentionLabel: string;
  avatarUrl: string | null;
};

function normalizeAutoRoleSyncStatus(value: unknown): AutoRoleSyncStatus {
  return value === "pending" ||
    value === "processing" ||
    value === "completed" ||
    value === "failed"
    ? value
    : "idle";
}

function normalizeAutoRoleConsoleEntryStatus(
  value: unknown,
): AutoRoleConsoleEntryStatus {
  return value === "processing" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
    ? value
    : "pending";
}

async function loadAutoRoleConsoleEntries(input: {
  guildId: string;
  syncRequestedAt: string | null;
}) {
  if (!input.syncRequestedAt) {
    return [] as AutoRoleConsoleEntry[];
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const query = supabase
    .from("guild_autorole_queue")
    .select(
      "id, member_id, status, last_error, processed_at, created_at, updated_at, due_at",
    )
    .eq("guild_id", input.guildId)
    .eq("requested_source", "existing_members_sync")
    .gte("created_at", input.syncRequestedAt)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(MAX_AUTOROLE_CONSOLE_ENTRIES);

  const result = await query;
  if (result.error) {
    throw new Error(result.error.message);
  }

  const rows = (result.data ?? []) as AutoRoleQueueConsoleRow[];
  const entries = await Promise.all(
    rows.map(async (row) => {
      const memberSummary = await fetchGuildMemberSummaryByBot(
        input.guildId,
        row.member_id,
      );
      return {
        queueId: String(row.id),
        memberId: row.member_id,
        status: normalizeAutoRoleConsoleEntryStatus(row.status),
        detail:
          typeof row.last_error === "string" && row.last_error.trim().length > 0
            ? row.last_error.trim()
            : null,
        occurredAt:
          row.processed_at ||
          row.updated_at ||
          row.created_at ||
          row.due_at ||
          null,
        displayName: memberSummary?.displayName || `Membro ${row.member_id.slice(-6)}`,
        mentionLabel:
          memberSummary?.mentionLabel ||
          `@${memberSummary?.displayName || row.member_id.slice(-6)}`,
        avatarUrl: memberSummary?.avatarUrl || null,
      } satisfies AutoRoleConsoleEntry;
    }),
  );

  return entries;
}

async function serializeAutoRoleSettings(
  guildId: string,
  row: AutoRoleSettingsRow,
) {
  let consoleEntries: AutoRoleConsoleEntry[] = [];

  try {
    consoleEntries = await loadAutoRoleConsoleEntries({
      guildId,
      syncRequestedAt: row.existing_members_sync_requested_at,
    });
  } catch (error) {
    console.error("autorole console entries load failed", {
      error,
      guildId,
    });
  }

  return {
    enabled: Boolean(row.enabled),
    roleIds: Array.isArray(row.role_ids)
      ? row.role_ids.filter((roleId): roleId is string => typeof roleId === "string")
      : [],
    assignmentDelayMinutes: normalizeAssignmentDelayMinutes(
      row.assignment_delay_minutes,
    ),
    syncStatus: normalizeAutoRoleSyncStatus(row.existing_members_sync_status),
    syncRequestedAt: row.existing_members_sync_requested_at,
    syncStartedAt: row.existing_members_sync_started_at,
    syncCompletedAt: row.existing_members_sync_completed_at,
    syncError: row.existing_members_sync_error,
    updatedAt: row.updated_at,
    consoleEntries,
  };
}

type AutoRoleAssignmentDelayMinutes = 0 | 10 | 20 | 30;

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

    const access = await ensureGuildAccess(guildId, "server_manage_autorole");
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
        settings: await serializeAutoRoleSettings(
          guildId,
          result.data as AutoRoleSettingsRow,
        ),
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
    let body: {
      guildId: string;
      enabled?: boolean;
      roleIds?: string[];
      assignmentDelayMinutes?: number;
      syncExistingMembers?: boolean;
    };
    try {
      body = parseFlowSecureDto(
        await request.json().catch(() => ({})),
        {
          guildId: flowSecureDto.discordSnowflake(),
          enabled: flowSecureDto.optional(flowSecureDto.boolean()),
          roleIds: flowSecureDto.optional(
            flowSecureDto.array(flowSecureDto.discordSnowflake(), {
              maxLength: MAX_AUTOROLE_ROLE_IDS,
            }),
          ),
          assignmentDelayMinutes: flowSecureDto.optional(
            flowSecureDto.number({
              integer: true,
              min: 0,
              max: 30,
            }),
          ),
          syncExistingMembers: flowSecureDto.optional(flowSecureDto.boolean()),
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

    const guildId = body.guildId;
    const enabled = body.enabled ?? true;
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

    const access = await ensureGuildAccess(guildId, "server_manage_autorole");
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
        settings: await serializeAutoRoleSettings(
          guildId,
          savedSettings as AutoRoleSettingsRow,
        ),
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
