import { NextResponse } from "next/server";
import { resolveSessionAccessToken } from "@/lib/auth/discordGuildAccess";
import {
  extractAuditErrorMessage,
  sanitizeErrorMessage,
} from "@/lib/security/errors";
import { applyNoStoreHeaders } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  extendSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { getManagedHistoryForUser } from "@/lib/account/managedHistory";


type PaymentOrderStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired"
  | "failed";

type PaymentMethod = "pix" | "card";

type PaymentOrderRecord = {
  id: number;
  order_number: number;
  user_id: number;
  guild_id: string;
  payment_method: PaymentMethod;
  status: PaymentOrderStatus;
  amount: string | number;
  currency: string;
  provider_payment_id: string | null;
  provider_status: string | null;
  provider_status_detail: string | null;
  provider_payload: unknown;
  paid_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type PaymentOrderEventRecord = {
  payment_order_id: number;
  event_type: string;
  event_payload: Record<string, unknown> | null;
  created_at: string;
};

const PAYMENT_HISTORY_SELECT_COLUMNS =
  "id, order_number, user_id, guild_id, payment_method, status, amount, currency, provider_payment_id, provider_status, provider_status_detail, provider_payload, paid_at, expires_at, created_at, updated_at";

const PAYMENT_HISTORY_EVENT_SELECT_COLUMNS =
  "payment_order_id, event_type, event_payload, created_at";

function toFiniteAmount(value: string | number) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildTechnicalHistoryLabels(
  order: PaymentOrderRecord,
  events: PaymentOrderEventRecord[],
) {
  const labels: string[] = [];

  const hasApprovedReturnReconciliation = events.some(
    (event) =>
      event.event_type === "flowdesk_hosted_card_return_reconciled" &&
      (event.event_payload?.resolvedStatus === "approved" ||
        order.status === "approved"),
  );

  if (hasApprovedReturnReconciliation) {
    labels.push("Aprovado por reconciliacao de retorno");
  }

  const hasWebhookApproval = events.some(
    (event) =>
      event.event_type === "provider_payment_reconciled" &&
      event.event_payload?.source === "mercado_pago_webhook" &&
      event.event_payload?.resolvedStatus === "approved",
  );

  if (hasWebhookApproval) {
    labels.push("Aprovado por webhook");
  }

  const hasAutomaticRefund = events.some(
    (event) =>
      event.event_type === "provider_payment_auto_refunded" ||
      event.event_type === "provider_payment_auto_refunded_after_setup_timeout",
  );

  if (hasAutomaticRefund) {
    labels.push("Estorno automatico de seguranca");
  }

  return labels;
}

function toHistoryOrder(
  order: PaymentOrderRecord,
  events: PaymentOrderEventRecord[],
) {
  const card = order.payment_method === "card" ? extractCardSnapshot(order.provider_payload) : null;

  return {
    id: order.id,
    orderNumber: order.order_number,
    guildId: order.guild_id,
    method: order.payment_method,
    status: order.status,
    amount: toFiniteAmount(order.amount),
    currency: order.currency,
    providerStatus: order.provider_status,
    providerStatusDetail: order.provider_status_detail,
    card,
    paidAt: order.paid_at,
    expiresAt: order.expires_at,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    technicalLabels: buildTechnicalHistoryLabels(order, events),
  };
}

export async function GET(request: Request) {
  const requestContext = createSecurityRequestContext(request);
  const respond = (body: unknown, init?: ResponseInit) =>
    attachRequestId(
      applyNoStoreHeaders(NextResponse.json(body, init)),
      requestContext.requestId,
    );

  try {
    const sessionData = await resolveSessionAccessToken();
    if (!sessionData?.authSession) {
      return respond(
        { ok: false, message: "Nao autenticado." },
        { status: 401 },
      );
    }

    const auditContext = extendSecurityRequestContext(requestContext, {
      sessionId: sessionData.authSession.id,
      userId: sessionData.authSession.user.id,
    });

    const rateLimit = await enforceRequestRateLimit({
      action: "payment_history_read",
      windowMs: 5 * 60 * 1000,
      maxAttempts: 100,
      context: auditContext,
    });

    if (!rateLimit.ok) {
      const response = respond(
        { ok: false, message: "Muitas consultas. Tente novamente em instantes." },
        { status: 429 },
      );
      response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
      return response;
    }

    const history = await getManagedHistoryForUser(sessionData.authSession.user.id);

    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_history_read",
      outcome: "succeeded",
      metadata: {
        orderCount: history.orders.length,
        methodCount: history.methods.length,
      },
    });

    return respond({
      ok: true,
      orders: history.orders,
      methods: history.methods,
    });
  } catch (error) {
    await logSecurityAuditEventSafe(requestContext, {
      action: "payment_history_read",
      outcome: "failed",
      metadata: {
        message: extractAuditErrorMessage(error),
      },
    });

    return respond(
      {
        ok: false,
        message: sanitizeErrorMessage(
          error,
          "Erro ao carregar historico de pagamentos.",
        ),
      },
      { status: 500 },
    );
  }
}

