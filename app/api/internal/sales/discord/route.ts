import { NextResponse } from "next/server";
import {
  applySalesCartDiscount,
  createSalesCartPixPayment,
  syncSalesCartPayment,
} from "@/lib/sales/checkoutRuntime";
import { extractAuditErrorMessage } from "@/lib/security/errors";
import {
  FlowSecureDtoError,
  flowSecureDto,
  parseFlowSecureDto,
} from "@/lib/security/flowSecure";
import { applyNoStoreHeaders } from "@/lib/security/http";
import { hasSecureInternalTokenAuth } from "@/lib/security/internalTokens";

const INTERNAL_SALES_ACTIONS = [
  "create_pix_payment",
  "sync_payment",
  "apply_discount",
] as const;

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

const SAFE_CHECKOUT_ERROR_FRAGMENTS = [
  "carrinho",
  "compra",
  "login",
  "flowdesk",
  "email valido",
  "produto",
  "estoque",
  "valor",
  "pix",
  "mercado pago",
  "credenciais",
  "pagamento",
  "metodo",
  "servidor",
  "cupom",
  "gift",
  "desconto",
];

function resolveCheckoutErrorMessage(error: unknown) {
  const message = extractAuditErrorMessage(error, "Erro interno no checkout de vendas.");
  const normalized = message.toLowerCase();

  if (
    normalized.includes("schema cache") ||
    normalized.includes("column") ||
    normalized.includes("does not exist")
  ) {
    return "Checkout de vendas em atualizacao. Rode a migration 116 e tente novamente.";
  }

  if (SAFE_CHECKOUT_ERROR_FRAGMENTS.some((fragment) => normalized.includes(fragment))) {
    return message;
  }

  return "Erro interno no checkout de vendas.";
}

export async function POST(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Nao autorizado." }, { status: 401 }),
      );
    }

    let payload: {
      action: (typeof INTERNAL_SALES_ACTIONS)[number];
      cartId: string;
      code?: string | undefined;
    };
    try {
      payload = parseFlowSecureDto(
        await request.json().catch(() => ({})),
        {
          action: flowSecureDto.enum(INTERNAL_SALES_ACTIONS),
          cartId: flowSecureDto.string({
            maxLength: 64,
            pattern:
              /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
            disallowAngleBrackets: true,
          }),
          code: flowSecureDto.optional(
            flowSecureDto.string({
              maxLength: 80,
              normalizeWhitespace: true,
              disallowAngleBrackets: true,
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

    if (payload.action === "create_pix_payment") {
      const result = await createSalesCartPixPayment(payload.cartId);
      return applyNoStoreHeaders(NextResponse.json({ ok: true, ...result }));
    }

    if (payload.action === "sync_payment") {
      const result = await syncSalesCartPayment(payload.cartId);
      return applyNoStoreHeaders(NextResponse.json({ ok: true, ...result }));
    }

    const result = await applySalesCartDiscount({
      cartId: payload.cartId,
      code: payload.code || "",
    });
    return applyNoStoreHeaders(NextResponse.json({ ok: true, ...result }));
  } catch (error) {
    console.error("[internal-sales-discord] checkout failed", error);
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: resolveCheckoutErrorMessage(error),
        },
        { status: 500 },
      ),
    );
  }
}
