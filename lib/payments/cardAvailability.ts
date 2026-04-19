export const CARD_PAYMENTS_COMING_SOON_BADGE = "DESATIVADO";
export const CARD_PAYMENTS_DISABLED_MESSAGE =
  "Pagamento com cartao esta desativado. No momento, a Flowdesk aceita somente PIX.";
export const CARD_RECURRING_DISABLED_MESSAGE =
  "Cobranca recorrente com cartao esta desativada no momento.";

function normalizeConfiguredValue(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function isExplicitlyEnabled(value: string | undefined) {
  const normalized = normalizeConfiguredValue(value)?.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function areHostedCardCheckoutsEnabled() {
  const cardCheckoutEnabled =
    isExplicitlyEnabled(process.env.FLOWDESK_ENABLE_CARD_CHECKOUTS) ||
    isExplicitlyEnabled(process.env.NEXT_PUBLIC_FLOWDESK_ENABLE_CARD_CHECKOUTS);

  if (!cardCheckoutEnabled) {
    return false;
  }

  return Boolean(
    normalizeConfiguredValue(process.env.NEXT_PUBLIC_MERCADO_PAGO_CARD_TEST_PUBLIC_KEY) ||
      normalizeConfiguredValue(process.env.NEXT_PUBLIC_MERCADO_PAGO_CARD_PUBLIC_KEY) ||
      normalizeConfiguredValue(
        process.env.NEXT_PUBLIC_MERCADO_PAGO_CARD_PRODUCTION_PUBLIC_KEY,
      ) ||
      normalizeConfiguredValue(process.env.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY),
  );
}

export function areCardPaymentsEnabled() {
  return false;
}
