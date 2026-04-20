import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  fetchMercadoPagoPaymentById,
  refundMercadoPagoCardPayment,
  refundMercadoPagoPixPayment,
  resolvePaymentStatus,
  type MercadoPagoPaymentResponse,
} from "@/lib/payments/mercadoPago";
import {
  createStablePaymentIdempotencyKey,
  extractMercadoPagoPaymentIdentifiers,
  verifyMercadoPagoWebhookSignature,
} from "@/lib/payments/paymentIntegrity";
import {
  claimPaymentProviderEvent,
  completePaymentProviderEvent,
  failPaymentProviderEvent,
} from "@/lib/payments/providerEventInbox";
import {
  getPaymentOrderByOrderNumber,
  getPaymentOrderByProviderPaymentId,
  reconcilePaymentOrderWithProviderPayment,
} from "@/lib/payments/reconciliation";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import { applyNoStoreHeaders } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  extendSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";

function parseJsonSafely(rawText: string) {
  if (!rawText) return null;

  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    return null;
  }
}

function parsePaymentId(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  return null;
}

function parseOrderNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d{1,12}$/.test(trimmed)) return null;

    const numeric = Number(trimmed);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
  }

  return null;
}

function getMetadataOrderNumber(
  metadata: Record<string, unknown> | null | undefined,
) {
  if (!metadata || typeof metadata !== "object") return null;
  return parseOrderNumber(metadata.flowdesk_order_number);
}

function getExternalReferenceOrderNumber(externalReference: string | null | undefined) {
  if (!externalReference) return null;

  const match = /^flowdesk-order-(\d+)$/i.exec(externalReference.trim());
  if (!match) return null;
  return parseOrderNumber(match[1]);
}

function extractWebhookPaymentId(input: {
  url: URL;
  body: unknown;
}) {
  const byQuery =
    parsePaymentId(input.url.searchParams.get("data.id")) ||
    parsePaymentId(input.url.searchParams.get("id"));
  if (byQuery) return byQuery;

  if (!input.body || typeof input.body !== "object") return null;
  const payload = input.body as Record<string, unknown>;
  const data = payload.data;

  if (data && typeof data === "object") {
    const dataId = parsePaymentId((data as Record<string, unknown>).id);
    if (dataId) return dataId;
  }

  return parsePaymentId(payload.id);
}

function resolveWebhookEventType(url: URL, body: unknown) {
  const bodyType =
    body && typeof body === "object" && typeof (body as Record<string, unknown>).type === "string"
      ? ((body as Record<string, unknown>).type as string).trim()
      : "";
  const queryType = url.searchParams.get("type")?.trim() || "";

  return bodyType || queryType || "payment";
}

function resolveWebhookEventAction(url: URL, body: unknown) {
  const bodyAction =
    body && typeof body === "object" && typeof (body as Record<string, unknown>).action === "string"
      ? ((body as Record<string, unknown>).action as string).trim()
      : "";
  const queryAction = url.searchParams.get("action")?.trim() || "";
  const topicAction = url.searchParams.get("topic")?.trim() || "";

  return bodyAction || queryAction || topicAction || "notification";
}

function resolveRelevantWebhookHeaders(request: Request) {
  return {
    "content-type": request.headers.get("content-type") || null,
    "user-agent": request.headers.get("user-agent") || null,
    "x-request-id": request.headers.get("x-request-id") || null,
    "x-signature": request.headers.get("x-signature") || null,
    "x-webhook-token-present": Boolean(request.headers.get("x-webhook-token")),
  };
}

function secureTokenEquals(expected: string, received: string) {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function validateLegacyWebhookToken(request: Request, url: URL) {
  const expectedToken = process.env.MERCADO_PAGO_WEBHOOK_TOKEN?.trim() || "";
  if (!expectedToken) return false;

  const tokenFromQuery = url.searchParams.get("token")?.trim() || "";
  const tokenFromHeader = request.headers.get("x-webhook-token")?.trim() || "";
  const candidates = [tokenFromQuery, tokenFromHeader].filter(Boolean);

  return candidates.some((candidate) => secureTokenEquals(expectedToken, candidate));
}

function resolveWebhookSignatureSecret() {
  return (
    process.env.MERCADO_PAGO_WEBHOOK_SIGNATURE_SECRET?.trim() ||
    process.env.MERCADO_PAGO_WEBHOOK_SECRET?.trim() ||
    ""
  );
}

function isExplicitlyEnabled(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function resolveWebhookSignatureMaxAgeSeconds() {
  const rawValue =
    process.env.MERCADO_PAGO_WEBHOOK_SIGNATURE_MAX_AGE_SECONDS?.trim() || "";
  if (!rawValue) return null;

  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.floor(numeric);
}

function resolveEffectiveWebhookSignatureMaxAgeSeconds() {
  const configuredValue = resolveWebhookSignatureMaxAgeSeconds();
  if (configuredValue !== null) {
    return configuredValue;
  }

  return 5 * 60;
}

function resolveWebhookAuthorization(input: {
  request: Request;
  url: URL;
  paymentId: string | null;
}) {
  const signatureSecret = resolveWebhookSignatureSecret();
  const allowLegacyTokenFallback = isExplicitlyEnabled(
    process.env.MERCADO_PAGO_WEBHOOK_ALLOW_LEGACY_TOKEN,
  );
  const signatureVerification = signatureSecret
    ? verifyMercadoPagoWebhookSignature({
        secret: signatureSecret,
        signatureHeader: input.request.headers.get("x-signature"),
        requestId: input.request.headers.get("x-request-id"),
        dataId:
          input.url.searchParams.get("data.id") ||
          input.url.searchParams.get("id") ||
          input.paymentId,
        maxAgeSeconds: resolveEffectiveWebhookSignatureMaxAgeSeconds(),
      })
    : null;

  if (signatureVerification?.ok) {
    return {
      ok: true as const,
      mode: "signature" as const,
      signatureVerified: true,
      reason: signatureVerification.reason,
      ageSeconds: signatureVerification.ageSeconds,
    };
  }

  if (
    !signatureSecret &&
    validateLegacyWebhookToken(input.request, input.url)
  ) {
    return {
      ok: true as const,
      mode: "token" as const,
      signatureVerified: false,
      reason: "legacy_token",
      ageSeconds: signatureVerification?.ageSeconds ?? null,
    };
  }

  if (
    signatureSecret &&
    allowLegacyTokenFallback &&
    validateLegacyWebhookToken(input.request, input.url)
  ) {
    return {
      ok: true as const,
      mode: "token" as const,
      signatureVerified: false,
      reason: "legacy_token_explicitly_allowed",
      ageSeconds: signatureVerification?.ageSeconds ?? null,
    };
  }

  const hasSecurityConfig = Boolean(
    signatureSecret || process.env.MERCADO_PAGO_WEBHOOK_TOKEN?.trim(),
  );

  if (!hasSecurityConfig) {
    if (process.env.NODE_ENV !== "production") {
      return {
        ok: true as const,
        mode: "dev_unsecured" as const,
        signatureVerified: false,
        reason: "dev_unsecured",
        ageSeconds: null,
      };
    }

    return {
      ok: false as const,
      mode: "missing_config" as const,
      signatureVerified: false,
      reason: "missing_webhook_auth_config",
      ageSeconds: null,
    };
  }

  return {
    ok: false as const,
    mode: "unauthorized" as const,
    signatureVerified: false,
    reason: signatureVerification?.reason || "invalid_webhook_auth",
    ageSeconds: signatureVerification?.ageSeconds ?? null,
  };
}

function resolveProviderPaymentMethodId(
  providerPayment: MercadoPagoPaymentResponse | null | undefined,
) {
  if (!providerPayment) return null;

  if (typeof providerPayment.payment_method_id === "string") {
    const normalized = providerPayment.payment_method_id.trim().toLowerCase();
    if (normalized) return normalized;
  }

  if (
    providerPayment.point_of_interaction?.transaction_data?.qr_code ||
    providerPayment.point_of_interaction?.transaction_data?.qr_code_base64
  ) {
    return "pix";
  }

  return null;
}

async function autoRefundProviderPayment(input: {
  providerPaymentId: string;
  providerPayment: MercadoPagoPaymentResponse;
  orderPaymentMethod?: "pix" | "card" | null;
}) {
  const providerMethodId = resolveProviderPaymentMethodId(input.providerPayment);
  const isPixPayment =
    providerMethodId === "pix" || input.orderPaymentMethod === "pix";

  if (isPixPayment) {
    return refundMercadoPagoPixPayment(input.providerPaymentId);
  }

  return refundMercadoPagoCardPayment(input.providerPaymentId);
}

function buildWebhookEventKey(input: {
  paymentId: string | null;
  eventType: string;
  eventAction: string;
  providerRequestId: string | null;
  rawBody: string;
  search: string;
}) {
  if (input.paymentId) {
    return `mercado_pago:payment:${input.paymentId}:${input.eventType}:${input.eventAction}`;
  }

  return createStablePaymentIdempotencyKey({
    namespace: "mercado-pago-webhook-event",
    parts: [
      input.eventType,
      input.eventAction,
      input.providerRequestId,
      input.search,
      input.rawBody,
    ],
  });
}

export async function POST(request: Request) {
  const requestContext = createSecurityRequestContext(request);
  const respond = (body: unknown, init?: ResponseInit) =>
    attachRequestId(
      applyNoStoreHeaders(NextResponse.json(body, init)),
      requestContext.requestId,
    );

  const url = new URL(request.url);
  const rawBody = await request.text();
  const body = parseJsonSafely(rawBody);
  const paymentId = extractWebhookPaymentId({ url, body });
  const eventType = resolveWebhookEventType(url, body);
  const eventAction = resolveWebhookEventAction(url, body);
  const providerRequestId = request.headers.get("x-request-id")?.trim() || null;
  const auth = resolveWebhookAuthorization({
    request,
    url,
    paymentId,
  });

  if (!auth.ok) {
    await logSecurityAuditEventSafe(requestContext, {
      action: "payment_webhook_mercadopago",
      outcome: "blocked",
      metadata: {
        paymentId,
        eventType,
        eventAction,
        reason: auth.reason,
      },
    });

    return respond(
      {
        ok: false,
        message:
          auth.mode === "missing_config"
            ? "Webhook do Mercado Pago sem autenticacao configurada."
            : "Webhook nao autorizado.",
      },
      { status: auth.mode === "missing_config" ? 503 : 401 },
    );
  }

  const eventKey = buildWebhookEventKey({
    paymentId,
    eventType,
    eventAction,
    providerRequestId,
    rawBody,
    search: url.search,
  });
  const claimedEvent = await claimPaymentProviderEvent({
    provider: "mercado_pago",
    eventKey,
    resourceType: eventType,
    resourceId: paymentId,
    eventAction,
    signatureVerified: auth.signatureVerified,
    requestId: providerRequestId || requestContext.requestId,
    requestPath: url.pathname,
    headers: resolveRelevantWebhookHeaders(request),
    payload: body || { rawBody },
    maxAttempts: 8,
  });

  if (!claimedEvent.ok) {
    if (claimedEvent.mode === "duplicate_completed") {
      return respond({
        ok: true,
        duplicate: true,
        paymentId,
      });
    }

    if (claimedEvent.mode === "already_processing") {
      return respond(
        {
          ok: true,
          processing: true,
          paymentId,
        },
        { status: 202 },
      );
    }

    if (claimedEvent.mode === "dead_letter") {
      return respond({
        ok: true,
        deadLetter: true,
        paymentId,
      });
    }
  }

  let auditContext = requestContext;

  try {
    if (!paymentId) {
      const resultPayload = {
        ignored: true,
        reason: "missing_payment_id",
      };

      await completePaymentProviderEvent({
        record: claimedEvent.record,
        provider: "mercado_pago",
        eventKey,
        resultPayload,
      });

      await logSecurityAuditEventSafe(auditContext, {
        action: "payment_webhook_mercadopago",
        outcome: "succeeded",
        metadata: resultPayload,
      });

      return respond({ ok: true, ...resultPayload });
    }

    const providerPayment = await fetchMercadoPagoPaymentById(paymentId);
    const providerPaymentId = parsePaymentId(providerPayment.id);
    if (!providerPaymentId) {
      const resultPayload = {
        ignored: true,
        paymentId,
        reason: "provider_payment_without_id",
      };

      await completePaymentProviderEvent({
        record: claimedEvent.record,
        provider: "mercado_pago",
        eventKey,
        resultPayload,
      });

      return respond({ ok: true, ...resultPayload });
    }

    const resolvedStatus = resolvePaymentStatus(providerPayment.status);
    const externalReferenceOrderNumber = getExternalReferenceOrderNumber(
      providerPayment.external_reference || null,
    );
    const metadataOrderNumber = getMetadataOrderNumber(providerPayment.metadata || null);
    const hintedOrderNumber = externalReferenceOrderNumber || metadataOrderNumber;
    const paymentIdentifiers = extractMercadoPagoPaymentIdentifiers(providerPayment);

    const order =
      (await getPaymentOrderByProviderPaymentId(providerPaymentId)) ||
      (hintedOrderNumber ? await getPaymentOrderByOrderNumber(hintedOrderNumber) : null);

    if (!order) {
      const shouldRefundOrphanApproved =
        resolvedStatus === "approved" && Boolean(hintedOrderNumber);

      if (shouldRefundOrphanApproved) {
        await autoRefundProviderPayment({
          providerPaymentId,
          providerPayment,
          orderPaymentMethod: null,
        });
      }

      const resultPayload = {
        ignored: true,
        orphanPayment: true,
        paymentId: providerPaymentId,
        resolvedStatus,
        autoRefunded: shouldRefundOrphanApproved,
        txId: paymentIdentifiers.txId,
        endToEndId: paymentIdentifiers.endToEndId,
      };

      await completePaymentProviderEvent({
        record: claimedEvent.record,
        provider: "mercado_pago",
        eventKey,
        resultPayload,
      });

      await logSecurityAuditEventSafe(auditContext, {
        action: "payment_webhook_mercadopago",
        outcome: "succeeded",
        metadata: resultPayload,
      });

      return respond({ ok: true, ...resultPayload });
    }

    auditContext = extendSecurityRequestContext(requestContext, {
      userId: order.user_id,
      guildId: order.guild_id,
    });

    const reconciled = await reconcilePaymentOrderWithProviderPayment(order, providerPayment, {
      source: "mercado_pago_webhook",
    });
    const resultPayload = {
      paymentId: providerPaymentId,
      orderId: reconciled.order.id,
      orderNumber: reconciled.order.order_number,
      status: reconciled.order.status,
      action: reconciled.action,
      resolvedStatus,
      txId: paymentIdentifiers.txId,
      endToEndId: paymentIdentifiers.endToEndId,
      authMode: auth.mode,
    };

    await completePaymentProviderEvent({
      record: claimedEvent.record,
      provider: "mercado_pago",
      eventKey,
      resultPayload,
    });

    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_webhook_mercadopago",
      outcome: "succeeded",
      metadata: resultPayload,
    });

    return respond({ ok: true, ...resultPayload });
  } catch (error) {
    const sanitizedMessage = sanitizeErrorMessage(
      error,
      "Erro no webhook do Mercado Pago.",
    );
    const failedEvent = await failPaymentProviderEvent({
      record: claimedEvent.record,
      provider: "mercado_pago",
      eventKey,
      errorMessage: sanitizedMessage,
      resultPayload: {
        paymentId,
        eventType,
        eventAction,
        requestId: requestContext.requestId,
      },
    });

    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_webhook_mercadopago",
      outcome: "failed",
      metadata: {
        paymentId,
        eventType,
        eventAction,
        message: sanitizedMessage,
        deadLetter: failedEvent.deadLetter,
      },
    });

    return respond(
      {
        ok: false,
        message: sanitizedMessage,
        requestId: requestContext.requestId,
        deadLetter: failedEvent.deadLetter,
      },
      { status: failedEvent.deadLetter ? 200 : 500 },
    );
  }
}
