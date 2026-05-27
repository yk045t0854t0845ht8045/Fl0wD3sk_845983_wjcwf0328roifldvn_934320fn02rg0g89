import crypto from "node:crypto";

import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type CacheEntry<TValue> = {
  expiresAt: number;
  value: TValue;
  tags: string[];
};

type PaymentOrderLike = {
  id?: number;
  order_number?: number;
  user_id?: number;
  guild_id?: string | null;
};

const LATEST_ORDER_CACHE_TTL_MS = 2_500;
const ORDER_BY_CODE_CACHE_TTL_MS = 2_500;
const DRAFT_ORDER_CACHE_TTL_MS = 3_500;

const paymentOrderQueryCache = new Map<string, CacheEntry<unknown>>();
const paymentOrderQueryInflight = new Map<string, Promise<unknown>>();
const paymentOrderQueryTagIndex = new Map<string, Set<string>>();

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeGuildKey(guildId: string | null | undefined) {
  const normalized = typeof guildId === "string" ? guildId.trim() : "";
  return normalized || "__account__";
}

function hashSelectColumns(selectColumns: string) {
  return crypto
    .createHash("sha1")
    .update(selectColumns)
    .digest("hex")
    .slice(0, 12);
}

function removeCacheKey(key: string) {
  const cached = paymentOrderQueryCache.get(key);
  if (cached) {
    for (const tag of cached.tags) {
      const keys = paymentOrderQueryTagIndex.get(tag);
      if (!keys) continue;
      keys.delete(key);
      if (keys.size === 0) {
        paymentOrderQueryTagIndex.delete(tag);
      }
    }
  }

  paymentOrderQueryCache.delete(key);
  paymentOrderQueryInflight.delete(key);
}

function readCacheEntry<TValue>(key: string) {
  const cached = paymentOrderQueryCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    removeCacheKey(key);
    return null;
  }
  return cloneJsonValue(cached.value as TValue);
}

function writeCacheEntry<TValue>(
  key: string,
  value: TValue,
  ttlMs: number,
  tags: string[],
) {
  removeCacheKey(key);

  const uniqueTags = Array.from(new Set(tags.filter(Boolean)));
  paymentOrderQueryCache.set(key, {
    value: cloneJsonValue(value),
    expiresAt: Date.now() + ttlMs,
    tags: uniqueTags,
  });

  for (const tag of uniqueTags) {
    const keys = paymentOrderQueryTagIndex.get(tag) || new Set<string>();
    keys.add(key);
    paymentOrderQueryTagIndex.set(tag, keys);
  }
}

function buildScopeTags(input: {
  userId?: number | null;
  guildId?: string | null;
  orderId?: number | null;
  orderNumber?: number | null;
}) {
  const hasGuildId = input.guildId !== undefined;
  const guildKey = hasGuildId ? normalizeGuildKey(input.guildId) : null;
  const tags: string[] = [];

  if (guildKey) {
    tags.push(`guild:${guildKey}`);
  }

  if (typeof input.userId === "number") {
    tags.push(`user:${input.userId}`);
    if (guildKey) {
      tags.push(`userGuild:${input.userId}:${guildKey}`);
    }
  }

  if (typeof input.orderId === "number") {
    tags.push(`orderId:${input.orderId}`);
  }

  if (typeof input.orderNumber === "number") {
    tags.push(`orderNumber:${input.orderNumber}`);
    if (guildKey) {
      tags.push(`orderNumberGuild:${guildKey}:${input.orderNumber}`);
    }
  }

  return tags;
}

function buildOrderTags(order: PaymentOrderLike | null | undefined) {
  if (!order || typeof order !== "object") return [];

  return buildScopeTags({
    userId: typeof order.user_id === "number" ? order.user_id : null,
    guildId: typeof order.guild_id === "string" ? order.guild_id : null,
    orderId: typeof order.id === "number" ? order.id : null,
    orderNumber:
      typeof order.order_number === "number" ? order.order_number : null,
  });
}

async function getOrLoadCachedValue<TValue>(input: {
  key: string;
  ttlMs: number;
  tags: string[];
  loader: () => Promise<TValue>;
}) {
  const cached = readCacheEntry<TValue>(input.key);
  if (cached !== null) {
    return cached;
  }

  const inflight = paymentOrderQueryInflight.get(input.key);
  if (inflight) {
    return cloneJsonValue((await inflight) as TValue);
  }

  const loadPromise = input
    .loader()
    .then((value) => {
      writeCacheEntry(
        input.key,
        value,
        input.ttlMs,
        [...input.tags, ...buildOrderTags(value as PaymentOrderLike)],
      );
      return value;
    })
    .finally(() => {
      paymentOrderQueryInflight.delete(input.key);
    });

  paymentOrderQueryInflight.set(input.key, loadPromise);
  return cloneJsonValue((await loadPromise) as TValue);
}

export function invalidatePaymentOrderQueryCaches(input?: {
  userId?: number | null;
  guildId?: string | null;
  orderId?: number | null;
  orderNumber?: number | null;
}) {
  if (!input) {
    for (const key of Array.from(paymentOrderQueryCache.keys())) {
      removeCacheKey(key);
    }
    return;
  }

  const tags = buildScopeTags(input);
  const keysToRemove = new Set<string>();

  for (const tag of tags) {
    const keys = paymentOrderQueryTagIndex.get(tag);
    if (!keys) continue;
    for (const key of keys) {
      keysToRemove.add(key);
    }
  }

  for (const key of keysToRemove) {
    removeCacheKey(key);
  }
}

export async function getCachedLatestPaymentOrderForUserAndGuild<
  TOrder extends PaymentOrderLike,
>(input: {
  userId: number;
  guildId: string | null;
  selectColumns: string;
  forceFresh?: boolean;
  ttlMs?: number;
}) {
  const guildKey = normalizeGuildKey(input.guildId);
  const key = `latest:${hashSelectColumns(input.selectColumns)}:${input.userId}:${guildKey}`;
  if (input.forceFresh) {
    removeCacheKey(key);
  }

  return getOrLoadCachedValue<TOrder | null>({
    key,
    ttlMs: input.ttlMs || LATEST_ORDER_CACHE_TTL_MS,
    tags: buildScopeTags({
      userId: input.userId,
      guildId: input.guildId,
    }),
    loader: async () => {
      const supabase = getSupabaseAdminClientOrThrow();
      const result = await supabase
        .from("payment_orders")
        .select(input.selectColumns)
        .eq("user_id", input.userId)
        .filter("guild_id", input.guildId === null ? "is" : "eq", input.guildId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<TOrder>();

      if (result.error) {
        throw new Error(`Erro ao carregar pedido atual: ${result.error.message}`);
      }

      return result.data || null;
    },
  });
}

export async function getCachedLatestPendingDraftPaymentOrderForUserAndGuild<
  TOrder extends PaymentOrderLike,
>(input: {
  userId: number;
  guildId: string | null;
  selectColumns: string;
  forceFresh?: boolean;
  ttlMs?: number;
}) {
  const guildKey = normalizeGuildKey(input.guildId);
  const key = `draft:${hashSelectColumns(input.selectColumns)}:${input.userId}:${guildKey}`;
  if (input.forceFresh) {
    removeCacheKey(key);
  }

  return getOrLoadCachedValue<TOrder | null>({
    key,
    ttlMs: input.ttlMs || DRAFT_ORDER_CACHE_TTL_MS,
    tags: buildScopeTags({
      userId: input.userId,
      guildId: input.guildId,
    }),
    loader: async () => {
      const supabase = getSupabaseAdminClientOrThrow();
      const result = await supabase
        .from("payment_orders")
        .select(input.selectColumns)
        .eq("user_id", input.userId)
        .filter("guild_id", input.guildId === null ? "is" : "eq", input.guildId)
        .eq("status", "pending")
        .is("provider_payment_id", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<TOrder>();

      if (result.error) {
        throw new Error(
          `Erro ao carregar rascunho pendente: ${result.error.message}`,
        );
      }

      return result.data || null;
    },
  });
}

export async function getCachedPaymentOrderByCodeForGuild<
  TOrder extends PaymentOrderLike,
>(input: {
  guildId: string | null;
  orderNumber: number;
  selectColumns: string;
  cartId?: number | null;
  forceFresh?: boolean;
  ttlMs?: number;
}) {
  const guildKey = normalizeGuildKey(input.guildId);
  const key = `code:${hashSelectColumns(input.selectColumns)}:${guildKey}:${input.orderNumber}:${input.cartId || "*"}`;
  if (input.forceFresh) {
    removeCacheKey(key);
  }

  return getOrLoadCachedValue<TOrder | null>({
    key,
    ttlMs: input.ttlMs || ORDER_BY_CODE_CACHE_TTL_MS,
    tags: buildScopeTags({
      guildId: input.guildId,
      orderNumber: input.orderNumber,
    }),
    loader: async () => {
      const supabase = getSupabaseAdminClientOrThrow();
      let query = supabase
        .from("payment_orders")
        .select(input.selectColumns)
        .filter("guild_id", input.guildId === null ? "is" : "eq", input.guildId)
        .eq("order_number", input.orderNumber);

      if (typeof input.cartId === "number" && Number.isFinite(input.cartId)) {
        query = query.eq("id", input.cartId);
      }

      const result = await query.maybeSingle<TOrder | null>();

      if (result.error) {
        throw new Error(
          `Erro ao carregar pedido por codigo: ${result.error.message}`,
        );
      }

      return result.data || null;
    },
  });
}
