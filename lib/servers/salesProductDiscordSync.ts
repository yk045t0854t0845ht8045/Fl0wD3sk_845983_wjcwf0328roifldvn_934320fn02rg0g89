import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import {
  buildSalesProductDiscordPayload,
  salesProductMessageLooksManaged,
} from "@/lib/servers/salesProductDiscordPayload";

const PRODUCT_DISCORD_SELECT =
  "id, guild_id, title, description, media_urls, price_amount, stock_quantity, discord_publication_mode, discord_channel_id, discord_message_id";
const DISCORD_RETRY_DELAYS_MS = [180, 420];
const PRODUCT_MEDIA_MAX_LENGTH = 1_500_000;

export type SalesProductDiscordSyncStatus = "idle" | "synced" | "failed";

export type SalesProductDiscordSyncRecord = {
  id: string;
  guild_id: string;
  title: string;
  description: string | null;
  media_urls: unknown;
  price_amount: number | string | null;
  stock_quantity: number | null;
  discord_publication_mode: string | null;
  discord_channel_id: string | null;
  discord_message_id: string | null;
};

type DiscordChannelMessage = {
  id?: unknown;
  author?: { bot?: unknown } | null;
  components?: unknown;
};

export type SalesProductDiscordSyncResult = {
  messageId: string | null;
  status: SalesProductDiscordSyncStatus;
  error: string | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveBotToken() {
  return process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || null;
}

function formatProductPrice(value: number | string | null) {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

export function buildSalesProductCode(id: string) {
  const digits = id.replace(/\D/g, "");
  const seed =
    digits ||
    Array.from(id).reduce((acc, char) => `${acc}${char.charCodeAt(0)}`, "");
  return `prd-${seed.padEnd(8, "0").slice(0, 8)}`;
}

async function requestDiscordWithBot<T>({
  url,
  botToken,
  method = "GET",
  body,
  resourceLabel,
}: {
  url: string;
  botToken: string;
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  resourceLabel: string;
}) {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= DISCORD_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bot ${botToken}`,
          ...(body && !(body instanceof FormData)
            ? { "Content-Type": "application/json" }
            : {}),
        },
        body: body
          ? body instanceof FormData
            ? body
            : JSON.stringify(body)
          : undefined,
        cache: "no-store",
      });

      if (response.status === 404 && method === "GET") {
        return null as T;
      }

      if (!response.ok) {
        const text = await response.text();
        const isRetryable = response.status === 429 || response.status >= 500;

        if (isRetryable && attempt < DISCORD_RETRY_DELAYS_MS.length) {
          await sleep(DISCORD_RETRY_DELAYS_MS[attempt]);
          continue;
        }

        throw new Error(
          `Discord respondeu com erro ao ${resourceLabel}: ${text || response.statusText}`,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error(`Falha ao ${resourceLabel}.`);

      if (attempt < DISCORD_RETRY_DELAYS_MS.length) {
        await sleep(DISCORD_RETRY_DELAYS_MS[attempt]);
        continue;
      }
    }
  }

  throw lastError || new Error(`Falha ao ${resourceLabel}.`);
}

function dataUrlToDiscordFile(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i);
  if (!match) return null;

  const mimeType = match[1].toLowerCase();
  const extension =
    mimeType.includes("png")
      ? "png"
      : mimeType.includes("webp")
        ? "webp"
        : mimeType.includes("gif")
          ? "gif"
          : "jpg";
  const binary = Buffer.from(match[2], "base64");
  if (!binary.length || binary.length > PRODUCT_MEDIA_MAX_LENGTH) return null;

  return {
    filename: `product-image.${extension}`,
    blob: new Blob([binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength)], {
      type: mimeType,
    }),
  };
}

function dataUrlToAttachmentUrl(dataUrl: string) {
  const file = dataUrlToDiscordFile(dataUrl);
  return file ? `attachment://${file.filename}` : null;
}

function buildDiscordRequestBody(payload: unknown, mediaUrls: unknown) {
  const firstMediaUrl = Array.isArray(mediaUrls)
    ? mediaUrls.find(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      )
    : "";
  const file = firstMediaUrl ? dataUrlToDiscordFile(firstMediaUrl) : null;

  if (!file) return payload;

  const formData = new FormData();
  formData.append("payload_json", JSON.stringify(payload));
  formData.append("files[0]", file.blob, file.filename);
  return formData;
}

async function hasActiveSalesPaymentMethod(guildId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("guild_sales_payment_methods")
    .select("id")
    .eq("guild_id", guildId)
    .eq("method_key", "mercado_pago")
    .eq("status", "active")
    .limit(1);

  if (result.error) {
    const message = result.error.message.toLowerCase();
    if (result.error.code === "42P01" || message.includes("guild_sales_payment_methods")) {
      return false;
    }
    throw new Error(result.error.message);
  }

  return Boolean(result.data?.length);
}

async function loadProductForDiscordSync(guildId: string, productId: string) {
  const result = await getSupabaseAdminClientOrThrow()
    .from("guild_sales_products")
    .select(PRODUCT_DISCORD_SELECT)
    .eq("guild_id", guildId)
    .eq("id", productId)
    .maybeSingle<SalesProductDiscordSyncRecord>();

  if (result.error) throw new Error(result.error.message);
  return result.data || null;
}

export async function persistSalesProductDiscordSyncState(input: {
  productId: string;
  guildId: string;
  mode: "online_only" | "channel" | string | null;
  messageId: string | null;
  status: SalesProductDiscordSyncStatus;
  error: string | null;
}) {
  const result = await getSupabaseAdminClientOrThrow()
    .from("guild_sales_products")
    .update({
      discord_message_id: input.mode === "channel" ? input.messageId : null,
      discord_last_synced_at:
        input.status === "synced" ? new Date().toISOString() : null,
      discord_sync_status: input.status,
      discord_sync_error: input.error,
    })
    .eq("id", input.productId)
    .eq("guild_id", input.guildId);

  if (result.error) throw new Error(result.error.message);
}

export async function syncSalesProductDiscordMessage(input: {
  product: SalesProductDiscordSyncRecord;
}): Promise<SalesProductDiscordSyncResult> {
  if (input.product.discord_publication_mode !== "channel") {
    return {
      messageId: null,
      status: "idle",
      error: null,
    };
  }

  const channelId = input.product.discord_channel_id;
  if (!channelId) {
    throw new Error("Canal Discord ausente para publicar o produto.");
  }

  const botToken = resolveBotToken();
  if (!botToken) {
    throw new Error("DISCORD_BOT_TOKEN nao configurado no ambiente do site.");
  }

  const productCode = buildSalesProductCode(input.product.id);
  const mediaUrls = Array.isArray(input.product.media_urls)
    ? input.product.media_urls.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const firstDataImageIndex = mediaUrls.findIndex((url) =>
    /^data:image\/[a-z0-9.+-]+;base64,/i.test(url),
  );
  const attachmentUrl =
    firstDataImageIndex >= 0 ? dataUrlToAttachmentUrl(mediaUrls[firstDataImageIndex]) : null;
  const payloadMediaUrls =
    firstDataImageIndex >= 0
      ? [
          ...mediaUrls.slice(0, firstDataImageIndex),
          attachmentUrl || "",
          ...mediaUrls.slice(firstDataImageIndex + 1),
        ].filter(Boolean)
      : mediaUrls;
  const payload = buildSalesProductDiscordPayload({
    productCode,
    title: input.product.title,
    description: input.product.description || "",
    priceLabel: formatProductPrice(input.product.price_amount),
    stockQuantity: input.product.stock_quantity,
    mediaUrls: payloadMediaUrls,
    paymentReady: await hasActiveSalesPaymentMethod(input.product.guild_id),
  });
  const discordBody = buildDiscordRequestBody(payload, input.product.media_urls);

  const storedMessageId = input.product.discord_message_id || "";
  const storedMessage = storedMessageId
    ? await requestDiscordWithBot<DiscordChannelMessage | null>({
        url: `https://discord.com/api/v10/channels/${channelId}/messages/${storedMessageId}`,
        botToken,
        resourceLabel: "buscar o embed do produto",
      })
    : null;

  const managedMessage =
    storedMessage && salesProductMessageLooksManaged(storedMessage, productCode)
      ? storedMessage
      : null;

  const dispatchedMessage =
    managedMessage && typeof managedMessage.id === "string"
      ? await requestDiscordWithBot<{ id: string }>({
          url: `https://discord.com/api/v10/channels/${channelId}/messages/${managedMessage.id}`,
          method: "PATCH",
          body: discordBody,
          botToken,
          resourceLabel: "atualizar o embed do produto",
        })
      : await requestDiscordWithBot<{ id: string }>({
          url: `https://discord.com/api/v10/channels/${channelId}/messages`,
          method: "POST",
          body: discordBody,
          botToken,
          resourceLabel: "enviar o embed do produto",
        });

  return {
    messageId: dispatchedMessage.id,
    status: "synced",
    error: null,
  };
}

export async function syncSalesProductDiscordMessageById(input: {
  guildId: string;
  productId: string;
}) {
  const product = await loadProductForDiscordSync(input.guildId, input.productId);
  if (!product) return null;

  const sync = await syncSalesProductDiscordMessage({ product });
  await persistSalesProductDiscordSyncState({
    productId: product.id,
    guildId: product.guild_id,
    mode: product.discord_publication_mode,
    messageId: sync.messageId,
    status: sync.status,
    error: sync.error,
  });
  return sync;
}

export async function markSalesProductDiscordSyncFailedById(input: {
  guildId: string;
  productId: string;
  error: string;
}) {
  const result = await getSupabaseAdminClientOrThrow()
    .from("guild_sales_products")
    .update({
      discord_last_synced_at: null,
      discord_sync_status: "failed",
      discord_sync_error: input.error,
    })
    .eq("guild_id", input.guildId)
    .eq("id", input.productId)
    .eq("discord_publication_mode", "channel");

  if (result.error) throw new Error(result.error.message);
}
