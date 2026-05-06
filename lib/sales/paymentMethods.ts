import crypto from "node:crypto";

export type SalesPaymentMethodKey =
  | "mercado_pago"
  | "flowpay"
  | "card"
  | "boleto"
  | "paypal"
  | "nupay";

export type SalesPaymentMethodStatus = "active" | "disabled";
export type SalesPaymentEnvironment = "production" | "test";

export type SalesPaymentMethodPublic = {
  methodKey: SalesPaymentMethodKey;
  title: string;
  description: string;
  logoLabel: string;
  provider: string;
  paymentRail: "pix" | "card" | "boleto" | "wallet" | "";
  status: SalesPaymentMethodStatus;
  canActivate: boolean;
  credentialsConfigured: boolean;
  environment: SalesPaymentEnvironment;
  lastHealthStatus: "unchecked" | "ok" | "failed";
  lastHealthError: string;
  updatedAt: string | null;
};

export type SalesPaymentMethodRow = {
  method_key: SalesPaymentMethodKey;
  provider: string | null;
  payment_rail: SalesPaymentMethodPublic["paymentRail"] | null;
  display_name: string | null;
  status: SalesPaymentMethodStatus | null;
  credentials_configured: boolean | null;
  environment: SalesPaymentEnvironment | null;
  last_health_status: SalesPaymentMethodPublic["lastHealthStatus"] | null;
  last_health_error: string | null;
  updated_at: string | null;
};

export type SalesPaymentMethodsSecureSnapshot = {
  mercadoPago?: {
    accessToken?: string | null;
    publicKey?: string | null;
    webhookSecret?: string | null;
    environment?: SalesPaymentEnvironment | null;
    statementDescriptor?: string | null;
  };
};

const METHOD_DEFINITIONS: Array<
  Omit<
    SalesPaymentMethodPublic,
    "status" | "credentialsConfigured" | "environment" | "lastHealthStatus" | "lastHealthError" | "updatedAt"
  >
> = [
  {
    methodKey: "mercado_pago",
    title: "Mercado Pago",
    description: "PIX via Mercado Pago para carrinhos do Discord e loja web.",
    logoLabel: "MP",
    provider: "mercado_pago",
    paymentRail: "pix",
    canActivate: true,
  },
  {
    methodKey: "flowpay",
    title: "FlowPay",
    description: "Reservado para a esteira proprietaria de pagamentos.",
    logoLabel: "FP",
    provider: "flowpay",
    paymentRail: "wallet",
    canActivate: false,
  },
  {
    methodKey: "card",
    title: "Cartao",
    description: "Cartao fica desativado ate a liberacao operacional.",
    logoLabel: "CC",
    provider: "stripe",
    paymentRail: "card",
    canActivate: false,
  },
  {
    methodKey: "boleto",
    title: "Boleto",
    description: "Boleto fica desativado nesta fase.",
    logoLabel: "BL",
    provider: "",
    paymentRail: "boleto",
    canActivate: false,
  },
  {
    methodKey: "paypal",
    title: "PayPal",
    description: "PayPal fica desativado nesta fase.",
    logoLabel: "PP",
    provider: "paypal",
    paymentRail: "wallet",
    canActivate: false,
  },
  {
    methodKey: "nupay",
    title: "Nupay",
    description: "Nupay fica desativado nesta fase.",
    logoLabel: "NU",
    provider: "nupay",
    paymentRail: "wallet",
    canActivate: false,
  },
];

export function getSalesPaymentMethodDefinitions() {
  return METHOD_DEFINITIONS;
}

export function normalizeSalesPaymentEnvironment(
  value: unknown,
): SalesPaymentEnvironment {
  return value === "test" ? "test" : "production";
}

export function normalizeSalesPaymentMethodKey(
  value: unknown,
): SalesPaymentMethodKey | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return METHOD_DEFINITIONS.some((definition) => definition.methodKey === normalized)
    ? (normalized as SalesPaymentMethodKey)
    : null;
}

export function createSecretFingerprint(value: string | null | undefined) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return "";
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export function maskCredential(value: string | null | undefined) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return "";
  if (normalized.length <= 8) return "configurada";
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

export function buildSalesPaymentMethodsResponse(rows: SalesPaymentMethodRow[]) {
  const rowsByKey = new Map(rows.map((row) => [row.method_key, row]));
  return METHOD_DEFINITIONS.map((definition) => {
    const row = rowsByKey.get(definition.methodKey);
    return {
      ...definition,
      status: row?.status === "active" ? "active" : "disabled",
      credentialsConfigured: row?.credentials_configured === true,
      environment: normalizeSalesPaymentEnvironment(row?.environment),
      lastHealthStatus:
        row?.last_health_status === "ok" || row?.last_health_status === "failed"
          ? row.last_health_status
          : "unchecked",
      lastHealthError: row?.last_health_error || "",
      updatedAt: row?.updated_at || null,
    } satisfies SalesPaymentMethodPublic;
  });
}
