import crypto from "node:crypto";
import { readServerSettingsVaultSnapshot } from "@/lib/servers/serverSettingsVault";
import { claimSalesStockDelivery } from "@/lib/servers/salesStockDelivery";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import {
  createSalesMercadoPagoPixPayment,
  fetchSalesMercadoPagoPaymentById,
  resolveSalesMercadoPagoStatus,
  type SalesMercadoPagoPayment,
} from "@/lib/sales/mercadoPago";
import type { SalesPaymentMethodsSecureSnapshot } from "@/lib/sales/paymentMethods";

type SalesCartRecord = {
  id: string;
  guild_id: string;
  discord_user_id: string;
  discord_channel_id: string | null;
  auth_user_id: number | null;
  status: string;
  currency: string;
  subtotal_amount: string | number | null;
  total_amount: string | number | null;
  selected_payment_method_key: string | null;
  provider: string | null;
  provider_payment_id: string | null;
  provider_external_reference: string | null;
  provider_status: string | null;
  provider_status_detail: string | null;
  provider_qr_code: string | null;
  provider_qr_base64: string | null;
  provider_ticket_url: string | null;
  payment_expires_at: string | null;
  paid_at: string | null;
  delivered_at: string | null;
};

type SalesCartItemRecord = {
  id: string;
  cart_id: string;
  guild_id: string;
  product_id: string;
  quantity: number | null;
  unit_price_amount: string | number | null;
  total_amount: string | number | null;
  product_snapshot: Record<string, unknown> | null;
};

type SalesAuthUserRecord = {
  id: number;
  email: string | null;
  display_name: string | null;
  username: string | null;
};

export type SalesCartDeliveryResult = {
  id: string;
  productId: string;
  deliveryMethod: "email" | "discord_dm" | "flowdesk_link";
  message: string;
  productTitle: string;
  status: "delivered" | "failed";
};

export type SalesCartRuntimeResult = {
  cart: SalesCartRecord;
  items: SalesCartItemRecord[];
  user: SalesAuthUserRecord | null;
  payment?: {
    providerPaymentId: string | null;
    status: string | null;
    statusDetail: string | null;
    qrCode: string | null;
    qrBase64: string | null;
    ticketUrl: string | null;
    amount: number;
    expiresAt: string | null;
  };
  deliveries?: SalesCartDeliveryResult[];
};

const CART_SELECT = [
  "id",
  "guild_id",
  "discord_user_id",
  "discord_channel_id",
  "auth_user_id",
  "status",
  "currency",
  "subtotal_amount",
  "total_amount",
  "selected_payment_method_key",
  "provider",
  "provider_payment_id",
  "provider_external_reference",
  "provider_status",
  "provider_status_detail",
  "provider_qr_code",
  "provider_qr_base64",
  "provider_ticket_url",
  "payment_expires_at",
  "paid_at",
  "delivered_at",
].join(", ");

function toNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeEmail(value: string | null | undefined) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

function resolvePublicBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.APP_URL ||
    process.env.SITE_URL ||
    "https://www.flwdesk.com"
  )
    .trim()
    .replace(/\/+$/, "");
}

function buildSalesPaymentNotificationUrl(cartId: string) {
  const params = new URLSearchParams({
    cartId,
    source_news: "webhooks",
  });
  return `${resolvePublicBaseUrl()}/api/payments/mercadopago/sales-webhook?${params.toString()}`;
}

export function buildSalesOrderDeliveryUrl(cartId: string) {
  return `${resolvePublicBaseUrl()}/checkout/orders/${encodeURIComponent(cartId)}`;
}

function getProductTitle(item: SalesCartItemRecord) {
  const snapshotTitle = item.product_snapshot?.title;
  return typeof snapshotTitle === "string" && snapshotTitle.trim()
    ? snapshotTitle.trim()
    : "Produto";
}

async function getSalesMercadoPagoAccessToken(guildId: string) {
  const snapshot =
    await readServerSettingsVaultSnapshot<SalesPaymentMethodsSecureSnapshot>({
      guildId,
      moduleKey: "sales_payment_methods",
    });
  const accessToken = snapshot?.payload?.mercadoPago?.accessToken?.trim();
  if (!accessToken) {
    throw new Error("Mercado Pago nao esta configurado para este servidor.");
  }
  return accessToken;
}

async function assertActiveMercadoPago(guildId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("guild_sales_payment_methods")
    .select("id")
    .eq("guild_id", guildId)
    .eq("method_key", "mercado_pago")
    .eq("status", "active")
    .eq("credentials_configured", true)
    .limit(1);

  if (result.error) throw new Error(result.error.message);
  if (!result.data?.length) {
    throw new Error("PIX via Mercado Pago esta desativado neste servidor.");
  }
}

export async function loadSalesCartRuntime(cartId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const cartResult = await supabase
    .from("guild_sales_carts")
    .select(CART_SELECT)
    .eq("id", cartId)
    .maybeSingle<SalesCartRecord>();

  if (cartResult.error) throw new Error(cartResult.error.message);
  if (!cartResult.data) throw new Error("Carrinho nao encontrado.");

  const itemsResult = await supabase
    .from("guild_sales_cart_items")
    .select(
      "id, cart_id, guild_id, product_id, quantity, unit_price_amount, total_amount, product_snapshot",
    )
    .eq("cart_id", cartId)
    .order("created_at", { ascending: true })
    .returns<SalesCartItemRecord[]>();
  if (itemsResult.error) throw new Error(itemsResult.error.message);

  let user: SalesAuthUserRecord | null = null;
  if (cartResult.data.auth_user_id) {
    const userResult = await supabase
      .from("auth_users")
      .select("id, email, display_name, username")
      .eq("id", cartResult.data.auth_user_id)
      .maybeSingle<SalesAuthUserRecord>();
    if (userResult.error) throw new Error(userResult.error.message);
    user = userResult.data || null;
  }

  return {
    cart: cartResult.data,
    items: itemsResult.data || [],
    user,
  };
}

async function recalculateCartTotals(cartId: string, items: SalesCartItemRecord[]) {
  const total = items.reduce((sum, item) => {
    const quantity = Math.max(1, Math.floor(Number(item.quantity || 1)));
    const unit = toNumber(item.unit_price_amount);
    return sum + quantity * unit;
  }, 0);
  const normalizedTotal = Number(total.toFixed(2));
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("guild_sales_carts")
    .update({
      subtotal_amount: normalizedTotal,
      total_amount: normalizedTotal,
    })
    .eq("id", cartId)
    .select(CART_SELECT)
    .single<SalesCartRecord>();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

function buildPaymentResponse(cart: SalesCartRecord) {
  return {
    providerPaymentId: cart.provider_payment_id,
    status: cart.provider_status,
    statusDetail: cart.provider_status_detail,
    qrCode: cart.provider_qr_code,
    qrBase64: cart.provider_qr_base64,
    ticketUrl: cart.provider_ticket_url,
    amount: toNumber(cart.total_amount),
    expiresAt: cart.payment_expires_at,
  };
}

export async function createSalesCartPixPayment(cartId: string): Promise<SalesCartRuntimeResult> {
  const runtime = await loadSalesCartRuntime(cartId);
  const { cart, items, user } = runtime;

  if (!cart.auth_user_id || !user) {
    throw new Error("Confirme o login da compra antes de gerar pagamento.");
  }
  if (!items.length) {
    throw new Error("Carrinho vazio.");
  }
  if (cart.status === "delivered" || cart.status === "paid") {
    return {
      ...runtime,
      payment: buildPaymentResponse(cart),
      deliveries: await loadSalesCartDeliveries(cart.id),
    };
  }
  if (cart.provider_payment_id && cart.status === "payment_pending") {
    return {
      ...runtime,
      payment: buildPaymentResponse(cart),
    };
  }

  await assertActiveMercadoPago(cart.guild_id);
  const accessToken = await getSalesMercadoPagoAccessToken(cart.guild_id);
  const email = normalizeEmail(user.email);
  if (!email) {
    throw new Error("A conta Flowdesk vinculada precisa ter um email valido.");
  }

  const updatedCart = await recalculateCartTotals(cart.id, items);
  const amount = toNumber(updatedCart.total_amount);
  if (amount < 0.01) {
    throw new Error("Valor do carrinho invalido para pagamento.");
  }

  const externalReference = `flowdesk-sales:${cart.id}`;
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const providerPayment = await createSalesMercadoPagoPixPayment({
    accessToken,
    amount,
    description: `Compra Flowdesk ${cart.id.slice(0, 8)}`,
    payerEmail: email,
    payerName: user.display_name || user.username || "Cliente Flowdesk",
    externalReference,
    expiresAt,
    notificationUrl: buildSalesPaymentNotificationUrl(cart.id),
    metadata: {
      flowdesk_scope: "guild_sales",
      cart_id: cart.id,
      guild_id: cart.guild_id,
      discord_user_id: cart.discord_user_id,
      auth_user_id: String(cart.auth_user_id),
    },
    idempotencyKey: crypto
      .createHash("sha256")
      .update(`flowdesk-sales-pix:${cart.id}:${amount.toFixed(2)}`)
      .digest("hex"),
  });

  const transactionData = providerPayment.point_of_interaction?.transaction_data;
  const providerStatus = providerPayment.status || null;
  const providerStatusDetail = providerPayment.status_detail || null;
  const nextStatus =
    resolveSalesMercadoPagoStatus(providerStatus) === "approved"
      ? "paid"
      : "payment_pending";
  const updateResult = await getSupabaseAdminClientOrThrow()
    .from("guild_sales_carts")
    .update({
      status: nextStatus,
      selected_payment_method_key: "mercado_pago",
      provider: "mercado_pago",
      provider_payment_id: String(providerPayment.id),
      provider_external_reference: providerPayment.external_reference || externalReference,
      provider_status: providerStatus,
      provider_status_detail: providerStatusDetail,
      provider_qr_code: transactionData?.qr_code || null,
      provider_qr_base64: transactionData?.qr_code_base64 || null,
      provider_ticket_url: transactionData?.ticket_url || null,
      provider_payload: providerPayment,
      payment_expires_at: providerPayment.date_of_expiration || expiresAt,
      paid_at: providerPayment.date_approved || null,
    })
    .eq("id", cart.id)
    .select(CART_SELECT)
    .single<SalesCartRecord>();

  if (updateResult.error) throw new Error(updateResult.error.message);

  const nextRuntime = {
    ...runtime,
    cart: updateResult.data,
    payment: buildPaymentResponse(updateResult.data),
  };

  if (nextStatus === "paid") {
    return syncSalesCartPayment(cart.id);
  }

  return nextRuntime;
}

export async function loadSalesCartDeliveries(cartId: string) {
  const result = await getSupabaseAdminClientOrThrow()
    .from("guild_sales_order_deliveries")
    .select("id, product_id, delivery_method, status, delivery_payload")
    .eq("cart_id", cartId)
    .order("created_at", { ascending: true });
  if (result.error) throw new Error(result.error.message);

  return (result.data || []).map((row) => {
    const payload =
      row.delivery_payload && typeof row.delivery_payload === "object"
        ? (row.delivery_payload as Record<string, unknown>)
        : {};
    return {
      id: row.id as string,
      productId: row.product_id as string,
      deliveryMethod: row.delivery_method as SalesCartDeliveryResult["deliveryMethod"],
      status: row.status === "failed" ? "failed" : "delivered",
      message: typeof payload.message === "string" ? payload.message : "",
      productTitle:
        typeof payload.productTitle === "string" ? payload.productTitle : "Produto",
    } satisfies SalesCartDeliveryResult;
  });
}

async function settleSalesCartDeliveries(
  runtime: Awaited<ReturnType<typeof loadSalesCartRuntime>>,
) {
  const existing = await loadSalesCartDeliveries(runtime.cart.id);
  const expectedQuantity = runtime.items.reduce(
    (sum, item) => sum + Math.max(1, Math.floor(Number(item.quantity || 1))),
    0,
  );
  if (existing.length >= expectedQuantity && expectedQuantity > 0) {
    return existing;
  }

  if (!runtime.cart.auth_user_id) {
    throw new Error("Carrinho aprovado sem usuario autenticado.");
  }

  const deliveries: SalesCartDeliveryResult[] = [...existing];
  const rowsToInsert: Array<Record<string, unknown>> = [];

  for (const item of runtime.items) {
    const quantity = Math.max(1, Math.floor(Number(item.quantity || 1)));
    for (let index = 0; index < quantity; index += 1) {
      const delivery = await claimSalesStockDelivery({
        guildId: runtime.cart.guild_id,
        productId: item.product_id,
      });
      if (!delivery) {
        rowsToInsert.push({
          cart_id: runtime.cart.id,
          guild_id: runtime.cart.guild_id,
          auth_user_id: runtime.cart.auth_user_id,
          discord_user_id: runtime.cart.discord_user_id,
          product_id: item.product_id,
          stock_item_id: null,
          delivery_method: "flowdesk_link",
          status: "failed",
          delivery_payload: {
            productTitle: getProductTitle(item),
            message:
              "Pagamento aprovado, mas nao havia estoque disponivel para esta unidade. Abra um ticket com o comprovante.",
          },
        });
        continue;
      }

      rowsToInsert.push({
        cart_id: runtime.cart.id,
        guild_id: runtime.cart.guild_id,
        auth_user_id: runtime.cart.auth_user_id,
        discord_user_id: runtime.cart.discord_user_id,
        product_id: item.product_id,
        stock_item_id: delivery.stockItemId,
        delivery_method: delivery.deliveryMethod,
        status: "delivered",
        delivery_payload: {
          productTitle: getProductTitle(item),
          message: delivery.message,
        },
      });
    }
  }

  if (rowsToInsert.length) {
    const insertResult = await getSupabaseAdminClientOrThrow()
      .from("guild_sales_order_deliveries")
      .insert(rowsToInsert);
    if (insertResult.error) throw new Error(insertResult.error.message);
  }

  return loadSalesCartDeliveries(runtime.cart.id);
}

function resolvePaidAt(providerPayment: SalesMercadoPagoPayment) {
  return providerPayment.date_approved || new Date().toISOString();
}

export async function syncSalesCartPayment(cartId: string): Promise<SalesCartRuntimeResult> {
  const runtime = await loadSalesCartRuntime(cartId);
  const { cart } = runtime;
  if (!cart.provider_payment_id) {
    return {
      ...runtime,
      payment: buildPaymentResponse(cart),
      deliveries: await loadSalesCartDeliveries(cart.id),
    };
  }

  const accessToken = await getSalesMercadoPagoAccessToken(cart.guild_id);
  const providerPayment = await fetchSalesMercadoPagoPaymentById({
    accessToken,
    paymentId: cart.provider_payment_id,
  });
  const resolvedStatus = resolveSalesMercadoPagoStatus(providerPayment.status);
  const transactionData = providerPayment.point_of_interaction?.transaction_data;
  const cartStatus =
    resolvedStatus === "approved"
      ? "paid"
      : resolvedStatus === "pending"
        ? "payment_pending"
        : resolvedStatus;

  const updateResult = await getSupabaseAdminClientOrThrow()
    .from("guild_sales_carts")
    .update({
      status: cartStatus,
      provider_status: providerPayment.status || null,
      provider_status_detail: providerPayment.status_detail || null,
      provider_qr_code: transactionData?.qr_code || cart.provider_qr_code,
      provider_qr_base64: transactionData?.qr_code_base64 || cart.provider_qr_base64,
      provider_ticket_url: transactionData?.ticket_url || cart.provider_ticket_url,
      provider_payload: providerPayment,
      payment_expires_at: providerPayment.date_of_expiration || cart.payment_expires_at,
      paid_at: resolvedStatus === "approved" ? resolvePaidAt(providerPayment) : cart.paid_at,
    })
    .eq("id", cart.id)
    .select(CART_SELECT)
    .single<SalesCartRecord>();

  if (updateResult.error) throw new Error(updateResult.error.message);

  const nextRuntime = {
    ...runtime,
    cart: updateResult.data,
    payment: buildPaymentResponse(updateResult.data),
  };

  if (resolvedStatus !== "approved") {
    return {
      ...nextRuntime,
      deliveries: await loadSalesCartDeliveries(cart.id),
    };
  }

  const deliveries = await settleSalesCartDeliveries({
    ...runtime,
    cart: updateResult.data,
  });
  const hasFailedDelivery = deliveries.some((delivery) => delivery.status === "failed");
  const finalStatus = hasFailedDelivery ? "delivery_failed" : "delivered";
  const finalResult = await getSupabaseAdminClientOrThrow()
    .from("guild_sales_carts")
    .update({
      status: finalStatus,
      delivered_at: new Date().toISOString(),
    })
    .eq("id", cart.id)
    .select(CART_SELECT)
    .single<SalesCartRecord>();
  if (finalResult.error) throw new Error(finalResult.error.message);

  return {
    ...nextRuntime,
    cart: finalResult.data,
    deliveries,
  };
}
