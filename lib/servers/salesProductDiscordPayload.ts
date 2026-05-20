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
  SECONDARY: 2,
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
  stockQuantity?: number | null;
  mediaUrls?: string[];
  paymentReady?: boolean;
};

function trimDiscordText(value: string, maxLength = MAX_DISCORD_TEXT) {
  const normalized = value.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function markdownTableToCodeBlock(block: string) {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2 || !lines.every((line) => line.includes("|"))) return block;
  if (!/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(lines[1])) return block;

  const rows = lines
    .filter((_, index) => index !== 1)
    .map((line) =>
      line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim().replace(/\s+/g, " ")),
    );
  const columnCount = Math.max(...rows.map((row) => row.length));
  const widths = Array.from({ length: columnCount }, (_, columnIndex) =>
    Math.min(
      28,
      Math.max(...rows.map((row) => (row[columnIndex] || "").length), 3),
    ),
  );
  const renderRow = (row: string[]) =>
    widths
      .map((width, columnIndex) => (row[columnIndex] || "").slice(0, width).padEnd(width, " "))
      .join(" | ")
      .trimEnd();
  const separator = widths.map((width) => "-".repeat(width)).join("-+-");

  return ["```", renderRow(rows[0] || []), separator, ...rows.slice(1).map(renderRow), "```"].join("\n");
}

function normalizeDescriptionForDiscord(value: string) {
  return value
    .split(/\n{2,}/)
    .map(markdownTableToCodeBlock)
    .join("\n\n")
    .replace(/<u>([\s\S]*?)<\/u>/gi, "__$1__")
    .replace(/<mark(?:\s+data-color="#[0-9a-fA-F]{6}")?>([\s\S]*?)<\/mark>/gi, "**$1**")
    .replace(/<\/?(?:u|mark)[^>]*>/gi, "")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "[$1]($2)");
}

function buildTextDisplay(content: string): JsonRecord {
  return {
    type: COMPONENT_TYPE.TEXT_DISPLAY,
    content: trimDiscordText(content),
  };
}

function buildProductMarkdown(input: SalesProductDiscordPayloadInput) {
  const description = input.description.trim()
    ? normalizeDescriptionForDiscord(input.description.trim())
    : "Produto disponivel para compra neste servidor.";

  return [
    `## ${input.title.trim() || "Produto"}`,
    trimDiscordText(description, 1200),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildDisabledInfoButtons(input: SalesProductDiscordPayloadInput): JsonRecord {
  const stockLabel =
    typeof input.stockQuantity === "number"
      ? `Estoque: ${Math.max(0, input.stockQuantity)}`
      : "Estoque: consultar";

  return {
    type: COMPONENT_TYPE.ACTION_ROW,
    components: [
      {
        type: COMPONENT_TYPE.BUTTON,
        custom_id: `sales:product:price:${input.productCode}`,
        style: BUTTON_STYLE.SECONDARY,
        label: `Valor: ${input.priceLabel}`,
        disabled: true,
      },
      {
        type: COMPONENT_TYPE.BUTTON,
        custom_id: `sales:product:stock:${input.productCode}`,
        style: BUTTON_STYLE.SECONDARY,
        label: stockLabel,
        disabled: true,
      },
    ],
  };
}

export function buildSalesProductDiscordPayload(
  input: SalesProductDiscordPayloadInput,
) {
  const firstImage = input.mediaUrls?.find((url) => /^(https?:\/\/|attachment:\/\/)/i.test(url));
  const components: JsonRecord[] = [
    {
      type: COMPONENT_TYPE.CONTAINER,
      accent_color: 0xf1f1f1,
      components: [
        buildTextDisplay(buildProductMarkdown(input)),
        ...(firstImage
          ? [
              {
                type: COMPONENT_TYPE.MEDIA_GALLERY,
                items: [
                  {
                    media: {
                      url: firstImage,
                    },
                  },
                ],
              },
            ]
          : []),
        {
          type: COMPONENT_TYPE.SEPARATOR,
          divider: true,
          spacing: 1,
        },
        buildDisabledInfoButtons(input),
      ].filter(Boolean) as JsonRecord[],
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

  return {
    flags: MESSAGE_FLAG_IS_COMPONENTS_V2,
    allowed_mentions: { parse: [] as string[] },
    components,
  };
}

export function buildSalesProductUnavailableDiscordPayload(input: {
  productCode: string;
  title?: string | null;
}) {
  const title = input.title?.trim() || "Produto removido";

  return {
    flags: MESSAGE_FLAG_IS_COMPONENTS_V2,
    allowed_mentions: { parse: [] as string[] },
    components: [
      {
        type: COMPONENT_TYPE.CONTAINER,
        accent_color: 0xdb4646,
        components: [
          buildTextDisplay(
            [
              `## ${title}`,
              "Este produto esta indisponivel no momento ou foi removido do catalogo.",
              "Abra a loja novamente pelo painel do servidor para conferir os produtos ativos.",
            ].join("\n"),
          ),
          {
            type: COMPONENT_TYPE.SEPARATOR,
            divider: true,
            spacing: 1,
          },
          {
            type: COMPONENT_TYPE.ACTION_ROW,
            components: [
              {
                type: COMPONENT_TYPE.BUTTON,
                custom_id: `sales:cart:removed:${input.productCode}`,
                style: BUTTON_STYLE.SECONDARY,
                label: "Produto indisponivel",
                disabled: true,
              },
            ],
          },
        ],
      },
    ],
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

