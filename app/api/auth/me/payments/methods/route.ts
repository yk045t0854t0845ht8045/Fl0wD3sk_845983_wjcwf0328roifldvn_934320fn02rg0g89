import { NextResponse } from "next/server";
import {
  isValidBrazilDocument,
  normalizeBrazilDocumentDigits,
  resolveBrazilDocumentType,
} from "@/lib/payments/brazilDocument";
import {
  createMercadoPagoCustomer,
  createMercadoPagoCustomerCard,
  deleteMercadoPagoCustomerCard,
  searchMercadoPagoCustomerByEmail,
} from "@/lib/payments/mercadoPago";
import { createStablePaymentIdempotencyKey } from "@/lib/payments/paymentIntegrity";
import { isValidSavedMethodId } from "@/lib/payments/savedMethods";
import {
  buildMethodIdFromStoredInput,
  normalizePaymentMethodNickname,
  toSavedMethodFromStoredRecord,
  type StoredPaymentMethodRecord,
} from "@/lib/payments/userPaymentMethods";
import {
  resolveDatabaseFailureMessage,
  resolveDatabaseFailureStatus,
} from "@/lib/security/databaseAvailability";
import { sanitizeErrorMessage } from "@/lib/security/errors";
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
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { ensureGuildAccess, normalizeGuildId } from "../pix/route";

type CreatePaymentMethodBody = {
  guildId?: unknown;
  brand?: unknown;
  firstSix?: unknown;
  lastFour?: unknown;
  expMonth?: unknown;
  expYear?: unknown;
  nickname?: unknown;
  payerName?: unknown;
  payerDocument?: unknown;
  cardToken?: unknown;
  paymentMethodId?: unknown;
  issuerId?: unknown;
  deviceSessionId?: unknown;
};

type UpdatePaymentMethodBody = {
  guildId?: unknown;
  methodId?: unknown;
  nickname?: unknown;
};

type DeletePaymentMethodBody = {
  guildId?: unknown;
  methodId?: unknown;
};

const METHOD_SELECT_COLUMNS =
  "method_id, nickname, brand, first_six, last_four, exp_month, exp_year, is_active, verification_status, verification_status_detail, verification_amount, verification_provider_payment_id, provider_customer_id, provider_card_id, verified_at, last_context_guild_id, created_at, updated_at";

function normalizeNumericText(value: unknown, digits: number) {
  if (typeof value === "number" && Number.isInteger(value)) {
    const text = String(value);
    return new RegExp(`^\\d{${digits}}$`).test(text) ? text : null;
  }

  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return new RegExp(`^\\d{${digits}}$`).test(normalized) ? normalized : null;
}

function normalizeNullableToken(value: unknown, maxLength = 200) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

function normalizeMonth(value: unknown) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 12 ? numeric : null;
}

function normalizeYear(value: unknown) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(numeric) && numeric >= 2000 && numeric <= 9999 ? numeric : null;
}

function normalizePayerName(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  if (normalized.length < 3 || normalized.length > 120) return null;
  return normalized;
}

function normalizePayerDocument(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = normalizeBrazilDocumentDigits(value);
  const type = resolveBrazilDocumentType(normalized);
  if (!type || !isValidBrazilDocument(normalized)) {
    return null;
  }

  return {
    normalized,
    type,
  };
}

function splitPayerName(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  const [firstName = "Cliente", ...rest] = normalized.split(" ");
  return {
    firstName,
    lastName: rest.join(" ") || null,
  };
}

function toApiMethod(row: StoredPaymentMethodRecord) {
  const method = toSavedMethodFromStoredRecord(row);
  if (!method) {
    throw new Error("Metodo salvo retornou formato invalido.");
  }
  return method;
}

async function findStoredMethodForUser(userId: number, methodId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_user_payment_methods")
    .select(METHOD_SELECT_COLUMNS)
    .eq("user_id", userId)
    .eq("method_id", methodId)
    .maybeSingle<StoredPaymentMethodRecord>();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data || null;
}

export async function POST(request: Request) {
  const baseRequestContext = createSecurityRequestContext(request);
  let auditContext = baseRequestContext;
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

    let body: CreatePaymentMethodBody = {};
    try {
      body = (await request.json()) as CreatePaymentMethodBody;
    } catch {
      return respond(
        { ok: false, message: "Payload JSON invalido." },
        { status: 400 },
      );
    }

    const guildId = normalizeGuildId(body.guildId);
    const access = await ensureGuildAccess(guildId);
    if (!access.ok) {
      return attachRequestId(
        applyNoStoreHeaders(access.response),
        baseRequestContext.requestId,
      );
    }

    auditContext = extendSecurityRequestContext(baseRequestContext, {
      sessionId: access.context.sessionData.authSession.id,
      userId: access.context.sessionData.authSession.user.id,
      guildId,
    });

    const rateLimit = await enforceRequestRateLimit({
      action: "payment_method_post",
      windowMs: 15 * 60 * 1000,
      maxAttempts: 6,
      context: auditContext,
    });

    if (!rateLimit.ok) {
      const response = respond(
        {
          ok: false,
          retryAfterSeconds: rateLimit.retryAfterSeconds,
          message:
            "Muitas tentativas de cadastrar cartao em pouco tempo. Aguarde alguns minutos.",
        },
        { status: 429 },
      );
      response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
      return response;
    }

    const payerName = normalizePayerName(body.payerName);
    const payerDocument = normalizePayerDocument(body.payerDocument);
    const brand = normalizeNullableToken(body.brand, 32)?.toLowerCase() || null;
    const firstSix = normalizeNumericText(body.firstSix, 6);
    const lastFour = normalizeNumericText(body.lastFour, 4);
    const expMonth = normalizeMonth(body.expMonth);
    const expYear = normalizeYear(body.expYear);
    const nickname = normalizePaymentMethodNickname(body.nickname);
    const cardToken = normalizeNullableToken(body.cardToken, 256);
    const paymentMethodId =
      normalizeNullableToken(body.paymentMethodId, 64)?.toLowerCase() || null;

    if (!payerName || !payerDocument) {
      return respond(
        { ok: false, message: "Titular ou CPF/CNPJ invalido para o cartao." },
        { status: 400 },
      );
    }

    if (!firstSix || !lastFour || !expMonth || !expYear || !paymentMethodId || !cardToken) {
      return respond(
        { ok: false, message: "Dados tokenizados do cartao invalidos." },
        { status: 400 },
      );
    }

    const methodId = buildMethodIdFromStoredInput({
      brand: brand || paymentMethodId,
      firstSix,
      lastFour,
      expMonth,
      expYear,
    });

    if (!methodId) {
      return respond(
        { ok: false, message: "Nao foi possivel identificar o cartao informado." },
        { status: 400 },
      );
    }

    const user = access.context.sessionData.authSession.user;
    const userEmail =
      (typeof user.email_normalized === "string" && user.email_normalized.trim()) ||
      (typeof user.email === "string" && user.email.trim().toLowerCase()) ||
      null;

    if (!userEmail || !user.email_verified_at) {
      return respond(
        {
          ok: false,
          message:
            "Confirme um e-mail valido na conta antes de salvar cartoes para recorrencia.",
        },
        { status: 400 },
      );
    }

    const existingMethod = await findStoredMethodForUser(user.id, methodId);
    if (
      existingMethod?.is_active === true &&
      existingMethod.provider_customer_id &&
      existingMethod.provider_card_id &&
      existingMethod.verification_status === "verified"
    ) {
      const supabase = getSupabaseAdminClientOrThrow();
      const updatedResult = await supabase
        .from("auth_user_payment_methods")
        .update({
          nickname,
          last_context_guild_id: guildId,
        })
        .eq("user_id", user.id)
        .eq("method_id", methodId)
        .select(METHOD_SELECT_COLUMNS)
        .single<StoredPaymentMethodRecord>();

      if (updatedResult.error || !updatedResult.data) {
        throw new Error(updatedResult.error?.message || "Falha ao atualizar metodo salvo.");
      }

      await supabase
        .from("auth_user_hidden_payment_methods")
        .delete()
        .eq("user_id", user.id)
        .eq("method_id", methodId);

      return respond({
        ok: true,
        alreadyVerified: true,
        vaulted: true,
        method: toApiMethod(updatedResult.data),
      });
    }

    const customerLookupKey = createStablePaymentIdempotencyKey({
      namespace: "payment-method-customer",
      parts: [user.id, userEmail],
    });
    let customer = await searchMercadoPagoCustomerByEmail(userEmail);
    if (!customer) {
      const payerNameParts = splitPayerName(payerName);
      customer = await createMercadoPagoCustomer({
        email: userEmail,
        firstName: payerNameParts.firstName,
        lastName: payerNameParts.lastName,
        idempotencyKey: customerLookupKey,
      });
    }

    const vaultedCard = await createMercadoPagoCustomerCard({
      customerId: customer.id,
      token: cardToken,
      idempotencyKey: createStablePaymentIdempotencyKey({
        namespace: "payment-method-vault",
        parts: [user.id, customer.id, methodId, cardToken],
      }),
    });

    const resolvedBrand =
      normalizeNullableToken(vaultedCard.payment_method?.id, 32)?.toLowerCase() ||
      brand ||
      paymentMethodId;
    const resolvedFirstSix =
      normalizeNumericText(vaultedCard.first_six_digits, 6) || firstSix;
    const resolvedLastFour =
      normalizeNumericText(vaultedCard.last_four_digits, 4) || lastFour;
    const resolvedExpMonth = normalizeMonth(vaultedCard.expiration_month) || expMonth;
    const resolvedExpYear = normalizeYear(vaultedCard.expiration_year) || expYear;
    const resolvedMethodId = buildMethodIdFromStoredInput({
      brand: resolvedBrand,
      firstSix: resolvedFirstSix,
      lastFour: resolvedLastFour,
      expMonth: resolvedExpMonth,
      expYear: resolvedExpYear,
    });

    if (!resolvedMethodId) {
      throw new Error("O cofre do provedor retornou um cartao sem identificacao valida.");
    }

    const supabase = getSupabaseAdminClientOrThrow();
    const upsertResult = await supabase
      .from("auth_user_payment_methods")
      .upsert(
        {
          user_id: user.id,
          method_id: resolvedMethodId,
          nickname,
          brand: resolvedBrand,
          first_six: resolvedFirstSix,
          last_four: resolvedLastFour,
          exp_month: resolvedExpMonth,
          exp_year: resolvedExpYear,
          provider: "mercado_pago",
          is_active: true,
          verification_status: "verified",
          verification_status_detail: "vaulted_with_provider_card",
          verified_at: new Date().toISOString(),
          last_context_guild_id: guildId,
          provider_customer_id: String(customer.id),
          provider_card_id: String(vaultedCard.id),
        },
        {
          onConflict: "user_id,method_id",
        },
      )
      .select(METHOD_SELECT_COLUMNS)
      .single<StoredPaymentMethodRecord>();

    if (upsertResult.error || !upsertResult.data) {
      throw new Error(upsertResult.error?.message || "Falha ao salvar cartao no cofre.");
    }

    await supabase
      .from("auth_user_hidden_payment_methods")
      .delete()
      .eq("user_id", user.id)
      .eq("method_id", resolvedMethodId);

    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_method_post",
      outcome: "succeeded",
      metadata: {
        methodId: resolvedMethodId,
        providerCustomerId: String(customer.id),
        providerCardId: String(vaultedCard.id),
      },
    });

    return respond({
      ok: true,
      vaulted: true,
      method: toApiMethod(upsertResult.data),
    });
  } catch (error) {
    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_method_post",
      outcome: "failed",
      metadata: {
        message: sanitizeErrorMessage(error, "Erro ao salvar cartao."),
      },
    });

    return respond(
      {
        ok: false,
        message: resolveDatabaseFailureMessage(
          error,
          sanitizeErrorMessage(error, "Erro ao salvar cartao."),
        ),
      },
      { status: resolveDatabaseFailureStatus(error) },
    );
  }
}

export async function PATCH(request: Request) {
  const baseRequestContext = createSecurityRequestContext(request);
  let auditContext = baseRequestContext;
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

    let body: UpdatePaymentMethodBody = {};
    try {
      body = (await request.json()) as UpdatePaymentMethodBody;
    } catch {
      return respond(
        { ok: false, message: "Payload JSON invalido." },
        { status: 400 },
      );
    }

    const guildId = normalizeGuildId(body.guildId);
    const methodId =
      typeof body.methodId === "string" && isValidSavedMethodId(body.methodId)
        ? body.methodId.trim()
        : null;
    const nickname = normalizePaymentMethodNickname(body.nickname);

    if (!methodId) {
      return respond(
        { ok: false, message: "Metodo invalido para atualizar." },
        { status: 400 },
      );
    }

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) {
      return attachRequestId(
        applyNoStoreHeaders(access.response),
        baseRequestContext.requestId,
      );
    }

    auditContext = extendSecurityRequestContext(baseRequestContext, {
      sessionId: access.context.sessionData.authSession.id,
      userId: access.context.sessionData.authSession.user.id,
      guildId,
    });

    const rateLimit = await enforceRequestRateLimit({
      action: "payment_method_patch",
      windowMs: 10 * 60 * 1000,
      maxAttempts: 20,
      context: auditContext,
    });

    if (!rateLimit.ok) {
      const response = respond(
        {
          ok: false,
          retryAfterSeconds: rateLimit.retryAfterSeconds,
          message: "Muitas alteracoes de apelido em pouco tempo. Aguarde alguns minutos.",
        },
        { status: 429 },
      );
      response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
      return response;
    }

    const supabase = getSupabaseAdminClientOrThrow();
    const updateResult = await supabase
      .from("auth_user_payment_methods")
      .update({
        nickname,
        last_context_guild_id: guildId,
      })
      .eq("user_id", access.context.sessionData.authSession.user.id)
      .eq("method_id", methodId)
      .eq("is_active", true)
      .select(METHOD_SELECT_COLUMNS)
      .maybeSingle<StoredPaymentMethodRecord>();

    if (updateResult.error) {
      throw new Error(updateResult.error.message);
    }

    if (!updateResult.data) {
      return respond(
        { ok: false, message: "Metodo nao encontrado para atualizar." },
        { status: 404 },
      );
    }

    return respond({
      ok: true,
      method: toApiMethod(updateResult.data),
    });
  } catch (error) {
    return respond(
      {
        ok: false,
        message: resolveDatabaseFailureMessage(
          error,
          sanitizeErrorMessage(error, "Erro ao atualizar metodo."),
        ),
      },
      { status: resolveDatabaseFailureStatus(error) },
    );
  }
}

export async function DELETE(request: Request) {
  const baseRequestContext = createSecurityRequestContext(request);
  let auditContext = baseRequestContext;
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

    let body: DeletePaymentMethodBody = {};
    try {
      body = (await request.json()) as DeletePaymentMethodBody;
    } catch {
      return respond(
        { ok: false, message: "Payload JSON invalido." },
        { status: 400 },
      );
    }

    const guildId = normalizeGuildId(body.guildId);
    const methodId =
      typeof body.methodId === "string" && isValidSavedMethodId(body.methodId)
        ? body.methodId.trim()
        : null;

    if (!methodId) {
      return respond(
        { ok: false, message: "Metodo invalido para remocao." },
        { status: 400 },
      );
    }

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) {
      return attachRequestId(
        applyNoStoreHeaders(access.response),
        baseRequestContext.requestId,
      );
    }

    auditContext = extendSecurityRequestContext(baseRequestContext, {
      sessionId: access.context.sessionData.authSession.id,
      userId: access.context.sessionData.authSession.user.id,
      guildId,
    });

    const rateLimit = await enforceRequestRateLimit({
      action: "payment_method_delete",
      windowMs: 10 * 60 * 1000,
      maxAttempts: 12,
      context: auditContext,
    });

    if (!rateLimit.ok) {
      const response = respond(
        {
          ok: false,
          retryAfterSeconds: rateLimit.retryAfterSeconds,
          message: "Muitas remocoes em pouco tempo. Aguarde alguns minutos.",
        },
        { status: 429 },
      );
      response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
      return response;
    }

    const userId = access.context.sessionData.authSession.user.id;
    const existingMethod = await findStoredMethodForUser(userId, methodId);

    if (existingMethod?.provider_customer_id && existingMethod?.provider_card_id) {
      try {
        await deleteMercadoPagoCustomerCard({
          customerId: existingMethod.provider_customer_id,
          cardId: existingMethod.provider_card_id,
        });
      } catch {
        // melhor esforco: ainda removemos o metodo local para bloquear reuso
      }
    }

    const supabase = getSupabaseAdminClientOrThrow();
    await supabase
      .from("auth_user_hidden_payment_methods")
      .upsert(
        {
          user_id: userId,
          method_id: methodId,
        },
        {
          onConflict: "user_id,method_id",
        },
      );

    if (existingMethod) {
      const updateResult = await supabase
        .from("auth_user_payment_methods")
        .update({
          is_active: false,
          verification_status: "cancelled",
          verification_status_detail: "removed_by_user",
          last_context_guild_id: guildId,
        })
        .eq("user_id", userId)
        .eq("method_id", methodId);

      if (updateResult.error) {
        throw new Error(updateResult.error.message);
      }
    }

    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_method_delete",
      outcome: "succeeded",
      metadata: {
        methodId,
      },
    });

    return respond({ ok: true });
  } catch (error) {
    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_method_delete",
      outcome: "failed",
      metadata: {
        message: sanitizeErrorMessage(error, "Erro ao remover metodo."),
      },
    });

    return respond(
      {
        ok: false,
        message: resolveDatabaseFailureMessage(
          error,
          sanitizeErrorMessage(error, "Erro ao remover metodo."),
        ),
      },
      { status: resolveDatabaseFailureStatus(error) },
    );
  }
}
