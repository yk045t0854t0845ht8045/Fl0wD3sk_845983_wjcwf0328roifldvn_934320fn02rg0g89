import crypto from "node:crypto";
import { buildOfficialDiscordChannelUrl } from "@/lib/discordLink/config";
import type { CurrentAuthSession } from "@/lib/auth/session";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import type {
  StatusSubscriptionRecord,
  StatusSubscriptionType,
  StatusSubscriptionViewer,
} from "./types";

type PersistedSubscriptionRow = {
  id: string;
  type: StatusSubscriptionType;
  target: string;
  label: string | null;
  metadata: Record<string, unknown> | null;
  is_active: boolean;
  verified_at: string | null;
  last_tested_at: string | null;
  last_delivery_at: string | null;
  last_delivery_status: number | null;
  last_delivery_error: string | null;
  created_at: string;
  updated_at: string;
};

type SaveStatusSubscriptionInput = {
  type: StatusSubscriptionType;
  target?: string | null;
};

type WebhookValidationResult = {
  ok: boolean;
  kind: "discord" | "generic";
  responseStatus: number | null;
  latencyMs: number | null;
  responseBody: string | null;
};

export class StatusSubscriptionError extends Error {
  statusCode: number;
  code: string;
  extra?: Record<string, unknown>;

  constructor(
    message: string,
    input?: {
      statusCode?: number;
      code?: string;
      extra?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.name = "StatusSubscriptionError";
    this.statusCode = input?.statusCode ?? 400;
    this.code = input?.code ?? "STATUS_SUBSCRIPTION_ERROR";
    this.extra = input?.extra;
  }
}

function buildDiscordAvatarUrl(discordUserId: string, avatarHash: string | null) {
  if (!avatarHash) return null;
  const extension = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordUserId}/${avatarHash}.${extension}?size=160`;
}

function normalizeTarget(type: StatusSubscriptionType, target: string | null | undefined) {
  const value = (target || "").trim();

  if (type === "discord_channel") {
    return buildOfficialDiscordChannelUrl();
  }

  if (type === "discord_dm") {
    return value;
  }

  if (!value) {
    throw new StatusSubscriptionError("Preencha o destino da inscricao.");
  }

  if (type === "email") {
    const normalized = value.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new StatusSubscriptionError("Informe um email valido.");
    }
    return normalized;
  }

  if (type === "webhook") {
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("invalid_protocol");
      }
      return url.toString();
    } catch {
      throw new StatusSubscriptionError("Informe uma URL de webhook valida.");
    }
  }

  return value;
}

function buildViewer(authSession: CurrentAuthSession | null): StatusSubscriptionViewer {
  if (!authSession) {
    return {
      authenticated: false,
      userId: null,
      discordUserId: null,
      username: null,
      displayName: null,
      avatarUrl: null,
      email: null,
    };
  }

  return {
    authenticated: true,
    userId: authSession.user.id,
    discordUserId: authSession.user.discord_user_id,
    username: authSession.user.username,
    displayName: authSession.user.display_name,
    avatarUrl: buildDiscordAvatarUrl(
      authSession.user.discord_user_id,
      authSession.user.avatar,
    ),
    email: authSession.user.email || null,
  };
}

async function getUserSubscriptions(userId: number) {
  const supabase = getSupabaseAdminClientOrThrow();
  const { data, error } = await supabase
    .from("system_status_subscriptions")
    .select(
      "id, type, target, label, metadata, is_active, verified_at, last_tested_at, last_delivery_at, last_delivery_status, last_delivery_error, created_at, updated_at",
    )
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return ((data || []) as PersistedSubscriptionRow[]).reduce<
    Partial<Record<StatusSubscriptionType, StatusSubscriptionRecord>>
  >((acc, row) => {
    acc[row.type] = row;
    return acc;
  }, {});
}

async function getUserSubscriptionByType(userId: number, type: StatusSubscriptionType) {
  const supabase = getSupabaseAdminClientOrThrow();
  const { data, error } = await supabase
    .from("system_status_subscriptions")
    .select(
      "id, type, target, label, metadata, is_active, verified_at, last_tested_at, last_delivery_at, last_delivery_status, last_delivery_error, created_at, updated_at",
    )
    .eq("user_id", userId)
    .eq("type", type)
    .maybeSingle<PersistedSubscriptionRow>();

  if (error) {
    throw error;
  }

  return data;
}

async function upsertUserSubscription(
  userId: number,
  type: StatusSubscriptionType,
  payload: {
    target: string;
    label: string | null;
    metadata: Record<string, unknown>;
    verifiedAt?: string | null;
    lastTestedAt?: string | null;
    lastDeliveryStatus?: number | null;
    lastDeliveryError?: string | null;
  },
) {
  const supabase = getSupabaseAdminClientOrThrow();
  const existing = await getUserSubscriptionByType(userId, type);
  const now = new Date().toISOString();

  if (existing?.id) {
    const { data, error } = await supabase
      .from("system_status_subscriptions")
      .update({
        target: payload.target,
        label: payload.label,
        metadata: payload.metadata,
        is_active: true,
        verified_at: payload.verifiedAt ?? existing.verified_at ?? now,
        last_tested_at: payload.lastTestedAt ?? existing.last_tested_at ?? null,
        last_delivery_status:
          payload.lastDeliveryStatus ?? existing.last_delivery_status ?? null,
        last_delivery_error:
          payload.lastDeliveryError ?? existing.last_delivery_error ?? null,
        updated_at: now,
      })
      .eq("id", existing.id)
      .select(
        "id, type, target, label, metadata, is_active, verified_at, last_tested_at, last_delivery_at, last_delivery_status, last_delivery_error, created_at, updated_at",
      )
      .single<PersistedSubscriptionRow>();

    if (error) {
      throw error;
    }

    return data;
  }

  const { data, error } = await supabase
    .from("system_status_subscriptions")
    .insert({
      user_id: userId,
      type,
      target: payload.target,
      label: payload.label,
      metadata: payload.metadata,
      is_active: true,
      verified_at: payload.verifiedAt ?? now,
      last_tested_at: payload.lastTestedAt ?? null,
      last_delivery_status: payload.lastDeliveryStatus ?? null,
      last_delivery_error: payload.lastDeliveryError ?? null,
    })
    .select(
      "id, type, target, label, metadata, is_active, verified_at, last_tested_at, last_delivery_at, last_delivery_status, last_delivery_error, created_at, updated_at",
    )
    .single<PersistedSubscriptionRow>();

  if (error) {
    throw error;
  }

  return data;
}

async function createAnonymousEmailSubscription(target: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const { data, error } = await supabase
    .from("system_status_subscriptions")
    .upsert(
      {
        type: "email",
        target,
        label: "Atualizacoes por email",
        metadata: {
          source: "status_page_public_form",
        },
        is_active: true,
        verified_at: new Date().toISOString(),
      },
      {
        onConflict: "type,target",
        ignoreDuplicates: false,
      },
    )
    .select(
      "id, type, target, label, metadata, is_active, verified_at, last_tested_at, last_delivery_at, last_delivery_status, last_delivery_error, created_at, updated_at",
    )
    .single<PersistedSubscriptionRow>();

  if (error) {
    throw error;
  }

  return data;
}

function getWebhookKind(url: string) {
  return /discord(?:app)?\.com\/api\/webhooks\//i.test(url) ? "discord" : "generic";
}

function buildWebhookHeaders(body: string) {
  const requestId = crypto.randomUUID();
  const secret = process.env.STATUS_WEBHOOK_SECRET?.trim() || "";
  const signature = secret
    ? `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`
    : null;

  return {
    requestId,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "FlowdeskStatus/1.0",
      "X-Flowdesk-Event": "status.subscription.validation",
      "X-Flowdesk-Request-Id": requestId,
      ...(signature ? { "X-Flowdesk-Signature": signature } : {}),
    },
  };
}

async function logWebhookDelivery(
  subscriptionId: string,
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  result: WebhookValidationResult,
) {
  const supabase = getSupabaseAdminClientOrThrow();
  const responseBody =
    result.responseBody && result.responseBody.length > 1500
      ? result.responseBody.slice(0, 1500)
      : result.responseBody;

  await supabase.from("system_status_webhook_deliveries").insert({
    subscription_id: subscriptionId,
    event_type: "status.subscription.validation",
    request_url: url,
    request_headers: headers,
    request_body: body,
    response_status: result.responseStatus,
    response_body: responseBody,
    delivered: result.ok,
    latency_ms: result.latencyMs,
  });
}

async function validateWebhook(url: string): Promise<WebhookValidationResult> {
  const kind = getWebhookKind(url);
  const startedAt = Date.now();

  const payload =
    kind === "discord"
      ? {
          content:
            "Flowdesk status webhook conectado com sucesso. Este evento valida que o destino esta pronto para receber notificacoes.",
        }
      : {
          event: "status.subscription.validation",
          generatedAt: new Date().toISOString(),
          challenge: crypto.randomUUID(),
          service: "flowdesk-status",
          message:
            "Webhook validado com sucesso. O destino esta pronto para receber atualizacoes de status.",
        };

  const body = JSON.stringify(payload);
  const { headers } = buildWebhookHeaders(body);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      cache: "no-store",
    });
    const latencyMs = Date.now() - startedAt;
    const responseBody = await response.text().catch(() => "");

    return {
      ok: response.ok,
      kind,
      responseStatus: response.status,
      latencyMs,
      responseBody: responseBody.trim().slice(0, 1500) || null,
    };
  } catch (error) {
    return {
      ok: false,
      kind,
      responseStatus: null,
      latencyMs: Date.now() - startedAt,
      responseBody:
        error instanceof Error
          ? `${error.name}: ${error.message}`.slice(0, 1500)
          : "Falha ao validar o webhook.",
    };
  }
}

export async function getStatusSubscriptionState(authSession: CurrentAuthSession | null) {
  const viewer = buildViewer(authSession);
  const subscriptions =
    authSession?.user?.id != null
      ? await getUserSubscriptions(authSession.user.id)
      : {};

  return {
    viewer,
    subscriptions,
    discordChannelUrl: buildOfficialDiscordChannelUrl(),
  };
}

export async function saveStatusSubscription(
  input: SaveStatusSubscriptionInput,
  authSession: CurrentAuthSession | null,
) {
  if (input.type === "discord_channel") {
    return {
      ok: true,
      redirectUrl: buildOfficialDiscordChannelUrl(),
      subscription: null,
    };
  }

  if (input.type === "discord_dm") {
    if (!authSession) {
      throw new StatusSubscriptionError(
        "Entre com sua conta para ativar atualizacoes por Discord DM.",
        { statusCode: 401, code: "AUTH_REQUIRED" },
      );
    }

    const target = authSession.user.discord_user_id;
    const subscription = await upsertUserSubscription(authSession.user.id, input.type, {
      target,
      label: "Alertas por Discord DM",
      metadata: {
        username: authSession.user.username,
        displayName: authSession.user.display_name,
        avatarUrl: buildDiscordAvatarUrl(
          authSession.user.discord_user_id,
          authSession.user.avatar,
        ),
        source: "status_page_discord_dm",
      },
      verifiedAt: new Date().toISOString(),
    });

    return {
      ok: true,
      subscription,
      validation: null,
    };
  }

  if (input.type === "webhook") {
    if (!authSession) {
      throw new StatusSubscriptionError(
        "Entre com sua conta para salvar um webhook de status.",
        { statusCode: 401, code: "AUTH_REQUIRED" },
      );
    }

    const target = normalizeTarget("webhook", input.target);
    const validation = await validateWebhook(target);

    if (!validation.ok) {
      throw new StatusSubscriptionError(
        validation.responseStatus
          ? `O destino respondeu ${validation.responseStatus} durante a validacao do webhook.`
          : "Nao foi possivel validar o webhook informado.",
        {
          statusCode: 400,
          code: "WEBHOOK_VALIDATION_FAILED",
          extra: {
            validation,
          },
        },
      );
    }

    const subscription = await upsertUserSubscription(authSession.user.id, input.type, {
      target,
      label: validation.kind === "discord" ? "Webhook do Discord" : "Webhook de status",
      metadata: {
        kind: validation.kind,
        source: "status_page_webhook",
      },
      verifiedAt: new Date().toISOString(),
      lastTestedAt: new Date().toISOString(),
      lastDeliveryStatus: validation.responseStatus,
      lastDeliveryError: null,
    });

    await logWebhookDelivery(
      subscription.id,
      target,
      {
        "Content-Type": "application/json",
        "User-Agent": "FlowdeskStatus/1.0",
        "X-Flowdesk-Event": "status.subscription.validation",
      },
      {
        event: "status.subscription.validation",
      },
      validation,
    );

    return {
      ok: true,
      subscription,
      validation,
    };
  }

  const normalizedTarget = normalizeTarget(
    "email",
    input.target || authSession?.user.email || "",
  );

  const subscription = authSession
    ? await upsertUserSubscription(authSession.user.id, "email", {
        target: normalizedTarget,
        label: "Atualizacoes por email",
        metadata: {
          source: "status_page_email",
        },
        verifiedAt: new Date().toISOString(),
      })
    : await createAnonymousEmailSubscription(normalizedTarget);

  return {
    ok: true,
    subscription,
    validation: null,
  };
}

export async function disableStatusSubscription(
  type: StatusSubscriptionType,
  authSession: CurrentAuthSession | null,
) {
  if (!authSession) {
    throw new StatusSubscriptionError("Sessao obrigatoria para alterar esta inscricao.", {
      statusCode: 401,
      code: "AUTH_REQUIRED",
    });
  }

  const existing = await getUserSubscriptionByType(authSession.user.id, type);
  if (!existing?.id) {
    return { ok: true };
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const { error } = await supabase
    .from("system_status_subscriptions")
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id);

  if (error) {
    throw error;
  }

  return { ok: true };
}
