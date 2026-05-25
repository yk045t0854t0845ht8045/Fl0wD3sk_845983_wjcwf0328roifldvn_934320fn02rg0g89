import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { verifyMercadoPagoWebhookSignature } from "@/lib/payments/paymentIntegrity";
import { syncSalesCartPayment } from "@/lib/sales/checkoutRuntime";
import { applyNoStoreHeaders } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;

function getTrimmedText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(
    value,
  );
}

function secureTokenEquals(expected: string, received: string) {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function parseJsonSafely(rawText: string) {
  if (!rawText) return {};

  try {
    const parsed = JSON.parse(rawText) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readPaymentId(url: URL, body: Record<string, unknown>) {
  const data =
    body.data && typeof body.data === "object"
      ? (body.data as Record<string, unknown>)
      : {};

  return (
    getTrimmedText(data.id, 80) ||
    getTrimmedText(body.id, 80) ||
    getTrimmedText(url.searchParams.get("data.id"), 80) ||
    getTrimmedText(url.searchParams.get("id"), 80) ||
    null
  );
}

function resolveSignatureSecret() {
  return (
    process.env.MERCADO_PAGO_SALES_WEBHOOK_SIGNATURE_SECRET?.trim() ||
    process.env.MERCADO_PAGO_WEBHOOK_SIGNATURE_SECRET?.trim() ||
    process.env.MERCADO_PAGO_WEBHOOK_SECRET?.trim() ||
    ""
  );
}

function resolveLegacyTokens() {
  return [
    process.env.MERCADO_PAGO_SALES_WEBHOOK_TOKEN,
    process.env.MERCADO_PAGO_WEBHOOK_TOKEN,
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
}

function isExplicitlyEnabled(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function allowLegacyTokenFallback() {
  return (
    isExplicitlyEnabled(process.env.MERCADO_PAGO_SALES_WEBHOOK_ALLOW_LEGACY_TOKEN) ||
    isExplicitlyEnabled(process.env.MERCADO_PAGO_WEBHOOK_ALLOW_LEGACY_TOKEN)
  );
}

function validateLegacyToken(request: Request, url: URL) {
  const expectedTokens = resolveLegacyTokens();
  if (!expectedTokens.length) return false;

  const candidates = [
    url.searchParams.get("token")?.trim() || "",
    request.headers.get("x-webhook-token")?.trim() || "",
    request.headers.get("x-sales-webhook-token")?.trim() || "",
  ].filter(Boolean);

  return candidates.some((candidate) =>
    expectedTokens.some((expected) => secureTokenEquals(expected, candidate)),
  );
}

function authorizeWebhook(input: {
  request: Request;
  url: URL;
  paymentId: string | null;
}) {
  const signatureSecret = resolveSignatureSecret();
  const signatureVerification = signatureSecret
    ? verifyMercadoPagoWebhookSignature({
        secret: signatureSecret,
        signatureHeader: input.request.headers.get("x-signature"),
        requestId: input.request.headers.get("x-request-id"),
        dataId:
          input.url.searchParams.get("data.id") ||
          input.url.searchParams.get("id") ||
          input.paymentId,
        maxAgeSeconds: 5 * 60,
      })
    : null;

  if (signatureVerification?.ok) {
    return { ok: true as const, mode: "signature" as const };
  }

  const hasLegacyToken = validateLegacyToken(input.request, input.url);
  if (!signatureSecret && hasLegacyToken) {
    return { ok: true as const, mode: "token" as const };
  }

  if (signatureSecret && allowLegacyTokenFallback() && hasLegacyToken) {
    return { ok: true as const, mode: "token" as const };
  }

  const hasSecurityConfig = Boolean(signatureSecret || resolveLegacyTokens().length);
  if (!hasSecurityConfig) {
    return process.env.NODE_ENV !== "production"
      ? { ok: true as const, mode: "dev_unsecured" as const }
      : {
          ok: false as const,
          status: 503 as const,
          reason: "missing_webhook_auth_config",
        };
  }

  return {
    ok: false as const,
    status: 401 as const,
    reason: signatureVerification?.reason || "invalid_webhook_auth",
  };
}

async function resolveCartId(request: Request, body: Record<string, unknown>) {
  const url = new URL(request.url);
  const cartId = getTrimmedText(url.searchParams.get("cartId"), 64);
  if (isUuid(cartId)) return cartId;

  const paymentId = readPaymentId(url, body);
  if (!paymentId) return null;

  const result = await getSupabaseAdminClientOrThrow()
    .from("guild_sales_carts")
    .select("id")
    .eq("provider", "mercado_pago")
    .eq("provider_payment_id", paymentId)
    .maybeSingle<{ id: string }>();

  if (result.error) throw new Error(result.error.message);
  return result.data?.id || null;
}

export async function POST(request: Request) {
  const requestContext = createSecurityRequestContext(request);
  const respond = (body: unknown, init?: ResponseInit) =>
    attachRequestId(
      applyNoStoreHeaders(NextResponse.json(body, init)),
      requestContext.requestId,
    );

  try {
    const rateLimit = await enforceRequestRateLimit({
      action: "payment_sales_webhook_mercadopago",
      windowMs: 5 * 60 * 1000,
      maxAttempts: 120,
      context: requestContext,
    });

    if (!rateLimit.ok) {
      const response = respond(
        { ok: false, message: "Webhook temporariamente limitado." },
        { status: 429 },
      );
      response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
      return response;
    }

    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
      return respond(
        { ok: false, message: "Payload do webhook excede o limite." },
        { status: 413 },
      );
    }

    const url = new URL(request.url);
    const body = parseJsonSafely(rawBody);
    const paymentId = readPaymentId(url, body);
    const auth = authorizeWebhook({
      request,
      url,
      paymentId,
    });

    if (!auth.ok) {
      await logSecurityAuditEventSafe(requestContext, {
        action: "payment_sales_webhook_mercadopago",
        outcome: "blocked",
        metadata: {
          paymentId,
          reason: auth.reason,
        },
      });

      return respond(
        {
          ok: false,
          message:
            auth.status === 503
              ? "Webhook de vendas sem autenticacao configurada."
              : "Webhook nao autorizado.",
        },
        { status: auth.status },
      );
    }

    const cartId = await resolveCartId(request, body);
    if (cartId) {
      await syncSalesCartPayment(cartId);
    }
    return respond({ ok: true, authMode: auth.mode });
  } catch (error) {
    console.error("[sales-webhook] failed", error);
    return respond({ ok: true });
  }
}

export async function GET() {
  return applyNoStoreHeaders(NextResponse.json({ ok: true }));
}
