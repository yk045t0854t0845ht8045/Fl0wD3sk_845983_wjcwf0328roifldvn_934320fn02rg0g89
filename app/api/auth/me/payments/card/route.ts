import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  hasAcceptedTeamAccessToGuild,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import {
  isValidBrazilDocument,
  normalizeBrazilDocumentDigits,
  resolveBrazilDocumentType,
} from "@/lib/payments/brazilDocument";
import {
  cancelMercadoPagoCardPayment,
  createMercadoPagoCardPayment,
  fetchMercadoPagoPaymentById,
  refundMercadoPagoCardPayment,
  resolveMercadoPagoCardEnvironment,
  resolvePaymentStatus,
  toQrDataUri,
  type MercadoPagoPaymentResponse,
} from "@/lib/payments/mercadoPago";
import {
  areCardPaymentsEnabled,
  CARD_PAYMENTS_DISABLED_MESSAGE,
} from "@/lib/payments/cardAvailability";
import { resolvePaymentDiagnostic } from "@/lib/payments/paymentDiagnostics";
import {
  cleanupExpiredUnpaidServerSetups,
  resolveUnpaidSetupEffectiveExpiresAt,
  resolveUnpaidSetupExpiresAt,
} from "@/lib/payments/setupCleanup";
import type { PlanPricingDefinition } from "@/lib/plans/catalog";
import {
  resolveEffectivePlanSelection,
  syncUserPlanStateFromOrder,
} from "@/lib/plans/state";
import { ensureSameOriginJsonMutationRequest } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  extendSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type CreateCardPaymentBody = {
  guildId?: unknown;
  planCode?: unknown;
  billingPeriodCode?: unknown;
  payerName?: unknown;
  payerDocument?: unknown;
  billingZipCode?: unknown;
  cardToken?: unknown;
  paymentMethodId?: unknown;
  installments?: unknown;
  issuerId?: unknown;
  deviceSessionId?: unknown;
};

type AuthUserRecord = {
  created_at: string;
};

type PaymentOrderRecord = {
  id: number;
  order_number: number;
  user_id: number;
  guild_id: string;
  payment_method: "pix" | "card" | "trial";
  status: string;
  amount: string | number;
  currency: string;
  plan_code: string | null;
  plan_name: string | null;
  plan_billing_cycle_days: number | null;
  plan_max_licensed_servers: number | null;
  plan_max_active_tickets: number | null;
  plan_max_automations: number | null;
  plan_max_monthly_actions: number | null;
  payer_name: string | null;
  payer_document: string | null;
  payer_document_type: "CPF" | "CNPJ" | null;
  provider_payment_id: string | null;
  provider_qr_code: string | null;
  provider_qr_base64: string | null;
  provider_ticket_url: string | null;
  provider_status: string | null;
  provider_status_detail: string | null;
  paid_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type PaymentOrderEventPayload = Record<string, unknown>;

const DEFAULT_AMOUNT = 9.99;
const DEFAULT_CURRENCY = "BRL";
const CARD_RETRY_COOLDOWN_MS = 2 * 60 * 1000;
const CARD_ISSUER_ANTIFRAUD_COOLDOWN_MS = 10 * 60 * 1000;
const CARD_PENDING_REUSE_WINDOW_MS = 15 * 60 * 1000;
const LICENSE_VALIDITY_DAYS = 30;
const LICENSE_VALIDITY_MS = LICENSE_VALIDITY_DAYS * 24 * 60 * 60 * 1000;
const PAYMENT_ORDER_SELECT_COLUMNS =
  "id, order_number, user_id, guild_id, payment_method, status, amount, currency, plan_code, plan_name, plan_billing_cycle_days, plan_max_licensed_servers, plan_max_active_tickets, plan_max_automations, plan_max_monthly_actions, payer_name, payer_document, payer_document_type, provider_payment_id, provider_qr_code, provider_qr_base64, provider_ticket_url, provider_status, provider_status_detail, paid_at, expires_at, created_at, updated_at";

function normalizeGuildId(value: unknown) {
  if (typeof value !== "string") return null;
  const guildId = value.trim();
  return isGuildId(guildId) ? guildId : null;
}

function normalizePayerName(value: unknown) {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) return null;
  if (name.length < 3 || name.length > 120) return null;
  return name;
}

function normalizePayerDocument(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = normalizeBrazilDocumentDigits(value);
  const type = resolveBrazilDocumentType(normalized);
  if (!type) return null;
  if (!isValidBrazilDocument(normalized)) return null;

  return {
    normalized,
    type,
  };
}

function normalizeBillingZipCode(value: unknown) {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return /^\d{8}$/.test(digits) ? digits : null;
}

function normalizeCardToken(value: unknown) {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (token.length < 8 || token.length > 300) return null;
  return token;
}

function normalizePaymentMethodId(value: unknown) {
  if (typeof value !== "string") return null;
  const methodId = value.trim().toLowerCase();
  if (!/^[a-z0-9_]{2,32}$/.test(methodId)) return null;
  return methodId;
}

function normalizeInstallments(value: unknown) {
  if (value === undefined || value === null || value === "") return 1;
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return null;
  if (numeric < 1 || numeric > 12) return null;
  return numeric;
}

function normalizeIssuerId(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const issuerId = String(value).trim();
  if (!issuerId) return null;
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(issuerId)) return null;
  return issuerId;
}

function normalizeDeviceSessionId(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return null;
  const sessionId = value.trim();
  if (!sessionId) return null;
  if (!/^[a-zA-Z0-9:_-]{8,200}$/.test(sessionId)) return null;
  return sessionId;
}

function normalizePayerEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function maskPayerDocument(document: string | null) {
  if (!document) return null;

  const digits = document.replace(/\D/g, "");
  if (digits.length <= 4) return digits;
  return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

function maskEmail(email: string | null) {
  if (!email) return null;
  const [localPart, domainPart] = email.split("@");
  if (!localPart || !domainPart) return null;
  if (localPart.length <= 2) return `**@${domainPart}`;
  return `${localPart.slice(0, 2)}***@${domainPart}`;
}

function parseAmount(amount: string | number) {
  if (typeof amount === "number") return amount;
  const numeric = Number(amount);
  return Number.isFinite(numeric) ? numeric : DEFAULT_AMOUNT;
}

function normalizeNameForComparison(value: string | null | undefined) {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function resolveCardRetryCooldownSeconds(input: {
  latestCardOrder: PaymentOrderRecord | null;
  payerDocument: string;
  payerName: string;
}) {
  const latestCardOrder = input.latestCardOrder;
  if (!latestCardOrder) return null;
  if (latestCardOrder.payment_method !== "card") return null;
  if (latestCardOrder.status === "approved") return null;

  if (
    latestCardOrder.payer_document &&
    latestCardOrder.payer_document !== input.payerDocument
  ) {
    return null;
  }

  if (
    latestCardOrder.payer_name &&
    normalizeNameForComparison(latestCardOrder.payer_name) !==
      normalizeNameForComparison(input.payerName)
  ) {
    return null;
  }

  const referenceTimeMs =
    Date.parse(latestCardOrder.updated_at) ||
    Date.parse(latestCardOrder.created_at) ||
    Date.now();

  if (!Number.isFinite(referenceTimeMs)) return null;

  const detail = (latestCardOrder.provider_status_detail || "").toLowerCase();
  const cooldownWindowMs =
    detail.includes("high_risk") ||
    detail.includes("analise antifraude do emissor") ||
    detail.includes("anÃ¡lise antifraude do emissor") ||
    (detail.includes("issuer") && detail.includes("fraud")) ||
    (detail.includes("emissor") && detail.includes("fraud"))
      ? CARD_ISSUER_ANTIFRAUD_COOLDOWN_MS
      : CARD_RETRY_COOLDOWN_MS;

  const elapsedMs = Date.now() - referenceTimeMs;
  if (elapsedMs >= cooldownWindowMs) return null;

  return Math.max(1, Math.ceil((cooldownWindowMs - elapsedMs) / 1000));
}

function isRecentOrderTimestamp(
  value: string | null | undefined,
  windowMs: number,
) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= windowMs;
}

function resolveLicenseBaseTimestamp(order: PaymentOrderRecord) {
  const paidAtMs = order.paid_at ? Date.parse(order.paid_at) : Number.NaN;
  if (Number.isFinite(paidAtMs)) return paidAtMs;

  const createdAtMs = Date.parse(order.created_at);
  if (Number.isFinite(createdAtMs)) return createdAtMs;

  return Date.now();
}

function resolveLicenseExpiresAt(order: PaymentOrderRecord) {
  const cycleDays =
    typeof order.plan_billing_cycle_days === "number" &&
    Number.isFinite(order.plan_billing_cycle_days) &&
    order.plan_billing_cycle_days > 0
      ? order.plan_billing_cycle_days
      : LICENSE_VALIDITY_DAYS;
  return new Date(
    resolveLicenseBaseTimestamp(order) + cycleDays * 24 * 60 * 60 * 1000,
  ).toISOString();
}

function isLicenseActiveForOrder(order: PaymentOrderRecord) {
  if (order.status !== "approved") return false;
  return Date.now() < Date.parse(resolveLicenseExpiresAt(order));
}

function resolveAmount() {
  const rawValue = process.env.MERCADO_PAGO_PIX_AMOUNT;
  if (!rawValue) return DEFAULT_AMOUNT;

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_AMOUNT;

  return Math.round(parsed * 100) / 100;
}

function resolveCurrency() {
  return process.env.MERCADO_PAGO_PIX_CURRENCY || DEFAULT_CURRENCY;
}

async function resolveCheckoutPlanForGuild(input: {
  userId: number;
  guildId: string;
  requestedPlanCode?: unknown;
  requestedBillingPeriodCode?: unknown;
}) {
  const { plan } = await resolveEffectivePlanSelection({
    userId: input.userId,
    guildId: input.guildId,
    preferredPlanCode: input.requestedPlanCode,
    preferredBillingPeriodCode: input.requestedBillingPeriodCode,
  });

  return {
    plan,
    amount: Math.max(0, Math.round(plan.totalAmount * 100) / 100),
    currency: plan.currency || resolveCurrency(),
  };
}

function toApiOrder(record: PaymentOrderRecord) {
  const qrDataUri = toQrDataUri(record.provider_qr_base64);

  return {
    id: record.id,
    orderNumber: record.order_number,
    guildId: record.guild_id,
    method: record.payment_method,
    status: record.status,
    amount: parseAmount(record.amount),
    currency: record.currency,
    planCode: record.plan_code,
    planName: record.plan_name,
    planBillingCycleDays: record.plan_billing_cycle_days,
    payerName: record.payer_name,
    payerDocumentMasked: maskPayerDocument(record.payer_document),
    payerDocumentType: record.payer_document_type,
    providerPaymentId: record.provider_payment_id,
    providerStatus: record.provider_status,
    providerStatusDetail: record.provider_status_detail,
    qrCodeText: record.provider_qr_code,
    qrCodeBase64: record.provider_qr_base64,
    qrCodeDataUri: qrDataUri,
    ticketUrl: record.provider_ticket_url,
    paidAt: record.paid_at,
    expiresAt: record.expires_at,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function isProviderDocumentErrorMessage(message: string) {
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes("identification number") ||
    normalizedMessage.includes("cpf/cnpj") ||
    normalizedMessage.includes("documento")
  );
}

function isProviderCardFieldErrorMessage(message: string) {
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes("card") ||
    normalizedMessage.includes("token") ||
    normalizedMessage.includes("security_code") ||
    normalizedMessage.includes("cvc") ||
    normalizedMessage.includes("cvv") ||
    normalizedMessage.includes("expiration") ||
    normalizedMessage.includes("payment_method_id") ||
    normalizedMessage.includes("issuer")
  );
}

function isProviderPayerEmailErrorMessage(message: string) {
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes("payer email forbidden") ||
    (normalizedMessage.includes("payer email") &&
      normalizedMessage.includes("forbidden")) ||
    (normalizedMessage.includes("email") &&
      normalizedMessage.includes("forbidden"))
  );
}

function isProviderInvalidUsersMessage(message: string) {
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes("invalid users involved") ||
    (normalizedMessage.includes("invalid user") &&
      normalizedMessage.includes("involved"))
  );
}

function isIssuerAntifraudProviderMessage(message: string) {
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes("cc_rejected_high_risk") ||
    normalizedMessage.includes("high_risk") ||
    normalizedMessage.includes("analise antifraude do emissor") ||
    normalizedMessage.includes("anÃ¡lise antifraude do emissor") ||
    (normalizedMessage.includes("issuer") &&
      normalizedMessage.includes("fraud")) ||
    (normalizedMessage.includes("emissor") &&
      normalizedMessage.includes("fraud"))
  );
}

function resolvePayerEntityType(
  identificationType: "CPF" | "CNPJ",
): "individual" | "association" {
  return identificationType === "CNPJ" ? "association" : "individual";
}

async function ensureGuildAccess(guildId: string) {
  const sessionData = await resolveSessionAccessToken();
  if (!sessionData?.authSession) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Nao autenticado." },
        { status: 401 },
      ),
    };
  }

  if (!sessionData.accessToken) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Token OAuth ausente na sessao." },
        { status: 401 },
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
    // fallback resiliente quando houver erro temporario na API do Discord
    accessibleGuild = null;
  }

  const hasTeamAccess = accessibleGuild
    ? false
    : await hasAcceptedTeamAccessToGuild(
        {
          authSession: sessionData.authSession,
          accessToken: sessionData.accessToken,
        },
        guildId,
      );

  if (!accessibleGuild && !hasTeamAccess && sessionData.authSession.activeGuildId !== guildId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Servidor nao encontrado para este usuario." },
        { status: 403 },
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

async function createPaymentOrderEvent(
  paymentOrderId: number,
  eventType: string,
  eventPayload: PaymentOrderEventPayload,
) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase.from("payment_order_events").insert({
    payment_order_id: paymentOrderId,
    event_type: eventType,
    event_payload: eventPayload,
  });

  if (result.error) {
    throw new Error(`Erro ao salvar evento de pagamento: ${result.error.message}`);
  }
}

async function createPaymentOrderEventSafe(
  paymentOrderId: number,
  eventType: string,
  eventPayload: PaymentOrderEventPayload,
) {
  try {
    await createPaymentOrderEvent(paymentOrderId, eventType, eventPayload);
  } catch {
    // evento de telemetria nao pode quebrar o fluxo principal
  }
}

function shouldCancelCardPayment(status: string | null | undefined) {
  const normalized = (status || "").trim().toLowerCase();
  return (
    normalized === "authorized" ||
    normalized === "in_process" ||
    normalized === "pending"
  );
}

function shouldRefundCardPayment(status: string | null | undefined) {
  const normalized = (status || "").trim().toLowerCase();
  return normalized === "approved";
}

async function tryReverseCardProviderPayment(input: {
  orderId: number;
  providerPaymentId: string;
  payment: MercadoPagoPaymentResponse | null;
  reason: string;
}) {
  const providerPayment =
    input.payment ||
    (await fetchMercadoPagoPaymentById(input.providerPaymentId, {
      useCardToken: true,
    }));
  const providerStatus = providerPayment.status || null;

  if (shouldRefundCardPayment(providerStatus)) {
    await refundMercadoPagoCardPayment(input.providerPaymentId);
    await createPaymentOrderEventSafe(
      input.orderId,
      "provider_payment_auto_refunded_after_failure",
      {
        providerPaymentId: input.providerPaymentId,
        providerStatus,
        reason: input.reason,
      },
    );
    return {
      action: "refund" as const,
      providerPayment,
      providerStatus,
    };
  }

  if (shouldCancelCardPayment(providerStatus)) {
    await cancelMercadoPagoCardPayment(input.providerPaymentId);
    await createPaymentOrderEventSafe(
      input.orderId,
      "provider_payment_auto_cancelled_after_failure",
      {
        providerPaymentId: input.providerPaymentId,
        providerStatus,
        reason: input.reason,
      },
    );
    return {
      action: "cancel" as const,
      providerPayment,
      providerStatus,
    };
  }

  return {
    action: null,
    providerPayment,
    providerStatus,
  };
}

async function getLatestOrderForUserAndGuild(userId: number, guildId: string) {
  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase
    .from("payment_orders")
    .select(PAYMENT_ORDER_SELECT_COLUMNS)
    .eq("user_id", userId)
    .eq("guild_id", guildId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<PaymentOrderRecord>();

  if (result.error) {
    throw new Error(`Erro ao carregar pagamento: ${result.error.message}`);
  }

  return result.data || null;
}

async function getLatestCardOrderForUserAndGuild(userId: number, guildId: string) {
  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase
    .from("payment_orders")
    .select(PAYMENT_ORDER_SELECT_COLUMNS)
    .eq("user_id", userId)
    .eq("guild_id", guildId)
    .eq("payment_method", "card")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<PaymentOrderRecord>();

  if (result.error) {
    throw new Error(`Erro ao carregar pagamento com cartao: ${result.error.message}`);
  }

  return result.data || null;
}

async function getRecentCardOrdersForUser(userId: number, limit = 8) {
  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase
    .from("payment_orders")
    .select(PAYMENT_ORDER_SELECT_COLUMNS)
    .eq("user_id", userId)
    .eq("payment_method", "card")
    .order("updated_at", { ascending: false })
    .limit(limit)
    .returns<PaymentOrderRecord[]>();

  if (result.error) {
    throw new Error(
      `Erro ao carregar pagamentos recentes com cartao: ${result.error.message}`,
    );
  }

  return result.data || [];
}

async function getLatestApprovedOrderForUser(userId: number) {
  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase
    .from("payment_orders")
    .select(PAYMENT_ORDER_SELECT_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "approved")
    .order("paid_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<PaymentOrderRecord>();

  if (result.error) {
    throw new Error(
      `Erro ao carregar ultimo pagamento aprovado: ${result.error.message}`,
    );
  }

  return result.data || null;
}

async function getAuthUserById(userId: number) {
  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase
    .from("auth_users")
    .select("created_at")
    .eq("id", userId)
    .maybeSingle<AuthUserRecord>();

  if (result.error) {
    throw new Error(`Erro ao carregar usuario autenticado: ${result.error.message}`);
  }

  return result.data || null;
}

async function getActiveLicenseOrderForGuild(guildId: string) {
  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase
    .from("payment_orders")
    .select(PAYMENT_ORDER_SELECT_COLUMNS)
    .eq("guild_id", guildId)
    .eq("status", "approved")
    .order("paid_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(30)
    .returns<PaymentOrderRecord[]>();

  if (result.error) {
    throw new Error(
      `Erro ao carregar licenca ativa do servidor: ${result.error.message}`,
    );
  }

  const orders = result.data || [];
  return orders.find((order) => isLicenseActiveForOrder(order)) || null;
}

async function hasStoredGuildSetupConfiguration(guildId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const [ticketSettingsResult, staffSettingsResult] = await Promise.all([
    supabase
      .from("guild_ticket_settings")
      .select("id")
      .eq("guild_id", guildId)
      .maybeSingle<{ id: number }>(),
    supabase
      .from("guild_ticket_staff_settings")
      .select("id")
      .eq("guild_id", guildId)
      .maybeSingle<{ id: number }>(),
  ]);

  if (ticketSettingsResult.error) {
    throw new Error(
      `Erro ao verificar configuracoes de canais do servidor: ${ticketSettingsResult.error.message}`,
    );
  }

  if (staffSettingsResult.error) {
    throw new Error(
      `Erro ao verificar configuracoes de cargos do servidor: ${staffSettingsResult.error.message}`,
    );
  }

  return Boolean(ticketSettingsResult.data && staffSettingsResult.data);
}

async function createDraftOrderForCheckout(input: {
  userId: number;
  guildId: string;
  amount: number;
  currency: string;
  cardChannel: string;
  plan: PlanPricingDefinition;
}) {
  const supabase = getSupabaseAdminClientOrThrow();

  const createdOrderResult = await supabase
    .from("payment_orders")
    .insert({
      user_id: input.userId,
      guild_id: input.guildId,
      payment_method: "card",
      status: "pending",
      amount: input.amount,
      currency: input.currency,
      plan_code: input.plan.code,
      plan_name: input.plan.name,
      plan_billing_cycle_days: input.plan.billingCycleDays,
      plan_max_licensed_servers: input.plan.entitlements.maxLicensedServers,
      plan_max_active_tickets: input.plan.entitlements.maxActiveTickets,
      plan_max_automations: input.plan.entitlements.maxAutomations,
      plan_max_monthly_actions: input.plan.entitlements.maxMonthlyActions,
      provider: "mercado_pago",
      expires_at: resolveUnpaidSetupExpiresAt(),
      provider_payload: {
        source: "flowdesk_checkout",
        step: 4,
        channel: input.cardChannel,
        precreated: true,
        plan: {
          code: input.plan.code,
          name: input.plan.name,
          billingCycleDays: input.plan.billingCycleDays,
          entitlements: {
            ...input.plan.entitlements,
          },
        },
      },
    })
    .select(PAYMENT_ORDER_SELECT_COLUMNS)
    .single<PaymentOrderRecord>();

  if (createdOrderResult.error || !createdOrderResult.data) {
    throw new Error(createdOrderResult.error?.message || "Falha ao iniciar pedido.");
  }

  await createPaymentOrderEvent(createdOrderResult.data.id, "order_created", {
    orderNumber: createdOrderResult.data.order_number,
    guildId: input.guildId,
    userId: input.userId,
    precreated: true,
    method: "card",
  });

  return createdOrderResult.data;
}

export async function POST(request: Request) {
  const baseRequestContext = createSecurityRequestContext(request);
  let auditContext = baseRequestContext;
  const respond = (body: unknown, init?: ResponseInit) =>
    attachRequestId(NextResponse.json(body, init), baseRequestContext.requestId);

  try {
    const securityResponse = ensureSameOriginJsonMutationRequest(request);
    if (securityResponse) return attachRequestId(securityResponse, baseRequestContext.requestId);

    let body: CreateCardPaymentBody = {};
    try {
      body = (await request.json()) as CreateCardPaymentBody;
    } catch {
      return respond(
        { ok: false, message: "Payload JSON invalido." },
        { status: 400 },
      );
    }

    const guildId = normalizeGuildId(body.guildId);
    const payerName = normalizePayerName(body.payerName);
    const payerDocument = normalizePayerDocument(body.payerDocument);
    const billingZipCode = normalizeBillingZipCode(body.billingZipCode);
    const cardToken = normalizeCardToken(body.cardToken);
    const paymentMethodId = normalizePaymentMethodId(body.paymentMethodId);
    const installments = normalizeInstallments(body.installments);
    const issuerId = normalizeIssuerId(body.issuerId);
    const deviceSessionId = normalizeDeviceSessionId(body.deviceSessionId);

    if (!guildId) {
      return respond(
        { ok: false, message: "Guild ID invalido para pagamento." },
        { status: 400 },
      );
    }

    if (!payerName) {
      return respond(
        { ok: false, message: "Nome completo invalido para pagamento." },
        { status: 400 },
      );
    }

    if (!payerDocument) {
      return respond(
        { ok: false, message: "CPF/CNPJ invalido para pagamento." },
        { status: 400 },
      );
    }

    if (!billingZipCode) {
      return respond(
        { ok: false, message: "CEP de cobranca invalido para pagamento." },
        { status: 400 },
      );
    }

    if (!cardToken || !paymentMethodId || installments === null) {
      return respond(
        { ok: false, message: "Dados do cartao invalidos para pagamento." },
        { status: 400 },
      );
    }

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) {
      return attachRequestId(access.response, baseRequestContext.requestId);
    }
    auditContext = extendSecurityRequestContext(baseRequestContext, {
      sessionId: access.context.sessionData.authSession.id,
      userId: access.context.sessionData.authSession.user.id,
      guildId,
    });

    const rateLimit = await enforceRequestRateLimit({
      action: "payment_card_post",
      windowMs: 10 * 60 * 1000,
      maxAttempts: 8,
      context: auditContext,
    });
    if (!rateLimit.ok) {
      await logSecurityAuditEventSafe(auditContext, {
        action: "payment_card_post",
        outcome: "blocked",
        metadata: {
          reason: "rate_limit",
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
      });
      const response = respond(
        {
          ok: false,
          message:
            "Muitas tentativas com cartao em pouco tempo. Aguarde alguns instantes antes de tentar novamente.",
        },
        { status: 429 },
      );
      response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
      return response;
    }

    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_card_post",
      outcome: "started",
      metadata: {
        installments,
      },
    });

    if (!areCardPaymentsEnabled()) {
      await logSecurityAuditEventSafe(auditContext, {
        action: "payment_card_post",
        outcome: "blocked",
        metadata: {
          reason: "card_payments_disabled",
        },
      });

      return respond(
        {
          ok: false,
          message: CARD_PAYMENTS_DISABLED_MESSAGE,
        },
        { status: 503 },
      );
    }

    const user = access.context.sessionData.authSession.user;
    await cleanupExpiredUnpaidServerSetups({
      userId: user.id,
      guildId,
      source: "payment_card_post",
    });

    const activeLicenseOrder = await getActiveLicenseOrderForGuild(guildId);
    if (activeLicenseOrder) {
      return respond({
        ok: true,
        blockedByActiveLicense: true,
        licenseActive: true,
        licenseExpiresAt: resolveLicenseExpiresAt(activeLicenseOrder),
        order: toApiOrder(activeLicenseOrder),
      });
    }

    if (!(await hasStoredGuildSetupConfiguration(guildId))) {
      return respond(
        {
          ok: false,
          message:
            "A configuracao desse servidor expirou apos 30 minutos sem pagamento. RefaÃ§a a configuracao antes de gerar um novo checkout.",
        },
        { status: 409 },
      );
    }

    const supabase = getSupabaseAdminClientOrThrow();
    const [latestOrder, latestCardOrder, recentCardOrders, latestApprovedOrder, authUser] = await Promise.all([
      getLatestOrderForUserAndGuild(user.id, guildId),
      getLatestCardOrderForUserAndGuild(user.id, guildId),
      getRecentCardOrdersForUser(user.id),
      getLatestApprovedOrderForUser(user.id),
      getAuthUserById(user.id),
    ]);

    const latestMatchingGlobalCardOrder =
      recentCardOrders.find((order) => {
        if (order.payment_method !== "card") return false;
        if (
          order.payer_document &&
          order.payer_document !== payerDocument.normalized
        ) {
          return false;
        }
        if (
          order.payer_name &&
          normalizeNameForComparison(order.payer_name) !==
            normalizeNameForComparison(payerName)
        ) {
          return false;
        }
        return true;
      }) || null;

    const hasRecentPendingCardOrder =
      !!latestCardOrder &&
      latestCardOrder.payment_method === "card" &&
      latestCardOrder.status === "pending" &&
      !!latestCardOrder.provider_payment_id &&
      (isRecentOrderTimestamp(
        latestCardOrder.updated_at,
        CARD_PENDING_REUSE_WINDOW_MS,
      ) ||
        isRecentOrderTimestamp(
          latestCardOrder.created_at,
          CARD_PENDING_REUSE_WINDOW_MS,
        ));

    const payerNameParts = payerName.split(/\s+/).filter(Boolean);
    const payerFirstName = payerNameParts[0] || "Cliente";
    const payerLastName = payerNameParts.slice(1).join(" ") || undefined;
    const registrationDate = authUser?.created_at || null;
    const lastApprovedPurchaseDate =
      latestApprovedOrder?.paid_at || latestApprovedOrder?.created_at || null;
    const isFirstPurchaseOnline = !latestApprovedOrder;

    if (hasRecentPendingCardOrder && latestCardOrder) {
      try {
        await createPaymentOrderEvent(
          latestCardOrder.id,
          "card_payment_reused_pending",
          {
            userId: user.id,
            guildId,
            orderNumber: latestCardOrder.order_number,
            providerPaymentId: latestCardOrder.provider_payment_id,
          },
        );
      } catch {
        // nao bloquear resposta principal por falha de log
      }

      return respond({
        ok: true,
        reused: true,
        alreadyProcessing: true,
        order: toApiOrder(latestCardOrder),
      });
    }

    const retryCooldownSeconds = resolveCardRetryCooldownSeconds({
      latestCardOrder: latestMatchingGlobalCardOrder || latestCardOrder,
      payerDocument: payerDocument.normalized,
      payerName,
    });
    if (retryCooldownSeconds && latestCardOrder) {
      try {
        await createPaymentOrderEvent(
          latestCardOrder.id,
          "card_retry_blocked_by_cooldown",
          {
            userId: user.id,
            guildId,
            retryAfterSeconds: retryCooldownSeconds,
            status: latestCardOrder.status,
            providerStatus: latestCardOrder.provider_status,
            providerStatusDetail: latestCardOrder.provider_status_detail,
          },
        );
      } catch {
        // nao bloquear o fluxo em caso de falha ao gravar evento
      }

      const response = respond(
        {
          ok: false,
          message: `Para reduzir bloqueio antifraude, aguarde ${retryCooldownSeconds}s antes de tentar novamente com cartao.`,
          retryAfterSeconds: retryCooldownSeconds,
          order: toApiOrder(latestCardOrder),
        },
        { status: 429 },
      );
      response.headers.set("Retry-After", String(retryCooldownSeconds));
      return response;
    }

    const checkoutPlan = await resolveCheckoutPlanForGuild({
      userId: user.id,
      guildId,
      requestedPlanCode: body.planCode,
      requestedBillingPeriodCode: body.billingPeriodCode,
    });

    if (checkoutPlan.plan.isTrial) {
      return respond(
        {
          ok: false,
          message:
            "O plano gratuito e ativado sem cartao. Use a acao de ativacao gratuita na tela de pagamento.",
        },
        { status: 409 },
      );
    }

    const amount = checkoutPlan.amount;
    const currency = checkoutPlan.currency;
    const cardEnvironment = resolveMercadoPagoCardEnvironment();
    const cardChannel =
      cardEnvironment === "production" ? "card_production" : "card_test";

    let createdOrder: PaymentOrderRecord;
    const canReuseDraftOrderForPayment =
      !!latestOrder &&
      latestOrder.status === "pending" &&
      !latestOrder.provider_payment_id;

    if (canReuseDraftOrderForPayment) {
      const reusedOrderResult = await supabase
        .from("payment_orders")
        .update({
          payment_method: "card",
          status: "pending",
          amount,
          currency,
          plan_code: checkoutPlan.plan.code,
          plan_name: checkoutPlan.plan.name,
          plan_billing_cycle_days: checkoutPlan.plan.billingCycleDays,
          plan_max_licensed_servers: checkoutPlan.plan.entitlements.maxLicensedServers,
          plan_max_active_tickets: checkoutPlan.plan.entitlements.maxActiveTickets,
          plan_max_automations: checkoutPlan.plan.entitlements.maxAutomations,
          plan_max_monthly_actions: checkoutPlan.plan.entitlements.maxMonthlyActions,
          expires_at: resolveUnpaidSetupExpiresAt(latestOrder.created_at),
          payer_name: payerName,
          payer_document: payerDocument.normalized,
          payer_document_type: payerDocument.type,
          provider_status: null,
          provider_status_detail: null,
          provider_qr_code: null,
          provider_qr_base64: null,
          provider_ticket_url: null,
          provider_payload: {
            source: "flowdesk_checkout",
            step: 4,
            channel: cardChannel,
            pricing: {
              baseAmount: amount,
              subtotalAmount: amount,
              totalAmount: amount,
              currency,
              coupon: null,
              giftCard: null,
            },
            plan: {
              code: checkoutPlan.plan.code,
              name: checkoutPlan.plan.name,
              billingCycleDays: checkoutPlan.plan.billingCycleDays,
              entitlements: {
                ...checkoutPlan.plan.entitlements,
              },
            },
          },
        })
        .eq("id", latestOrder.id)
        .select(PAYMENT_ORDER_SELECT_COLUMNS)
        .single<PaymentOrderRecord>();

      if (reusedOrderResult.error || !reusedOrderResult.data) {
        throw new Error(reusedOrderResult.error?.message || "Falha ao preparar pedido.");
      }

      createdOrder = reusedOrderResult.data;

      await createPaymentOrderEvent(createdOrder.id, "order_payment_started", {
        orderNumber: createdOrder.order_number,
        guildId,
        userId: user.id,
        method: "card",
      });
    } else {
      createdOrder = await createDraftOrderForCheckout({
        userId: user.id,
        guildId,
        amount,
        currency,
        cardChannel,
        plan: checkoutPlan.plan,
      });

      const preparedOrderResult = await supabase
        .from("payment_orders")
        .update({
          payment_method: "card",
          payer_name: payerName,
          payer_document: payerDocument.normalized,
          payer_document_type: payerDocument.type,
        })
        .eq("id", createdOrder.id)
        .select(PAYMENT_ORDER_SELECT_COLUMNS)
        .single<PaymentOrderRecord>();

      if (preparedOrderResult.error || !preparedOrderResult.data) {
        throw new Error(preparedOrderResult.error?.message || "Falha ao preparar pedido.");
      }

      createdOrder = preparedOrderResult.data;
    }

    const externalReference = `flowdesk-order-${createdOrder.order_number}`;
    const discordPayerEmail = normalizePayerEmail(user.email);
    if (!discordPayerEmail) {
      return respond(
        {
          ok: false,
          message:
              "Nao foi possivel identificar um e-mail valido da conta Discord para pagamento com cartao.",
        },
        { status: 400 },
      );
    }

    let createdProviderPayment: MercadoPagoPaymentResponse | null = null;

    try {
      const mercadoPagoPayment = await createMercadoPagoCardPayment({
        amount,
        description: `${checkoutPlan.plan.name} #${createdOrder.order_number}`,
        payerName,
        payerEmail: discordPayerEmail,
        payerIdentification: {
          type: payerDocument.type,
          number: payerDocument.normalized,
        },
        payerEntityType: resolvePayerEntityType(payerDocument.type),
        payerAddress: {
          zipCode: billingZipCode,
        },
        externalReference,
        metadata: {
          flowdesk_order_number: String(createdOrder.order_number),
          flowdesk_user_id: String(user.id),
          flowdesk_discord_user_id: user.discord_user_id,
          flowdesk_guild_id: guildId,
          flowdesk_plan_code: checkoutPlan.plan.code,
          flowdesk_plan_name: checkoutPlan.plan.name,
          flowdesk_payment_channel: cardChannel,
          flowdesk_checkout_surface: "config_step_4_card",
        },
        token: cardToken,
        paymentMethodId,
        installments,
        issuerId,
        deviceSessionId,
        idempotencyKey: `flowdesk-card-order-${createdOrder.id}`,
        binaryMode: false,
        threeDSecureMode: "optional",
        statementDescriptor: "FLOWDESK",
        additionalInfo: {
          items: [
            {
              id: `flowdesk-plan-${guildId}`,
              title: checkoutPlan.plan.name,
              description: `${checkoutPlan.plan.checkoutPeriodLabel} para o servidor ${guildId} no painel Flowdesk`,
              category_id: "services",
              quantity: 1,
              unit_price: amount,
            },
          ],
          payer: {
            first_name: payerFirstName,
            last_name: payerLastName,
            registration_date: registrationDate || undefined,
            last_purchase: lastApprovedPurchaseDate || undefined,
            is_first_purchase_online: isFirstPurchaseOnline,
            address: {
              zip_code: billingZipCode,
            },
          },
        },
      });
      createdProviderPayment = mercadoPagoPayment;

      const providerPaymentId = String(mercadoPagoPayment.id);
      let latestProviderPayment = mercadoPagoPayment;
      try {
        const snapshot = await fetchMercadoPagoPaymentById(providerPaymentId, {
          useCardToken: true,
        });
        if (snapshot && typeof snapshot === "object") {
          latestProviderPayment = snapshot;
        }
      } catch {
        // fallback para retorno inicial quando a consulta imediata ainda nao estiver disponivel
      }

      const providerStatus =
        latestProviderPayment.status || mercadoPagoPayment.status || null;
      const resolvedStatus = resolvePaymentStatus(providerStatus);
      const paidAt =
        resolvedStatus === "approved"
          ? latestProviderPayment.date_approved ||
            mercadoPagoPayment.date_approved ||
            new Date().toISOString()
          : null;
      const expiresAt = resolveUnpaidSetupEffectiveExpiresAt({
        createdAt: createdOrder.created_at,
        providerExpiresAt:
          latestProviderPayment.date_of_expiration ||
          mercadoPagoPayment.date_of_expiration ||
          null,
      });
      const diagnostic = resolvePaymentDiagnostic({
        paymentMethod: "card",
        status: resolvedStatus,
        providerStatus,
        providerStatusDetail:
          latestProviderPayment.status_detail ||
          mercadoPagoPayment.status_detail ||
          null,
      });

      const updatedOrderResult = await supabase
        .from("payment_orders")
        .update({
          status: resolvedStatus,
          provider_payment_id: providerPaymentId,
          provider_external_reference: externalReference,
          provider_qr_code: null,
          provider_qr_base64: null,
          provider_ticket_url: null,
          provider_status: providerStatus,
          provider_status_detail:
            latestProviderPayment.status_detail ||
            mercadoPagoPayment.status_detail ||
            null,
          provider_payload: {
            source: "flowdesk_checkout",
            step: 4,
            channel: cardChannel,
            payer_email_source: "discord",
            payer_email_masked: maskEmail(discordPayerEmail),
            billing_zip_code_present: true,
            device_session_id_present: Boolean(deviceSessionId),
            flowdesk_diagnostic: diagnostic,
            mercado_pago: latestProviderPayment,
            mercado_pago_initial: mercadoPagoPayment,
          },
          paid_at: paidAt,
          expires_at: expiresAt,
        })
        .eq("id", createdOrder.id)
        .select(PAYMENT_ORDER_SELECT_COLUMNS)
        .single<PaymentOrderRecord>();

      if (updatedOrderResult.error || !updatedOrderResult.data) {
        throw new Error(
          updatedOrderResult.error?.message ||
            "Falha ao salvar retorno do pagamento.",
        );
      }

      await createPaymentOrderEvent(createdOrder.id, "provider_payment_created", {
        providerPaymentId,
        providerStatus,
        providerStatusDetail:
          latestProviderPayment.status_detail ||
          mercadoPagoPayment.status_detail ||
          null,
        diagnosticCategory: diagnostic.category,
        payerEmailSource: "discord",
        payerEmailMasked: maskEmail(discordPayerEmail),
        billingZipCodePresent: true,
        cardEnvironment,
        deviceSessionIdPresent: Boolean(deviceSessionId),
        method: "card",
      });

      await logSecurityAuditEventSafe(auditContext, {
        action: "payment_card_post",
        outcome: "succeeded",
        metadata: {
          orderNumber: updatedOrderResult.data.order_number,
          status: updatedOrderResult.data.status,
        },
      });

      if (updatedOrderResult.data.status === "approved") {
        await syncUserPlanStateFromOrder(updatedOrderResult.data);
      }

      const apiOrder = toApiOrder(updatedOrderResult.data);
      const retryAfterSeconds =
        updatedOrderResult.data.status === "rejected" &&
        updatedOrderResult.data.provider_status_detail &&
        isIssuerAntifraudProviderMessage(
          updatedOrderResult.data.provider_status_detail,
        )
          ? Math.ceil(CARD_ISSUER_ANTIFRAUD_COOLDOWN_MS / 1000)
          : null;

      return respond({
        ok: true,
        reused: false,
        retryAfterSeconds,
        order: apiOrder,
      });
    } catch (providerError) {
      const message =
        providerError instanceof Error
          ? providerError.message
          : "Falha ao criar pagamento com cartao.";

      const providerPaymentId = createdProviderPayment
        ? String(createdProviderPayment.id)
        : null;

      if (providerPaymentId && !createdOrder.provider_payment_id) {
        let recoveredOrder: PaymentOrderRecord | null = null;
        let recoveredProviderPayment = createdProviderPayment;

        try {
          const snapshot = await fetchMercadoPagoPaymentById(providerPaymentId, {
            useCardToken: true,
          });
          if (snapshot && typeof snapshot === "object") {
            recoveredProviderPayment = snapshot;
          }
        } catch {
          // manter retorno inicial do provedor se o snapshot nao estiver disponivel
        }

        try {
          const providerStatus = recoveredProviderPayment?.status || null;
          const resolvedStatus = resolvePaymentStatus(providerStatus);
          const paidAt =
            resolvedStatus === "approved"
              ? recoveredProviderPayment?.date_approved || new Date().toISOString()
              : null;
          const expiresAt = resolveUnpaidSetupEffectiveExpiresAt({
            createdAt: createdOrder.created_at,
            providerExpiresAt:
              recoveredProviderPayment?.date_of_expiration || null,
          });
          const diagnostic = resolvePaymentDiagnostic({
            paymentMethod: "card",
            status: resolvedStatus,
            providerStatus,
            providerStatusDetail:
              recoveredProviderPayment?.status_detail || message,
          });

          const recoveredOrderResult = await supabase
            .from("payment_orders")
            .update({
              status: resolvedStatus,
              provider_payment_id: providerPaymentId,
              provider_external_reference: externalReference,
              provider_qr_code: null,
              provider_qr_base64: null,
              provider_ticket_url: null,
              provider_status: providerStatus,
              provider_status_detail:
                recoveredProviderPayment?.status_detail || message,
              provider_payload: {
                source: "flowdesk_checkout",
                step: 4,
                channel: cardChannel,
                recovery_after_error: true,
                payer_email_source: "discord",
                payer_email_masked: maskEmail(discordPayerEmail),
                device_session_id_present: Boolean(deviceSessionId),
                flowdesk_diagnostic: diagnostic,
                mercado_pago: recoveredProviderPayment,
              },
              paid_at: paidAt,
              expires_at: expiresAt,
            })
            .eq("id", createdOrder.id)
            .select(PAYMENT_ORDER_SELECT_COLUMNS)
            .single<PaymentOrderRecord>();

          if (recoveredOrderResult.error || !recoveredOrderResult.data) {
            throw new Error(
              recoveredOrderResult.error?.message ||
                "Falha ao recuperar pagamento com cartao apos erro local.",
            );
          }

          recoveredOrder = recoveredOrderResult.data;

          await createPaymentOrderEventSafe(
            createdOrder.id,
            "provider_payment_recovered_after_error",
            {
              providerPaymentId,
              providerStatus,
              resolvedStatus,
              diagnosticCategory: diagnostic.category,
              method: "card",
            },
          );
        } catch {
          try {
            await tryReverseCardProviderPayment({
              orderId: createdOrder.id,
              providerPaymentId,
              payment: recoveredProviderPayment,
              reason: "recovery_after_local_failure",
            });
          } catch {
            // melhor esforco
          }
        }

        if (recoveredOrder) {
          await logSecurityAuditEventSafe(auditContext, {
            action: "payment_card_post",
            outcome: "succeeded",
            metadata: {
              orderNumber: recoveredOrder.order_number,
              status: recoveredOrder.status,
              recoveredAfterFailure: true,
            },
          });

          if (recoveredOrder.status === "approved") {
            await syncUserPlanStateFromOrder(recoveredOrder);
          }

          return respond({
            ok: true,
            reused: false,
            recovered: true,
            order: toApiOrder(recoveredOrder),
          });
        }
      }

      await supabase
        .from("payment_orders")
        .update({
          status: "failed",
          provider_external_reference: externalReference,
          provider_status: "error",
          provider_status_detail: message,
        })
        .eq("id", createdOrder.id);

      await createPaymentOrderEvent(createdOrder.id, "provider_payment_failed", {
        message,
        method: "card",
      });

      if (isProviderDocumentErrorMessage(message)) {
        return respond(
          { ok: false, message: "CPF/CNPJ invalido para pagamento." },
          { status: 400 },
        );
      }

      if (isProviderCardFieldErrorMessage(message)) {
        return respond(
          { ok: false, message: "Dados do cartao invalidos para pagamento." },
          { status: 400 },
        );
      }

      if (isProviderPayerEmailErrorMessage(message)) {
        return respond(
          {
            ok: false,
            message:
              "O e-mail da conta Discord nao foi aceito pelo provedor de pagamento. Verifique o e-mail da conta e tente novamente.",
          },
          { status: 400 },
        );
      }

      if (isProviderInvalidUsersMessage(message)) {
        return respond(
          {
            ok: false,
            message:
              "Nao foi possivel validar os dados do pagador no provedor. Confira os dados do titular e tente novamente.",
          },
          { status: 400 },
        );
      }

      if (isIssuerAntifraudProviderMessage(message)) {
        const response = respond(
          {
            ok: false,
            retryAfterSeconds: Math.ceil(
              CARD_ISSUER_ANTIFRAUD_COOLDOWN_MS / 1000,
            ),
            message:
              "Pagamento recusado na analise antifraude do emissor. Aguarde alguns minutos e tente novamente com o mesmo titular, no mesmo dispositivo e na mesma rede.",
          },
          { status: 429 },
        );
        response.headers.set(
          "Retry-After",
          String(Math.ceil(CARD_ISSUER_ANTIFRAUD_COOLDOWN_MS / 1000)),
        );
        return response;
      }

      throw new Error(message);
    }
  } catch (error) {
    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_card_post",
      outcome: "failed",
      metadata: {
        message: error instanceof Error ? error.message : "unknown_error",
      },
    });
    return respond(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao criar pagamento com cartao.",
      },
      { status: 500 },
    );
  }
}

