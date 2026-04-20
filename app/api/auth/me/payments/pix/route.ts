import { NextResponse } from "next/server";
import { clearPlanStateCacheForUser } from "@/lib/account/managedPlanState";
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
  createMercadoPagoPixPayment,
  fetchMercadoPagoPaymentById,
  refundMercadoPagoPixPayment,
  resolveMercadoPagoPixPayerEmail,
  resolvePaymentStatus,
  toQrDataUri,
  type MercadoPagoPaymentResponse,
} from "@/lib/payments/mercadoPago";
import {
  createStablePaymentIdempotencyKey,
  extractMercadoPagoPaymentIdentifiers,
  resolveNextPaymentOrderStatus,
  resolveTrustedMercadoPagoPaymentTimestamps,
} from "@/lib/payments/paymentIntegrity";
import {
  encryptPaymentSensitiveValue,
  resolvePaymentDocumentLast4,
} from "@/lib/payments/paymentPii";
import { resolveDiscountPricing } from "@/lib/payments/discountPricing";
import {
  ensureCheckoutAccessTokenForOrder,
  PAYMENT_ORDER_CHECKOUT_LINK_SELECT_COLUMNS,
  resolveCheckoutLinkFailureMessage,
  verifyCheckoutAccessToken,
} from "@/lib/payments/checkoutLinkSecurity";
import {
  cleanupExpiredUnpaidServerSetups,
  resolveUnpaidSetupEffectiveExpiresAt,
  resolveUnpaidSetupExpiresAt,
} from "@/lib/payments/setupCleanup";
import {
  getApprovedOrdersForGuild,
  invalidateGuildLicenseCaches,
  resolveCoverageForApprovedOrder,
  resolveLatestLicenseCoverageFromApprovedOrders,
  resolveRenewalPaymentDecision,
} from "@/lib/payments/licenseStatus";
import {
  getCachedLatestPaymentOrderForUserAndGuild,
  getCachedLatestPendingDraftPaymentOrderForUserAndGuild,
  getCachedPaymentOrderByCodeForGuild,
  invalidatePaymentOrderQueryCaches,
} from "@/lib/payments/orderQueryCache";
import {
  type PlanPricingDefinition,
  resolvePlanPricing,
  normalizePlanCode,
  normalizePlanBillingPeriodCode,
} from "@/lib/plans/catalog";

import {
  resolveApprovedOrderLicenseExpiresAt,
  resolveEffectivePlanSelection,
  syncUserPlanStateFromOrder,
} from "@/lib/plans/state";
import {
  applyFlowPointsToAmount,
  buildPlanTransitionPayload,
  orderTransitionAllowsImmediateApproval,
  resolvePlanChangePreview,
  type PlanChangePreview,
} from "@/lib/plans/change";
import {
  extractAuditErrorMessage,
  sanitizeErrorMessage,
} from "@/lib/security/errors";
import {
  flowSecureDto,
  FlowSecureDtoError,
  parseFlowSecureDto,
} from "@/lib/security/flowSecure";
import {
  resolveDatabaseFailureMessage,
  resolveDatabaseFailureStatus,
} from "@/lib/security/databaseAvailability";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";
import { runCoalescedRouteResponse } from "@/lib/security/routeCoalescing";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  extendSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";
import { runCoalescedPaymentRequest } from "@/lib/payments/requestCoalescing";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type CreatePixPaymentBody = {
  guildId?: unknown;
  planCode?: unknown;
  billingPeriodCode?: unknown;
  payerName?: unknown;
  payerDocument?: unknown;
  couponCode?: unknown;
  giftCardCode?: unknown;
  forceNew?: unknown;
};

export type PaymentOrderRecord = {
  id: number;
  order_number: number;
  guild_id: string;
  payment_method: "pix" | "card" | "trial";
  status: string;
  amount: string | number;
  currency: string;
  plan_code: string;
  plan_name: string;
  plan_billing_cycle_days: number;
  plan_max_licensed_servers: number;
  plan_max_active_tickets: number;
  plan_max_automations: number;
  plan_max_monthly_actions: number;
  payer_name: string | null;
  payer_document: string | null;
  payer_document_last4: string | null;
  payer_document_type: "CPF" | "CNPJ" | null;
  payer_document_encrypted?: string | null;
  provider_payment_id: string | null;
  provider_external_reference: string | null;
  provider_qr_code: string | null;
  provider_qr_base64: string | null;
  provider_ticket_url: string | null;
  provider_payload: unknown;
  provider_status: string | null;
  provider_status_detail: string | null;
  paid_at: string | null;
  expires_at: string | null;
  user_id: number;
  checkout_link_nonce: string | null;
  checkout_link_expires_at: string | null;
  checkout_link_invalidated_at: string | null;
  created_at: string;
  updated_at: string;
};

type PaymentOrderEventPayload = Record<string, unknown>;

const DEFAULT_PIX_CURRENCY = "BRL";
const PENDING_REUSE_WINDOW_MS = 25 * 60 * 1000;
const ORDER_EXPIRATION_SAFETY_BUFFER_MS = 45 * 1000;
const PAYMENT_ROUTE_COALESCE_TTL_MS = 1500;
export const PAYMENT_ORDER_SELECT_COLUMNS =
  `id, order_number, guild_id, payment_method, status, amount, currency, plan_code, plan_name, plan_billing_cycle_days, plan_max_licensed_servers, plan_max_active_tickets, plan_max_automations, plan_max_monthly_actions, payer_name, payer_document, payer_document_last4, payer_document_type, provider_payment_id, provider_external_reference, provider_qr_code, provider_qr_base64, provider_ticket_url, provider_payload, provider_status, provider_status_detail, paid_at, expires_at, user_id, created_at, updated_at, ${PAYMENT_ORDER_CHECKOUT_LINK_SELECT_COLUMNS}`;

export function invalidatePaymentReadCachesForOrder(
  order:
    | Pick<PaymentOrderRecord, "id" | "order_number" | "user_id" | "guild_id">
    | null
    | undefined,
) {
  if (!order) return;
  invalidatePaymentOrderQueryCaches({
    userId: order.user_id,
    guildId: order.guild_id,
    orderId: order.id,
    orderNumber: order.order_number,
  });
}

function invalidateLicenseReadCachesForOrder(
  order: Pick<PaymentOrderRecord, "guild_id"> | null | undefined,
) {
  if (order && typeof order.guild_id === "string" && order.guild_id.trim()) {
    invalidateGuildLicenseCaches(order.guild_id);
  }
}

function mergeProviderPayload(
  currentPayload: unknown,
  patch: Record<string, unknown>,
) {
  const basePayload =
    currentPayload && typeof currentPayload === "object" && !Array.isArray(currentPayload)
      ? currentPayload
      : {};

  return {
    ...basePayload,
    ...patch,
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

export function normalizeGuildId(value: unknown) {
  if (typeof value !== "string") return null;
  const guildId = value.trim();
  return isGuildId(guildId) ? guildId : null;
}

function normalizeOrderCode(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{1,12}$/.test(trimmed)) return null;
  const numeric = Number(trimmed);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  return numeric;
}

function normalizePayerName(value: unknown) {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) return null;
  if (name.length < 3 || name.length > 120) return null;
  return name;
}

export function normalizePayerEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
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

export function parseForceNewFlag(value: unknown) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  if (typeof value === "number") return value === 1;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function maskPayerDocument(
  document: string | null,
  documentLast4?: string | null,
) {
  const digits = document?.replace(/\D/g, "") || "";
  if (digits) {
    if (digits.length <= 4) return digits;
    return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
  }

  const normalizedLast4 =
    typeof documentLast4 === "string" && /^\d{1,4}$/.test(documentLast4.trim())
      ? documentLast4.trim()
      : null;
  if (!normalizedLast4) return null;
  return `${"*".repeat(Math.max(4, normalizedLast4.length))}${normalizedLast4}`;
}

function parseAmount(amount: string | number) {
  if (typeof amount === "number") return amount;
  const numeric = Number(amount);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundCurrencyAmount(amount: number) {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

export function resolveFlowPointsGrantedFromSubtotal(input: {
  planChange: PlanChangePreview;
  discountedSubtotalAmount: number;
}) {
  if (input.planChange.kind !== "upgrade") return 0;
  const normalizedCredit = roundCurrencyAmount(Math.max(0, input.planChange.currentCreditAmount));
  // O grant é o excesso do crédito sobre o preço ORIGINAL do novo plano.
  // Não usamos o subtotal com desconto: cupom/gift card reduzem o que o usuário paga,
  // mas não devem aumentar os FlowPoints devolvidos — senão doamos dinheiro extra.
  const targetTotalAmount = roundCurrencyAmount(Math.max(0, input.planChange.targetTotalAmount));
  return roundCurrencyAmount(Math.max(0, normalizedCredit - targetTotalAmount));
}

function normalizeCurrency(value: string | null | undefined) {
  return (value || "").trim().toUpperCase();
}

function amountsMatch(left: string | number, right: number) {
  return Math.round(parseAmount(left) * 100) === Math.round(right * 100);
}

function currenciesMatch(left: string | null | undefined, right: string) {
  return normalizeCurrency(left) === normalizeCurrency(right);
}

function resolvePixCurrency() {
  return process.env.MERCADO_PAGO_PIX_CURRENCY || DEFAULT_PIX_CURRENCY;
}

function isRecentOrderTimestamp(
  value: string | null | undefined,
  windowMs: number,
) {
  const timestamp = parseTimestampMs(value);
  if (timestamp === null) return false;
  return Date.now() - timestamp <= windowMs;
}

function parseTimestampMs(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isUniqueConstraintError(error: { code?: string; message?: string } | null | undefined) {
  return (
    error?.code === "23505" ||
    (typeof error?.message === "string" &&
      error.message.toLowerCase().includes("duplicate key"))
  );
}

async function resolveApprovedOrderExpiresAt(
  order: Pick<
    PaymentOrderRecord,
    | "id"
    | "user_id"
    | "payment_method"
    | "created_at"
    | "paid_at"
    | "plan_billing_cycle_days"
    | "plan_code"
  >,
  paidAtOverride?: string | null,
) {
  const resolution = await resolveApprovedOrderLicenseExpiresAt({
    order,
    paidAtOverride,
  });
  return resolution.expiresAt;
}

function isExpirationRelatedProviderErrorMessage(message: string) {
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes("date_of_expiration") ||
    normalizedMessage.includes("date of expiration") ||
    normalizedMessage.includes("expiration") ||
    normalizedMessage.includes("expired") ||
    normalizedMessage.includes("prazo") ||
    normalizedMessage.includes("expir")
  );
}

export function isOrderExpiredOrExpiringSoon(
  order: Pick<
    PaymentOrderRecord,
    "status" | "provider_status" | "provider_status_detail" | "expires_at" | "created_at"
  >,
  bufferMs = 0,
) {
  const resolvedProviderStatus = resolvePaymentStatus(
    order.provider_status || order.status,
  );
  if (order.status === "expired" || resolvedProviderStatus === "expired") {
    return true;
  }

  const providerDetail = (order.provider_status_detail || "").trim().toLowerCase();
  if (
    providerDetail === "expired" ||
    providerDetail === "unpaid_setup_timeout_cleanup" ||
    providerDetail === "auto_refund_after_unpaid_setup_timeout"
  ) {
    return true;
  }

  const directExpiresAtMs = parseTimestampMs(order.expires_at);
  const fallbackExpiresAtMs = parseTimestampMs(
    resolveUnpaidSetupExpiresAt(order.created_at),
  );
  const expiresAtMs = directExpiresAtMs ?? fallbackExpiresAtMs;
  if (expiresAtMs === null) return false;

  return expiresAtMs <= Date.now() + Math.max(0, bufferMs);
}

export function canReuseDraftCheckoutOrder(order: PaymentOrderRecord) {
  return (
    order.status === "pending" &&
    !order.provider_payment_id &&
    !isOrderExpiredOrExpiringSoon(order, ORDER_EXPIRATION_SAFETY_BUFFER_MS)
  );
}

function canReuseExistingPixCheckoutOrder(
  order: PaymentOrderRecord,
  amount: number,
  currency: string,
) {
  return (
    order.payment_method === "pix" &&
    order.status === "pending" &&
    Boolean(order.provider_payment_id) &&
    Boolean(order.provider_qr_code) &&
    amountsMatch(order.amount, amount) &&
    currenciesMatch(order.currency, currency) &&
    isRecentOrderTimestamp(order.created_at, PENDING_REUSE_WINDOW_MS) &&
    !isOrderExpiredOrExpiringSoon(order, ORDER_EXPIRATION_SAFETY_BUFFER_MS) &&
    resolvePaymentStatus(order.provider_status || order.status) === "pending"
  );
}

function resolveFriendlyPixProviderErrorMessage(message: string) {
  if (isProviderDocumentErrorMessage(message)) {
    return "CPF/CNPJ invalido para pagamento.";
  }

  if (isExpirationRelatedProviderErrorMessage(message)) {
    return "A tentativa anterior do PIX venceu e o sistema preparou uma nova base segura. Tente novamente para gerar um novo codigo valido.";
  }

  const normalizedMessage = message.toLowerCase();
  if (
    normalizedMessage.includes("invalid_credentials") ||
    normalizedMessage.includes("unauthorized") ||
    normalizedMessage.includes("access token") ||
    normalizedMessage.includes("credential")
  ) {
    return "O Mercado Pago recusou a autenticacao da cobranca PIX. Revise a credencial de producao e a chave Pix ativa nessa conta. Nao houve cobranca.";
  }

  if (
    normalizedMessage.includes("tempo limite") ||
    normalizedMessage.includes("timeout") ||
    normalizedMessage.includes("falha de rede") ||
    normalizedMessage.includes("internal_error") ||
    normalizedMessage.includes("temporarily_unavailable")
  ) {
    return "O Mercado Pago ficou indisponivel durante a geracao do PIX. Tente novamente em instantes. Nenhuma cobranca foi concluida.";
  }

  if (
    normalizedMessage.includes("rate_limit") ||
    normalizedMessage.includes("too many requests")
  ) {
    return "O Mercado Pago limitou temporariamente novas tentativas de PIX. Aguarde alguns segundos e tente novamente.";
  }

  if (
    normalizedMessage.includes("mercado pago") ||
    normalizedMessage.includes("payment") ||
    normalizedMessage.includes("pix")
  ) {
    return "Nao foi possivel confirmar a geracao do PIX com o provedor agora. Tente novamente em instantes.";
  }

  return "Nao foi possivel gerar o PIX agora. Tente novamente em instantes.";
}

async function resolveCheckoutPlanWithoutGuild(input: {
  userId: number;
  requestedPlanCode?: unknown;
  requestedBillingPeriodCode?: unknown;
}) {
  const plan = resolvePlanPricing(
    normalizePlanCode(input.requestedPlanCode),
    normalizePlanBillingPeriodCode(input.requestedBillingPeriodCode),
  );

  const planChange = resolvePlanChangePreview({
    userPlanState: null,
    targetPlan: plan,
    flowPointsBalance: 0,
    scheduledChange: null,
  });

  return {
    plan,
    amount: plan.totalAmount,
    currency: plan.currency || resolvePixCurrency(),
    currentPlanRepurchaseBlocked: false,
    userPlanState: null,
    flowPointsBalance: 0,
    scheduledChange: null,
    planChange,
  };
}


export async function resolveCheckoutPlanForGuild(input: {
  userId: number;
  guildId: string | null;
  requestedPlanCode?: unknown;
  requestedBillingPeriodCode?: unknown;
}) {
  const { guildId } = input;
  if (!guildId) {
    return resolveCheckoutPlanWithoutGuild(input);
  }

  const selection = await resolveEffectivePlanSelection({
    userId: input.userId,
    guildId: guildId,
    preferredPlanCode: input.requestedPlanCode,
    preferredBillingPeriodCode: input.requestedBillingPeriodCode,
  });
  const planChange = resolvePlanChangePreview({
    userPlanState: selection.userPlanState,
    targetPlan: selection.plan,
    flowPointsBalance: selection.flowPointsBalance,
    scheduledChange: selection.scheduledChange,
  });

  return {
    plan: selection.plan,
    amount: Math.max(0, Math.round(planChange.immediateSubtotalAmount * 100) / 100),
    currency: selection.plan.currency || resolvePixCurrency(),
    currentPlanRepurchaseBlocked: planChange.isCurrentSelectionBlocked,
    userPlanState: selection.userPlanState,
    flowPointsBalance: selection.flowPointsBalance,
    scheduledChange: selection.scheduledChange,
    planChange,
  };
}

export function buildCheckoutTransitionProviderPayload(input: {
  planChange: PlanChangePreview;
  flowPointsApplied: number;
  flowPointsGranted?: number;
  scheduledChangeId?: number | null;
}) {
  return {
    transition: buildPlanTransitionPayload({
      preview: input.planChange,
      flowPointsApplied: input.flowPointsApplied,
      flowPointsGranted: input.flowPointsGranted,
      scheduledChangeId: input.scheduledChangeId,
    }),
  };
}

async function confirmImmediatePixProviderPayment(
  providerPaymentId: string,
  fallbackPayment: MercadoPagoPaymentResponse,
) {
  try {
    const confirmedPayment = await fetchMercadoPagoPaymentById(providerPaymentId, {
      forceFresh: true,
    });
    return confirmedPayment || fallbackPayment;
  } catch {
    return fallbackPayment;
  }
}

export function doesOrderMatchCheckoutPlan(
  order: Pick<PaymentOrderRecord, "plan_code" | "plan_billing_cycle_days" | "amount" | "currency">,
  checkoutPlan: {
    plan: PlanPricingDefinition;
    amount: number;
    currency: string;
  },
) {
  return (
    order.plan_code === checkoutPlan.plan.code &&
    order.plan_billing_cycle_days === checkoutPlan.plan.billingCycleDays &&
    amountsMatch(order.amount, checkoutPlan.amount) &&
    currenciesMatch(order.currency, checkoutPlan.currency)
  );
}

export function toApiOrder(
  record: PaymentOrderRecord,
  checkoutAccessToken: string | null = null,
) {
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
    payerDocumentMasked: maskPayerDocument(
      record.payer_document,
      record.payer_document_last4,
    ),
    payerDocumentType: record.payer_document_type,
    providerPaymentId: record.provider_payment_id,
    providerExternalReference: record.provider_external_reference,
    providerStatus: record.provider_status,
    providerStatusDetail: record.provider_status_detail,
    qrCodeText: record.provider_qr_code,
    qrCodeBase64: record.provider_qr_base64,
    qrCodeDataUri: qrDataUri,
    ticketUrl: record.provider_ticket_url,
    paidAt: record.paid_at,
    expiresAt: record.expires_at,
    checkoutAccessToken,
    checkoutAccessTokenExpiresAt: record.checkout_link_expires_at,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function parsePaymentId(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed;
  }
  return null;
}

function normalizeCheckoutToken(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

export async function ensureGuildAccess(guildId: string | null) {
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

  if (!guildId) {
    return {
      ok: true as const,
      context: {
        sessionData,
      },
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

  if (!sessionData.accessToken) {
    const hasTeamAccessWithoutToken = await hasAcceptedTeamAccessToGuild(
      {
        authSession: sessionData.authSession,
        accessToken: "",
      },
      guildId,
    );

    if (hasTeamAccessWithoutToken) {
      return {
        ok: true as const,
        context: {
          sessionData,
        },
      };
    }

    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Token OAuth ausente na sessao." },
        { status: 401 },
      ),
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

export async function createPaymentOrderEvent(
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

export async function createPaymentOrderEventSafe(
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

export async function getLatestOrderForUserAndGuild(userId: number, guildId: string | null) {
  return getCachedLatestPaymentOrderForUserAndGuild<PaymentOrderRecord>({
    userId,
    guildId,
    selectColumns: PAYMENT_ORDER_SELECT_COLUMNS,
  });
}

async function getLatestPendingDraftOrderForUserAndGuild(
  userId: number,
  guildId: string | null,
  forceFresh = false,
) {
  return getCachedLatestPendingDraftPaymentOrderForUserAndGuild<PaymentOrderRecord>({
    userId,
    guildId,
    forceFresh,
    selectColumns: PAYMENT_ORDER_SELECT_COLUMNS,
  });
}

async function getOrderByCodeForGuild(guildId: string | null, orderCode: number) {
  return getCachedPaymentOrderByCodeForGuild<PaymentOrderRecord>({
    guildId,
    orderNumber: orderCode,
    selectColumns: PAYMENT_ORDER_SELECT_COLUMNS,
  });
}

export async function getOrderByCodeForUserAndGuild(
  userId: number,
  guildId: string | null,
  orderCode: number,
) {
  const order = await getOrderByCodeForGuild(guildId, orderCode);
  if (!order) return { order: null, foreignOwner: false };

  if (order.user_id !== userId) {
    return { order: null, foreignOwner: true };
  }
  return { order, foreignOwner: false };
}

export async function getLatestApprovedLicenseCoverageForGuild(
  guildId: string | null,
  excludedOrderId?: number,
) {
  const approvedOrders = await getApprovedOrdersForGuild<PaymentOrderRecord>(
    guildId,
    PAYMENT_ORDER_SELECT_COLUMNS,
  );

  const filteredOrders =
    typeof excludedOrderId === "number"
      ? approvedOrders.filter((order) => order.id !== excludedOrderId)
      : approvedOrders;

  return resolveLatestLicenseCoverageFromApprovedOrders(filteredOrders);
}

async function getCoverageForApprovedOrder(order: PaymentOrderRecord) {
  if (order.status !== "approved") return null;

  const approvedOrders = await getApprovedOrdersForGuild<PaymentOrderRecord>(
    order.guild_id,
    PAYMENT_ORDER_SELECT_COLUMNS,
  );

  return resolveCoverageForApprovedOrder(approvedOrders, order);
}

async function reconcilePixOrderFromProvider(
  order: PaymentOrderRecord,
  source: "poll" | "order_code" | "post_recovery",
) {
  if (!order.provider_payment_id) return order;

  const providerPayment = await fetchMercadoPagoPaymentById(order.provider_payment_id);
  const providerPaymentId = parsePaymentId(providerPayment.id);
  if (!providerPaymentId) return order;

  const providerStatus = providerPayment.status || null;
  const providerStatusDetail = providerPayment.status_detail || null;
  const resolvedStatus = resolveNextPaymentOrderStatus(
    order.status,
    resolvePaymentStatus(providerStatus),
  );
  const transactionData = providerPayment.point_of_interaction?.transaction_data;
  const paymentIdentifiers = extractMercadoPagoPaymentIdentifiers(providerPayment);
  const trustedTimestamps = resolveTrustedMercadoPagoPaymentTimestamps({
    providerPayment,
    currentPaidAt: order.paid_at,
    currentExpiresAt: order.expires_at,
    resolvedStatus,
  });
  const paidAt = trustedTimestamps.paidAt;
  const expiresAt =
    resolvedStatus === "approved"
      ? await resolveApprovedOrderExpiresAt(order, paidAt)
      : trustedTimestamps.expiresAt ||
        resolveUnpaidSetupEffectiveExpiresAt({
          createdAt: order.created_at,
          providerExpiresAt: providerPayment.date_of_expiration || null,
        });
  const externalReference =
    providerPayment.external_reference || order.provider_external_reference || null;

  if (resolvedStatus === "approved") {
    const existingCoverage = order.guild_id
      ? await getLatestApprovedLicenseCoverageForGuild(
          order.guild_id,
          order.id,
        )
      : null;

    const paymentTimestampMs = paidAt ? Date.parse(paidAt) : Date.now();
    const canBypassRenewalWindow = orderTransitionAllowsImmediateApproval(
      order.provider_payload,
    );
    const renewalDecision = canBypassRenewalWindow
      ? {
          allowed: true as const,
          reason: "immediate_upgrade" as const,
          licenseStartsAtMs: Number.isFinite(paymentTimestampMs)
            ? paymentTimestampMs
            : Date.now(),
        }
      : resolveRenewalPaymentDecision(
          existingCoverage,
          Number.isFinite(paymentTimestampMs) ? paymentTimestampMs : Date.now(),
        );

    if (!renewalDecision.allowed) {
      await refundMercadoPagoPixPayment(providerPaymentId);

      const supabase = getSupabaseAdminClientOrThrow();
      const refundedOrderResult = await supabase
        .from("payment_orders")
        .update({
          status: "cancelled",
          provider_status: "refunded",
          provider_status_detail:
            "auto_refund_duplicate_active_license",
          provider_external_reference: externalReference,
          provider_qr_code: transactionData?.qr_code || order.provider_qr_code,
          provider_qr_base64:
            transactionData?.qr_code_base64 || order.provider_qr_base64,
          provider_ticket_url:
            transactionData?.ticket_url || order.provider_ticket_url,
          provider_payload: {
            ...mergeProviderPayload(order.provider_payload, {
              source: "flowdesk_checkout",
              step: 4,
              reconciled_by: source,
              auto_refunded_duplicate: true,
              payment_identifiers: paymentIdentifiers,
              trusted_timestamps: trustedTimestamps,
              mercado_pago: providerPayment,
            }),
          },
          expires_at: expiresAt,
        })
        .eq("id", order.id)
        .select(PAYMENT_ORDER_SELECT_COLUMNS)
        .single<PaymentOrderRecord>();

      if (refundedOrderResult.error || !refundedOrderResult.data) {
        throw new Error(
          refundedOrderResult.error?.message ||
            "Falha ao atualizar estorno automatico.",
        );
      }

      await createPaymentOrderEventSafe(order.id, "provider_payment_auto_refunded", {
        source,
        providerPaymentId,
        reason: renewalDecision.reason,
        previousApprovedOrderNumber: existingCoverage?.order.order_number || null,
      });

      invalidatePaymentReadCachesForOrder(refundedOrderResult.data);
      invalidateLicenseReadCachesForOrder(refundedOrderResult.data);
      return refundedOrderResult.data;
    }
  }

  const hasRelevantChanges =
    order.status !== resolvedStatus ||
    order.provider_status !== providerStatus ||
    order.provider_status_detail !== providerStatusDetail ||
    order.provider_external_reference !== externalReference ||
    order.provider_qr_code !== (transactionData?.qr_code || null) ||
    order.provider_qr_base64 !== (transactionData?.qr_code_base64 || null) ||
    order.provider_ticket_url !== (transactionData?.ticket_url || null) ||
    order.paid_at !== paidAt ||
    order.expires_at !== expiresAt;

  if (!hasRelevantChanges) return order;

  const supabase = getSupabaseAdminClientOrThrow();
  const updatedOrderResult = await supabase
    .from("payment_orders")
    .update({
      status: resolvedStatus,
      provider_payment_id: providerPaymentId,
      provider_external_reference: externalReference,
      provider_qr_code: transactionData?.qr_code || null,
      provider_qr_base64: transactionData?.qr_code_base64 || null,
      provider_ticket_url: transactionData?.ticket_url || null,
      provider_status: providerStatus,
      provider_status_detail: providerStatusDetail,
      provider_payload: {
        ...mergeProviderPayload(order.provider_payload, {
          source: "flowdesk_checkout",
          step: 4,
          reconciled_by: source,
          payment_identifiers: paymentIdentifiers,
          trusted_timestamps: trustedTimestamps,
          mercado_pago: providerPayment,
        }),
      },
      paid_at: paidAt,
      expires_at: expiresAt,
    })
    .eq("id", order.id)
    .select(PAYMENT_ORDER_SELECT_COLUMNS)
    .single<PaymentOrderRecord>();

  if (updatedOrderResult.error || !updatedOrderResult.data) {
    throw new Error(
      updatedOrderResult.error?.message ||
        "Falha ao reconciliar status de pagamento PIX.",
    );
  }

  await createPaymentOrderEventSafe(order.id, "provider_payment_reconciled", {
    source,
    providerPaymentId,
    providerStatus,
    providerStatusDetail,
    resolvedStatus,
    txId: paymentIdentifiers.txId,
    endToEndId: paymentIdentifiers.endToEndId,
  });

  invalidatePaymentReadCachesForOrder(updatedOrderResult.data);
  invalidateLicenseReadCachesForOrder(updatedOrderResult.data);
  return updatedOrderResult.data;
}

export async function createDraftOrderForCheckout(input: {
  userId: number;
  guildId: string | null;
  amount: number;
  currency: string;
  plan: PlanPricingDefinition;
  paymentMethod?: PaymentOrderRecord["payment_method"];
  providerPayload?: Record<string, unknown>;
}) {
  const paymentMethod = input.paymentMethod || "pix";
  return runCoalescedPaymentRequest<PaymentOrderRecord>({
    key: createStablePaymentIdempotencyKey({
      namespace: "flowdesk-payment-draft-create",
      parts: [
        input.userId,
        input.guildId || "__global__",
        input.plan.code,
        input.plan.billingCycleDays,
        input.amount,
        input.currency,
        JSON.stringify(input.providerPayload || {}),
      ],
    }),
    ttlMs: PAYMENT_ROUTE_COALESCE_TTL_MS,
    producer: async () => {
      const supabase = getSupabaseAdminClientOrThrow();

      const createdOrderResult = await supabase
        .from("payment_orders")
        .insert({
          user_id: input.userId,
          guild_id: input.guildId,
          payment_method: paymentMethod,
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
            precreated: true,
            plan: {
              code: input.plan.code,
              name: input.plan.name,
              billingCycleDays: input.plan.billingCycleDays,
              entitlements: {
                ...input.plan.entitlements,
              },
            },
            ...(input.providerPayload || {}),
          },
        })
        .select(PAYMENT_ORDER_SELECT_COLUMNS)
        .single<PaymentOrderRecord>();

      if (createdOrderResult.error || !createdOrderResult.data) {
        if (isUniqueConstraintError(createdOrderResult.error)) {
          const existingDraftOrder = await getLatestPendingDraftOrderForUserAndGuild(
            input.userId,
            input.guildId,
            true,
          );

          if (existingDraftOrder) {
            return reuseDraftOrderForCheckout({
              order: existingDraftOrder,
              amount: input.amount,
              currency: input.currency,
              plan: input.plan,
              providerPayload: input.providerPayload,
            });
          }
        }

        throw new Error(createdOrderResult.error?.message || "Falha ao iniciar pedido.");
      }

      await createPaymentOrderEvent(createdOrderResult.data.id, "order_created", {
        orderNumber: createdOrderResult.data.order_number,
        guildId: input.guildId,
        userId: input.userId,
        precreated: true,
      });

      invalidatePaymentReadCachesForOrder(createdOrderResult.data);
      return createdOrderResult.data;
    },
  });
}

export async function reuseDraftOrderForCheckout(input: {
  order: PaymentOrderRecord;
  amount: number;
  currency: string;
  plan: PlanPricingDefinition;
  paymentMethod?: PaymentOrderRecord["payment_method"];
  providerPayload?: Record<string, unknown>;
}) {
  const paymentMethod = input.paymentMethod || "pix";
  return runCoalescedPaymentRequest<PaymentOrderRecord>({
    key: createStablePaymentIdempotencyKey({
      namespace: "flowdesk-payment-draft-reuse",
      parts: [
        input.order.id,
        input.plan.code,
        input.plan.billingCycleDays,
        input.amount,
        input.currency,
        JSON.stringify(input.providerPayload || {}),
      ],
    }),
    ttlMs: PAYMENT_ROUTE_COALESCE_TTL_MS,
    producer: async () => {
      const supabase = getSupabaseAdminClientOrThrow();

      const updatedOrderResult = await supabase
        .from("payment_orders")
        .update({
          payment_method: paymentMethod,
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
          payer_name: null,
          payer_document: null,
          payer_document_last4: null,
          payer_document_type: null,
          payer_document_encrypted: null,
          provider_status: null,
          provider_status_detail: null,
          provider_payload: {
            source: "flowdesk_checkout",
            step: 4,
            precreated: true,
            refreshedForPlanSwitch: true,
            plan: {
              code: input.plan.code,
              name: input.plan.name,
              billingCycleDays: input.plan.billingCycleDays,
              entitlements: {
                ...input.plan.entitlements,
              },
            },
            ...(input.providerPayload || {}),
          },
          expires_at: resolveUnpaidSetupExpiresAt(input.order.created_at),
        })
        .eq("id", input.order.id)
        .select(PAYMENT_ORDER_SELECT_COLUMNS)
        .single<PaymentOrderRecord>();

      if (updatedOrderResult.error || !updatedOrderResult.data) {
        throw new Error(
          updatedOrderResult.error?.message ||
            "Falha ao atualizar o pedido base para o plano selecionado.",
        );
      }

      await createPaymentOrderEventSafe(
        updatedOrderResult.data.id,
        "order_base_retargeted",
        {
          orderNumber: updatedOrderResult.data.order_number,
          planCode: input.plan.code,
          amount: input.amount,
          currency: input.currency,
        },
      );

      invalidatePaymentReadCachesForOrder(updatedOrderResult.data);
      return updatedOrderResult.data;
    },
  });
}

async function finalizeCreditCoveredCheckoutOrder(input: {
  order: PaymentOrderRecord;
  pricing: Awaited<ReturnType<typeof resolveDiscountPricing>>;
  flowPointsApplied: number;
  flowPointsGranted: number;
  planChange: PlanChangePreview;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const paidAt = new Date().toISOString();
  const expiresAt = await resolveApprovedOrderExpiresAt(input.order, paidAt);
  const updatedOrderResult = await supabase
    .from("payment_orders")
    .update({
      status: "approved",
      amount: 0,
      provider_status: "approved",
      provider_status_detail: "covered_by_internal_credits",
      provider_payload: {
        source: "flowdesk_checkout",
        step: 4,
        coveredByCredits: true,
        pricing: {
          ...input.pricing,
          flowPoints: {
            appliedAmount: input.flowPointsApplied,
          },
          totalAmount: 0,
        },
        transition: buildPlanTransitionPayload({
          preview: input.planChange,
          flowPointsApplied: input.flowPointsApplied,
          flowPointsGranted: input.flowPointsGranted,
        }),
        plan: {
          code: input.order.plan_code,
          name: input.order.plan_name,
          billingCycleDays: input.order.plan_billing_cycle_days,
        },
      },
      paid_at: paidAt,
      expires_at: expiresAt,
    })
    .eq("id", input.order.id)
    .select(PAYMENT_ORDER_SELECT_COLUMNS)
    .single<PaymentOrderRecord>();

  if (updatedOrderResult.error || !updatedOrderResult.data) {
    throw new Error(
      updatedOrderResult.error?.message ||
        "Falha ao concluir a troca coberta por creditos internos.",
    );
  }

  await createPaymentOrderEventSafe(
    updatedOrderResult.data.id,
    "provider_payment_created",
    {
      providerStatus: "approved",
      providerStatusDetail: "covered_by_internal_credits",
      flowPointsApplied: input.flowPointsApplied,
      flowPointsGranted: input.flowPointsGranted,
    },
  );

  await syncUserPlanStateFromOrder(updatedOrderResult.data);
  clearPlanStateCacheForUser(input.order.user_id);
  invalidatePaymentReadCachesForOrder(updatedOrderResult.data);
  invalidateLicenseReadCachesForOrder(updatedOrderResult.data);

  return ensureCheckoutAccessTokenForOrder({
    order: updatedOrderResult.data,
    forceRotate: true,
    invalidateOtherOrders: true,
  });
}

export async function GET(request: Request) {
  const requestContext = createSecurityRequestContext(request);
  const respond = (body: unknown, init?: ResponseInit) =>
    attachRequestId(
      applyNoStoreHeaders(NextResponse.json(body, init)),
      requestContext.requestId,
    );

  try {
    const url = new URL(request.url);
    const guildIdFromQuery = normalizeGuildId(url.searchParams.get("guildId"));
    const requestedPlanCode = url.searchParams.get("planCode");
    const requestedBillingPeriodCode = url.searchParams.get("billingPeriodCode");
    const orderCodeFromQuery = normalizeOrderCode(url.searchParams.get("code"));
    const checkoutToken = normalizeCheckoutToken(
      url.searchParams.get("checkoutToken"),
    );
    const forceNew = parseForceNewFlag(url.searchParams.get("forceNew"));

    const guildId = guildIdFromQuery;

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) {
      return attachRequestId(
        applyNoStoreHeaders(access.response),
        requestContext.requestId,
      );
    }

    const userId = access.context.sessionData.authSession.user.id;

    if (orderCodeFromQuery) {
      const foundOrderByCode = await getOrderByCodeForUserAndGuild(
        userId,
        guildId,
        orderCodeFromQuery,
      );
      if (!foundOrderByCode.order) {
        return respond(
          {
            ok: false,
            message: foundOrderByCode.foreignOwner
              ? "Este link de pagamento pertence a outra conta autenticada."
              : "Pedido nao encontrado para este servidor.",
          },
          { status: foundOrderByCode.foreignOwner ? 403 : 404 },
        );
      }

      let orderByCode = foundOrderByCode.order;
      const tokenValidation = verifyCheckoutAccessToken(orderByCode, checkoutToken);
      if (!tokenValidation.ok) {
        return respond(
          {
            ok: false,
            message: resolveCheckoutLinkFailureMessage(tokenValidation.reason),
          },
          { status: tokenValidation.reason === "expired" ? 410 : 403 },
        );
      }

      if (orderByCode.provider_payment_id) {
        try {
          orderByCode = await reconcilePixOrderFromProvider(orderByCode, "order_code");
        } catch {
          await createPaymentOrderEventSafe(orderByCode.id, "provider_payment_reconcile_failed", {
            source: "order_code",
          });
        }
      }

      const securedOrder = await ensureCheckoutAccessTokenForOrder({
        order: orderByCode,
        forceRotate: false,
        invalidateOtherOrders: false,
      });
      const orderCoverage =
        securedOrder.order.status === "approved"
          ? await getCoverageForApprovedOrder(securedOrder.order)
          : null;

      return respond({
        ok: true,
        order: toApiOrder(
          securedOrder.order,
          securedOrder.checkoutAccessToken,
        ),
        licenseActive: orderCoverage?.status === "paid",
        licenseExpiresAt: orderCoverage?.licenseExpiresAt || null,
        fromOrderCode: true,
      });
    }

    let latestOrder = await getLatestOrderForUserAndGuild(
      userId,
      guildId,
    );
    const checkoutPlan = await resolveCheckoutPlanForGuild({
      userId,
      guildId,
      requestedPlanCode,
      requestedBillingPeriodCode,
    });

    if (checkoutPlan.currentPlanRepurchaseBlocked) {
      return respond(
        {
          ok: false,
          message:
            "Seu plano atual ja esta ativo. Escolha outro plano para mudar agora.",
        },
        { status: 409 },
      );
    }

    if (checkoutPlan.planChange.execution === "schedule_for_renewal") {
      return respond({
        ok: true,
        order: null,
        requiresScheduledChange: true,
        message:
          "Esse downgrade sera aplicado apenas no proximo vencimento. Agende a troca na tela do checkout.",
      });
    }

    if (checkoutPlan.plan.isTrial) {
      return respond(
        {
          ok: false,
          message:
            "O plano gratuito e ativado sem checkout. Finalize a ativacao do periodo gratuito na tela de pagamento.",
        },
        { status: 409 },
      );
    }

    if (checkoutPlan.amount <= 0) {
      return respond({
        ok: true,
        order: null,
        coveredByCreditsPreview: true,
        message:
          "O saldo restante do plano atual e os creditos internos ja cobrem essa troca.",
      });
    }

    if (
      latestOrder &&
      latestOrder.payment_method === "pix" &&
      latestOrder.status === "pending" &&
      latestOrder.provider_payment_id
    ) {
      try {
        latestOrder = await reconcilePixOrderFromProvider(latestOrder, "poll");
        if (latestOrder?.status === "approved") {
          // Garante cache limpo se o polling acabou de aprovar o pedido
          clearPlanStateCacheForUser(userId);
        }
      } catch {
        await createPaymentOrderEventSafe(
          latestOrder.id,
          "provider_payment_reconcile_failed",
          {
            source: "checkout_bootstrap",
          },
        );
      }
    }

    const latestPendingPixOrder =
      latestOrder &&
      latestOrder.status === "pending" &&
      latestOrder.payment_method === "pix"
        ? latestOrder
        : null;

    // Rascunho puro: pending sem PIX gerado (sem provider_payment_id) — pode ser reutilizado.
    const latestDraftOrder =
      latestPendingPixOrder && !latestPendingPixOrder.provider_payment_id
        ? latestPendingPixOrder
        : null;

    let order = latestPendingPixOrder;
    if (forceNew) {
      // forceNew só cria novo se não há rascunho reutilizável — evita multiplos rascunhos
      if (latestDraftOrder && !isOrderExpiredOrExpiringSoon(latestDraftOrder, ORDER_EXPIRATION_SAFETY_BUFFER_MS)) {
        order = await reuseDraftOrderForCheckout({
          order: latestDraftOrder,
          amount: checkoutPlan.amount,
          currency: checkoutPlan.currency,
          plan: checkoutPlan.plan,
          providerPayload: buildCheckoutTransitionProviderPayload({
            planChange: checkoutPlan.planChange,
            flowPointsApplied: 0,
          }),
        });
      } else {
        order = await createDraftOrderForCheckout({
          userId,
          guildId,
          amount: checkoutPlan.amount,
          currency: checkoutPlan.currency,
          plan: checkoutPlan.plan,
          providerPayload: buildCheckoutTransitionProviderPayload({
            planChange: checkoutPlan.planChange,
            flowPointsApplied: 0,
          }),
        });
      }
    } else if (
      latestPendingPixOrder &&
      !doesOrderMatchCheckoutPlan(latestPendingPixOrder, checkoutPlan)
    ) {
      if (latestDraftOrder && !isOrderExpiredOrExpiringSoon(latestDraftOrder, ORDER_EXPIRATION_SAFETY_BUFFER_MS)) {
        // Tem rascunho sem PIX: atualiza no lugar sem criar novo pedido
        order = await reuseDraftOrderForCheckout({
          order: latestDraftOrder,
          amount: checkoutPlan.amount,
          currency: checkoutPlan.currency,
          plan: checkoutPlan.plan,
          providerPayload: buildCheckoutTransitionProviderPayload({
            planChange: checkoutPlan.planChange,
            flowPointsApplied: 0,
          }),
        });
      } else {
        // PIX já foi gerado ou rascunho expirado: cria novo
        order = await createDraftOrderForCheckout({
          userId,
          guildId,
          amount: checkoutPlan.amount,
          currency: checkoutPlan.currency,
          plan: checkoutPlan.plan,
          providerPayload: buildCheckoutTransitionProviderPayload({
            planChange: checkoutPlan.planChange,
            flowPointsApplied: 0,
          }),
        });
      }
    } else if (
      latestPendingPixOrder &&
      isOrderExpiredOrExpiringSoon(
        latestPendingPixOrder,
        ORDER_EXPIRATION_SAFETY_BUFFER_MS,
      )
    ) {
      order = await createDraftOrderForCheckout({
        userId,
        guildId,
        amount: checkoutPlan.amount,
        currency: checkoutPlan.currency,
        plan: checkoutPlan.plan,
        providerPayload: buildCheckoutTransitionProviderPayload({
          planChange: checkoutPlan.planChange,
          flowPointsApplied: 0,
        }),
      });
    } else if (!order) {
      order = await createDraftOrderForCheckout({
        userId,
        guildId,
        amount: checkoutPlan.amount,
        currency: checkoutPlan.currency,
        plan: checkoutPlan.plan,
        providerPayload: buildCheckoutTransitionProviderPayload({
          planChange: checkoutPlan.planChange,
          flowPointsApplied: 0,
        }),
      });
    }

    const securedOrder = await ensureCheckoutAccessTokenForOrder({
      order,
      forceRotate: forceNew,
      invalidateOtherOrders: forceNew,
    });

    return respond({
      ok: true,
      order: toApiOrder(
        securedOrder.order,
        securedOrder.checkoutAccessToken,
      ),
      blockedByActiveLicense: false,
      licenseActive: false,
      licenseExpiresAt: null,
    });
  } catch (error) {
    return respond(
      {
        ok: false,
        message: resolveDatabaseFailureMessage(
          error,
          sanitizeErrorMessage(error, "Erro ao carregar pagamento PIX."),
        ),
      },
      { status: resolveDatabaseFailureStatus(error) },
    );
  }
}

export async function POST(request: Request) {
  const baseRequestContext = createSecurityRequestContext(request);
  let auditContext = baseRequestContext;
  const respond = (body: unknown, init?: ResponseInit) =>
    attachRequestId(
      applyNoStoreHeaders(NextResponse.json(body, init)),
      baseRequestContext.requestId,
    );

  try {
    const securityResponse = ensureSameOriginJsonMutationRequest(request);
    if (securityResponse) {
      return attachRequestId(
        applyNoStoreHeaders(securityResponse),
        baseRequestContext.requestId,
      );
    }

    let body: CreatePixPaymentBody = {};
    try {
      body = parseFlowSecureDto<CreatePixPaymentBody>(
        await request.json(),
        {
          guildId: flowSecureDto.optional(
            flowSecureDto.string({
              maxLength: 32,
            }),
          ),
          planCode: flowSecureDto.optional(
            flowSecureDto.string({
              maxLength: 80,
            }),
          ),
          billingPeriodCode: flowSecureDto.optional(
            flowSecureDto.string({
              maxLength: 40,
            }),
          ),
          payerName: flowSecureDto.optional(
            flowSecureDto.string({
              maxLength: 120,
            }),
          ),
          payerDocument: flowSecureDto.optional(
            flowSecureDto.string({
              maxLength: 32,
            }),
          ),
          couponCode: flowSecureDto.optional(
            flowSecureDto.string({
              maxLength: 80,
            }),
          ),
          giftCardCode: flowSecureDto.optional(
            flowSecureDto.string({
              maxLength: 80,
            }),
          ),
          forceNew: flowSecureDto.optional(flowSecureDto.unknown()),
        },
        {
          rejectUnknown: true,
        },
      );
    } catch (error) {
      const message =
        error instanceof FlowSecureDtoError
          ? error.issues[0] || error.message
          : "Payload JSON invalido.";
      return respond(
        { ok: false, message },
        { status: 400 },
      );
    }

    const guildId = normalizeGuildId(body.guildId);
    const requestedPayerName = normalizePayerName(body.payerName);
    const requestedPayerDocument = normalizePayerDocument(body.payerDocument);
    const forceNew = parseForceNewFlag(body.forceNew);

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) {
      return attachRequestId(
        applyNoStoreHeaders(access.response),
        baseRequestContext.requestId,
      );
    }
    auditContext = extendSecurityRequestContext(baseRequestContext, {
      sessionId: access.context.sessionData.authSession.id,
      userId: access.context.sessionData.authSession.user.id,
      guildId,
    });
    const mutationKey = createStablePaymentIdempotencyKey({
      namespace: "payment-pix-post-route",
      parts: [
        access.context.sessionData.authSession.user.id,
        guildId || "__account__",
        typeof body.planCode === "string" ? body.planCode : "",
        typeof body.billingPeriodCode === "string" ? body.billingPeriodCode : "",
        requestedPayerName || "",
        requestedPayerDocument?.normalized || "",
        typeof body.couponCode === "string" ? body.couponCode : "",
        typeof body.giftCardCode === "string" ? body.giftCardCode : "",
        forceNew,
      ],
    });

    return await runCoalescedRouteResponse({
      key: mutationKey,
      ttlMs: PAYMENT_ROUTE_COALESCE_TTL_MS,
      producer: async () => {

        const rateLimit = await enforceRequestRateLimit({
          action: "payment_pix_post",
          windowMs: 10 * 60 * 1000,
          maxAttempts: 10,
          context: auditContext,
        });
        if (!rateLimit.ok) {
          await logSecurityAuditEventSafe(auditContext, {
            action: "payment_pix_post",
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
                "Muitas tentativas de gerar PIX em pouco tempo. Aguarde alguns instantes.",
            },
            { status: 429 },
          );
          response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
          return response;
        }

        await logSecurityAuditEventSafe(auditContext, {
          action: "payment_pix_post",
          outcome: "started",
        });

        const user = access.context.sessionData.authSession.user;
        if (guildId) {
          await cleanupExpiredUnpaidServerSetups({
            userId: user.id,
            guildId,
            source: "payment_pix_post",
          });
        }

    const checkoutPlan = await resolveCheckoutPlanForGuild({
      userId: user.id,
      guildId,
      requestedPlanCode: body.planCode,
      requestedBillingPeriodCode: body.billingPeriodCode,
    });

    if (checkoutPlan.planChange.execution === "schedule_for_renewal") {
      return respond(
        {
          ok: false,
          requiresScheduledChange: true,
          message:
            "Esse downgrade deve ser agendado para o proximo vencimento. Use a acao de agendar troca na tela de pagamento.",
        },
        { status: 409 },
      );
    }

    const latestCoverage = guildId ? await getLatestApprovedLicenseCoverageForGuild(guildId) : null;
    const renewalDecision =
      (guildId && checkoutPlan.planChange.kind === "upgrade")
        ? {
            allowed: true as const,
            reason: "immediate_upgrade" as const,
            licenseStartsAtMs: Date.now(),
          }
        : resolveRenewalPaymentDecision(latestCoverage);
    if (guildId && latestCoverage && !renewalDecision.allowed) {
      return respond({
        ok: false,
        blockedByActiveLicense: true,
        licenseActive: true,
        licenseExpiresAt: latestCoverage.licenseExpiresAt,
        message:
          "Ja existe uma licenca ativa neste servidor. Aguarde a janela correta para renovar ou escolha outro plano.",
      }, { status: 409 });
    }

    const supabase = getSupabaseAdminClientOrThrow();
    let latestOrder = guildId ? await getLatestOrderForUserAndGuild(user.id, guildId) : null;

    if (
      latestOrder &&
      latestOrder.payment_method === "pix" &&
      latestOrder.status === "pending" &&
      latestOrder.provider_payment_id
    ) {
      try {
        latestOrder = await reconcilePixOrderFromProvider(latestOrder, "poll");
      } catch {
        await createPaymentOrderEventSafe(latestOrder.id, "provider_payment_reconcile_failed", {
          source: "payment_pix_post",
        });
      }
    }

    if (checkoutPlan.currentPlanRepurchaseBlocked) {
      return respond(
        {
          ok: false,
          message:
            "Seu plano atual ja esta ativo. Escolha outro plano para mudar agora.",
        },
        { status: 409 },
      );
    }

    if (checkoutPlan.plan.isTrial) {
      return respond(
        {
          ok: false,
          message:
            "O plano gratuito e ativado sem PIX. Use a acao de ativacao gratuita na tela de pagamento.",
        },
        { status: 409 },
      );
    }

    const pricing = await resolveDiscountPricing({
      baseAmount: checkoutPlan.amount,
      currency: checkoutPlan.currency,
      couponCode: typeof body.couponCode === "string" ? body.couponCode : null,
      giftCardCode: typeof body.giftCardCode === "string" ? body.giftCardCode : null,
      userId: user.id,
      planCode: checkoutPlan.plan.code,
      billingPeriodCode: checkoutPlan.plan.billingPeriodCode,
    });
    const flowPointsPreview = applyFlowPointsToAmount({
      amount: pricing.totalAmount,
      flowPointsBalance: checkoutPlan.flowPointsBalance,
    });
    const pricingWithFlowPoints = {
      ...pricing,
      totalAmount: flowPointsPreview.remainingAmount,
      flowPoints: {
        appliedAmount: flowPointsPreview.appliedAmount,
        balanceBefore: checkoutPlan.flowPointsBalance,
        balanceAfter: flowPointsPreview.nextBalanceAmount,
      },
    };
    const flowPointsGranted = resolveFlowPointsGrantedFromSubtotal({
      planChange: checkoutPlan.planChange,
      discountedSubtotalAmount: pricing.subtotalAmount,
    });
    const payerName = requestedPayerName;
    const payerDocument = requestedPayerDocument;
    const amount = pricingWithFlowPoints.totalAmount;
    const currency = pricingWithFlowPoints.currency;
    const transitionProviderPayload = buildCheckoutTransitionProviderPayload({
      planChange: checkoutPlan.planChange,
      flowPointsApplied: flowPointsPreview.appliedAmount,
      flowPointsGranted,
      scheduledChangeId: checkoutPlan.scheduledChange?.id || null,
    });

    if (amount > 0 && !payerName) {
      return respond(
        { ok: false, message: "Nome completo invalido para pagamento." },
        { status: 400 },
      );
    }

    if (amount > 0 && !payerDocument) {
      return respond(
        { ok: false, message: "CPF/CNPJ invalido para pagamento." },
        { status: 400 },
      );
    }

    if (
      forceNew &&
      latestOrder &&
      latestOrder.payment_method === "pix" &&
      latestOrder.status === "pending" &&
      latestOrder.provider_payment_id &&
      !isOrderExpiredOrExpiringSoon(
        latestOrder,
        ORDER_EXPIRATION_SAFETY_BUFFER_MS,
      )
    ) {
      const securedOrder = await ensureCheckoutAccessTokenForOrder({
        order: latestOrder,
        forceRotate: false,
        invalidateOtherOrders: false,
      });

      return respond({
        ok: true,
        reused: true,
        alreadyProcessing: true,
        order: toApiOrder(
          securedOrder.order,
          securedOrder.checkoutAccessToken,
        ),
      });
    }

    if (
      !forceNew &&
      latestOrder &&
      latestOrder.plan_code === checkoutPlan.plan.code &&
      latestOrder.plan_billing_cycle_days === checkoutPlan.plan.billingCycleDays &&
      canReuseExistingPixCheckoutOrder(
        latestOrder,
        amount,
        currency,
      )
    ) {
      const securedOrder = await ensureCheckoutAccessTokenForOrder({
        order: latestOrder,
        forceRotate: false,
        invalidateOtherOrders: false,
      });
      return respond({
        ok: true,
        reused: true,
        order: toApiOrder(
          securedOrder.order,
          securedOrder.checkoutAccessToken,
        ),
      });
    }

    let createdOrder: PaymentOrderRecord;
    const draftOrderToReuse =
      !forceNew && latestOrder && canReuseDraftCheckoutOrder(latestOrder)
        ? latestOrder
        : null;

    if (draftOrderToReuse) {
      const reusedOrderResult = await supabase
        .from("payment_orders")
        .update({
          payment_method: "pix",
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
          payer_name: payerName || null,
          payer_document: null,
          payer_document_last4:
            resolvePaymentDocumentLast4(payerDocument?.normalized || null),
          payer_document_type: payerDocument?.type || null,
          payer_document_encrypted: encryptPaymentSensitiveValue(
            payerDocument?.normalized || null,
          ),
          provider_status: null,
          provider_status_detail: null,
          provider_payload: {
            source: "flowdesk_checkout",
            step: 4,
            pricing: pricingWithFlowPoints,
            ...transitionProviderPayload,
            plan: {
              code: checkoutPlan.plan.code,
              name: checkoutPlan.plan.name,
              billingCycleDays: checkoutPlan.plan.billingCycleDays,
              entitlements: {
                ...checkoutPlan.plan.entitlements,
              },
            },
          },
          expires_at: resolveUnpaidSetupExpiresAt(draftOrderToReuse.created_at),
        })
        .eq("id", draftOrderToReuse.id)
        .select(PAYMENT_ORDER_SELECT_COLUMNS)
        .single<PaymentOrderRecord>();

      if (reusedOrderResult.error || !reusedOrderResult.data) {
        throw new Error(reusedOrderResult.error?.message || "Falha ao preparar pedido.");
      }

      createdOrder = reusedOrderResult.data;
      invalidatePaymentReadCachesForOrder(createdOrder);

      await createPaymentOrderEvent(createdOrder.id, "order_payment_started", {
        orderNumber: createdOrder.order_number,
        guildId,
        userId: user.id,
      });
    } else {
      createdOrder = await createDraftOrderForCheckout({
        userId: user.id,
        guildId,
        amount,
        currency,
        plan: checkoutPlan.plan,
      });

      const preparedOrderResult = await supabase
        .from("payment_orders")
        .update({
          payment_method: "pix",
          amount,
          currency,
          plan_code: checkoutPlan.plan.code,
          plan_name: checkoutPlan.plan.name,
          plan_billing_cycle_days: checkoutPlan.plan.billingCycleDays,
          plan_max_licensed_servers: checkoutPlan.plan.entitlements.maxLicensedServers,
          plan_max_active_tickets: checkoutPlan.plan.entitlements.maxActiveTickets,
          plan_max_automations: checkoutPlan.plan.entitlements.maxAutomations,
          plan_max_monthly_actions: checkoutPlan.plan.entitlements.maxMonthlyActions,
          payer_name: payerName || null,
          payer_document: null,
          payer_document_last4:
            resolvePaymentDocumentLast4(payerDocument?.normalized || null),
          payer_document_type: payerDocument?.type || null,
          payer_document_encrypted: encryptPaymentSensitiveValue(
            payerDocument?.normalized || null,
          ),
          provider_payload: {
            source: "flowdesk_checkout",
            step: 4,
            pricing: pricingWithFlowPoints,
            ...transitionProviderPayload,
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
        .eq("id", createdOrder.id)
        .select(PAYMENT_ORDER_SELECT_COLUMNS)
        .single<PaymentOrderRecord>();

      if (preparedOrderResult.error || !preparedOrderResult.data) {
        throw new Error(preparedOrderResult.error?.message || "Falha ao preparar pedido.");
      }

      createdOrder = preparedOrderResult.data;
      invalidatePaymentReadCachesForOrder(createdOrder);
    }

    if (amount <= 0) {
      const securedOrder = await finalizeCreditCoveredCheckoutOrder({
        order: createdOrder,
        pricing,
        flowPointsApplied: flowPointsPreview.appliedAmount,
        flowPointsGranted,
        planChange: checkoutPlan.planChange,
      });

      await logSecurityAuditEventSafe(auditContext, {
        action: "payment_pix_post",
        outcome: "succeeded",
        metadata: {
          orderNumber: securedOrder.order.order_number,
          status: securedOrder.order.status,
          coveredByCredits: true,
        },
      });

      return respond({
        ok: true,
        reused: false,
        order: toApiOrder(
          securedOrder.order,
          securedOrder.checkoutAccessToken,
        ),
      });
    }

    const externalReference = `flowdesk-order-${createdOrder.order_number}`;
    const resolvedPayerName = payerName as string;
    const resolvedPayerDocument = payerDocument as NonNullable<typeof payerDocument>;
    const pixCreationIdempotencyKey = createStablePaymentIdempotencyKey({
      namespace: "flowdesk-pix-create-order",
      parts: [
        createdOrder.order_number,
        externalReference,
        amount,
        currency,
        resolvedPayerDocument.normalized,
      ],
    });

    let createdProviderPayment: MercadoPagoPaymentResponse | null = null;
    try {
      const payerEmail =
        resolveMercadoPagoPixPayerEmail(
          normalizePayerEmail(user.email),
        ) ||
        normalizePayerEmail(user.email) ||
        `${
          user.discord_user_id ? `discord-${user.discord_user_id}` : `user-${user.id}`
        }@flowdeskbot.app`;

      const mercadoPagoPayment = await createMercadoPagoPixPayment({
        amount,
        description: `Flowdesk pagamento #${createdOrder.order_number}`,
        payerName: resolvedPayerName,
        payerEmail,
        payerIdentification: {
          type: resolvedPayerDocument.type,
          number: resolvedPayerDocument.normalized,
        },
        externalReference,
        metadata: {
          flowdesk_order_number: String(createdOrder.order_number),
          flowdesk_user_id: String(user.id),
          ...(user.discord_user_id
            ? {
                flowdesk_discord_user_id: user.discord_user_id,
              }
            : {}),
          ...(guildId
            ? {
                flowdesk_guild_id: guildId,
              }
            : {}),
          flowdesk_plan_code: checkoutPlan.plan.code,
          flowdesk_plan_name: checkoutPlan.plan.name,
          flowdesk_pricing_total: String(amount),
          ...(pricing.coupon?.code
            ? {
                flowdesk_coupon_code: pricing.coupon.code,
              }
            : {}),
          ...(pricing.giftCard?.code
            ? {
                flowdesk_gift_card_code: pricing.giftCard.code,
              }
            : {}),
          ...(flowPointsPreview.appliedAmount > 0
            ? {
                flowdesk_flow_points_applied: String(flowPointsPreview.appliedAmount),
              }
            : {}),
        },
        dateOfExpiration: resolveUnpaidSetupExpiresAt(createdOrder.created_at),
        idempotencyKey: pixCreationIdempotencyKey,
      });
      createdProviderPayment = mercadoPagoPayment;

      const providerPaymentId = String(mercadoPagoPayment.id);
      const confirmedMercadoPagoPayment =
        resolvePaymentStatus(mercadoPagoPayment.status) === "approved"
          ? await confirmImmediatePixProviderPayment(
              providerPaymentId,
              mercadoPagoPayment,
            )
          : mercadoPagoPayment;
      const transactionData =
        confirmedMercadoPagoPayment.point_of_interaction?.transaction_data;
      const providerStatus = confirmedMercadoPagoPayment.status || null;
      const resolvedStatus = resolveNextPaymentOrderStatus(
        createdOrder.status,
        resolvePaymentStatus(confirmedMercadoPagoPayment.status),
      );
      const paymentIdentifiers = extractMercadoPagoPaymentIdentifiers(
        confirmedMercadoPagoPayment,
      );
      const trustedTimestamps = resolveTrustedMercadoPagoPaymentTimestamps({
        providerPayment: confirmedMercadoPagoPayment,
        currentPaidAt: createdOrder.paid_at,
        currentExpiresAt: createdOrder.expires_at,
        resolvedStatus,
      });
      const paidAt = trustedTimestamps.paidAt;
      const expiresAt =
        resolvedStatus === "approved"
          ? await resolveApprovedOrderExpiresAt(createdOrder, paidAt)
          : trustedTimestamps.expiresAt ||
            resolveUnpaidSetupEffectiveExpiresAt({
              createdAt: createdOrder.created_at,
              providerExpiresAt:
                confirmedMercadoPagoPayment.date_of_expiration || null,
            });

      const updatedOrderResult = await supabase
        .from("payment_orders")
        .update({
          status: resolvedStatus,
          provider_payment_id: providerPaymentId,
          provider_external_reference: externalReference,
          provider_qr_code: transactionData?.qr_code || null,
          provider_qr_base64: transactionData?.qr_code_base64 || null,
          provider_ticket_url: transactionData?.ticket_url || null,
          provider_status: providerStatus,
          provider_status_detail:
            confirmedMercadoPagoPayment.status_detail || null,
          provider_payload: {
            source: "flowdesk_checkout",
            step: 4,
            mercado_pago: confirmedMercadoPagoPayment,
            payment_identifiers: paymentIdentifiers,
            trusted_timestamps: trustedTimestamps,
            pricing: pricingWithFlowPoints,
            ...transitionProviderPayload,
            plan: {
              code: checkoutPlan.plan.code,
              name: checkoutPlan.plan.name,
              billingCycleDays: checkoutPlan.plan.billingCycleDays,
              entitlements: {
                ...checkoutPlan.plan.entitlements,
              },
            },
          },
          paid_at: paidAt,
          expires_at: expiresAt,
        })
        .eq("id", createdOrder.id)
        .select(PAYMENT_ORDER_SELECT_COLUMNS)
        .single<PaymentOrderRecord>();

      if (updatedOrderResult.error || !updatedOrderResult.data) {
        throw new Error(updatedOrderResult.error?.message || "Falha ao salvar retorno do pagamento.");
      }

      await createPaymentOrderEvent(createdOrder.id, "provider_payment_created", {
        providerPaymentId,
        providerStatus,
        providerStatusDetail:
          confirmedMercadoPagoPayment.status_detail || null,
        txId: paymentIdentifiers.txId,
        endToEndId: paymentIdentifiers.endToEndId,
        providerLastUpdatedAt: trustedTimestamps.lastUpdatedAt,
      });

      invalidatePaymentReadCachesForOrder(updatedOrderResult.data);
      if (updatedOrderResult.data.status === "approved") {
        invalidateLicenseReadCachesForOrder(updatedOrderResult.data);
      }

      await logSecurityAuditEventSafe(auditContext, {
        action: "payment_pix_post",
        outcome: "succeeded",
        metadata: {
          orderNumber: updatedOrderResult.data.order_number,
          status: updatedOrderResult.data.status,
        },
      });

      const securedOrder = await ensureCheckoutAccessTokenForOrder({
        order: updatedOrderResult.data,
        forceRotate: true,
        invalidateOtherOrders: true,
      });

      if (updatedOrderResult.data.status === "approved") {
        await syncUserPlanStateFromOrder(updatedOrderResult.data);
        clearPlanStateCacheForUser(user.id);
      }

      return respond({
        ok: true,
        reused: false,
        order: toApiOrder(
          securedOrder.order,
          securedOrder.checkoutAccessToken,
        ),
      });
    } catch (providerError) {
      const message =
        providerError instanceof Error
          ? providerError.message
          : "Falha ao criar pagamento PIX.";

      const providerPaymentId = createdProviderPayment
        ? parsePaymentId(createdProviderPayment.id)
        : null;

      if (providerPaymentId && !createdOrder.provider_payment_id) {
        // Protecao: tentamos recuperar o vinculo do pagamento ao pedido.
        let recoveredOrder: PaymentOrderRecord | null = null;
        try {
          const providerStatus = createdProviderPayment?.status || null;
          const resolvedStatus = resolveNextPaymentOrderStatus(
            createdOrder.status,
            resolvePaymentStatus(providerStatus),
          );
          const transactionData =
            createdProviderPayment?.point_of_interaction?.transaction_data;
          const paymentIdentifiers = extractMercadoPagoPaymentIdentifiers(
            createdProviderPayment,
          );
          const trustedTimestamps = resolveTrustedMercadoPagoPaymentTimestamps({
            providerPayment: createdProviderPayment,
            currentPaidAt: createdOrder.paid_at,
            currentExpiresAt: createdOrder.expires_at,
            resolvedStatus,
          });
          const paidAt = trustedTimestamps.paidAt;
          const expiresAt =
            resolvedStatus === "approved"
              ? await resolveApprovedOrderExpiresAt(createdOrder, paidAt)
              : trustedTimestamps.expiresAt ||
                resolveUnpaidSetupEffectiveExpiresAt({
                  createdAt: createdOrder.created_at,
                  providerExpiresAt:
                    createdProviderPayment?.date_of_expiration || null,
                });

          const recoveredOrderResult = await supabase
            .from("payment_orders")
            .update({
              status: resolvedStatus,
              provider_payment_id: providerPaymentId,
              provider_external_reference: externalReference,
              provider_qr_code: transactionData?.qr_code || null,
              provider_qr_base64: transactionData?.qr_code_base64 || null,
              provider_ticket_url: transactionData?.ticket_url || null,
              provider_status: providerStatus,
              provider_status_detail:
                createdProviderPayment?.status_detail || message,
              provider_payload: {
                source: "flowdesk_checkout",
                step: 4,
                recovery_after_error: true,
                mercado_pago: createdProviderPayment,
                payment_identifiers: paymentIdentifiers,
                trusted_timestamps: trustedTimestamps,
                pricing: pricingWithFlowPoints,
                ...transitionProviderPayload,
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
                "Falha ao recuperar pagamento PIX apos erro local.",
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
              txId: paymentIdentifiers.txId,
              endToEndId: paymentIdentifiers.endToEndId,
            },
          );

          invalidatePaymentReadCachesForOrder(recoveredOrder);
          if (recoveredOrder.status === "approved") {
            invalidateLicenseReadCachesForOrder(recoveredOrder);
          }
        } catch {
          // Se nao conseguimos recuperar localmente e o pagamento ja estiver aprovado,
          // tentamos estornar para evitar cobranca sem vinculacao.
          try {
            const snapshot = await fetchMercadoPagoPaymentById(providerPaymentId);
            if (resolvePaymentStatus(snapshot.status) === "approved") {
              await refundMercadoPagoPixPayment(providerPaymentId);
              await createPaymentOrderEventSafe(
                createdOrder.id,
                "provider_payment_auto_refunded_after_recovery_failure",
                {
                  providerPaymentId,
                },
              );
            }
          } catch {
            // melhor esforco
          }
        }

        if (recoveredOrder) {
          await logSecurityAuditEventSafe(auditContext, {
            action: "payment_pix_post",
            outcome: "succeeded",
            metadata: {
              orderNumber: recoveredOrder.order_number,
              status: recoveredOrder.status,
              recoveredAfterFailure: true,
            },
          });

          const securedRecoveredOrder = await ensureCheckoutAccessTokenForOrder({
            order: recoveredOrder,
            forceRotate: true,
            invalidateOtherOrders: true,
          });

          return respond({
            ok: true,
            reused: false,
            recovered: true,
            order: toApiOrder(
              securedRecoveredOrder.order,
              securedRecoveredOrder.checkoutAccessToken,
            ),
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

      invalidatePaymentReadCachesForOrder(createdOrder);

      await createPaymentOrderEvent(createdOrder.id, "provider_payment_failed", {
        message,
      });

      const friendlyMessage = resolveFriendlyPixProviderErrorMessage(message);
      const responseStatus = isProviderDocumentErrorMessage(message) ? 400 : 503;

          return respond(
            { ok: false, message: friendlyMessage },
            { status: responseStatus },
          );
        }
      },
    });
  } catch (error) {
    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_pix_post",
      outcome: "failed",
      metadata: {
        message: extractAuditErrorMessage(error),
      },
    });
    return respond(
      {
        ok: false,
        message: resolveDatabaseFailureMessage(
          error,
          sanitizeErrorMessage(error, "Erro ao criar pagamento PIX."),
        ),
      },
      { status: resolveDatabaseFailureStatus(error) },
    );
  }
}

