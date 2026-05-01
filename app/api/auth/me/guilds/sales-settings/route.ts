import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  fetchGuildChannelsByBot,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import {
  getEffectiveDashboardPermissions,
  type TeamRolePermission,
} from "@/lib/teams/userTeams";
import { getGuildLicenseStatus } from "@/lib/payments/licenseStatus";
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
import { sendServerSettingsSavedEmailSafe } from "@/lib/mail/transactional";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

const GUILD_CATEGORY = 4;
const GUILD_TEXT = 0;
const GUILD_ANNOUNCEMENT = 5;
const RECEIPT_COMPANY_NAME_MAX_LENGTH = 100;
const RECEIPT_COMPANY_DOCUMENT_MAX_LENGTH = 80;
const RECEIPT_SUPPORT_TEXT_MAX_LENGTH = 300;

const OPTIONAL_DISCORD_SNOWFLAKE_TEXT = flowSecureDto.string({
  maxLength: 20,
  pattern: /^(?:\d{17,20})?$/,
  allowEmpty: true,
  disallowAngleBrackets: true,
  rejectThreatPatterns: false,
});

function getTrimmedId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getTrimmedText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isValidTextChannelType(type?: number) {
  return type === GUILD_TEXT || type === GUILD_ANNOUNCEMENT;
}

function isMissingSalesSettingsTable(error: unknown) {
  const record =
    error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const code = typeof record.code === "string" ? record.code : "";
  const message =
    typeof record.message === "string" ? record.message.toLowerCase() : "";
  return code === "42P01" || message.includes("guild_sales_settings");
}

function buildSalesSettingsResponse(
  record: Record<string, unknown> | null | undefined,
) {
  if (!record) return null;

  return {
    enabled: record.enabled === true,
    cartsCategoryId:
      typeof record.carts_category_id === "string"
        ? record.carts_category_id
        : null,
    paymentApprovedLogChannelId:
      typeof record.payment_approved_log_channel_id === "string"
        ? record.payment_approved_log_channel_id
        : null,
    paymentPendingLogChannelId:
      typeof record.payment_pending_log_channel_id === "string"
        ? record.payment_pending_log_channel_id
        : null,
    paymentRejectedLogChannelId:
      typeof record.payment_rejected_log_channel_id === "string"
        ? record.payment_rejected_log_channel_id
        : null,
    receiptCompanyName:
      typeof record.receipt_company_name === "string"
        ? record.receipt_company_name
        : "",
    receiptCompanyDocument:
      typeof record.receipt_company_document === "string"
        ? record.receipt_company_document
        : "",
    receiptSupportText:
      typeof record.receipt_support_text === "string"
        ? record.receipt_support_text
        : "",
    updatedAt: typeof record.updated_at === "string" ? record.updated_at : null,
  };
}

function buildSalesSettingsResponseFromSnapshot(input: {
  snapshot: Record<string, unknown>;
  updatedAt: string | null;
}) {
  return {
    enabled: input.snapshot.enabled === true,
    cartsCategoryId:
      typeof input.snapshot.cartsCategoryId === "string"
        ? input.snapshot.cartsCategoryId
        : null,
    paymentApprovedLogChannelId:
      typeof input.snapshot.paymentApprovedLogChannelId === "string"
        ? input.snapshot.paymentApprovedLogChannelId
        : null,
    paymentPendingLogChannelId:
      typeof input.snapshot.paymentPendingLogChannelId === "string"
        ? input.snapshot.paymentPendingLogChannelId
        : null,
    paymentRejectedLogChannelId:
      typeof input.snapshot.paymentRejectedLogChannelId === "string"
        ? input.snapshot.paymentRejectedLogChannelId
        : null,
    receiptCompanyName:
      typeof input.snapshot.receiptCompanyName === "string"
        ? input.snapshot.receiptCompanyName
        : "",
    receiptCompanyDocument:
      typeof input.snapshot.receiptCompanyDocument === "string"
        ? input.snapshot.receiptCompanyDocument
        : "",
    receiptSupportText:
      typeof input.snapshot.receiptSupportText === "string"
        ? input.snapshot.receiptSupportText
        : "",
    updatedAt: input.updatedAt,
  };
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

  const { permissions: dashboardPerms, isTeamServer } =
    await getEffectiveDashboardPermissions({
      authUserId: sessionData.authSession.user.id,
      guildId,
    });

  const accessibleGuild = await assertUserAdminInGuildOrNull(
    {
      authSession: sessionData.authSession,
      accessToken: sessionData.accessToken,
    },
    guildId,
  );

  const hasFullAccess = dashboardPerms === "full";
  const hasSpecificPerm =
    dashboardPerms instanceof Set && dashboardPerms.has(requiredPermission);
  const canManage =
    hasFullAccess || hasSpecificPerm || (!isTeamServer && accessibleGuild);

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
    if (!access.ok) return access.response;

    await cleanupExpiredUnpaidServerSetups({
      userId: access.context.sessionData.authSession.user.id,
      guildId,
      source: "guild_sales_settings_get",
    });

    const supabase = getSupabaseAdminClientOrThrow();
    const [result, secureSnapshotResult] = await Promise.all([
      supabase
        .from("guild_sales_settings")
        .select(
          "enabled, carts_category_id, payment_approved_log_channel_id, payment_pending_log_channel_id, payment_rejected_log_channel_id, receipt_company_name, receipt_company_document, receipt_support_text, updated_at",
        )
        .eq("guild_id", guildId)
        .maybeSingle(),
      readServerSettingsVaultSnapshot<Record<string, unknown>>({
        guildId,
        moduleKey: "sales_settings",
      }),
    ]);

    if (secureSnapshotResult?.payload) {
      return applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          settings: buildSalesSettingsResponseFromSnapshot({
            snapshot: secureSnapshotResult.payload,
            updatedAt: secureSnapshotResult.updatedAt,
          }),
        }),
      );
    }

    if (result.error) {
      if (isMissingSalesSettingsTable(result.error)) {
        return applyNoStoreHeaders(NextResponse.json({ ok: true, settings: null }));
      }
      throw new Error(result.error.message);
    }

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        settings: buildSalesSettingsResponse(result.data as Record<string, unknown> | null),
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(
            error,
            "Erro ao carregar configuracoes de vendas.",
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

  let diagnostic = createServerSaveDiagnosticContext("sales_settings");

  try {
    let body: {
      guildId: string;
      enabled?: boolean;
      cartsCategoryId?: string | null;
      paymentApprovedLogChannelId?: string | null;
      paymentPendingLogChannelId?: string | null;
      paymentRejectedLogChannelId?: string | null;
      receiptCompanyName?: string;
      receiptCompanyDocument?: string;
      receiptSupportText?: string;
    };

    try {
      body = parseFlowSecureDto(
        await request.json().catch(() => ({})),
        {
          guildId: flowSecureDto.discordSnowflake(),
          enabled: flowSecureDto.optional(flowSecureDto.boolean()),
          cartsCategoryId: flowSecureDto.optional(
            flowSecureDto.nullable(OPTIONAL_DISCORD_SNOWFLAKE_TEXT),
          ),
          paymentApprovedLogChannelId: flowSecureDto.optional(
            flowSecureDto.nullable(OPTIONAL_DISCORD_SNOWFLAKE_TEXT),
          ),
          paymentPendingLogChannelId: flowSecureDto.optional(
            flowSecureDto.nullable(OPTIONAL_DISCORD_SNOWFLAKE_TEXT),
          ),
          paymentRejectedLogChannelId: flowSecureDto.optional(
            flowSecureDto.nullable(OPTIONAL_DISCORD_SNOWFLAKE_TEXT),
          ),
          receiptCompanyName: flowSecureDto.optional(
            flowSecureDto.string({
              allowEmpty: true,
              maxLength: RECEIPT_COMPANY_NAME_MAX_LENGTH,
              disallowAngleBrackets: false,
            }),
          ),
          receiptCompanyDocument: flowSecureDto.optional(
            flowSecureDto.string({
              allowEmpty: true,
              maxLength: RECEIPT_COMPANY_DOCUMENT_MAX_LENGTH,
              disallowAngleBrackets: false,
            }),
          ),
          receiptSupportText: flowSecureDto.optional(
            flowSecureDto.string({
              allowEmpty: true,
              maxLength: RECEIPT_SUPPORT_TEXT_MAX_LENGTH,
              disallowAngleBrackets: false,
            }),
          ),
        },
        { rejectUnknown: true },
      );
    } catch (error) {
      if (!(error instanceof FlowSecureDtoError)) throw error;
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
    diagnostic = createServerSaveDiagnosticContext("sales_settings", guildId);

    const enabled = body.enabled ?? false;
    const cartsCategoryId = getTrimmedId(body.cartsCategoryId);
    const paymentApprovedLogChannelId = getTrimmedId(body.paymentApprovedLogChannelId);
    const paymentPendingLogChannelId = getTrimmedId(body.paymentPendingLogChannelId);
    const paymentRejectedLogChannelId = getTrimmedId(body.paymentRejectedLogChannelId);
    const receiptCompanyName = getTrimmedText(
      body.receiptCompanyName,
      RECEIPT_COMPANY_NAME_MAX_LENGTH,
    );
    const receiptCompanyDocument = getTrimmedText(
      body.receiptCompanyDocument,
      RECEIPT_COMPANY_DOCUMENT_MAX_LENGTH,
    );
    const receiptSupportText = getTrimmedText(
      body.receiptSupportText,
      RECEIPT_SUPPORT_TEXT_MAX_LENGTH,
    );

    if (
      enabled &&
      (!isGuildId(cartsCategoryId) ||
        !isGuildId(paymentApprovedLogChannelId) ||
        !isGuildId(paymentPendingLogChannelId) ||
        !isGuildId(paymentRejectedLogChannelId))
    ) {
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "Escolha a categoria do carrinho e todos os canais de logs antes de ativar vendas.",
          },
          { status: 400 },
        ),
      );
    }

    if (enabled && !receiptCompanyName) {
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message: "Informe o nome da empresa que aparecera no comprovante.",
          },
          { status: 400 },
        ),
      );
    }

    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
    if (!access.ok) return access.response;

    const authUserId = access.context.sessionData.authSession.user.id;
    const accessMode = resolveServerSaveAccessMode({
      accessibleGuild: access.context.accessibleGuild,
      hasTeamAccess: access.context.hasTeamAccess,
    });

    let licenseStatus = await getGuildLicenseStatus(guildId);
    if (licenseStatus !== "paid") {
      licenseStatus = await getGuildLicenseStatus(guildId, { forceFresh: true });
    }

    if (licenseStatus === "expired" || licenseStatus === "off") {
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

    await cleanupExpiredUnpaidServerSetups({
      userId: authUserId,
      guildId,
      source: "guild_sales_settings_post",
    });

    const rawChannels = await fetchGuildChannelsByBot(guildId);
    if (!rawChannels) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Bot nao possui acesso aos canais deste servidor." },
          { status: 403 },
        ),
      );
    }

    if (enabled) {
      const channelsById = new Map(rawChannels.map((channel) => [channel.id, channel]));
      const cartsCategory = channelsById.get(cartsCategoryId);
      const approvedLog = channelsById.get(paymentApprovedLogChannelId);
      const pendingLog = channelsById.get(paymentPendingLogChannelId);
      const rejectedLog = channelsById.get(paymentRejectedLogChannelId);

      if (!cartsCategory || cartsCategory.type !== GUILD_CATEGORY) {
        return applyNoStoreHeaders(
          NextResponse.json(
            { ok: false, message: "Categoria de carrinhos invalida." },
            { status: 400 },
          ),
        );
      }

      if (
        !approvedLog ||
        !pendingLog ||
        !rejectedLog ||
        !isValidTextChannelType(approvedLog.type) ||
        !isValidTextChannelType(pendingLog.type) ||
        !isValidTextChannelType(rejectedLog.type)
      ) {
        return applyNoStoreHeaders(
          NextResponse.json(
            { ok: false, message: "Um ou mais canais de log de pagamento sao invalidos." },
            { status: 400 },
          ),
        );
      }
    }

    const snapshot = {
      enabled,
      cartsCategoryId: cartsCategoryId || null,
      paymentApprovedLogChannelId: paymentApprovedLogChannelId || null,
      paymentPendingLogChannelId: paymentPendingLogChannelId || null,
      paymentRejectedLogChannelId: paymentRejectedLogChannelId || null,
      receiptCompanyName,
      receiptCompanyDocument,
      receiptSupportText,
    };

    const supabase = getSupabaseAdminClientOrThrow();
    const result = await supabase
      .from("guild_sales_settings")
      .upsert(
        {
          guild_id: guildId,
          enabled,
          carts_category_id: cartsCategoryId || null,
          payment_approved_log_channel_id: paymentApprovedLogChannelId || null,
          payment_pending_log_channel_id: paymentPendingLogChannelId || null,
          payment_rejected_log_channel_id: paymentRejectedLogChannelId || null,
          receipt_company_name: receiptCompanyName,
          receipt_company_document: receiptCompanyDocument,
          receipt_support_text: receiptSupportText,
          configured_by_user_id: authUserId,
        },
        { onConflict: "guild_id" },
      )
      .select(
        "enabled, carts_category_id, payment_approved_log_channel_id, payment_pending_log_channel_id, payment_rejected_log_channel_id, receipt_company_name, receipt_company_document, receipt_support_text, updated_at",
      )
      .single();

    if (result.error) throw new Error(result.error.message);

    const secureUpdated = await writeServerSettingsVaultSnapshot({
      guildId,
      moduleKey: "sales_settings",
      configuredByUserId: authUserId,
      payload: snapshot,
    });
    invalidateDashboardSettingsCache({ guildId });

    recordServerSaveDiagnostic({
      context: diagnostic,
      authUserId,
      accessMode,
      licenseStatus,
      outcome: "saved",
      httpStatus: 200,
      detail: "Configuracoes de vendas salvas com sucesso.",
    });
    void sendServerSettingsSavedEmailSafe({
      user: access.context.sessionData.authSession.user,
      guildId,
      moduleLabel: "Vendas",
      detail: enabled ? "Modulo ativo" : "Modulo desativado",
    });

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        settings: buildSalesSettingsResponseFromSnapshot({
          snapshot,
          updatedAt: secureUpdated?.updatedAt || result.data.updated_at || null,
        }),
      }),
    );
  } catch (error) {
    recordServerSaveDiagnostic({
      context: diagnostic,
      outcome: "failed",
      httpStatus: 500,
      detail: extractAuditErrorMessage(
        error,
        "Erro ao salvar configuracoes de vendas.",
      ),
    });
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(
            error,
            "Erro ao salvar configuracoes de vendas.",
          ),
        },
        { status: 500 },
      ),
    );
  }
}
