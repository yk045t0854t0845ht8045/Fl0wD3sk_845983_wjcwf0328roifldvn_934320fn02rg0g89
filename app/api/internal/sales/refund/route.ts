import { NextResponse } from "next/server";
import { refundSalesCartPayment } from "@/lib/sales/checkoutRuntime";
import { extractAuditErrorMessage } from "@/lib/security/errors";
import {
  FlowSecureDtoError,
  flowSecureDto,
  parseFlowSecureDto,
} from "@/lib/security/flowSecure";
import { applyNoStoreHeaders } from "@/lib/security/http";
import { hasSecureInternalTokenAuth } from "@/lib/security/internalTokens";

function resolveInternalSalesToken() {
  return (
    process.env.SALES_INTERNAL_API_TOKEN ||
    process.env.FLOWAI_INTERNAL_API_TOKEN ||
    process.env.CRON_SECRET ||
    ""
  ).trim();
}

function isAuthorized(request: Request) {
  return hasSecureInternalTokenAuth({
    request,
    expectedTokens: [resolveInternalSalesToken()],
    headerNames: ["x-flowdesk-internal-token", "x-sales-internal-token"],
    allowDevWithoutToken: true,
  });
}

function resolveRefundErrorMessage(error: unknown) {
  const message = extractAuditErrorMessage(error, "Erro interno ao processar reembolso.");
  const normalized = message.toLowerCase();
  if (
    normalized.includes("mercado pago") ||
    normalized.includes("compra") ||
    normalized.includes("pagamento") ||
    normalized.includes("credenciais") ||
    normalized.includes("reembolso") ||
    normalized.includes("provedor")
  ) {
    return message;
  }
  return "Erro interno ao processar reembolso.";
}

export async function POST(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Nao autorizado." }, { status: 401 }),
      );
    }

    let payload: { cartId: string; guildId: string; reason?: string | undefined };
    try {
      payload = parseFlowSecureDto(
        await request.json().catch(() => ({})),
        {
          cartId: flowSecureDto.string({
            maxLength: 80,
            pattern:
              /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
            disallowAngleBrackets: true,
          }),
          guildId: flowSecureDto.discordSnowflake(),
          reason: flowSecureDto.optional(
            flowSecureDto.string({
              maxLength: 500,
              normalizeWhitespace: true,
            }),
          ),
        },
        { rejectUnknown: true },
      );
    } catch (error) {
      if (!(error instanceof FlowSecureDtoError)) {
        throw error;
      }

      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: error.issues[0] || error.message },
          { status: 400 },
        ),
      );
    }

    const result = await refundSalesCartPayment({
      cartId: payload.cartId,
      guildId: payload.guildId,
      reason: payload.reason || "",
    });
    const resultRecord = result as typeof result & Record<string, unknown>;

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        alreadyRefunded: result.alreadyRefunded,
        financialRefunded:
          resultRecord.financialRefunded === true || result.alreadyRefunded === true,
        providerRefundConfirmedAfterError:
          resultRecord.providerRefundConfirmedAfterError === true,
        persistenceCompleted: resultRecord.persistenceCompleted !== false,
        persistenceFallbackApplied: resultRecord.persistenceFallbackApplied === true,
        persistenceError: resultRecord.persistenceError || null,
        eventLogged: resultRecord.eventLogged !== false,
        eventError: resultRecord.eventError || null,
        cart: {
          id: result.cart.id,
          status: result.cart.status,
          providerPaymentId: result.cart.provider_payment_id,
          providerStatus: result.cart.provider_status,
          providerStatusDetail: result.cart.provider_status_detail,
        },
      }),
    );
  } catch (error) {
    console.error("[internal-sales-refund] failed", error);
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: resolveRefundErrorMessage(error),
        },
        { status: 500 },
      ),
    );
  }
}
