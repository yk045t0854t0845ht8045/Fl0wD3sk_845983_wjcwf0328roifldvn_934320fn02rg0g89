import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import {
  isValidBrazilDocument,
  normalizeBrazilDocumentDigits,
  resolveBrazilDocumentType,
} from "@/lib/payments/brazilDocument";
import {
  createMercadoPagoCustomer,
  createMercadoPagoCustomerCard,
  deleteMercadoPagoCustomerCard,
  resolveMercadoPagoCardEnvironment,
  searchMercadoPagoCustomerByEmail,
} from "@/lib/payments/mercadoPago";
import { isValidSavedMethodId, parseSavedMethodId } from "@/lib/payments/savedMethods";
import {
  buildMethodIdFromStoredInput,
  normalizePaymentMethodNickname,
  normalizeStoredMethodShape,
  toSavedMethodFromStoredRecord,
  type StoredPaymentMethodRecord,
} from "@/lib/payments/userPaymentMethods";
import {
  areCardPaymentsEnabled,
  CARD_PAYMENTS_DISABLED_MESSAGE,
} from "@/lib/payments/cardAvailability";
import { getLockedGuildLicenseByGuildId } from "@/lib/payments/licenseStatus";
import { ensureSameOriginJsonMutationRequest } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  extendSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type DeleteMethodBody = {
  guildId?: unknown;
  methodId?: unknown;
};

type AddMethodBody = {
  guildId?: unknown;
  nickname?: unknown;
  brand?: unknown;
  firstSix?: unknown;
  lastFour?: unknown;
  expMonth?: unknown;
  expYear?: unknown;
  payerName?: unknown;
  payerDocument?: unknown;
  cardToken?: unknown;
  paymentMethodId?: unknown;
  issuerId?: unknown;
  deviceSessionId?: unknown;
};

type UpdateMethodBody = {
  guildId?: unknown;
  methodId?: unknown;
  nickname?: unknown;
};

type GuildPlanSettingsRecord = {
  recurring_enabled: boolean;
  recurring_method_id: string | null;
};

type AccessContext =
  | {
      ok: true;
      context: {
        userId: number;
        sessionId: string;
        userEmail: string | null;
        discordUserId: string;
      };
    }
  | {
      ok: false;
      response: NextResponse;
    };

const BLOCKED_CARD_DIGITS = new Set([
  "000000",
  "111111",
  "123456",
  "654321",
  "999999",
  "0000",
  "1111",
  "1234",
  "4321",
  "9999",
]);
const HIGH_RISK_RETRY_COOLDOWN_MS = 10 * 60 * 1000;
const VAULT_TRANSIENT_RETRY_DELAY_MS = 650;
const VAULT_MAX_RETRY_ATTEMPTS = 2;

const STORED_METHOD_SELECT_COLUMNS =
  "method_id, nickname, brand, first_six, last_four, exp_month, exp_year, is_active, verification_status, verification_status_detail, verification_amount, verification_provider_payment_id, provider_customer_id, provider_card_id, verified_at, last_context_guild_id, created_at, updated_at";

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableVaultProviderError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : typeof error === "string"
        ? error.toLowerCase()
        : "";

  if (!message) return false;

  return [
    "timeout",
    "timed out",
    "temporarily unavailable",
    "temporariamente indisponivel",
    "internal error",
    "internal_server_error",
    "service unavailable",
    "bad gateway",
    "gateway timeout",
    "connection",
    "network",
    "socket",
    "econnreset",
    "too many requests",
    "rate limit",
    "429",
  ].some((pattern) => message.includes(pattern));
}

async function runVaultOperationWithRetry<T>(input: {
  operation: (attempt: number) => Promise<T>;
  maxAttempts?: number;
  onRetry?: (attempt: number, error: unknown) => Promise<void> | void;
}) {
  const maxAttempts =
    typeof input.maxAttempts === "number" && input.maxAttempts > 0
      ? Math.floor(input.maxAttempts)
      : VAULT_MAX_RETRY_ATTEMPTS;

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await input.operation(attempt);
    } catch (error) {
      lastError = error;

      if (attempt >= maxAttempts || !isRetryableVaultProviderError(error)) {
        throw error;
      }

      await input.onRetry?.(attempt, error);
      await delay(VAULT_TRANSIENT_RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Falha ao concluir a operacao do cofre seguro.");
}

function normalizeGuildId(value: unknown) {
  if (typeof value !== "string") return null;
  const guildId = value.trim();
  return isGuildId(guildId) ? guildId : null;
}

function normalizeMethodId(value: unknown) {
  if (!isValidSavedMethodId(value)) return null;
  if (typeof value !== "string") return null;
  return value.trim();
}

function normalizeStringDigits(value: unknown, length: number) {
  if (typeof value !== "string") return null;
  const digits = value.trim();
  if (!new RegExp(`^\\d{${length}}$`).test(digits)) return null;
  return digits;
}

function normalizeNullableInteger(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return null;
  return numeric;
}

function normalizePayerName(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  if (normalized.length < 2 || normalized.length > 120) return null;
  return normalized;
}

function normalizePayerDocument(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = normalizeBrazilDocumentDigits(value);
  const type = resolveBrazilDocumentType(normalized);
  if (!type) return null;
  if (!isValidBrazilDocument(normalized)) return null;

  return {
    normalized,
    type,
  };
}

function normalizeCardToken(value: unknown) {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (token.length < 8 || token.length > 300) return null;
  return token;
}

function normalizePaymentMethodId(value: unknown) {
  if (typeof value !== "string") return null;
  const methodId = value.trim().toLowerCase();
  if (!/^[a-z0-9_]{2,32}$/.test(methodId)) return null;
  return methodId;
}

function normalizeIssuerId(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const issuerId = String(value).trim();
  if (!issuerId) return null;
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(issuerId)) return null;
  return issuerId;
}

function normalizeDeviceSessionId(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return null;
  const sessionId = value.trim();
  if (!sessionId) return null;
  if (!/^[a-zA-Z0-9:_-]{8,200}$/.test(sessionId)) return null;
  return sessionId;
}

function normalizePayerEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function isRepeatedDigits(value: string) {
  return /^(\d)\1+$/.test(value);
}

function isBlockedDigitPattern(value: string) {
  return BLOCKED_CARD_DIGITS.has(value);
}

function isExpiryOutOfRange(expMonth: number | null, expYear: number | null) {
  if (expMonth === null || expYear === null) return false;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  if (expYear < currentYear) return true;
  if (expYear > currentYear + 20) return true;
  if (expYear === currentYear && expMonth < currentMonth) return true;

  return false;
}

function normalizeProviderId(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeProviderCardDigits(value: unknown, length: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const text = String(Math.trunc(value));
    return new RegExp(`^\\d{${length}}$`).test(text) ? text : null;
  }

  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return new RegExp(`^\\d{${length}}$`).test(normalized) ? normalized : null;
}

function normalizeProviderSmallInt(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

function toApiMethod(method: StoredPaymentMethodRecord) {
  const normalized = toSavedMethodFromStoredRecord(method);
  if (!normalized) {
    throw new Error("Metodo salvo invalido para resposta.");
  }

  return normalized;
}

async function ensureGuildAccess(guildId: string): Promise<AccessContext> {
  const sessionData = await resolveSessionAccessToken();
  if (!sessionData?.authSession) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, message: "Nao autenticado." },
        { status: 401 },
      ),
    };
  }

  if (!sessionData.accessToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, message: "Token OAuth ausente na sessao." },
        { status: 401 },
      ),
    };
  }

  if (sessionData.authSession.activeGuildId === guildId) {
    return {
      ok: true,
      context: {
        userId: sessionData.authSession.user.id,
        sessionId: sessionData.authSession.id,
        userEmail: sessionData.authSession.user.email || null,
        discordUserId: sessionData.authSession.user.discord_user_id,
      },
    };
  }

  let accessibleGuild = null;
  try {
    accessibleGuild = await assertUserAdminInGuildOrNull(
      {
        authSession: sessionData.authSession,
        accessToken: sessionData.accessToken,
      },
      guildId,
    );
  } catch {
    accessibleGuild = null;
  }

  if (!accessibleGuild && sessionData.authSession.activeGuildId !== guildId) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, message: "Servidor nao encontrado para este usuario." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    context: {
      userId: sessionData.authSession.user.id,
      sessionId: sessionData.authSession.id,
      userEmail: sessionData.authSession.user.email || null,
      discordUserId: sessionData.authSession.user.discord_user_id,
    },
  };
}

async function getLatestProviderCustomerIdForUser(userId: number) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_user_payment_methods")
    .select("provider_customer_id")
    .eq("user_id", userId)
    .not("provider_customer_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ provider_customer_id: string | null }>();

  if (result.error) {
    throw new Error(
      result.error.message ||
        "Falha ao localizar cliente salvo do Mercado Pago.",
    );
  }

  return normalizeProviderId(result.data?.provider_customer_id);
}

export async function POST(request: Request) {
  const baseRequestContext = createSecurityRequestContext(request);
  let auditContext = baseRequestContext;

  try {
    const securityResponse = ensureSameOriginJsonMutationRequest(request);
    if (securityResponse) {
      return attachRequestId(securityResponse, baseRequestContext.requestId);
    }

    let body: AddMethodBody = {};
    try {
      body = (await request.json()) as AddMethodBody;
    } catch {
      return attachRequestId(NextResponse.json(
        { ok: false, message: "Payload JSON invalido." },
        { status: 400 },
      ), baseRequestContext.requestId);
    }

    const guildId = normalizeGuildId(body.guildId);
    if (!guildId) {
      return attachRequestId(NextResponse.json(
        { ok: false, message: "Guild ID invalido." },
        { status: 400 },
      ), baseRequestContext.requestId);
    }

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) return attachRequestId(access.response, baseRequestContext.requestId);

    const lockedGuildLicense = await getLockedGuildLicenseByGuildId(guildId);
    if (lockedGuildLicense && lockedGuildLicense.userId !== access.context.userId) {
      return attachRequestId(
        NextResponse.json(
          {
            ok: false,
            message:
              "As funcoes financeiras deste servidor ficam disponiveis apenas para a conta responsavel pela licenca ativa.",
          },
          { status: 403 },
        ),
        baseRequestContext.requestId,
      );
    }

    auditContext = extendSecurityRequestContext(baseRequestContext, {
      sessionId: access.context.sessionId,
      userId: access.context.userId,
      guildId,
    });

    const rateLimit = await enforceRequestRateLimit({
      action: "payment_method_post",
      windowMs: 15 * 60 * 1000,
      maxAttempts: 10,
      context: auditContext,
    });
    if (!rateLimit.ok) {
      await logSecurityAuditEventSafe(auditContext, {
        action: "payment_method_post",
        outcome: "blocked",
        metadata: {
          reason: "rate_limit",
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
      });

      const response = NextResponse.json(
        {
          ok: false,
          message:
            "Muitas tentativas para validar/salvar cartao. Aguarde alguns instantes e tente novamente.",
        },
        { status: 429 },
      );
      response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
      return attachRequestId(response, baseRequestContext.requestId);
    }

    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_method_post",
      outcome: "started",
    });

    if (!areCardPaymentsEnabled()) {
      await logSecurityAuditEventSafe(auditContext, {
        action: "payment_method_post",
        outcome: "blocked",
        metadata: {
          reason: "card_payments_disabled",
        },
      });

      return attachRequestId(
        NextResponse.json(
          {
            ok: false,
            message: CARD_PAYMENTS_DISABLED_MESSAGE,
          },
          { status: 503 },
        ),
        baseRequestContext.requestId,
      );
    }

    const nickname = normalizePaymentMethodNickname(body.nickname);
    const payerName = normalizePayerName(body.payerName);
    const payerDocument = normalizePayerDocument(body.payerDocument);
    const cardToken = normalizeCardToken(body.cardToken);
    const paymentMethodId = normalizePaymentMethodId(body.paymentMethodId);
    const issuerId = normalizeIssuerId(body.issuerId);
    const deviceSessionId = normalizeDeviceSessionId(body.deviceSessionId);
    const normalized = normalizeStoredMethodShape({
      brand: typeof body.brand === "string" ? body.brand : null,
      firstSix: normalizeStringDigits(body.firstSix, 6),
      lastFour: normalizeStringDigits(body.lastFour, 4),
      expMonth: normalizeNullableInteger(body.expMonth),
      expYear: normalizeNullableInteger(body.expYear),
    });

    if (!normalized.firstSix || !normalized.lastFour) {
      return NextResponse.json(
        { ok: false, message: "Dados do cartao invalidos para salvar metodo." },
        { status: 400 },
      );
    }

    if (
      isRepeatedDigits(normalized.firstSix) ||
      isRepeatedDigits(normalized.lastFour) ||
      isBlockedDigitPattern(normalized.firstSix) ||
      isBlockedDigitPattern(normalized.lastFour)
    ) {
      return NextResponse.json(
        { ok: false, message: "Dados do cartao invalidos para salvar metodo." },
        { status: 400 },
      );
    }

    if (isExpiryOutOfRange(normalized.expMonth, normalized.expYear)) {
      return NextResponse.json(
        { ok: false, message: "Validade do cartao invalida para salvar metodo." },
        { status: 400 },
      );
    }

    const methodId = buildMethodIdFromStoredInput(normalized);
    if (!methodId || !isValidSavedMethodId(methodId)) {
      return NextResponse.json(
        { ok: false, message: "Metodo de pagamento invalido." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdminClientOrThrow();
    const existingMethodResult = await supabase
      .from("auth_user_payment_methods")
      .select(STORED_METHOD_SELECT_COLUMNS)
      .eq("user_id", access.context.userId)
      .eq("method_id", methodId)
      .maybeSingle<StoredPaymentMethodRecord>();

    if (existingMethodResult.error) {
      throw new Error(existingMethodResult.error.message);
    }

    const existingMethod = existingMethodResult.data || null;
    const isAlreadyVerified =
      existingMethod?.verification_status === "verified";
    if (!isAlreadyVerified) {
      const [activeCountResult, recentUpdatesResult] = await Promise.all([
        supabase
          .from("auth_user_payment_methods")
          .select("id", { count: "exact", head: true })
          .eq("user_id", access.context.userId)
          .eq("is_active", true),
        supabase
          .from("auth_user_payment_methods")
          .select("id", { count: "exact", head: true })
          .eq("user_id", access.context.userId)
          .gte(
            "updated_at",
            new Date(Date.now() - 60_000).toISOString(),
          ),
      ]);

      if (activeCountResult.error) {
        throw new Error(activeCountResult.error.message);
      }

      if (recentUpdatesResult.error) {
        throw new Error(recentUpdatesResult.error.message);
      }

      if ((activeCountResult.count || 0) >= 20) {
        return attachRequestId(NextResponse.json(
          {
            ok: false,
            message:
              "Limite de metodos atingido. Remova um metodo antigo antes de adicionar outro.",
          },
          { status: 409 },
        ), baseRequestContext.requestId);
      }

      if ((recentUpdatesResult.count || 0) >= 8) {
        return attachRequestId(NextResponse.json(
          {
            ok: false,
            message:
              "Muitas tentativas em pouco tempo. Aguarde alguns segundos e tente novamente.",
          },
          { status: 429 },
        ), baseRequestContext.requestId);
      }
    }

    if (isAlreadyVerified && existingMethod) {
      const upsertResult = await supabase
        .from("auth_user_payment_methods")
        .upsert(
          {
            user_id: access.context.userId,
            method_id: methodId,
            nickname: nickname || null,
            brand: normalized.brand,
            first_six: normalized.firstSix,
            last_four: normalized.lastFour,
            exp_month: normalized.expMonth,
            exp_year: normalized.expYear,
            verification_status: "verified",
            verification_status_detail:
              existingMethod.verification_status_detail || null,
            verification_amount: existingMethod.verification_amount ?? null,
            verification_provider_payment_id:
              existingMethod.verification_provider_payment_id ?? null,
            provider_customer_id:
              existingMethod.provider_customer_id ?? null,
            provider_card_id: existingMethod.provider_card_id ?? null,
            verified_at: existingMethod.verified_at || new Date().toISOString(),
            last_context_guild_id: guildId,
            is_active: true,
          },
          {
            onConflict: "user_id,method_id",
          },
        )
        .select(STORED_METHOD_SELECT_COLUMNS)
        .single<StoredPaymentMethodRecord>();

      if (upsertResult.error || !upsertResult.data) {
        throw new Error(
          upsertResult.error?.message || "Falha ao reativar metodo.",
        );
      }

      await supabase
        .from("auth_user_hidden_payment_methods")
        .delete()
        .eq("user_id", access.context.userId)
        .eq("method_id", methodId);

      await logSecurityAuditEventSafe(auditContext, {
        action: "payment_method_post",
        outcome: "succeeded",
        metadata: {
          methodId,
          alreadyVerified: true,
        },
      });

      return attachRequestId(NextResponse.json({
        ok: true,
        guildId,
        method: toApiMethod(upsertResult.data),
        alreadyVerified: true,
      }), baseRequestContext.requestId);
    }

    const payerEmail = normalizePayerEmail(access.context.userEmail);
    if (!payerName || !payerDocument || !cardToken || !paymentMethodId) {
      return attachRequestId(NextResponse.json(
        {
          ok: false,
          message:
            "Dados completos do cartao sao obrigatorios para validar e liberar o metodo.",
        },
        { status: 400 },
      ), baseRequestContext.requestId);
    }

    if (!payerEmail) {
      return attachRequestId(NextResponse.json(
        {
          ok: false,
          message:
            "Nao foi possivel identificar um e-mail valido da conta Discord para validar o cartao.",
        },
        { status: 400 },
      ), baseRequestContext.requestId);
    }

    const cardEnvironment = resolveMercadoPagoCardEnvironment();
    const customerIdempotencyKey = crypto.randomUUID();
    const cardVaultIdempotencyKey = crypto.randomUUID();
    let vaultCustomerRetryCount = 0;
    let vaultCardRetryCount = 0;

    try {
      let providerCustomerId =
        normalizeProviderId(existingMethod?.provider_customer_id) ||
        (await getLatestProviderCustomerIdForUser(access.context.userId));

      if (!providerCustomerId) {
        const existingCustomer = await searchMercadoPagoCustomerByEmail(
          payerEmail,
        );
        providerCustomerId = normalizeProviderId(existingCustomer?.id);
      }

      if (!providerCustomerId) {
        try {
          const createdCustomer = await runVaultOperationWithRetry({
            operation: async (attempt) => {
              vaultCustomerRetryCount = attempt - 1;
              return createMercadoPagoCustomer({
                email: payerEmail,
                firstName: payerName.split(/\s+/)[0] || "Cliente",
                lastName:
                  payerName.split(/\s+/).slice(1).join(" ") || undefined,
                idempotencyKey: customerIdempotencyKey,
              });
            },
            onRetry: async (attempt, error) => {
              await logSecurityAuditEventSafe(auditContext, {
                action: "payment_method_post",
                outcome: "blocked",
                metadata: {
                  methodId,
                  stage: "vault_customer_retry",
                  nextAttempt: attempt + 1,
                  message:
                    error instanceof Error
                      ? error.message
                      : "unknown_customer_retry_error",
                },
              });
            },
          });
          providerCustomerId = normalizeProviderId(createdCustomer.id);
        } catch (createCustomerError) {
          const fallbackCustomer = await searchMercadoPagoCustomerByEmail(
            payerEmail,
          );
          providerCustomerId = normalizeProviderId(fallbackCustomer?.id);

          if (!providerCustomerId) {
            throw createCustomerError;
          }
        }
      }

      if (!providerCustomerId) {
        throw new Error(
          "Nao foi possivel preparar o cofre seguro do cliente no Mercado Pago.",
        );
      }

      const vaultedCard = await runVaultOperationWithRetry({
        operation: async (attempt) => {
          vaultCardRetryCount = attempt - 1;
          return createMercadoPagoCustomerCard({
            customerId: providerCustomerId,
            token: cardToken,
            idempotencyKey: cardVaultIdempotencyKey,
          });
        },
        onRetry: async (attempt, error) => {
          await logSecurityAuditEventSafe(auditContext, {
            action: "payment_method_post",
            outcome: "blocked",
            metadata: {
              methodId,
              stage: "vault_card_retry",
              nextAttempt: attempt + 1,
              paymentMethodId,
              issuerId,
              cardEnvironment,
              deviceSessionIdPresent: Boolean(deviceSessionId),
              message:
                error instanceof Error
                  ? error.message
                  : "unknown_card_retry_error",
            },
          });
        },
      });

      const providerCardId = normalizeProviderId(vaultedCard.id);
      if (!providerCardId) {
        throw new Error(
          "O Mercado Pago nao retornou um identificador valido para o cartao salvo.",
        );
      }

      const vaultedBrand =
        typeof vaultedCard.payment_method?.id === "string"
          ? vaultedCard.payment_method.id
          : normalized.brand;
      const vaultedFirstSix =
        normalizeProviderCardDigits(vaultedCard.first_six_digits, 6) ||
        normalized.firstSix;
      const vaultedLastFour =
        normalizeProviderCardDigits(vaultedCard.last_four_digits, 4) ||
        normalized.lastFour;
      const vaultedExpMonth =
        normalizeProviderSmallInt(vaultedCard.expiration_month) ??
        normalized.expMonth;
      const vaultedExpYear =
        normalizeProviderSmallInt(vaultedCard.expiration_year) ??
        normalized.expYear;
      const verifiedAt = new Date().toISOString();

      const upsertResult = await supabase
        .from("auth_user_payment_methods")
        .upsert(
          {
            user_id: access.context.userId,
            method_id: methodId,
            nickname: nickname || null,
            brand: vaultedBrand,
            first_six: vaultedFirstSix,
            last_four: vaultedLastFour,
            exp_month: vaultedExpMonth,
            exp_year: vaultedExpYear,
            verification_status: "verified",
            verification_status_detail: "saved_card_vault",
            verification_amount: null,
            verification_provider_payment_id: null,
            provider_customer_id: providerCustomerId,
            provider_card_id: providerCardId,
            verified_at: verifiedAt,
            last_context_guild_id: guildId,
            is_active: true,
          },
          {
            onConflict: "user_id,method_id",
          },
        )
        .select(STORED_METHOD_SELECT_COLUMNS)
        .single<StoredPaymentMethodRecord>();

      if (upsertResult.error || !upsertResult.data) {
        throw new Error(
          upsertResult.error?.message ||
            "Falha ao salvar o cartao no metodo seguro.",
        );
      }

      await supabase
        .from("auth_user_hidden_payment_methods")
        .delete()
        .eq("user_id", access.context.userId)
        .eq("method_id", methodId);

      await logSecurityAuditEventSafe(auditContext, {
        action: "payment_method_post",
        outcome: "succeeded",
        metadata: {
          methodId,
          providerCustomerId,
          providerCardId,
          cardEnvironment,
          flow: "vault_saved_card",
          vaultCustomerRetryCount,
          vaultCardRetryCount,
          paymentMethodId,
          issuerId,
          deviceSessionIdPresent: Boolean(deviceSessionId),
        },
      });

      return attachRequestId(
        NextResponse.json({
          ok: true,
          guildId,
          method: toApiMethod(upsertResult.data),
          vaulted: true,
        }),
        baseRequestContext.requestId,
      );
    } catch (providerError) {
      const message =
        providerError instanceof Error
          ? providerError.message
          : "Falha ao salvar o cartao no cofre seguro.";
      const normalizedMessage = message.toLowerCase();
      const retryAfterSeconds =
        normalizedMessage.includes("cc_rejected_high_risk") ||
        normalizedMessage.includes("high_risk")
          ? Math.ceil(HIGH_RISK_RETRY_COOLDOWN_MS / 1000)
          : null;
      const responseStatus =
        retryAfterSeconds && retryAfterSeconds > 0
          ? 429
          : normalizedMessage.includes("mercado pago:") ||
              normalizedMessage.includes("cartao") ||
              normalizedMessage.includes("card") ||
              normalizedMessage.includes("customer") ||
              normalizedMessage.includes("token") ||
              normalizedMessage.includes("documento") ||
              normalizedMessage.includes("cpf/cnpj")
            ? 400
            : 502;

      const safeProviderMessage =
        normalizedMessage.includes("cc_rejected_high_risk") ||
        normalizedMessage.includes("high_risk")
          ? "O Mercado Pago marcou esta tentativa de salvar cartao como risco elevado. Aguarde alguns minutos e tente novamente no mesmo dispositivo."
          : message;

      await logSecurityAuditEventSafe(auditContext, {
        action: "payment_method_post",
        outcome: "failed",
        metadata: {
          methodId,
          stage: "vault_error",
          message,
          normalizedMessage: safeProviderMessage,
          retryAfterSeconds,
          cardEnvironment,
          vaultCustomerRetryCount,
          vaultCardRetryCount,
          paymentMethodId,
          issuerId,
          deviceSessionIdPresent: Boolean(deviceSessionId),
        },
      });

      const response = NextResponse.json(
        {
          ok: false,
          retryAfterSeconds,
          message: safeProviderMessage,
        },
        { status: responseStatus },
      );

      if (retryAfterSeconds && retryAfterSeconds > 0) {
        response.headers.set("Retry-After", String(retryAfterSeconds));
      }

      return attachRequestId(response, baseRequestContext.requestId);
    }

  } catch (error) {
    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_method_post",
      outcome: "failed",
      metadata: {
        message: error instanceof Error ? error.message : "unknown_error",
      },
    });

    return attachRequestId(NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao adicionar metodo de pagamento.",
      },
      { status: 500 },
    ), baseRequestContext.requestId);
  }
}

export async function PATCH(request: Request) {
  const baseRequestContext = createSecurityRequestContext(request);
  let auditContext = baseRequestContext;

  try {
    const securityResponse = ensureSameOriginJsonMutationRequest(request);
    if (securityResponse) return attachRequestId(securityResponse, baseRequestContext.requestId);

    let body: UpdateMethodBody = {};
    try {
      body = (await request.json()) as UpdateMethodBody;
    } catch {
      return attachRequestId(NextResponse.json(
        { ok: false, message: "Payload JSON invalido." },
        { status: 400 },
      ), baseRequestContext.requestId);
    }

    const guildId = normalizeGuildId(body.guildId);
    const methodId = normalizeMethodId(body.methodId);
    if (!guildId) {
      return attachRequestId(NextResponse.json(
        { ok: false, message: "Guild ID invalido." },
        { status: 400 },
      ), baseRequestContext.requestId);
    }
    if (!methodId) {
      return attachRequestId(NextResponse.json(
        { ok: false, message: "Metodo de pagamento invalido." },
        { status: 400 },
      ), baseRequestContext.requestId);
    }

    if (body.nickname !== undefined) {
      const isValidNickname =
        normalizePaymentMethodNickname(body.nickname) !== null ||
        body.nickname === "" ||
        body.nickname === null;
      if (!isValidNickname) {
        return attachRequestId(NextResponse.json(
          { ok: false, message: "Apelido do cartao invalido." },
          { status: 400 },
        ), baseRequestContext.requestId);
      }
    }

    const nickname = normalizePaymentMethodNickname(body.nickname);
    const access = await ensureGuildAccess(guildId);
    if (!access.ok) return attachRequestId(access.response, baseRequestContext.requestId);

    const lockedGuildLicense = await getLockedGuildLicenseByGuildId(guildId);
    if (lockedGuildLicense && lockedGuildLicense.userId !== access.context.userId) {
      return attachRequestId(
        NextResponse.json(
          {
            ok: false,
            message:
              "As funcoes financeiras deste servidor ficam disponiveis apenas para a conta responsavel pela licenca ativa.",
          },
          { status: 403 },
        ),
        baseRequestContext.requestId,
      );
    }

    auditContext = extendSecurityRequestContext(baseRequestContext, {
      sessionId: access.context.sessionId,
      userId: access.context.userId,
      guildId,
    });
    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_method_patch",
      outcome: "started",
    });

    const parsed = parseSavedMethodId(methodId);
    if (!parsed || !parsed.firstSix || !parsed.lastFour) {
      return attachRequestId(NextResponse.json(
        { ok: false, message: "Metodo de pagamento invalido para apelido." },
        { status: 400 },
      ), baseRequestContext.requestId);
    }

    if (
      isRepeatedDigits(parsed.firstSix) ||
      isRepeatedDigits(parsed.lastFour) ||
      isBlockedDigitPattern(parsed.firstSix) ||
      isBlockedDigitPattern(parsed.lastFour)
    ) {
      return attachRequestId(NextResponse.json(
        { ok: false, message: "Metodo de pagamento invalido para apelido." },
        { status: 400 },
      ), baseRequestContext.requestId);
    }

    const supabase = getSupabaseAdminClientOrThrow();
    const existingMethodResult = await supabase
      .from("auth_user_payment_methods")
      .select(STORED_METHOD_SELECT_COLUMNS)
      .eq("user_id", access.context.userId)
      .eq("method_id", methodId)
      .maybeSingle<StoredPaymentMethodRecord>();

    if (existingMethodResult.error) {
      throw new Error(existingMethodResult.error.message);
    }

    if (!existingMethodResult.data) {
      return attachRequestId(NextResponse.json(
        { ok: false, message: "Metodo de pagamento nao encontrado." },
        { status: 404 },
      ), baseRequestContext.requestId);
    }

    const updateResult = await supabase
      .from("auth_user_payment_methods")
      .update(
        {
          nickname: nickname || null,
          is_active: true,
          last_context_guild_id: guildId,
        },
      )
      .eq("user_id", access.context.userId)
      .eq("method_id", methodId)
      .select(STORED_METHOD_SELECT_COLUMNS)
      .single<StoredPaymentMethodRecord>();

    if (updateResult.error || !updateResult.data) {
      throw new Error(updateResult.error?.message || "Falha ao salvar apelido.");
    }

    await supabase
      .from("auth_user_hidden_payment_methods")
      .delete()
      .eq("user_id", access.context.userId)
      .eq("method_id", methodId);

    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_method_patch",
      outcome: "succeeded",
      metadata: {
        methodId,
      },
    });

    return attachRequestId(NextResponse.json({
      ok: true,
      guildId,
      method: toApiMethod(updateResult.data),
    }), baseRequestContext.requestId);
  } catch (error) {
    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_method_patch",
      outcome: "failed",
      metadata: {
        message: error instanceof Error ? error.message : "unknown_error",
      },
    });

    return attachRequestId(NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao atualizar apelido do metodo.",
      },
      { status: 500 },
    ), baseRequestContext.requestId);
  }
}

export async function DELETE(request: Request) {
  const baseRequestContext = createSecurityRequestContext(request);
  let auditContext = baseRequestContext;

  try {
    const securityResponse = ensureSameOriginJsonMutationRequest(request);
    if (securityResponse) return attachRequestId(securityResponse, baseRequestContext.requestId);

    let body: DeleteMethodBody = {};
    try {
      body = (await request.json()) as DeleteMethodBody;
    } catch {
      return attachRequestId(NextResponse.json(
        { ok: false, message: "Payload JSON invalido." },
        { status: 400 },
      ), baseRequestContext.requestId);
    }

    const guildId = normalizeGuildId(body.guildId);
    const methodId = normalizeMethodId(body.methodId);

    if (!guildId) {
      return attachRequestId(NextResponse.json(
        { ok: false, message: "Guild ID invalido." },
        { status: 400 },
      ), baseRequestContext.requestId);
    }

    if (!methodId) {
      return attachRequestId(NextResponse.json(
        { ok: false, message: "Metodo de pagamento invalido." },
        { status: 400 },
      ), baseRequestContext.requestId);
    }

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) return attachRequestId(access.response, baseRequestContext.requestId);

    const lockedGuildLicense = await getLockedGuildLicenseByGuildId(guildId);
    if (lockedGuildLicense && lockedGuildLicense.userId !== access.context.userId) {
      return attachRequestId(
        NextResponse.json(
          {
            ok: false,
            message:
              "As funcoes financeiras deste servidor ficam disponiveis apenas para a conta responsavel pela licenca ativa.",
          },
          { status: 403 },
        ),
        baseRequestContext.requestId,
      );
    }

    auditContext = extendSecurityRequestContext(baseRequestContext, {
      sessionId: access.context.sessionId,
      userId: access.context.userId,
      guildId,
    });
    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_method_delete",
      outcome: "started",
      metadata: {
        methodId,
      },
    });

    const userId = access.context.userId;
    const supabase = getSupabaseAdminClientOrThrow();
    const existingMethodResult = await supabase
      .from("auth_user_payment_methods")
      .select(STORED_METHOD_SELECT_COLUMNS)
      .eq("user_id", userId)
      .eq("method_id", methodId)
      .maybeSingle<StoredPaymentMethodRecord>();

    if (existingMethodResult.error) {
      throw new Error(existingMethodResult.error.message);
    }

    const existingMethod = existingMethodResult.data || null;
    if (!existingMethod) {
      return attachRequestId(NextResponse.json(
        { ok: false, message: "Metodo de pagamento nao encontrado." },
        { status: 404 },
      ), baseRequestContext.requestId);
    }

    const planSettingsResult = await supabase
      .from("guild_plan_settings")
      .select("recurring_enabled, recurring_method_id")
      .eq("user_id", userId)
      .eq("recurring_enabled", true)
      .eq("recurring_method_id", methodId)
      .limit(1)
      .maybeSingle<GuildPlanSettingsRecord>();

    if (planSettingsResult.error) {
      throw new Error(planSettingsResult.error.message);
    }

    const planSettings = planSettingsResult.data || null;
    if (
      planSettings?.recurring_enabled &&
      planSettings.recurring_method_id === methodId
    ) {
      return attachRequestId(NextResponse.json(
        {
          ok: false,
          message:
            "Nao e possivel remover este cartao enquanto existir cobranca recorrente ativa vinculada a ele.",
        },
        { status: 409 },
      ), baseRequestContext.requestId);
    }

    const [hideResult, softDeleteResult] = await Promise.all([
      supabase
        .from("auth_user_hidden_payment_methods")
        .upsert(
          {
            user_id: userId,
            method_id: methodId,
            deleted_at: new Date().toISOString(),
          },
          {
            onConflict: "user_id,method_id",
          },
        )
        .select("id")
        .single<{ id: number }>(),
      supabase
        .from("auth_user_payment_methods")
        .update({ is_active: false })
        .eq("user_id", userId)
        .eq("method_id", methodId),
    ]);

    if (hideResult.error || !hideResult.data) {
      throw new Error(hideResult.error?.message || "Falha ao remover metodo.");
    }
    if (softDeleteResult.error) {
      throw new Error(softDeleteResult.error.message);
    }

    const providerCustomerId = normalizeProviderId(
      existingMethod.provider_customer_id,
    );
    const providerCardId = normalizeProviderId(existingMethod.provider_card_id);

    if (providerCustomerId && providerCardId) {
      try {
        await deleteMercadoPagoCustomerCard({
          customerId: providerCustomerId,
          cardId: providerCardId,
        });
      } catch (providerDeleteError) {
        await logSecurityAuditEventSafe(auditContext, {
          action: "payment_method_delete",
          outcome: "failed",
          metadata: {
            methodId,
            stage: "provider_card_delete",
            message:
              providerDeleteError instanceof Error
                ? providerDeleteError.message
                : "unknown_provider_delete_error",
          },
        });
      }
    }

    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_method_delete",
      outcome: "succeeded",
      metadata: {
        methodId,
      },
    });

    return attachRequestId(NextResponse.json({
      ok: true,
      guildId,
      methodId,
    }), baseRequestContext.requestId);
  } catch (error) {
    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_method_delete",
      outcome: "failed",
      metadata: {
        message: error instanceof Error ? error.message : "unknown_error",
      },
    });

    return attachRequestId(NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao remover metodo de pagamento.",
      },
      { status: 500 },
    ), baseRequestContext.requestId);
  }
}
