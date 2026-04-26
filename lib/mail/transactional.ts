import { sendFlowdeskTransactionalEmail } from "@/lib/mail/authEmail";
import {
  readOrderPlanTransitionPayload,
} from "@/lib/plans/change";
import {
  resolvePaymentBillingPeriodCodeFromCycleDays,
  buildPaymentCheckoutEntryHref,
} from "@/lib/payments/paymentRouting";
import {
  resolvePlanBillingPeriodDefinition,
} from "@/lib/plans/catalog";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type EmailUser = {
  id: number;
  email?: string | null;
  display_name?: string | null;
  username?: string | null;
};

type PaymentEmailOrder = {
  id: number;
  order_number: number;
  user_id: number;
  guild_id?: string | null;
  payment_method?: string | null;
  status?: string | null;
  amount?: string | number | null;
  currency?: string | null;
  plan_code?: string | null;
  plan_name?: string | null;
  plan_billing_cycle_days?: number | null;
  provider_ticket_url?: string | null;
  provider_payload?: unknown;
  paid_at?: string | null;
  expires_at?: string | null;
  created_at?: string | null;
};

type PaymentEventPayload = Record<string, unknown>;

const AUTH_USER_EMAIL_SELECT_COLUMNS =
  "id, email, display_name, username";

function shouldSkipLocalAuthTransactionalEmail() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.AUTH_ENABLE_LOCAL_TRANSACTIONAL_EMAILS !== "1"
  );
}

function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
}

function resolveDisplayName(user: EmailUser | null | undefined) {
  return (
    user?.display_name?.trim() ||
    user?.username?.trim() ||
    "cliente Flowdesk"
  );
}

function formatCurrency(value: string | number | null | undefined, currency = "BRL") {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric)) return "R$ 0,00";

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currency || "BRL",
  }).format(numeric);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: process.env.AUTH_EMAIL_TIMEZONE?.trim() || "America/Sao_Paulo",
  }).format(date);
}

function normalizeUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function resolvePublicBaseUrl() {
  const value =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.APP_URL ||
    process.env.SITE_URL ||
    "https://www.flwdesk.com";

  return value.trim().replace(/\/+$/, "");
}

function buildAbsoluteUrl(pathOrUrl: string | null | undefined) {
  if (!pathOrUrl) return null;
  const normalized = normalizeUrl(pathOrUrl);
  if (normalized) return normalized;

  const path = String(pathOrUrl).trim();
  if (!path) return null;
  return `${resolvePublicBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

function readProviderPayloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isFlowPointsOnlyPaymentOrder(order: PaymentEmailOrder) {
  const payload = readProviderPayloadRecord(order.provider_payload);
  const productType =
    typeof payload.productType === "string"
      ? payload.productType.trim().toLowerCase()
      : typeof payload.product_type === "string"
        ? payload.product_type.trim().toLowerCase()
        : typeof payload.kind === "string"
          ? payload.kind.trim().toLowerCase()
          : "";

  return (
    productType === "flow_points" ||
    productType === "flowpoints" ||
    order.plan_code === "flow_points" ||
    order.plan_code === "flowpoints"
  );
}

function resolveFlowPointsGranted(order: PaymentEmailOrder) {
  const transition = readOrderPlanTransitionPayload(order.provider_payload);
  return Math.max(0, transition?.flowPointsGranted || 0);
}

function resolvePaymentMethodLabel(value: string | null | undefined) {
  switch (value) {
    case "pix":
      return "PIX";
    case "card":
      return "Cartao";
    case "trial":
      return "Teste gratuito";
    default:
      return "Pagamento";
  }
}

function resolveBillingLabel(order: PaymentEmailOrder) {
  const periodCode = resolvePaymentBillingPeriodCodeFromCycleDays(
    order.plan_billing_cycle_days,
  );
  return resolvePlanBillingPeriodDefinition(periodCode).label;
}

function buildPaymentUrl(order: PaymentEmailOrder, checkoutAccessToken?: string | null) {
  const href = buildPaymentCheckoutEntryHref({
    planCode: order.plan_code,
    billingPeriodCode: resolvePaymentBillingPeriodCodeFromCycleDays(
      order.plan_billing_cycle_days,
    ),
    orderNumber: order.order_number,
    orderId: order.id,
    searchParams: checkoutAccessToken
      ? { checkoutToken: checkoutAccessToken }
      : undefined,
  });

  return buildAbsoluteUrl(href);
}

async function getUserForEmail(userId: number) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_users")
    .select(AUTH_USER_EMAIL_SELECT_COLUMNS)
    .eq("id", userId)
    .maybeSingle<EmailUser>();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data || null;
}

async function getPaymentOrderEmailEvent(
  paymentOrderId: number,
  eventType: string,
) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("payment_order_events")
    .select("id")
    .eq("payment_order_id", paymentOrderId)
    .eq("event_type", eventType)
    .limit(1)
    .maybeSingle<{ id: number }>();

  if (result.error) {
    return null;
  }

  return result.data || null;
}

async function markPaymentOrderEmailEvent(
  paymentOrderId: number,
  eventType: string,
  eventPayload: PaymentEventPayload,
) {
  const supabase = getSupabaseAdminClientOrThrow();
  await supabase.from("payment_order_events").insert({
    payment_order_id: paymentOrderId,
    event_type: eventType,
    event_payload: eventPayload,
  });
}

async function sendPaymentEmailOnce(
  order: PaymentEmailOrder,
  eventType: string,
  eventPayload: PaymentEventPayload,
  sender: () => Promise<void>,
) {
  const existing = await getPaymentOrderEmailEvent(order.id, eventType);
  if (existing) return;

  await sender();
  await markPaymentOrderEmailEvent(order.id, eventType, {
    ...eventPayload,
    sentAt: new Date().toISOString(),
  }).catch(() => null);
}

export async function sendAccountCreatedEmailSafe(user: EmailUser) {
  if (shouldSkipLocalAuthTransactionalEmail()) return;

  const email = normalizeEmail(user.email);
  if (!email) return;

  await sendFlowdeskTransactionalEmail({
    toEmail: email,
    type: "account-created",
    subject: "Flowdesk | Conta criada",
    preheader: "Sua conta Flowdesk foi criada com sucesso.",
    badgeLabel: "Conta",
    title: "Conta criada com sucesso",
    intro: `Ola, ${resolveDisplayName(user)}. Sua conta Flowdesk ja esta pronta para uso.`,
    sections: [
      { label: "Conta", value: email },
      { label: "Criada em", value: formatDateTime(new Date().toISOString()) },
    ],
  }).catch((error) => {
    console.warn("[transactional-email] account-created failed:", error);
  });
}

export async function sendLoginNotificationEmailSafe(input: {
  userId: number;
  authMethod: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  locationLabel?: string | null;
}) {
  if (shouldSkipLocalAuthTransactionalEmail()) return;

  try {
    const user = await getUserForEmail(input.userId);
    const email = normalizeEmail(user?.email);
    if (!email) return;

    await sendFlowdeskTransactionalEmail({
      toEmail: email,
      type: "login-notification",
      subject: "Flowdesk | Novo login na sua conta",
      preheader: "Um acesso foi realizado na sua conta Flowdesk.",
      badgeLabel: "Seguranca",
      title: "Novo login detectado",
      intro: `Registramos um acesso na conta de ${resolveDisplayName(user)}.`,
      sections: [
        { label: "Metodo", value: input.authMethod || "login" },
        { label: "Dispositivo", value: input.userAgent || "Nao identificado" },
        { label: "Localizacao", value: input.locationLabel || input.ipAddress || "Nao identificada" },
        { label: "Data", value: formatDateTime(new Date().toISOString()) },
      ],
      footer:
        "Se voce nao reconhece este acesso, altere sua senha e revise suas sessoes ativas.",
    });
  } catch (error) {
    console.warn("[transactional-email] login-notification failed:", error);
  }
}

export async function sendPaymentPendingEmailSafe(input: {
  user: EmailUser;
  order: PaymentEmailOrder;
  paymentUrl?: string | null;
  checkoutAccessToken?: string | null;
}) {
  const email = normalizeEmail(input.user.email);
  if (!email) return;

  const paymentUrl =
    normalizeUrl(input.paymentUrl) ||
    buildPaymentUrl(input.order, input.checkoutAccessToken) ||
    normalizeUrl(input.order.provider_ticket_url);

  await sendPaymentEmailOnce(
    input.order,
    "email_payment_pending_sent",
    {
      paymentUrl,
      status: input.order.status,
    },
    () =>
      sendFlowdeskTransactionalEmail({
        toEmail: email,
        type: "payment-pending",
        subject: `Flowdesk | Pagamento #${input.order.order_number} pendente`,
        preheader: "Seu pagamento Flowdesk esta aguardando conclusao.",
        badgeLabel: "Pagamento",
        title: "Pagamento pendente",
        intro: "Seu pedido foi criado e ainda precisa ser concluido para liberar o beneficio.",
        sections: [
          { label: "Pedido", value: `#${input.order.order_number}` },
          { label: "Plano", value: input.order.plan_name || input.order.plan_code },
          { label: "Periodo", value: resolveBillingLabel(input.order) },
          { label: "Metodo", value: resolvePaymentMethodLabel(input.order.payment_method) },
          { label: "Valor", value: formatCurrency(input.order.amount, input.order.currency || "BRL") },
        ],
        action: paymentUrl
          ? {
              label: "PAGAR",
              href: paymentUrl,
            }
          : null,
      }),
  ).catch((error) => {
    console.warn("[transactional-email] payment-pending failed:", error);
  });
}

export async function sendPaymentApprovedEmailForOrderSafe(order: PaymentEmailOrder) {
  try {
    const user = await getUserForEmail(order.user_id);
    const email = normalizeEmail(user?.email);
    if (!email) return;

    const flowPointsOnly = isFlowPointsOnlyPaymentOrder(order);
    const flowPointsGranted = resolveFlowPointsGranted(order);

    if (!flowPointsOnly) {
      await sendPaymentEmailOnce(
        order,
        "email_payment_approved_sent",
        { status: order.status },
        () =>
          sendFlowdeskTransactionalEmail({
            toEmail: email,
            type: "payment-approved",
            subject: `Flowdesk | Pagamento #${order.order_number} aprovado`,
            preheader: "Pagamento aprovado e beneficio liberado na sua conta.",
            badgeLabel: "Pagamento",
            title: "Pagamento aprovado",
            intro: "Recebemos a confirmacao do pagamento e o beneficio foi aplicado na sua conta.",
            sections: [
              { label: "Pedido", value: `#${order.order_number}` },
              { label: "Plano", value: order.plan_name || order.plan_code },
              { label: "Periodo", value: resolveBillingLabel(order) },
              { label: "Valor", value: formatCurrency(order.amount, order.currency || "BRL") },
              { label: "Aprovado em", value: formatDateTime(order.paid_at || new Date().toISOString()) },
              { label: "Valido ate", value: formatDateTime(order.expires_at || null) },
            ],
          }),
      );
    }

    if (flowPointsOnly || flowPointsGranted > 0) {
      await sendPaymentEmailOnce(
        order,
        "email_flow_points_granted_sent",
        { flowPointsGranted },
        () =>
          sendFlowdeskTransactionalEmail({
            toEmail: email,
            type: "flow-points-granted",
            subject: "Flowdesk | FlowPoints creditados",
            preheader: "FlowPoints foram enviados para sua conta.",
            badgeLabel: "FlowPoints",
            title: "FlowPoints creditados",
            intro: "Os FlowPoints do pagamento foram enviados para sua conta Flowdesk.",
            sections: [
              { label: "Pedido", value: `#${order.order_number}` },
              { label: "FlowPoints", value: flowPointsGranted > 0 ? formatCurrency(flowPointsGranted, order.currency || "BRL") : "Creditado" },
              { label: "Creditado em", value: formatDateTime(order.paid_at || new Date().toISOString()) },
            ],
          }),
      );
    }
  } catch (error) {
    console.warn("[transactional-email] payment-approved failed:", error);
  }
}

export async function sendApiKeyCreatedEmailSafe(input: {
  user: EmailUser;
  keyName?: string | null;
}) {
  const email = normalizeEmail(input.user.email);
  if (!email) return;

  await sendFlowdeskTransactionalEmail({
    toEmail: email,
    type: "api-key-created",
    subject: "Flowdesk | Nova chave de API criada",
    preheader: "Uma chave de API foi criada na sua conta.",
    badgeLabel: "API",
    title: "Chave de API criada",
    intro: "Uma nova chave de API foi criada na sua conta Flowdesk.",
    sections: [
      { label: "Nome", value: input.keyName || "Chave sem nome" },
      { label: "Criada em", value: formatDateTime(new Date().toISOString()) },
    ],
    footer:
      "Se voce nao criou esta chave, revogue-a imediatamente no painel da conta.",
  }).catch((error) => {
    console.warn("[transactional-email] api-key-created failed:", error);
  });
}

export async function sendTeamCreatedEmailSafe(input: {
  user: EmailUser;
  teamName: string;
  guildCount: number;
  memberInviteCount: number;
}) {
  const email = normalizeEmail(input.user.email);
  if (!email) return;

  await sendFlowdeskTransactionalEmail({
    toEmail: email,
    type: "team-created",
    subject: "Flowdesk | Equipe criada",
    preheader: "Uma equipe foi criada na sua conta.",
    badgeLabel: "Equipe",
    title: "Equipe criada",
    intro: "Sua nova equipe Flowdesk foi criada com sucesso.",
    sections: [
      { label: "Equipe", value: input.teamName },
      { label: "Servidores vinculados", value: input.guildCount },
      { label: "Convites enviados", value: input.memberInviteCount },
    ],
  }).catch((error) => {
    console.warn("[transactional-email] team-created failed:", error);
  });
}

export async function sendAccountStatusChangedEmailSafe(input: {
  user: EmailUser;
  statusLabel: string;
  detail?: string | null;
}) {
  const email = normalizeEmail(input.user.email);
  if (!email) return;

  await sendFlowdeskTransactionalEmail({
    toEmail: email,
    type: "account-status-updated",
    subject: "Flowdesk | Status da conta atualizado",
    preheader: "Houve uma atualizacao no status da sua conta.",
    badgeLabel: "Conta",
    title: "Status da conta atualizado",
    intro: "Registramos uma atualizacao importante no status da sua conta Flowdesk.",
    sections: [
      { label: "Status", value: input.statusLabel },
      { label: "Detalhe", value: input.detail || null },
      { label: "Atualizado em", value: formatDateTime(new Date().toISOString()) },
    ],
  }).catch((error) => {
    console.warn("[transactional-email] account-status failed:", error);
  });
}

export async function sendServerSettingsSavedEmailSafe(input: {
  user: EmailUser;
  guildId: string;
  moduleLabel: string;
  detail?: string | null;
}) {
  const email = normalizeEmail(input.user.email);
  if (!email) return;

  await sendFlowdeskTransactionalEmail({
    toEmail: email,
    type: "server-settings-saved",
    subject: "Flowdesk | Configuracoes do servidor salvas",
    preheader: "Configuracoes de um servidor foram salvas.",
    badgeLabel: "Servidor",
    title: "Configuracoes salvas",
    intro: "As configuracoes do servidor foram salvas no painel Flowdesk.",
    sections: [
      { label: "Modulo", value: input.moduleLabel },
      { label: "Servidor", value: input.guildId },
      { label: "Detalhe", value: input.detail || null },
      { label: "Salvo em", value: formatDateTime(new Date().toISOString()) },
    ],
  }).catch((error) => {
    console.warn("[transactional-email] server-settings failed:", error);
  });
}

export async function sendSupportTicketOpenedEmailSafe(input: {
  user: EmailUser;
  protocol: string;
  guildName?: string | null;
  channelUrl?: string | null;
  reason?: string | null;
}) {
  const email = normalizeEmail(input.user.email);
  if (!email) return;

  await sendFlowdeskTransactionalEmail({
    toEmail: email,
    type: "support-ticket-opened",
    subject: `Flowdesk | Ticket ${input.protocol} aberto`,
    preheader: "Seu ticket de suporte foi aberto.",
    badgeLabel: "Suporte",
    title: "Ticket de suporte aberto",
    intro: "Recebemos sua solicitacao e o atendimento foi aberto no Discord.",
    sections: [
      { label: "Protocolo", value: input.protocol },
      { label: "Servidor", value: input.guildName || null },
      { label: "Motivo", value: input.reason || null },
    ],
    action: normalizeUrl(input.channelUrl)
      ? { label: "ABRIR TICKET", href: input.channelUrl as string }
      : null,
  }).catch((error) => {
    console.warn("[transactional-email] support-ticket failed:", error);
  });
}
