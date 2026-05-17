import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  isDiscordRelinkRequiredError,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import {
  getEffectiveDashboardPermissions,
  type TeamRolePermission,
} from "@/lib/teams/userTeams";
import { extractAuditErrorMessage, sanitizeErrorMessage } from "@/lib/security/errors";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";
import {
  readServerSettingsVaultSnapshot,
  writeServerSettingsVaultSnapshot,
} from "@/lib/servers/serverSettingsVault";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import {
  buildSalesPaymentMethodsResponse,
  createSecretFingerprint,
  getSalesMercadoPagoEnvironmentMismatchMessage,
  getSalesPaymentMethodDefinitions,
  normalizeSalesPaymentEnvironment,
  normalizeSalesPaymentMethodKey,
  type SalesPaymentMethodRow,
  type SalesPaymentMethodsSecureSnapshot,
} from "@/lib/sales/paymentMethods";
import { validateSalesMercadoPagoAccessToken } from "@/lib/sales/mercadoPago";

const PAYMENT_METHODS_SELECT =
  "method_key, provider, payment_rail, display_name, status, credentials_configured, environment, last_health_status, last_health_error, updated_at";
const PAYMENT_METHODS_BASE_SELECT =
  "method_key, provider, payment_rail, display_name, status, credentials_configured, environment, updated_at";
const PAYMENT_METHODS_MIN_SELECT = "method_key, status";
const MISSING_SECURE_CREDENTIAL_MESSAGE =
  "Credenciais seguras ausentes. Reative o PIX e salve novamente o Access Token do Mercado Pago.";

type AccessResult =
  | {
      ok: true;
      context: {
        authUserId: number;
      };
    }
  | {
      ok: false;
      response: NextResponse;
    };

function buildDiscordRelinkResponse() {
  return NextResponse.json(
    {
      ok: false,
      code: "DISCORD_RELINK_REQUIRED",
      reauthRequired: true,
      message:
        "Sua conexao com o Discord expirou ou foi revogada. Revincule sua conta Discord para continuar gerenciando este servidor.",
    },
    { status: 401 },
  );
}

function getTrimmedText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function ensureGuildAccess(
  guildId: string,
  requiredPermission: TeamRolePermission,
): Promise<AccessResult> {
  let sessionData;
  try {
    sessionData = await resolveSessionAccessToken();
  } catch (error) {
    if (isDiscordRelinkRequiredError(error)) {
      return { ok: false, response: buildDiscordRelinkResponse() };
    }
    throw error;
  }
  if (!sessionData?.authSession || !sessionData.accessToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, message: "Nao autenticado." },
        { status: 401 },
      ),
    };
  }

  const { permissions: dashboardPerms, isTeamServer } =
    await getEffectiveDashboardPermissions({
      authUserId: sessionData.authSession.user.id,
      guildId,
    });

  let accessibleGuild;
  try {
    accessibleGuild = await assertUserAdminInGuildOrNull(
      {
        authSession: sessionData.authSession,
        accessToken: sessionData.accessToken,
      },
      guildId,
    );
  } catch (error) {
    if (isDiscordRelinkRequiredError(error)) {
      return { ok: false, response: buildDiscordRelinkResponse() };
    }
    throw error;
  }

  const hasFullAccess = dashboardPerms === "full";
  const hasSpecificPerm =
    dashboardPerms instanceof Set && dashboardPerms.has(requiredPermission);
  const canManage =
    hasFullAccess || hasSpecificPerm || (!isTeamServer && accessibleGuild);

  if (!canManage) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          message: "Voce nao possui permissao para gerenciar pagamentos.",
        },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    context: {
      authUserId: sessionData.authSession.user.id,
    },
  };
}

function defaultMethodDefinition(methodKey: string) {
  return getSalesPaymentMethodDefinitions().find(
    (definition) => definition.methodKey === methodKey,
  );
}

function resolveCredentialField(
  rawBody: Record<string, unknown>,
  field: "accessToken" | "publicKey" | "webhookSecret" | "statementDescriptor",
  currentValue: string | null | undefined,
  maxLength: number,
) {
  if (!Object.prototype.hasOwnProperty.call(rawBody, field)) {
    return typeof currentValue === "string" ? currentValue.trim() : "";
  }
  return getTrimmedText(rawBody[field], maxLength);
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function hasMercadoPagoAccessToken(
  value: SalesPaymentMethodsSecureSnapshot | null | undefined,
) {
  return Boolean(value?.mercadoPago?.accessToken?.trim());
}

async function confirmSalesPaymentVaultSnapshot(input: {
  guildId: string;
  localPayload?: unknown;
}) {
  const localPayload = input.localPayload as SalesPaymentMethodsSecureSnapshot | null | undefined;
  if (hasMercadoPagoAccessToken(localPayload)) {
    return true;
  }

  const delays = [120, 360, 800];
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    const verification =
      await readServerSettingsVaultSnapshot<SalesPaymentMethodsSecureSnapshot>({
        guildId: input.guildId,
        moduleKey: "sales_payment_methods",
      });
    if (hasMercadoPagoAccessToken(verification?.payload)) {
      return true;
    }
    if (attempt < delays.length) {
      await sleep(delays[attempt]);
    }
  }

  return false;
}

function getSupabaseErrorInfo(error: unknown) {
  const record =
    error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  return {
    code: typeof record.code === "string" ? record.code : "",
    message: typeof record.message === "string" ? record.message.toLowerCase() : "",
  };
}

function isMissingPaymentMethodsTable(error: unknown) {
  const { code, message } = getSupabaseErrorInfo(error);
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes("guild_sales_payment_methods") &&
      (message.includes("relation") || message.includes("table")) &&
      (message.includes("does not exist") ||
        message.includes("not found") ||
        message.includes("could not find")))
  );
}

function isMissingPaymentMethodsColumn(error: unknown) {
  const { code, message } = getSupabaseErrorInfo(error);
  return (
    code === "42703" ||
    code === "PGRST204" ||
    message.includes("schema cache") ||
    message.includes("column")
  );
}

function normalizePaymentMethodRow(row: Partial<SalesPaymentMethodRow>) {
  return {
    method_key: row.method_key,
    provider: row.provider ?? null,
    payment_rail: row.payment_rail ?? null,
    display_name: row.display_name ?? null,
    status: row.status ?? null,
    credentials_configured: row.credentials_configured ?? null,
    environment: row.environment ?? null,
    last_health_status: row.last_health_status ?? null,
    last_health_error: row.last_health_error ?? null,
    updated_at: row.updated_at ?? null,
  } as SalesPaymentMethodRow;
}

async function selectRowsWithFallback(guildId: string, selectColumns: string) {
  return getSupabaseAdminClientOrThrow()
    .from("guild_sales_payment_methods")
    .select(selectColumns)
    .eq("guild_id", guildId)
    .returns<Partial<SalesPaymentMethodRow>[]>();
}

async function loadRows(guildId: string): Promise<SalesPaymentMethodRow[]> {
  let result = await selectRowsWithFallback(guildId, PAYMENT_METHODS_SELECT);

  if (result.error) {
    if (isMissingPaymentMethodsTable(result.error)) {
      return [];
    }
    if (isMissingPaymentMethodsColumn(result.error)) {
      result = await selectRowsWithFallback(guildId, PAYMENT_METHODS_BASE_SELECT);
    }
  }

  if (result.error && isMissingPaymentMethodsColumn(result.error)) {
    result = await selectRowsWithFallback(guildId, PAYMENT_METHODS_MIN_SELECT);
  }

  if (result.error) {
    if (isMissingPaymentMethodsTable(result.error)) return [];
    throw new Error(result.error.message);
  }

  return reconcileRowsWithSecureVault(guildId, (result.data || []).map(normalizePaymentMethodRow));
}

async function reconcileRowsWithSecureVault(
  guildId: string,
  rows: SalesPaymentMethodRow[],
): Promise<SalesPaymentMethodRow[]> {
  const mercadoPagoRow = rows.find((row) => row.method_key === "mercado_pago");
  let accessToken = "";
  let publicKey = "";
  let environment = mercadoPagoRow?.environment || "production";

  try {
    const snapshot =
      await readServerSettingsVaultSnapshot<SalesPaymentMethodsSecureSnapshot>({
        guildId,
        moduleKey: "sales_payment_methods",
      });
    accessToken = snapshot?.payload?.mercadoPago?.accessToken?.trim() || "";
    publicKey = snapshot?.payload?.mercadoPago?.publicKey?.trim() || "";
    environment = normalizeSalesPaymentEnvironment(
      snapshot?.payload?.mercadoPago?.environment || environment,
    );
  } catch (error) {
    console.warn("[sales-payment-methods] secure vault read failed", {
      guildId,
      error: extractAuditErrorMessage(error),
    });
  }

  if (!mercadoPagoRow) {
    if (!accessToken) return rows;
    return [
      ...rows,
      {
        method_key: "mercado_pago",
        provider: "mercado_pago",
        payment_rail: "pix",
        display_name: "Mercado Pago",
        status: "active",
        credentials_configured: true,
        environment,
        last_health_status: "unchecked",
        last_health_error: "",
        updated_at: null,
      },
    ] as SalesPaymentMethodRow[];
  }

  if (accessToken) {
    if (mercadoPagoRow.credentials_configured !== true) {
      const repairResult = await getSupabaseAdminClientOrThrow()
        .from("guild_sales_payment_methods")
        .update({
          credentials_configured: true,
          environment,
          public_key_fingerprint: createSecretFingerprint(publicKey),
          access_token_fingerprint: createSecretFingerprint(accessToken),
          last_health_status:
            mercadoPagoRow.last_health_status === "failed"
              ? "unchecked"
              : mercadoPagoRow.last_health_status || "unchecked",
          last_health_error:
            mercadoPagoRow.last_health_status === "failed"
              ? ""
              : mercadoPagoRow.last_health_error || "",
        })
        .eq("guild_id", guildId)
        .eq("method_key", "mercado_pago");
      if (repairResult.error) {
        console.warn("[sales-payment-methods] secure credential repair failed", {
          guildId,
          error: extractAuditErrorMessage(repairResult.error),
        });
      }
    }

    return rows.map((row) =>
      row.method_key === "mercado_pago"
        ? {
            ...row,
            credentials_configured: true,
            environment,
            last_health_status:
              row.last_health_status === "failed"
                ? "unchecked"
                : row.last_health_status,
            last_health_error:
              row.last_health_status === "failed" ? "" : row.last_health_error,
          }
        : row,
    ) as SalesPaymentMethodRow[];
  }

  return rows.map((row) =>
    row.method_key === "mercado_pago"
      ? {
          ...row,
          credentials_configured: Boolean(row.credentials_configured),
          last_health_status: "failed" as const,
          last_health_error: MISSING_SECURE_CREDENTIAL_MESSAGE,
        }
      : row,
  ) as SalesPaymentMethodRow[];
}

function resolveSalesPaymentMethodsError(error: unknown, fallback: string) {
  const message = extractAuditErrorMessage(error, fallback);
  const normalized = message.toLowerCase();

  if (
    normalized.includes("schema cache") ||
    normalized.includes("column") ||
    normalized.includes("does not exist") ||
    normalized.includes("guild_settings_secure_snapshots") ||
    normalized.includes("guild_sales_payment_methods")
  ) {
    return "Banco de vendas em producao desatualizado. Aplique as migrations 101 e 115 e tente novamente.";
  }

  if (
    normalized.includes("nao autenticado") ||
    normalized.includes("permissao") ||
    normalized.includes("discord") ||
    normalized.includes("mercado pago") ||
    normalized.includes("access token") ||
    normalized.includes("cofre seguro")
  ) {
    return message;
  }

  return sanitizeErrorMessage(error, fallback);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const guildId = getTrimmedText(url.searchParams.get("guildId"), 25);
    if (!isGuildId(guildId)) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Guild ID invalido." }, { status: 400 }),
      );
    }

    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
    if (!access.ok) return applyNoStoreHeaders(access.response);

    const rows = await loadRows(guildId);
    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        methods: buildSalesPaymentMethodsResponse(rows),
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: resolveSalesPaymentMethodsError(
            error,
            "Erro ao carregar metodos de pagamento.",
          ),
        },
        { status: 500 },
      ),
    );
  }
}

export async function POST(request: Request) {
  const invalidMutationResponse = ensureSameOriginJsonMutationRequest(request);
  if (invalidMutationResponse) return applyNoStoreHeaders(invalidMutationResponse);

  try {
    const rawBody = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const guildId = getTrimmedText(rawBody.guildId, 25);
    const methodKey = normalizeSalesPaymentMethodKey(rawBody.methodKey);
    const action = getTrimmedText(rawBody.action, 24);

    if (!isGuildId(guildId) || !methodKey || !["activate", "deactivate"].includes(action)) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Parametros invalidos." }, { status: 400 }),
      );
    }

    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
    if (!access.ok) return applyNoStoreHeaders(access.response);

    const definition = defaultMethodDefinition(methodKey);
    if (!definition) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Metodo indisponivel." }, { status: 404 }),
      );
    }

    const supabase = getSupabaseAdminClientOrThrow();

    if (action === "deactivate") {
      const result = await supabase
        .from("guild_sales_payment_methods")
        .upsert(
          {
            guild_id: guildId,
            method_key: methodKey,
            provider: definition.provider,
            payment_rail: definition.paymentRail,
            display_name: definition.title,
            status: "disabled",
            configured_by_user_id: access.context.authUserId,
          },
          { onConflict: "guild_id,method_key" },
        )
        .select(PAYMENT_METHODS_SELECT)
        .single<SalesPaymentMethodRow>();

      if (result.error) throw new Error(result.error.message);
      const rows = await loadRows(guildId);
      return applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          method: buildSalesPaymentMethodsResponse([result.data])[0],
          methods: buildSalesPaymentMethodsResponse(rows),
        }),
      );
    }

    if (methodKey !== "mercado_pago") {
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message: "Por enquanto somente PIX via Mercado Pago pode ser ativado.",
          },
          { status: 400 },
        ),
      );
    }

    const secureSnapshot =
      await readServerSettingsVaultSnapshot<SalesPaymentMethodsSecureSnapshot>({
        guildId,
        moduleKey: "sales_payment_methods",
      });
    const currentMercadoPago = secureSnapshot?.payload?.mercadoPago || {};
    const environment = normalizeSalesPaymentEnvironment(
      rawBody.environment || currentMercadoPago.environment,
    );
    const accessToken = resolveCredentialField(
      rawBody,
      "accessToken",
      currentMercadoPago.accessToken,
      500,
    );
    const publicKey = resolveCredentialField(
      rawBody,
      "publicKey",
      currentMercadoPago.publicKey,
      240,
    );
    const webhookSecret = resolveCredentialField(
      rawBody,
      "webhookSecret",
      currentMercadoPago.webhookSecret,
      240,
    );
    const statementDescriptor = resolveCredentialField(
      rawBody,
      "statementDescriptor",
      currentMercadoPago.statementDescriptor,
      22,
    );

    if (!accessToken) {
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "Informe o Access Token do Mercado Pago para ativar PIX. Client ID e Client Secret nao geram cobranca PIX neste fluxo.",
          },
          { status: 400 },
        ),
      );
    }

    const environmentMismatchMessage =
      getSalesMercadoPagoEnvironmentMismatchMessage({
        accessToken,
        environment,
      });
    if (environmentMismatchMessage) {
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message: environmentMismatchMessage,
          },
          { status: 400 },
        ),
      );
    }

    let healthStatus: "ok" | "failed" = "ok";
    let healthError = "";
    try {
      await validateSalesMercadoPagoAccessToken(accessToken);
    } catch (error) {
      healthStatus = "failed";
      healthError = error instanceof Error ? error.message : "Credencial recusada.";
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "O Mercado Pago recusou essas credenciais. Confira se voce informou o Access Token correto, nao Client ID nem Client Secret.",
            detail: healthError,
          },
          { status: 400 },
        ),
      );
    }

    const vaultWriteResult = await writeServerSettingsVaultSnapshot({
      guildId,
      moduleKey: "sales_payment_methods",
      configuredByUserId: access.context.authUserId,
      payload: {
        mercadoPago: {
          accessToken,
          publicKey,
          webhookSecret,
          environment,
          statementDescriptor,
        },
      } satisfies SalesPaymentMethodsSecureSnapshot,
    });
    if (!vaultWriteResult) {
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "Nao foi possivel salvar as credenciais no cofre seguro. Aplique a migration 101 antes de ativar PIX em producao.",
          },
          { status: 500 },
        ),
      );
    }

    const vaultConfirmed = await confirmSalesPaymentVaultSnapshot({
      guildId,
      localPayload: vaultWriteResult.payload,
    });
    if (!vaultConfirmed) {
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "Nao foi possivel confirmar as credenciais no cofre seguro agora. Tente salvar novamente em alguns instantes; se persistir, revise FLOWSECURE_MASTER_KEY em producao.",
          },
          { status: 500 },
        ),
      );
    }

    const result = await supabase
      .from("guild_sales_payment_methods")
      .upsert(
        {
          guild_id: guildId,
          method_key: "mercado_pago",
          provider: "mercado_pago",
          payment_rail: "pix",
          display_name: "Mercado Pago",
          status: "active",
          credentials_configured: true,
          environment,
          public_key_fingerprint: createSecretFingerprint(publicKey),
          access_token_fingerprint: createSecretFingerprint(accessToken),
          last_health_status: healthStatus,
          last_health_error: healthError,
          configured_by_user_id: access.context.authUserId,
        },
        { onConflict: "guild_id,method_key" },
      )
      .select(PAYMENT_METHODS_SELECT)
      .single<SalesPaymentMethodRow>();

    if (result.error) throw new Error(result.error.message);
    const rows = await loadRows(guildId);

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        method: buildSalesPaymentMethodsResponse([result.data])[0],
        methods: buildSalesPaymentMethodsResponse(rows),
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: resolveSalesPaymentMethodsError(
            error,
            "Erro ao salvar metodo de pagamento.",
          ),
        },
        { status: 500 },
      ),
    );
  }
}
