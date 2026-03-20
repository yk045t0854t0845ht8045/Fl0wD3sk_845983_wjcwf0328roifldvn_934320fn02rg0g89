import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import { reconcilePaymentOrderRecord } from "@/lib/payments/reconciliation";
import { applyNoStoreHeaders } from "@/lib/security/http";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type PaymentOrderStateRecord = {
  id: number;
  order_number: number;
  guild_id: string;
  payment_method: "pix" | "card";
  status: "pending" | "approved" | "rejected" | "cancelled" | "expired" | "failed";
  provider_payment_id: string | null;
  provider_status: string | null;
  provider_status_detail: string | null;
  provider_qr_code: string | null;
  paid_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

const LICENSE_VALIDITY_DAYS = 30;
const LICENSE_VALIDITY_MS = LICENSE_VALIDITY_DAYS * 24 * 60 * 60 * 1000;
const PAYMENT_STATE_SELECT_COLUMNS =
  "id, order_number, guild_id, payment_method, status, provider_payment_id, provider_status, provider_status_detail, provider_qr_code, paid_at, expires_at, created_at, updated_at";

function normalizeGuildId(value: string | null) {
  if (!value) return null;
  const guildId = value.trim();
  return isGuildId(guildId) ? guildId : null;
}

function resolveLicenseBaseTimestamp(order: PaymentOrderStateRecord) {
  const paidAtMs = order.paid_at ? Date.parse(order.paid_at) : Number.NaN;
  if (Number.isFinite(paidAtMs)) return paidAtMs;

  const createdAtMs = Date.parse(order.created_at);
  if (Number.isFinite(createdAtMs)) return createdAtMs;

  return Date.now();
}

function resolveLicenseExpiresAt(order: PaymentOrderStateRecord) {
  return new Date(
    resolveLicenseBaseTimestamp(order) + LICENSE_VALIDITY_MS,
  ).toISOString();
}

function isLicenseActiveForOrder(order: PaymentOrderStateRecord) {
  if (order.status !== "approved") return false;
  return Date.now() < Date.parse(resolveLicenseExpiresAt(order));
}

function toOrderState(order: PaymentOrderStateRecord) {
  return {
    orderNumber: order.order_number,
    guildId: order.guild_id,
    method: order.payment_method,
    status: order.status,
    providerStatus: order.provider_status,
    providerStatusDetail: order.provider_status_detail,
    hasPixQr: Boolean(order.provider_qr_code),
    paidAt: order.paid_at,
    expiresAt: order.expires_at,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
  };
}

async function ensureGuildAccess(guildId: string) {
  const sessionData = await resolveSessionAccessToken();
  if (!sessionData?.authSession) {
    return {
      ok: false as const,
      response: applyNoStoreHeaders(
        NextResponse.json(
        { ok: false, message: "Nao autenticado." },
        { status: 401 },
      ),
      ),
    };
  }

  if (!sessionData.accessToken) {
    return {
      ok: false as const,
      response: applyNoStoreHeaders(
        NextResponse.json(
        { ok: false, message: "Token OAuth ausente na sessao." },
        { status: 401 },
      ),
      ),
    };
  }

  if (sessionData.authSession.activeGuildId === guildId) {
    return {
      ok: true as const,
      context: {
        sessionData,
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
      ok: false as const,
      response: applyNoStoreHeaders(
        NextResponse.json(
        { ok: false, message: "Servidor nao encontrado para este usuario." },
        { status: 403 },
      ),
      ),
    };
  }

  return {
    ok: true as const,
    context: {
      sessionData,
    },
  };
}

async function getActiveLicenseOrderForGuild(guildId: string) {
  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase
    .from("payment_orders")
    .select(PAYMENT_STATE_SELECT_COLUMNS)
    .eq("guild_id", guildId)
    .eq("status", "approved")
    .order("paid_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(30)
    .returns<PaymentOrderStateRecord[]>();

  if (result.error) {
    throw new Error(
      `Erro ao carregar licenca ativa do servidor: ${result.error.message}`,
    );
  }

  const orders = result.data || [];
  return orders.find((order) => isLicenseActiveForOrder(order)) || null;
}

async function getLatestUserOrderForGuild(userId: number, guildId: string) {
  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase
    .from("payment_orders")
    .select(PAYMENT_STATE_SELECT_COLUMNS)
    .eq("user_id", userId)
    .eq("guild_id", guildId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<PaymentOrderStateRecord>();

  if (result.error) {
    throw new Error(`Erro ao carregar pedido do usuario: ${result.error.message}`);
  }

  return result.data || null;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const guildId = normalizeGuildId(url.searchParams.get("guildId"));

    if (!guildId) {
      return applyNoStoreHeaders(
        NextResponse.json(
        { ok: false, message: "Guild ID invalido." },
        { status: 400 },
        ),
      );
    }

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) {
      return access.response;
    }

    const user = access.context.sessionData.authSession.user;
    let [activeLicenseOrder, latestUserOrder] = await Promise.all([
      getActiveLicenseOrderForGuild(guildId),
      getLatestUserOrderForGuild(user.id, guildId),
    ]);

    const shouldReconcileLatestOrder =
      !!latestUserOrder &&
      !!latestUserOrder.provider_payment_id &&
      (latestUserOrder.status === "pending" ||
        latestUserOrder.status === "failed" ||
        latestUserOrder.status === "expired" ||
        latestUserOrder.status === "rejected");

    if (shouldReconcileLatestOrder && latestUserOrder) {
      try {
        const reconciled = await reconcilePaymentOrderRecord(latestUserOrder, {
          source: "auth_payment_state",
        });
        latestUserOrder = {
          ...latestUserOrder,
          ...reconciled.order,
          provider_payment_id:
            reconciled.order.provider_payment_id ??
            latestUserOrder.provider_payment_id,
          provider_status: reconciled.order.provider_status ?? null,
          provider_status_detail:
            reconciled.order.provider_status_detail ?? null,
        };

        if (
          reconciled.changed &&
          (reconciled.order.status === "approved" ||
            reconciled.order.status === "cancelled")
        ) {
          activeLicenseOrder = await getActiveLicenseOrderForGuild(guildId);
        }
      } catch {
        // melhor esforco; nao quebrar a consulta de estado por falha na reconciliacao
      }
    }

    return applyNoStoreHeaders(
      NextResponse.json({
      ok: true,
      guildId,
      activeLicense: activeLicenseOrder
        ? {
            ...toOrderState(activeLicenseOrder),
            licenseExpiresAt: resolveLicenseExpiresAt(activeLicenseOrder),
          }
        : null,
      latestOrder: latestUserOrder ? toOrderState(latestUserOrder) : null,
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao consultar estado de pagamento do servidor.",
      },
      { status: 500 },
      ),
    );
  }
}
