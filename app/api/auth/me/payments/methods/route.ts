import crypto from "node:crypto";
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
  cancelMercadoPagoCardPayment,
  createMercadoPagoCardPayment,
  fetchMercadoPagoPaymentById,
  refundMercadoPagoCardPayment,
  resolveMercadoPagoCardEnvironment,
} from "@/lib/payments/mercadoPago";
import { isValidSavedMethodId, parseSavedMethodId } from "@/lib/payments/savedMethods";
import {
  buildMethodIdFromStoredInput,
  normalizePaymentMethodNickname,
  normalizeStoredMethodShape,
  toSavedMethodFromStoredRecord,
  type StoredPaymentMethodRecord,
} from "@/lib/payments/userPaymentMethods";
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

type PaymentMethodVerificationRecord = {
  id: number;
  status: string;
  provider_payment_id: string | null;
  provider_status: string | null;
  provider_status_detail: string | null;
  verified_at: string | null;
  refunded_at: string | null;
};

type LatestVerificationGuardRecord = {
  id: number;
  status: string;
  provider_status: string | null;
  provider_status_detail: string | null;
  created_at: string;
  updated_at: string;
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

const STORED_METHOD_SELECT_COLUMNS =
  "method_id, nickname, brand, first_six, last_four, exp_month, exp_year, is_active, verification_status, verification_status_detail, verification_amount, verification_provider_payment_id, verified_at, last_context_guild_id, created_at, updated_at";

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

function resolveVerificationAmount() {
  const cents = crypto.randomInt(1, 100);
  return Math.round((1 + cents / 100) * 100) / 100;
}

function toApiMethod(method: StoredPaymentMethodRecord) {
  const normalized = toSavedMethodFromStoredRecord(method);
  if (!normalized) {
    throw new Error("Metodo salvo invalido para resposta.");
  }

  return normalized;
}

function shouldCancelAuthorizedVerification(status: string | null | undefined) {
  const normalized = (status || "").trim().toLowerCase();
  return (
    normalized === "authorized" ||
    normalized === "in_process" ||
    normalized === "pending"
  );
}

function shouldRefundCapturedVerification(status: string | null | undefined) {
  const normalized = (status || "").trim().toLowerCase();
  return normalized === "approved";
}

function isVerificationApproved(status: string | null | undefined) {
  const normalized = (status || "").trim().toLowerCase();
  return normalized === "authorized" || normalized === "approved";
}

function isHighRiskStatusDetail(value: string | null | undefined) {
  const normalized = (value || "").trim().toLowerCase();
  return (
    normalized.includes("cc_rejected_high_risk") ||
    normalized.includes("high_risk")
  );
}

function isDuplicatedPaymentStatusDetail(value: string | null | undefined) {
  const normalized = (value || "").trim().toLowerCase();
  return (
    normalized.includes("cc_rejected_duplicated_payment") ||
    normalized.includes("duplicated_payment") ||
    normalized.includes("duplicated")
  );
}

function resolveRetryAfterSecondsFromAttempt(
  attempt: LatestVerificationGuardRecord,
  cooldownMs: number,
) {
  const referenceMs =
    Date.parse(attempt.updated_at) ||
    Date.parse(attempt.created_at) ||
    Date.now();

  if (!Number.isFinite(referenceMs)) return null;

  const remainingMs = cooldownMs - (Date.now() - referenceMs);
  if (remainingMs <= 0) return null;

  return Math.max(1, Math.ceil(remainingMs / 1000));
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

async function createVerificationAttempt(input: {
  userId: number;
  guildId: string;
  methodId: string;
  amount: number;
  currency: string;
  payerName: string;
  payerDocument: string;
  payerDocumentType: "CPF" | "CNPJ";
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_user_payment_method_verifications")
    .insert({
      user_id: input.userId,
      guild_id: input.guildId,
      method_id: input.methodId,
      amount: input.amount,
      currency: input.currency,
      payer_name: input.payerName,
      payer_document: input.payerDocument,
      payer_document_type: input.payerDocumentType,
      provider_payload: {
        source: "flowdesk_saved_method",
      },
    })
    .select(
      "id, status, provider_payment_id, provider_status, provider_status_detail, verified_at, refunded_at",
    )
    .single<PaymentMethodVerificationRecord>();

  if (result.error || !result.data) {
    throw new Error(
      result.error?.message ||
        "Falha ao iniciar validacao segura do cartao.",
    );
  }

  return result.data;
}

async function getLatestVerificationAttemptForGuard(input: {
  userId: number;
  guildId: string;
  methodId: string;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_user_payment_method_verifications")
    .select("id, status, provider_status, provider_status_detail, created_at, updated_at")
    .eq("user_id", input.userId)
    .eq("guild_id", input.guildId)
    .eq("method_id", input.methodId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<LatestVerificationGuardRecord>();

  if (result.error) {
    throw new Error(
      result.error.message ||
        "Falha ao verificar tentativas recentes de validacao do cartao.",
    );
  }

  return result.data || null;
}

async function updateVerificationAttempt(
  verificationId: number,
  input: {
    status: "pending" | "verified" | "failed" | "cancelled";
    providerPaymentId?: string | null;
    providerExternalReference?: string | null;
    providerStatus?: string | null;
    providerStatusDetail?: string | null;
    providerPayload?: Record<string, unknown>;
    verifiedAt?: string | null;
    refundedAt?: string | null;
  },
) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_user_payment_method_verifications")
    .update({
      status: input.status,
      provider_payment_id: input.providerPaymentId ?? null,
      provider_external_reference: input.providerExternalReference ?? null,
      provider_status: input.providerStatus ?? null,
      provider_status_detail: input.providerStatusDetail ?? null,
      provider_payload: input.providerPayload || {},
      verified_at: input.verifiedAt ?? null,
      refunded_at: input.refundedAt ?? null,
    })
    .eq("id", verificationId);

  if (result.error) {
    throw new Error(result.error.message);
  }
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
    if (cardEnvironment === "production" && !deviceSessionId) {
      return attachRequestId(NextResponse.json(
        {
          ok: false,
          message:
            "Nao foi possivel concluir a identificacao segura do dispositivo. Aguarde alguns segundos e tente novamente.",
        },
        { status: 400 },
      ), baseRequestContext.requestId);
    }

    const latestVerificationAttempt = await getLatestVerificationAttemptForGuard({
      userId: access.context.userId,
      guildId,
      methodId,
    });

    if (
      latestVerificationAttempt &&
      latestVerificationAttempt.status === "failed" &&
      (isHighRiskStatusDetail(latestVerificationAttempt.provider_status_detail) ||
        isDuplicatedPaymentStatusDetail(
          latestVerificationAttempt.provider_status_detail,
        ))
    ) {
      const retryAfterSeconds = resolveRetryAfterSecondsFromAttempt(
        latestVerificationAttempt,
        HIGH_RISK_RETRY_COOLDOWN_MS,
      );

      if (retryAfterSeconds) {
        await logSecurityAuditEventSafe(auditContext, {
          action: "payment_method_post",
          outcome: "blocked",
          metadata: {
            methodId,
            reason: "provider_high_risk_cooldown",
            retryAfterSeconds,
            providerStatus: latestVerificationAttempt.provider_status,
            providerStatusDetail:
              latestVerificationAttempt.provider_status_detail,
          },
        });

        const response = NextResponse.json(
          {
            ok: false,
            retryAfterSeconds,
            message:
              "O provedor marcou a ultima tentativa como sensivel ao antifraude. Aguarde alguns minutos antes de tentar novamente com este cartao, no mesmo dispositivo.",
          },
          { status: 429 },
        );
        response.headers.set("Retry-After", String(retryAfterSeconds));
        return attachRequestId(response, baseRequestContext.requestId);
      }
    }

    const verificationAmount = resolveVerificationAmount();
    const verificationCurrency = "BRL";
    const verificationAttempt = await createVerificationAttempt({
      userId: access.context.userId,
      guildId,
      methodId,
      amount: verificationAmount,
      currency: verificationCurrency,
      payerName,
      payerDocument: payerDocument.normalized,
      payerDocumentType: payerDocument.type,
    });

    const externalReference = `flowdesk-method-verify-${verificationAttempt.id}`;

    let verificationPayload: Record<string, unknown> = {
      source: "flowdesk_saved_method",
      verificationId: verificationAttempt.id,
      methodId,
      guildId,
      payerDocumentType: payerDocument.type,
      deviceSessionIdPresent: Boolean(deviceSessionId),
    };

    try {
      const initialPayment = await createMercadoPagoCardPayment({
        amount: verificationAmount,
        description: `Flowdesk validacao segura ${verificationAttempt.id}`,
        payerName,
        payerEmail,
        payerIdentification: {
          type: payerDocument.type,
          number: payerDocument.normalized,
        },
        externalReference,
        metadata: {
          flowdesk_verification_id: String(verificationAttempt.id),
          flowdesk_user_id: String(access.context.userId),
          flowdesk_discord_user_id: access.context.discordUserId,
          flowdesk_guild_id: guildId,
          flowdesk_method_id: methodId,
          flowdesk_flow: "saved_method_validation",
          flowdesk_verification_amount: String(verificationAmount.toFixed(2)),
        },
        token: cardToken,
        paymentMethodId,
        installments: 1,
        issuerId,
        deviceSessionId,
        idempotencyKey: `flowdesk-method-verify-${verificationAttempt.id}`,
        capture: false,
      });

      const providerPaymentId = String(initialPayment.id);
      let providerPayment = initialPayment;

      try {
        const snapshot = await fetchMercadoPagoPaymentById(providerPaymentId, {
          useCardToken: true,
        });
        if (snapshot && typeof snapshot === "object") {
          providerPayment = snapshot;
        }
      } catch {
        // manter retorno inicial quando o snapshot ainda nao estiver disponivel
      }

      const providerStatus = providerPayment.status || initialPayment.status || null;
      const providerStatusDetail =
        providerPayment.status_detail || initialPayment.status_detail || null;

      verificationPayload = {
        ...verificationPayload,
        externalReference,
        initialPayment,
        providerPayment,
      };

      if (!isVerificationApproved(providerStatus)) {
        await updateVerificationAttempt(verificationAttempt.id, {
          status: "failed",
          providerPaymentId,
          providerExternalReference: externalReference,
          providerStatus,
          providerStatusDetail,
          providerPayload: verificationPayload,
        });

        await logSecurityAuditEventSafe(auditContext, {
          action: "payment_method_post",
          outcome: "failed",
          metadata: {
            methodId,
            stage: "provider_verification",
            providerStatus,
            providerStatusDetail,
          },
        });

        const retryAfterSeconds =
          isHighRiskStatusDetail(providerStatusDetail) ||
          isDuplicatedPaymentStatusDetail(providerStatusDetail)
            ? Math.ceil(HIGH_RISK_RETRY_COOLDOWN_MS / 1000)
            : null;

        const safeProviderMessage = isHighRiskStatusDetail(providerStatusDetail)
          ? "O Mercado Pago sinalizou esta tentativa como risco elevado. Aguarde alguns minutos antes de tentar novamente com o mesmo cartao e no mesmo dispositivo."
          : isDuplicatedPaymentStatusDetail(providerStatusDetail)
            ? "O provedor identificou tentativas muito parecidas em sequencia. Aguarde alguns minutos antes de repetir a validacao deste cartao."
            : providerStatusDetail ||
              "O cartao nao conseguiu concluir a validacao de seguranca.";

        const response = NextResponse.json(
          {
            ok: false,
            retryAfterSeconds,
            message: safeProviderMessage,
          },
          {
            status:
              retryAfterSeconds && retryAfterSeconds > 0 ? 429 : 402,
          },
        );

        if (retryAfterSeconds && retryAfterSeconds > 0) {
          response.headers.set("Retry-After", String(retryAfterSeconds));
        }

        return attachRequestId(response, baseRequestContext.requestId);
      }

      let reversalPayload: unknown = null;
      if (shouldRefundCapturedVerification(providerStatus)) {
        reversalPayload = await refundMercadoPagoCardPayment(providerPaymentId);
      } else if (shouldCancelAuthorizedVerification(providerStatus)) {
        reversalPayload = await cancelMercadoPagoCardPayment(providerPaymentId);
      }

      const verifiedAt = new Date().toISOString();
      verificationPayload = {
        ...verificationPayload,
        reversalPayload,
      };

      await updateVerificationAttempt(verificationAttempt.id, {
        status: "verified",
        providerPaymentId,
        providerExternalReference: externalReference,
        providerStatus,
        providerStatusDetail,
        providerPayload: verificationPayload,
        verifiedAt,
        refundedAt: verifiedAt,
      });

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
            verification_status_detail: providerStatusDetail,
            verification_amount: verificationAmount,
            verification_provider_payment_id: providerPaymentId,
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
        throw new Error(upsertResult.error?.message || "Falha ao salvar metodo.");
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
          verificationAmount,
          verificationCurrency,
        },
      });

      return attachRequestId(NextResponse.json({
        ok: true,
        guildId,
        method: toApiMethod(upsertResult.data),
        verification: {
          amount: verificationAmount,
          currency: verificationCurrency,
        },
      }), baseRequestContext.requestId);
    } catch (providerError) {
      const message =
        providerError instanceof Error
          ? providerError.message
          : "Falha ao validar o cartao com seguranca.";
      const normalizedMessage = message.toLowerCase();
      const retryAfterSeconds =
        normalizedMessage.includes("cc_rejected_high_risk") ||
        normalizedMessage.includes("high_risk") ||
        normalizedMessage.includes("duplicated_payment")
          ? Math.ceil(HIGH_RISK_RETRY_COOLDOWN_MS / 1000)
          : null;
      const responseStatus =
        retryAfterSeconds && retryAfterSeconds > 0
          ? 429
          : normalizedMessage.includes("mercado pago:") ||
              normalizedMessage.includes("cartao") ||
              normalizedMessage.includes("card") ||
              normalizedMessage.includes("identification") ||
              normalizedMessage.includes("documento") ||
              normalizedMessage.includes("cpf/cnpj")
            ? 400
            : 502;

      const safeProviderMessage =
        normalizedMessage.includes("cc_rejected_high_risk") ||
        normalizedMessage.includes("high_risk")
          ? "O Mercado Pago marcou esta validacao como risco elevado. Aguarde alguns minutos e tente novamente com o mesmo dispositivo."
          : normalizedMessage.includes("duplicated_payment")
            ? "O provedor identificou repeticao de tentativa. Aguarde alguns minutos antes de validar este cartao novamente."
            : message;

      await updateVerificationAttempt(verificationAttempt.id, {
        status: "failed",
        providerStatus: "error",
        providerStatusDetail: safeProviderMessage,
        providerPayload: {
          ...verificationPayload,
          error: message,
          normalizedError: safeProviderMessage,
          retryAfterSeconds,
        },
      });

      await logSecurityAuditEventSafe(auditContext, {
        action: "payment_method_post",
        outcome: "failed",
        metadata: {
          methodId,
          stage: "provider_error",
          message,
          normalizedMessage: safeProviderMessage,
          retryAfterSeconds,
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
