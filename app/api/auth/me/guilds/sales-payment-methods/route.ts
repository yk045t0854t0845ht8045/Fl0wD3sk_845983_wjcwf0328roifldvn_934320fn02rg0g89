import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import {
  getEffectiveDashboardPermissions,
  type TeamRolePermission,
} from "@/lib/teams/userTeams";
import { sanitizeErrorMessage } from "@/lib/security/errors";
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

function getTrimmedText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function ensureGuildAccess(
  guildId: string,
  requiredPermission: TeamRolePermission,
): Promise<AccessResult> {
  const sessionData = await resolveSessionAccessToken();
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

async function loadRows(guildId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("guild_sales_payment_methods")
    .select(PAYMENT_METHODS_SELECT)
    .eq("guild_id", guildId)
    .returns<SalesPaymentMethodRow[]>();

  if (result.error) {
    const message = result.error.message.toLowerCase();
    if (result.error.code === "42P01" || message.includes("guild_sales_payment_methods")) {
      return [];
    }
    throw new Error(result.error.message);
  }

  return result.data || [];
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
          message: sanitizeErrorMessage(error, "Erro ao carregar metodos de pagamento."),
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

    await writeServerSettingsVaultSnapshot({
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
          message: sanitizeErrorMessage(error, "Erro ao salvar metodo de pagamento."),
        },
        { status: 500 },
      ),
    );
  }
}
