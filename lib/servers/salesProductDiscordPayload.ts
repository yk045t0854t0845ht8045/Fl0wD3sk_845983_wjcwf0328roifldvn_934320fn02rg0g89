const COMPONENT_TYPE = {
  ACTION_ROW: 1,
  BUTTON: 2,
  SECTION: 9,
  TEXT_DISPLAY: 10,
  THUMBNAIL: 11,
  MEDIA_GALLERY: 12,
  SEPARATOR: 14,
  CONTAINER: 17,
} as const;

const BUTTON_STYLE = {
  PRIMARY: 1,
  SUCCESS: 3,
} as const;

const MESSAGE_FLAG_IS_COMPONENTS_V2 = 32768;
const MAX_DISCORD_TEXT = 3900;

type JsonRecord = Record<string, unknown>;

type SalesProductDiscordPayloadInput = {
  productCode: string;
  title: string;
  description: string;
  priceLabel: string;
  categoryTitle?: string | null;
  sku?: string | null;
  stockQuantity?: number | null;
  mediaUrls?: string[];
  paymentReady?: boolean;
};

function trimDiscordText(value: string, maxLength = MAX_DISCORD_TEXT) {
  const normalized = value.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function buildTextDisplay(content: string): JsonRecord {
  return {
    type: COMPONENT_TYPE.TEXT_DISPLAY,
    content: trimDiscordText(content),
  };
}

function buildProductMarkdown(input: SalesProductDiscordPayloadInput) {
  const description = input.description.trim()
    ? input.description.trim()
    : "Produto disponivel para compra neste servidor.";

  return [
    `## ${input.title.trim() || "Produto"}`,
    trimDiscordText(description, 1200),
    "",
    `**Valor:** ${input.priceLabel}`,
    input.categoryTitle ? `**Categoria:** ${input.categoryTitle}` : "",
    input.sku ? `**SKU:** ${input.sku}` : "",
    typeof input.stockQuantity === "number"
      ? `**Estoque:** ${Math.max(0, input.stockQuantity)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildSalesProductDiscordPayload(
  input: SalesProductDiscordPayloadInput,
) {
  const firstImage = input.mediaUrls?.find((url) => /^https?:\/\//i.test(url));
  const components: JsonRecord[] = [
    {
      type: COMPONENT_TYPE.CONTAINER,
      accent_color: 0xf1f1f1,
      components: [
        firstImage
          ? {
              type: COMPONENT_TYPE.SECTION,
              components: [buildTextDisplay(buildProductMarkdown(input))],
              accessory: {
                type: COMPONENT_TYPE.THUMBNAIL,
                media: { url: firstImage },
              },
            }
          : buildTextDisplay(buildProductMarkdown(input)),
        {
          type: COMPONENT_TYPE.SEPARATOR,
          divider: true,
          spacing: 1,
        },
        buildTextDisplay(
          input.paymentReady
            ? "-# Ao adicionar ao carrinho, o bot valida estoque e pagamento antes de criar o checkout."
            : "-# Carrinho ainda indisponivel: configure um metodo de pagamento para ativar compras.",
        ),
      ],
    },
    {
      type: COMPONENT_TYPE.ACTION_ROW,
      components: [
        {
          type: COMPONENT_TYPE.BUTTON,
          custom_id: input.paymentReady
            ? `sales:cart:add:${input.productCode}`
            : `sales:cart:missing_payment:${input.productCode}`,
          style: input.paymentReady ? BUTTON_STYLE.SUCCESS : BUTTON_STYLE.PRIMARY,
          label: "Adicionar ao carrinho",
        },
      ],
    },
  ];

  const galleryItems = (input.mediaUrls || [])
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(1, 5)
    .map((url) => ({ media: { url } }));

  if (galleryItems.length) {
    components.splice(1, 0, {
      type: COMPONENT_TYPE.MEDIA_GALLERY,
      items: galleryItems,
    });
  }

  return {
    flags: MESSAGE_FLAG_IS_COMPONENTS_V2,
    allowed_mentions: { parse: [] as string[] },
    components,
  };
}

export function salesProductMessageLooksManaged(
  message: unknown,
  productCode: string,
) {
  if (!message || typeof message !== "object") return false;
  const record = message as Record<string, unknown>;
  const author = record.author as Record<string, unknown> | undefined;
  if (!author || author.bot !== true) return false;

  const expectedSuffix = `:${productCode}`;
  const walk = (components: unknown): boolean => {
    if (!Array.isArray(components)) return false;
    for (const component of components) {
      if (!component || typeof component !== "object") continue;
      const recordComponent = component as Record<string, unknown>;
      const customId = recordComponent.custom_id;
      if (
        typeof customId === "string" &&
        customId.startsWith("sales:cart:") &&
        customId.endsWith(expectedSuffix)
      ) {
        return true;
      }
      if (walk(recordComponent.components)) return true;
      if (recordComponent.accessory && walk([recordComponent.accessory])) {
        return true;
      }
    }
    return false;
  };

  return walk(record.components);
}

