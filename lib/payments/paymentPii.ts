import crypto from "node:crypto";

const PAYMENT_PII_PREFIX = "fdpay_pii_v1";

function resolvePaymentPiiMasterSecret() {
  const candidates = [
    process.env.PAYMENT_PII_ENCRYPTION_KEY,
    process.env.PAYMENT_PII_SECRET,
    process.env.PAYMENT_LINK_SECRET,
    process.env.AUTH_SECRET,
    process.env.NEXTAUTH_SECRET,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function getPaymentPiiKeyOrThrow() {
  const masterSecret = resolvePaymentPiiMasterSecret();
  if (!masterSecret) {
    throw new Error(
      "PAYMENT_PII_ENCRYPTION_KEY/PAYMENT_PII_SECRET/AUTH_SECRET nao configurado no ambiente.",
    );
  }

  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      Buffer.from(masterSecret, "utf8"),
      Buffer.from("flowdesk-payment-pii", "utf8"),
      Buffer.from("aes-256-gcm:v1", "utf8"),
      32,
    ),
  );
}

export function resolvePaymentDocumentLast4(value: string | null | undefined) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  return digits.slice(-4) || null;
}

export function encryptPaymentSensitiveValue(
  value: string | null | undefined,
) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getPaymentPiiKeyOrThrow(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(normalized, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    PAYMENT_PII_PREFIX,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    authTag.toString("base64url"),
  ].join(".");
}
