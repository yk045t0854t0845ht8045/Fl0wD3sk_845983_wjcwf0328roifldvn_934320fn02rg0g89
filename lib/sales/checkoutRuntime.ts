import crypto from "node:crypto";
import { readServerSettingsVaultSnapshot } from "@/lib/servers/serverSettingsVault";
import { claimSalesStockDelivery } from "@/lib/servers/salesStockDelivery";
import {
  markSalesProductDiscordSyncFailedById,
  syncSalesProductDiscordMessageById,
} from "@/lib/servers/salesProductDiscordSync";
import { sendSalesPaymentApprovedEmailForCartSafe } from "@/lib/mail/transactional";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import {
  createSalesMercadoPagoPixPayment,
  fetchSalesMercadoPagoPaymentById,
  resolveSalesMercadoPagoStatus,
  type SalesMercadoPagoPayment,
} from "@/lib/sales/mercadoPago";
import {
  createSecretFingerprint,
  getSalesMercadoPagoEnvironmentMismatchMessage,
  type SalesPaymentMethodsSecureSnapshot,
} from "@/lib/sales/paymentMethods";

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
  customer_email?: string | null;
  customer_name?: string | null;
  receipt_email_sent_at?: string | null;
  receipt_email_error?: string | null;
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

type SalesPaymentMethodRecord = {
  id: string;
  provider: string | null;
  payment_rail: string | null;
  status: string | null;
  credentials_configured: boolean | null;
  environment: string | null;
  last_health_status: string | null;
};

type SalesProductPaymentRecord = {
  id: string;
  guild_id: string;
  title: string;
  sku: string | null;
  media_urls: unknown;
  price_amount: string | number | null;
  inventory_tracked: boolean | null;
  stock_quantity: number | null;
  status: string | null;
  active: boolean | null;
};

type SalesSettingsReceiptRecord = {
  receipt_company_name: string | null;
  receipt_company_document: string | null;
  receipt_support_text: string | null;
};

type SalesCartDeliveryRecord = {
  id: string;
  product_id: string;
  cart_item_id: string | null;
  unit_index: number | null;
  idempotency_key: string | null;
  delivery_method: string;
  status: string;
  delivery_payload: Record<string, unknown> | null;
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

const BASE_CART_COLUMNS = [
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
];

const OPTIONAL_CART_COLUMNS = [
  "customer_email",
  "customer_name",
  "receipt_email_sent_at",
  "receipt_email_error",
];

const CART_BASE_SELECT = BASE_CART_COLUMNS.join(", ");
const CART_SELECT = [...BASE_CART_COLUMNS, ...OPTIONAL_CART_COLUMNS].join(", ");

const PRODUCT_PAYMENT_SELECT = [
  "id",
  "guild_id",
  "title",
  "sku",
  "media_urls",
  "price_amount",
  "inventory_tracked",
  "stock_quantity",
  "status",
  "active",
].join(", ");

const BASE_DELIVERY_COLUMNS = [
  "id",
  "product_id",
  "delivery_method",
  "status",
  "delivery_payload",
];

const OPTIONAL_DELIVERY_COLUMNS = [
  "cart_item_id",
  "unit_index",
  "idempotency_key",
];

const DELIVERY_BASE_SELECT = BASE_DELIVERY_COLUMNS.join(", ");
const DELIVERY_SELECT = [...BASE_DELIVERY_COLUMNS, ...OPTIONAL_DELIVERY_COLUMNS].join(", ");

function toNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeEmail(value: string | null | undefined) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

function isMissingOptionalCartColumnError(error: {
  code?: string | null;
  message?: string | null;
} | null | undefined) {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = typeof error?.message === "string" ? error.message.toLowerCase() : "";
  return (
    code === "42703" ||
    code === "PGRST204" ||
    OPTIONAL_CART_COLUMNS.some((column) => message.includes(column.toLowerCase())) ||
    (message.includes("guild_sales_carts") &&
      (message.includes("schema cache") || message.includes("column")))
  );
}

function withOptionalCartDefaults(cart: SalesCartRecord) {
  return {
    ...cart,
    customer_email: cart.customer_email ?? null,
    customer_name: cart.customer_name ?? null,
    receipt_email_sent_at: cart.receipt_email_sent_at ?? null,
    receipt_email_error: cart.receipt_email_error ?? "",
  };
}

function stripOptionalCartUpdateFields(values: Record<string, unknown>) {
  const next = { ...values };
  for (const key of OPTIONAL_CART_COLUMNS) {
    delete next[key];
  }
  return next;
}

function isMissingOptionalDeliveryColumnError(error: {
  code?: string | null;
  message?: string | null;
} | null | undefined) {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = typeof error?.message === "string" ? error.message.toLowerCase() : "";
  return (
    code === "42703" ||
    code === "PGRST204" ||
    OPTIONAL_DELIVERY_COLUMNS.some((column) => message.includes(column.toLowerCase())) ||
    (message.includes("guild_sales_order_deliveries") &&
      (message.includes("schema cache") || message.includes("column")))
  );
}

function stripOptionalDeliveryFields(row: Record<string, unknown>) {
  const next = { ...row };
  for (const key of OPTIONAL_DELIVERY_COLUMNS) {
    delete next[key];
  }
  return next;
}

function withOptionalDeliveryDefaults(row: SalesCartDeliveryRecord) {
  return {
    ...row,
    cart_item_id: row.cart_item_id ?? null,
    unit_index: row.unit_index ?? null,
    idempotency_key: row.idempotency_key ?? "",
  };
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

async function loadSalesCartRecord(cartId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("guild_sales_carts")
    .select(CART_SELECT)
    .eq("id", cartId)
    .maybeSingle<SalesCartRecord>();

  if (!result.error) {
    return result.data ? withOptionalCartDefaults(result.data) : null;
  }
  if (!isMissingOptionalCartColumnError(result.error)) {
    throw new Error(result.error.message);
  }

  const fallback = await supabase
    .from("guild_sales_carts")
    .select(CART_BASE_SELECT)
    .eq("id", cartId)
    .maybeSingle<SalesCartRecord>();
  if (fallback.error) throw new Error(fallback.error.message);
  return fallback.data ? withOptionalCartDefaults(fallback.data) : null;
}

async function updateSalesCartAndSelect(
  cartId: string,
  values: Record<string, unknown>,
) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("guild_sales_carts")
    .update(values)
    .eq("id", cartId)
    .select(CART_SELECT)
    .single<SalesCartRecord>();

  if (!result.error) {
    return withOptionalCartDefaults(result.data);
  }
  if (!isMissingOptionalCartColumnError(result.error)) {
    throw new Error(result.error.message);
  }

  const fallback = await supabase
    .from("guild_sales_carts")
    .update(stripOptionalCartUpdateFields(values))
    .eq("id", cartId)
    .select(CART_BASE_SELECT)
    .single<SalesCartRecord>();
  if (fallback.error) throw new Error(fallback.error.message);
  return withOptionalCartDefaults(fallback.data);
}

function getProductTitle(item: SalesCartItemRecord) {
  const snapshotTitle = item.product_snapshot?.title;
  return typeof snapshotTitle === "string" && snapshotTitle.trim()
    ? snapshotTitle.trim()
    : "Produto";
}

async function loadSalesMercadoPagoSecureSnapshot(guildId: string) {
  const snapshot =
    await readServerSettingsVaultSnapshot<SalesPaymentMethodsSecureSnapshot>({
      guildId,
      moduleKey: "sales_payment_methods",
    });
  const accessToken = snapshot?.payload?.mercadoPago?.accessToken?.trim();
  if (!accessToken) {
    throw new Error("Mercado Pago nao esta configurado para este servidor.");
  }
  const environment = snapshot?.payload?.mercadoPago?.environment || "production";
  const environmentMismatchMessage =
    getSalesMercadoPagoEnvironmentMismatchMessage({
      accessToken,
      environment,
    });
  if (environmentMismatchMessage) {
    throw new Error(environmentMismatchMessage);
  }

  return {
    accessToken,
    publicKey: snapshot?.payload?.mercadoPago?.publicKey?.trim() || "",
    environment,
  };
}

async function resolveActiveMercadoPagoConfig(guildId: string) {
  const secure = await loadSalesMercadoPagoSecureSnapshot(guildId);
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("guild_sales_payment_methods")
    .select("id, provider, payment_rail, status, credentials_configured, environment, last_health_status")
    .eq("guild_id", guildId)
    .eq("method_key", "mercado_pago")
    .maybeSingle<SalesPaymentMethodRecord>();

  if (result.error) throw new Error(result.error.message);
  const method = result.data;
  if (!method || method.status !== "active") {
    throw new Error("PIX via Mercado Pago esta desativado neste servidor.");
  }
  const provider = method.provider?.trim() || "mercado_pago";
  const rail = method.payment_rail?.trim() || "pix";
  if (provider !== "mercado_pago" || rail !== "pix") {
    throw new Error("Metodo Mercado Pago ativo esta inconsistente. Reative o PIX no painel.");
  }
  if (method.last_health_status === "failed") {
    throw new Error("As credenciais Mercado Pago ativas falharam na ultima validacao.");
  }
  if (method.credentials_configured !== true) {
    const repairResult = await supabase
      .from("guild_sales_payment_methods")
      .update({
        credentials_configured: true,
        environment: secure.environment,
        public_key_fingerprint: createSecretFingerprint(secure.publicKey),
        access_token_fingerprint: createSecretFingerprint(secure.accessToken),
        last_health_status: "unchecked",
        last_health_error: "",
      })
      .eq("id", method.id);
    if (repairResult.error) throw new Error(repairResult.error.message);
  }

  return secure;
}

export async function loadSalesCartRuntime(cartId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const cart = await loadSalesCartRecord(cartId);
  if (!cart) throw new Error("Carrinho nao encontrado.");

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
  if (cart.auth_user_id) {
    const userResult = await supabase
      .from("auth_users")
      .select("id, email, display_name, username")
      .eq("id", cart.auth_user_id)
      .maybeSingle<SalesAuthUserRecord>();
    if (userResult.error) throw new Error(userResult.error.message);
    user = userResult.data || null;
  }

  return {
    cart,
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
  return updateSalesCartAndSelect(cartId, {
    subtotal_amount: normalizedTotal,
    total_amount: normalizedTotal,
  });
}

function normalizeQuantity(value: unknown) {
  return Math.max(1, Math.floor(Number(value || 1)));
}

function readMediaUrls(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function productSnapshotFromRecord(
  product: SalesProductPaymentRecord,
  currentSnapshot: Record<string, unknown> | null,
) {
  const snapshot = currentSnapshot && typeof currentSnapshot === "object"
    ? currentSnapshot
    : {};
  return {
    ...snapshot,
    title: product.title,
    sku: product.sku || "",
    priceAmount: toNumber(product.price_amount),
    stockQuantity: Number(product.stock_quantity || 0),
    mediaUrls: readMediaUrls(product.media_urls),
  };
}

function assertPaymentAllowedForCartStatus(status: string) {
  if (["cancelled", "expired", "rejected", "delivery_failed"].includes(status)) {
    throw new Error("Este carrinho nao pode mais gerar pagamento.");
  }
}

async function loadProductsForCartItems(items: SalesCartItemRecord[]) {
  const productIds = Array.from(new Set(items.map((item) => item.product_id)));
  if (!productIds.length) return new Map<string, SalesProductPaymentRecord>();

  const result = await getSupabaseAdminClientOrThrow()
    .from("guild_sales_products")
    .select(PRODUCT_PAYMENT_SELECT)
    .in("id", productIds)
    .returns<SalesProductPaymentRecord[]>();

  if (result.error) throw new Error(result.error.message);
  return new Map((result.data || []).map((product) => [product.id, product]));
}

async function refreshCartItemsForPayment(runtime: Awaited<ReturnType<typeof loadSalesCartRuntime>>) {
  const productsById = await loadProductsForCartItems(runtime.items);
  const updates: Array<Promise<unknown>> = [];
  const nextItems: SalesCartItemRecord[] = [];

  for (const item of runtime.items) {
    const product = productsById.get(item.product_id);
    if (!product || product.guild_id !== runtime.cart.guild_id) {
      throw new Error("Produto do carrinho nao foi encontrado.");
    }
    if (product.status !== "active" || product.active === false) {
      throw new Error(`Produto indisponivel: ${product.title || item.product_id}.`);
    }

    const quantity = normalizeQuantity(item.quantity);
    const stockQuantity = Number(product.stock_quantity || 0);
    if (product.inventory_tracked !== false && stockQuantity < quantity) {
      throw new Error(
        `Estoque insuficiente para ${product.title || "produto"}. Disponivel: ${stockQuantity}.`,
      );
    }

    const unitPrice = Number(toNumber(product.price_amount).toFixed(2));
    if (unitPrice < 0.01) {
      throw new Error(`Valor invalido para ${product.title || "produto"}.`);
    }

    const total = Number((unitPrice * quantity).toFixed(2));
    const nextSnapshot = productSnapshotFromRecord(product, item.product_snapshot);
    const nextItem = {
      ...item,
      quantity,
      unit_price_amount: unitPrice,
      total_amount: total,
      product_snapshot: nextSnapshot,
    };
    nextItems.push(nextItem);

    const currentTotal = Number(toNumber(item.total_amount).toFixed(2));
    const currentUnit = Number(toNumber(item.unit_price_amount).toFixed(2));
    if (currentUnit !== unitPrice || currentTotal !== total || item.quantity !== quantity) {
      updates.push(
        Promise.resolve(
          getSupabaseAdminClientOrThrow()
            .from("guild_sales_cart_items")
            .update({
              quantity,
              unit_price_amount: unitPrice,
              total_amount: total,
              product_snapshot: nextSnapshot,
            })
            .eq("id", item.id),
        ).then((result) => {
          if (result.error) throw new Error(result.error.message);
        }),
      );
    }
  }

  if (updates.length) {
    await Promise.all(updates);
  }

  return nextItems;
}

async function recordSalesOrderEvent(input: {
  cart: SalesCartRecord;
  eventType: string;
  eventKey?: string;
  payload?: Record<string, unknown>;
}) {
  const result = await getSupabaseAdminClientOrThrow()
    .from("guild_sales_order_events")
    .insert({
      cart_id: input.cart.id,
      guild_id: input.cart.guild_id,
      auth_user_id: input.cart.auth_user_id,
      discord_user_id: input.cart.discord_user_id,
      event_type: input.eventType,
      event_key: input.eventKey || "",
      event_payload: input.payload || {},
    });

  if (result.error) {
    const message = result.error.message.toLowerCase();
    if (
      result.error.code === "42P01" ||
      result.error.code === "23505" ||
      message.includes("guild_sales_order_events")
    ) {
      return;
    }
    throw new Error(result.error.message);
  }
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
  if (cart.status === "delivered" || cart.status === "delivery_failed" || cart.status === "paid") {
    return {
      ...runtime,
      payment: buildPaymentResponse(cart),
      deliveries: await loadSalesCartDeliveries(cart.id),
    };
  }
  assertPaymentAllowedForCartStatus(cart.status);
  if (cart.provider_payment_id && cart.status === "payment_pending") {
    return {
      ...runtime,
      payment: buildPaymentResponse(cart),
    };
  }

  const mercadoPagoConfig = await resolveActiveMercadoPagoConfig(cart.guild_id);
  const email = normalizeEmail(user.email);
  if (!email) {
    throw new Error("A conta Flowdesk vinculada precisa ter um email valido.");
  }

  const validatedItems = await refreshCartItemsForPayment(runtime);
  const updatedCart = await recalculateCartTotals(cart.id, validatedItems);
  const amount = toNumber(updatedCart.total_amount);
  if (amount < 0.01) {
    throw new Error("Valor do carrinho invalido para pagamento.");
  }

  const externalReference = `flowdesk-sales:${cart.id}`;
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const providerPayment = await createSalesMercadoPagoPixPayment({
    accessToken: mercadoPagoConfig.accessToken,
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
  const updatedPaymentCart = await updateSalesCartAndSelect(cart.id, {
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
    customer_email: email,
    customer_name: user.display_name || user.username || "Cliente Flowdesk",
  });
  await recordSalesOrderEvent({
    cart: updatedPaymentCart,
    eventType: "payment_created",
    eventKey: `payment_created:${providerPayment.id}`,
    payload: {
      provider: "mercado_pago",
      providerPaymentId: String(providerPayment.id),
      status: providerStatus,
      amount,
    },
  });

  const nextRuntime = {
    ...runtime,
    cart: updatedPaymentCart,
    items: validatedItems,
    payment: buildPaymentResponse(updatedPaymentCart),
  };

  if (nextStatus === "paid") {
    return syncSalesCartPayment(cart.id);
  }

  return nextRuntime;
}

async function loadSalesCartDeliveryRows(cartId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("guild_sales_order_deliveries")
    .select(DELIVERY_SELECT)
    .eq("cart_id", cartId)
    .order("created_at", { ascending: true })
    .returns<SalesCartDeliveryRecord[]>();
  if (!result.error) {
    return (result.data || []).map(withOptionalDeliveryDefaults);
  }
  if (!isMissingOptionalDeliveryColumnError(result.error)) {
    throw new Error(result.error.message);
  }

  const fallback = await supabase
    .from("guild_sales_order_deliveries")
    .select(DELIVERY_BASE_SELECT)
    .eq("cart_id", cartId)
    .order("created_at", { ascending: true })
    .returns<SalesCartDeliveryRecord[]>();
  if (fallback.error) throw new Error(fallback.error.message);
  return (fallback.data || []).map(withOptionalDeliveryDefaults);
}

export async function loadSalesCartDeliveries(cartId: string) {
  const rows = await loadSalesCartDeliveryRows(cartId);
  return rows.map((row) => {
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

async function syncProductEmbedsAfterStockChange(input: {
  cart: SalesCartRecord;
  productIds: Iterable<string>;
}) {
  const productIds = Array.from(new Set(Array.from(input.productIds).filter(Boolean)));
  await Promise.all(
    productIds.map(async (productId) => {
      try {
        const sync = await syncSalesProductDiscordMessageById({
          guildId: input.cart.guild_id,
          productId,
        });
        if (sync?.status === "synced") {
          await recordSalesOrderEvent({
            cart: input.cart,
            eventType: "product_embed_synced",
            eventKey: `product_embed_synced:${productId}`,
            payload: { productId, source: "stock_change" },
          });
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Falha ao atualizar embed do produto.";
        await markSalesProductDiscordSyncFailedById({
          guildId: input.cart.guild_id,
          productId,
          error: message.slice(0, 500),
        }).catch(() => null);
        await recordSalesOrderEvent({
          cart: input.cart,
          eventType: "product_embed_sync_failed",
          eventKey: `product_embed_sync_failed:${productId}:${Date.now()}`,
          payload: { productId, message },
        }).catch(() => null);
      }
    }),
  );
}

async function settleSalesCartDeliveries(
  runtime: Awaited<ReturnType<typeof loadSalesCartRuntime>>,
) {
  if (!runtime.cart.auth_user_id) {
    throw new Error("Carrinho aprovado sem usuario autenticado.");
  }

  const existingRows = await loadSalesCartDeliveryRows(runtime.cart.id);
  const existingKeys = new Set(
    existingRows
      .map((row) => row.idempotency_key || "")
      .filter((key) => key.trim().length > 0),
  );
  const legacyCountByProduct = new Map<string, number>();
  for (const row of existingRows) {
    if (row.idempotency_key) continue;
    legacyCountByProduct.set(
      row.product_id,
      (legacyCountByProduct.get(row.product_id) || 0) + 1,
    );
  }

  const rowsToInsert: Array<Record<string, unknown>> = [];
  const stockChangedProductIds = new Set<string>();

  for (const item of runtime.items) {
    const quantity = normalizeQuantity(item.quantity);
    for (let index = 0; index < quantity; index += 1) {
      const idempotencyKey = `${runtime.cart.id}:${item.id}:${index}`;
      if (existingKeys.has(idempotencyKey)) {
        continue;
      }
      const legacyCount = legacyCountByProduct.get(item.product_id) || 0;
      if (legacyCount > 0) {
        legacyCountByProduct.set(item.product_id, legacyCount - 1);
        continue;
      }

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
          cart_item_id: item.id,
          unit_index: index,
          idempotency_key: idempotencyKey,
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
      stockChangedProductIds.add(item.product_id);

      rowsToInsert.push({
        cart_id: runtime.cart.id,
        guild_id: runtime.cart.guild_id,
        auth_user_id: runtime.cart.auth_user_id,
        discord_user_id: runtime.cart.discord_user_id,
        product_id: item.product_id,
        cart_item_id: item.id,
        unit_index: index,
        idempotency_key: idempotencyKey,
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
    const supabase = getSupabaseAdminClientOrThrow();
    const insertResult = await supabase
      .from("guild_sales_order_deliveries")
      .insert(rowsToInsert);
    if (insertResult.error && isMissingOptionalDeliveryColumnError(insertResult.error)) {
      const fallbackRows = rowsToInsert.map(stripOptionalDeliveryFields);
      const fallbackInsert = await supabase
        .from("guild_sales_order_deliveries")
        .insert(fallbackRows);
      if (fallbackInsert.error && fallbackInsert.error.code !== "23505") {
        throw new Error(fallbackInsert.error.message);
      }
    } else if (insertResult.error && insertResult.error.code !== "23505") {
      throw new Error(insertResult.error.message);
    }
    await recordSalesOrderEvent({
      cart: runtime.cart,
      eventType: "delivery_settled",
      eventKey: "delivery_settled",
      payload: {
        inserted: rowsToInsert.length,
      },
    });
  }
  if (stockChangedProductIds.size) {
    await syncProductEmbedsAfterStockChange({
      cart: runtime.cart,
      productIds: stockChangedProductIds,
    });
  }

  return loadSalesCartDeliveries(runtime.cart.id);
}

function resolvePaidAt(providerPayment: SalesMercadoPagoPayment) {
  return providerPayment.date_approved || new Date().toISOString();
}

async function loadSalesReceiptSettings(guildId: string) {
  const result = await getSupabaseAdminClientOrThrow()
    .from("guild_sales_settings")
    .select("receipt_company_name, receipt_company_document, receipt_support_text")
    .eq("guild_id", guildId)
    .maybeSingle<SalesSettingsReceiptRecord>();

  if (result.error) {
    const message = result.error.message.toLowerCase();
    if (result.error.code === "42P01" || message.includes("guild_sales_settings")) {
      return null;
    }
    throw new Error(result.error.message);
  }

  return result.data || null;
}

function resolveCustomerName(user: SalesAuthUserRecord | null) {
  return user?.display_name?.trim() || user?.username?.trim() || "Cliente Flowdesk";
}

async function markSalesReceiptEmailResult(input: {
  cartId: string;
  sentAt?: string | null;
  error?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
}) {
  const result = await getSupabaseAdminClientOrThrow()
    .from("guild_sales_carts")
    .update({
      receipt_email_sent_at: input.sentAt || null,
      receipt_email_error: input.error || "",
      customer_email: input.customerEmail || null,
      customer_name: input.customerName || null,
    })
    .eq("id", input.cartId);

  if (result.error) {
    const message = result.error.message.toLowerCase();
    if (
      result.error.code === "42703" ||
      message.includes("receipt_email_sent_at") ||
      message.includes("customer_email")
    ) {
      return;
    }
    throw new Error(result.error.message);
  }
}

async function sendSalesCartReceiptEmailSafe(input: {
  runtime: Awaited<ReturnType<typeof loadSalesCartRuntime>>;
  cart: SalesCartRecord;
  deliveries: SalesCartDeliveryResult[];
}) {
  const user = input.runtime.user;
  const email = normalizeEmail(user?.email);
  if (!user || !email || input.cart.receipt_email_sent_at) return;

  try {
    const settings = await loadSalesReceiptSettings(input.cart.guild_id);
    await sendSalesPaymentApprovedEmailForCartSafe({
      user,
      cart: input.cart,
      items: input.runtime.items,
      deliveries: input.deliveries,
      orderUrl: buildSalesOrderDeliveryUrl(input.cart.id),
      settings: settings
        ? {
            receiptCompanyName: settings.receipt_company_name,
            receiptCompanyDocument: settings.receipt_company_document,
            receiptSupportText: settings.receipt_support_text,
          }
        : null,
    });

    const sentAt = new Date().toISOString();
    await markSalesReceiptEmailResult({
      cartId: input.cart.id,
      sentAt,
      error: "",
      customerEmail: email,
      customerName: resolveCustomerName(user),
    });
    await recordSalesOrderEvent({
      cart: input.cart,
      eventType: "receipt_email_sent",
      eventKey: "receipt_email_sent",
      payload: { sentAt, email },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao enviar recibo.";
    await markSalesReceiptEmailResult({
      cartId: input.cart.id,
      sentAt: null,
      error: message.slice(0, 500),
      customerEmail: email,
      customerName: resolveCustomerName(user),
    }).catch(() => null);
    await recordSalesOrderEvent({
      cart: input.cart,
      eventType: "receipt_email_failed",
      eventKey: `receipt_email_failed:${Date.now()}`,
      payload: { message },
    }).catch(() => null);
  }
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

  const mercadoPagoConfig = await loadSalesMercadoPagoSecureSnapshot(cart.guild_id);
  const providerPayment = await fetchSalesMercadoPagoPaymentById({
    accessToken: mercadoPagoConfig.accessToken,
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

  const syncedCart = await updateSalesCartAndSelect(cart.id, {
    status: cartStatus,
    provider_status: providerPayment.status || null,
    provider_status_detail: providerPayment.status_detail || null,
    provider_qr_code: transactionData?.qr_code || cart.provider_qr_code,
    provider_qr_base64: transactionData?.qr_code_base64 || cart.provider_qr_base64,
    provider_ticket_url: transactionData?.ticket_url || cart.provider_ticket_url,
    provider_payload: providerPayment,
    payment_expires_at: providerPayment.date_of_expiration || cart.payment_expires_at,
    paid_at: resolvedStatus === "approved" ? resolvePaidAt(providerPayment) : cart.paid_at,
  });
  await recordSalesOrderEvent({
    cart: syncedCart,
    eventType: "payment_synced",
    eventKey:
      resolvedStatus === "approved"
        ? "payment_approved"
        : `payment_status:${resolvedStatus}`,
    payload: {
      provider: "mercado_pago",
      providerPaymentId: String(providerPayment.id),
      status: providerPayment.status || null,
      resolvedStatus,
    },
  });

  const nextRuntime = {
    ...runtime,
    cart: syncedCart,
    payment: buildPaymentResponse(syncedCart),
  };

  if (resolvedStatus !== "approved") {
    return {
      ...nextRuntime,
      deliveries: await loadSalesCartDeliveries(cart.id),
    };
  }

  const deliveries = await settleSalesCartDeliveries({
    ...runtime,
    cart: syncedCart,
  });
  const hasFailedDelivery = deliveries.some((delivery) => delivery.status === "failed");
  const finalStatus = hasFailedDelivery ? "delivery_failed" : "delivered";
  const finalizedCart = await updateSalesCartAndSelect(cart.id, {
    status: finalStatus,
    delivered_at: new Date().toISOString(),
  });
  await recordSalesOrderEvent({
    cart: finalizedCart,
    eventType: "order_finalized",
    eventKey: "order_finalized",
    payload: {
      status: finalStatus,
      deliveryCount: deliveries.length,
      failedDeliveryCount: deliveries.filter((delivery) => delivery.status === "failed").length,
    },
  });
  await sendSalesCartReceiptEmailSafe({
    runtime: {
      ...runtime,
      cart: finalizedCart,
    },
    cart: finalizedCart,
    deliveries,
  });

  return {
    ...nextRuntime,
    cart: finalizedCart,
    deliveries,
  };
}
