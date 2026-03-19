import { NextResponse } from "next/server";
import { resolveSessionAccessToken } from "@/lib/auth/discordGuildAccess";
import {
  buildSavedMethods,
  extractCardSnapshot,
} from "@/lib/payments/savedMethods";
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
  guild_id: string;
  payment_method: PaymentMethod;
  status: PaymentOrderStatus;
  amount: string | number;
  currency: string;
  provider_status: string | null;
  provider_status_detail: string | null;
  provider_payload: unknown;
  paid_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

const PAYMENT_HISTORY_SELECT_COLUMNS =
  "id, order_number, guild_id, payment_method, status, amount, currency, provider_status, provider_status_detail, provider_payload, paid_at, expires_at, created_at, updated_at";

function toFiniteAmount(value: string | number) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toHistoryOrder(order: PaymentOrderRecord) {
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

    const orders = (result.data || []).map(toHistoryOrder);
    const allMethods = buildSavedMethods(
      (result.data || []).map((order) => ({
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
        "method_id, nickname, brand, first_six, last_four, exp_month, exp_year, is_active, created_at, updated_at",
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
