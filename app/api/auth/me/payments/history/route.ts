import { NextResponse } from "next/server";
import { resolveSessionAccessToken } from "@/lib/auth/discordGuildAccess";
import {
  buildSavedMethods,
  extractCardSnapshot,
} from "@/lib/payments/savedMethods";
import { reconcilePaymentOrderRecord } from "@/lib/payments/reconciliation";
import {
  mergeSavedMethodsWithStored,
  toSavedMethodFromStoredRecord,
  type StoredPaymentMethodRecord,
} from "@/lib/payments/userPaymentMethods";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

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

export async function GET() {
  try {
    const sessionData = await resolveSessionAccessToken();
    if (!sessionData?.authSession) {
      return NextResponse.json(
        { ok: false, message: "Nao autenticado." },
        { status: 401 },
      );
    }

    const supabase = getSupabaseAdminClientOrThrow();
    const result = await supabase
      .from("payment_orders")
      .select(PAYMENT_HISTORY_SELECT_COLUMNS)
      .eq("user_id", sessionData.authSession.user.id)
      .order("created_at", { ascending: false })
      .limit(500)
      .returns<PaymentOrderRecord[]>();

    if (result.error) {
      throw new Error(result.error.message);
    }

    let rawOrders = result.data || [];
    const candidates = rawOrders
      .filter(
        (order) =>
          !!order.provider_payment_id &&
          (order.status === "pending" ||
            order.status === "failed" ||
            order.status === "expired" ||
            order.status === "rejected"),
      )
      .slice(0, 4);

    let reconciledAnything = false;
    for (const order of candidates) {
      try {
        const reconciled = await reconcilePaymentOrderRecord(order, {
          source: "auth_payment_history",
        });
        if (reconciled.changed) {
          reconciledAnything = true;
        }
      } catch {
        // nao quebrar historico por falha em reconciliacao oportunista
      }
    }

    if (reconciledAnything) {
      const refreshedResult = await supabase
        .from("payment_orders")
        .select(PAYMENT_HISTORY_SELECT_COLUMNS)
        .eq("user_id", sessionData.authSession.user.id)
        .order("created_at", { ascending: false })
        .limit(500)
        .returns<PaymentOrderRecord[]>();

      if (refreshedResult.error) {
        throw new Error(refreshedResult.error.message);
      }

      rawOrders = refreshedResult.data || [];
    }

    const orderIds = rawOrders.map((order) => order.id);
    let paymentEventsByOrderId = new Map<number, PaymentOrderEventRecord[]>();

    if (orderIds.length > 0) {
      const eventsResult = await supabase
        .from("payment_order_events")
        .select(PAYMENT_HISTORY_EVENT_SELECT_COLUMNS)
        .in("payment_order_id", orderIds)
        .order("created_at", { ascending: false })
        .returns<PaymentOrderEventRecord[]>();

      if (eventsResult.error) {
        throw new Error(eventsResult.error.message);
      }

      paymentEventsByOrderId = (eventsResult.data || []).reduce(
        (map, event) => {
          const current = map.get(event.payment_order_id) || [];
          current.push(event);
          map.set(event.payment_order_id, current);
          return map;
        },
        new Map<number, PaymentOrderEventRecord[]>(),
      );
    }

    const orders = rawOrders.map((order) =>
      toHistoryOrder(order, paymentEventsByOrderId.get(order.id) || []),
    );
    const allMethods = buildSavedMethods(
      rawOrders.map((order) => ({
        payment_method: order.payment_method,
        provider_payload: order.provider_payload,
        created_at: order.created_at,
      })),
    );

    const hiddenMethodsResult = await supabase
      .from("auth_user_hidden_payment_methods")
      .select("method_id")
      .eq("user_id", sessionData.authSession.user.id)
      .returns<Array<{ method_id: string }>>();

    if (hiddenMethodsResult.error) {
      throw new Error(hiddenMethodsResult.error.message);
    }

    const hiddenMethodSet = new Set(
      (hiddenMethodsResult.data || []).map((item) => item.method_id),
    );

    const storedMethodsResult = await supabase
      .from("auth_user_payment_methods")
      .select(
        "method_id, nickname, brand, first_six, last_four, exp_month, exp_year, is_active, verification_status, verification_status_detail, verification_amount, verified_at, last_context_guild_id, created_at, updated_at",
      )
      .eq("user_id", sessionData.authSession.user.id)
      .eq("is_active", true)
      .returns<StoredPaymentMethodRecord[]>();

    if (storedMethodsResult.error) {
      throw new Error(storedMethodsResult.error.message);
    }

    const storedMethods = (storedMethodsResult.data || [])
      .map((row) => toSavedMethodFromStoredRecord(row))
      .filter((method): method is NonNullable<typeof method> => Boolean(method));

    const methods = mergeSavedMethodsWithStored({
      derivedMethods: allMethods,
      storedMethods,
      hiddenMethodSet,
    });

    return NextResponse.json({
      ok: true,
      orders,
      methods,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao carregar historico de pagamentos.",
      },
      { status: 500 },
    );
  }
}
