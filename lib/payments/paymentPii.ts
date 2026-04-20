import { encryptFlowSecureValue } from "@/lib/security/flowSecure";

export function resolvePaymentDocumentLast4(value: string | null | undefined) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  return digits.slice(-4) || null;
}

export function encryptPaymentSensitiveValue(
  value: string | null | undefined,
) {
  return encryptFlowSecureValue(value, {
    purpose: "payment_pii",
    subcontext: "payer_document",
  });
}
