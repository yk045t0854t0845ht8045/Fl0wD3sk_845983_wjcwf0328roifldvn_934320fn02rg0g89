import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type DeliveryMethod = "email" | "discord_dm" | "flowdesk_link";

type StockDeliveryRecord = {
  id: string;
  guild_id: string;
  product_id: string;
  product_name: string;
  item_type: string;
  delivery_method: DeliveryMethod;
  category: string;
  platform: string;
  provider: string;
  email: string;
  login: string;
  password: string;
  access_type: string;
  recovery: string;
  gift_card_name: string;
  redemption_value: string;
  redemption_code: string;
  access_link: string;
  link_password: string;
  region: string;
  validity: string;
  quantity: number;
  server: string;
  buyer_required_id: string;
  delivery_deadline: string;
  service_type: string;
  required_buyer_info: string;
  discord_product_type: string;
  server_or_bot_link: string;
  token_or_key: string;
  required_permissions: string;
  tool_name: string;
  automation_type: string;
  software_name: string;
  software_version: string;
  operating_system: string;
  license_key: string;
  download_link: string;
  subscription_duration: string;
  account_type: string;
  course_name: string;
  item_name: string;
  instructions: string;
  observations: string;
};

const DELIVERY_SELECT = [
  "id",
  "guild_id",
  "product_id",
  "product_name",
  "item_type",
  "delivery_method",
  "category",
  "platform",
  "provider",
  "email",
  "login",
  "password",
  "access_type",
  "recovery",
  "gift_card_name",
  "redemption_value",
  "redemption_code",
  "access_link",
  "link_password",
  "region",
  "validity",
  "quantity",
  "server",
  "buyer_required_id",
  "delivery_deadline",
  "service_type",
  "required_buyer_info",
  "discord_product_type",
  "server_or_bot_link",
  "token_or_key",
  "required_permissions",
  "tool_name",
  "automation_type",
  "software_name",
  "software_version",
  "operating_system",
  "license_key",
  "download_link",
  "subscription_duration",
  "account_type",
  "course_name",
  "item_name",
  "instructions",
  "observations",
].join(", ");

const labelByKey: Array<[keyof StockDeliveryRecord, string]> = [
  ["product_name", "Produto"],
  ["category", "Categoria"],
  ["platform", "Plataforma"],
  ["provider", "Provedor"],
  ["email", "Email"],
  ["login", "Login"],
  ["password", "Senha"],
  ["access_type", "Tipo de acesso"],
  ["recovery", "Recuperacao"],
  ["gift_card_name", "Gift card"],
  ["redemption_value", "Valor"],
  ["redemption_code", "Codigo de resgate"],
  ["access_link", "Link de acesso"],
  ["link_password", "Senha do link"],
  ["region", "Regiao"],
  ["validity", "Validade"],
  ["quantity", "Quantidade"],
  ["server", "Servidor"],
  ["buyer_required_id", "ID/Nickname necessario"],
  ["delivery_deadline", "Prazo de entrega"],
  ["service_type", "Tipo de servico"],
  ["required_buyer_info", "Informacoes necessarias"],
  ["discord_product_type", "Tipo Discord/Bot"],
  ["server_or_bot_link", "Link servidor/bot"],
  ["token_or_key", "Token/chave"],
  ["required_permissions", "Permissoes"],
  ["tool_name", "Ferramenta"],
  ["automation_type", "Automacao"],
  ["software_name", "Software"],
  ["software_version", "Versao"],
  ["operating_system", "Sistema operacional"],
  ["license_key", "Licenca"],
  ["download_link", "Download"],
  ["subscription_duration", "Duracao"],
  ["account_type", "Tipo de conta"],
  ["course_name", "Curso"],
  ["item_name", "Item"],
  ["instructions", "Instrucoes"],
  ["observations", "Observacoes"],
];

function formatDeliveryMessage(record: StockDeliveryRecord) {
  const lines = labelByKey
    .map(([key, label]) => {
      const rawValue = record[key];
      const value =
        typeof rawValue === "number" ? String(rawValue) : String(rawValue || "").trim();
      return value ? `**${label}:** ${value}` : "";
    })
    .filter(Boolean);

  return [
    `## Entrega digital - ${record.product_name || "Produto"}`,
    ...lines,
  ].join("\n");
}

async function refreshProductStockQuantity(guildId: string, productId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const { data, error } = await supabase
    .from("guild_sales_stock_items")
    .select("quantity")
    .eq("guild_id", guildId)
    .eq("product_id", productId)
    .eq("status", "available");

  if (error) throw new Error(error.message);
  const quantity = (data || []).reduce(
    (total, item) => total + Math.max(0, Number(item.quantity || 0)),
    0,
  );

  const update = await supabase
    .from("guild_sales_products")
    .update({ stock_quantity: quantity })
    .eq("guild_id", guildId)
    .eq("id", productId);

  if (update.error) throw new Error(update.error.message);
  return quantity;
}

export async function claimSalesStockDelivery(input: {
  guildId: string;
  productId: string;
  preferredDeliveryMethod?: DeliveryMethod;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  let query = supabase
    .from("guild_sales_stock_items")
    .select(DELIVERY_SELECT)
    .eq("guild_id", input.guildId)
    .eq("product_id", input.productId)
    .eq("status", "available")
    .gt("quantity", 0)
    .order("created_at", { ascending: true })
    .limit(1);

  if (input.preferredDeliveryMethod) {
    query = query.eq("delivery_method", input.preferredDeliveryMethod);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const record = data as unknown as StockDeliveryRecord;
  const nextQuantity = Math.max(0, Number(record.quantity || 0) - 1);
  const nextStatus = nextQuantity > 0 ? "available" : "delivered";
  const update = await supabase
    .from("guild_sales_stock_items")
    .update({ quantity: nextQuantity, status: nextStatus })
    .eq("id", record.id)
    .eq("guild_id", input.guildId)
    .eq("status", "available")
    .gt("quantity", 0)
    .select("id")
    .maybeSingle();

  if (update.error) throw new Error(update.error.message);
  if (!update.data) return null;
  const stockQuantity = await refreshProductStockQuantity(input.guildId, input.productId);

  return {
    stockItemId: record.id,
    deliveryMethod: record.delivery_method,
    message: formatDeliveryMessage(record),
    stockQuantity,
  };
}
