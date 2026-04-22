import crypto from "node:crypto";
import type { MercadoPagoPaymentResponse } from "@/lib/payments/mercadoPago";
import { normalizeUtcTimestampIso } from "@/lib/time/utcTimestamp";

export type PaymentOrderStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired"
  | "failed";

type IdempotencyKeyPart = string | number | boolean | null | undefined;

type VerifyMercadoPagoWebhookSignatureInput = {
  secret?: string | null;
  signatureHeader?: string | null;
  requestId?: string | null;
  dataId?: string | null;
  maxAgeSeconds?: number | null;
  nowMs?: number;
};

function normalizeStringValue(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeIsoTimestamp(value: string | null | undefined) {
  return normalizeUtcTimestampIso(value);
}

function secureStringEquals(expected: string, received: string) {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function normalizeWebhookDataId(value: string | null | undefined) {
  const normalized = normalizeStringValue(value);
  if (!normalized) return null;

  return /^[a-z0-9]+$/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

function collectCandidateValues(
  input: unknown,
  keyMatcher: (normalizedKey: string) => boolean,
) {
  const foundValues: string[] = [];
  const visited = new Set<unknown>();
  const pushScalarValue = (value: unknown) => {
    if (typeof value === "string") {
      const normalized = normalizeStringValue(value);
      if (normalized) {
        foundValues.push(normalized);
      }
      return true;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      foundValues.push(String(value));
      return true;
    }

    return false;
  };

  const visit = (value: unknown, depth: number) => {
    if (depth > 8 || value === null || typeof value === "undefined") {
      return;
    }

    if (pushScalarValue(value)) {
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    if (visited.has(value)) {
      return;
    }
    visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, depth + 1);
      }
      return;
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      const normalizedKey = key.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
      if (keyMatcher(normalizedKey)) {
        if (!pushScalarValue(nestedValue)) {
          visit(nestedValue, depth + 1);
        }
        continue;
      }

      visit(nestedValue, depth + 1);
    }
  };

  visit(input, 0);

  return Array.from(new Set(foundValues));
}

export function createStablePaymentIdempotencyKey(input: {
  namespace: string;
  parts: IdempotencyKeyPart[];
}) {
  const namespace = normalizeStringValue(input.namespace) || "flowdesk-payment";
  const normalizedParts = input.parts.map((part) => {
    if (part === null || typeof part === "undefined") return "";
    if (typeof part === "boolean") return part ? "1" : "0";
    return String(part).trim();
  });

  return crypto
    .createHash("sha256")
    .update([namespace, ...normalizedParts].join("\n"))
    .digest("hex");
}

export function parseMercadoPagoWebhookSignature(header: string | null | undefined) {
  const normalizedHeader = normalizeStringValue(header);
  if (!normalizedHeader) return null;

  const parts = normalizedHeader
    .split(",")
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  let timestamp: string | null = null;
  let signatureV1: string | null = null;

  for (const part of parts) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = part.slice(0, separatorIndex).trim().toLowerCase();
    const value = part.slice(separatorIndex + 1).trim();

    if (!value) continue;
    if (key === "ts") timestamp = value;
    if (key === "v1") signatureV1 = value.toLowerCase();
  }

  if (!timestamp || !signatureV1) {
    return null;
  }

  return {
    ts: timestamp,
    v1: signatureV1,
  };
}

export function verifyMercadoPagoWebhookSignature(
  input: VerifyMercadoPagoWebhookSignatureInput,
) {
  const secret = normalizeStringValue(input.secret);
  if (!secret) {
    return {
      ok: false as const,
      reason: "missing_secret" as const,
      ageSeconds: null,
      manifest: null,
    };
  }

  const parsedSignature = parseMercadoPagoWebhookSignature(input.signatureHeader);
  if (!parsedSignature) {
    return {
      ok: false as const,
      reason: "missing_signature" as const,
      ageSeconds: null,
      manifest: null,
    };
  }

  const requestId = normalizeStringValue(input.requestId);
  if (!requestId) {
    return {
      ok: false as const,
      reason: "missing_request_id" as const,
      ageSeconds: null,
      manifest: null,
    };
  }

  const dataId = normalizeWebhookDataId(input.dataId);
  if (!dataId) {
    return {
      ok: false as const,
      reason: "missing_data_id" as const,
      ageSeconds: null,
      manifest: null,
    };
  }

  const manifest = `id:${dataId};request-id:${requestId};ts:${parsedSignature.ts};`;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(manifest)
    .digest("hex")
    .toLowerCase();

  if (!secureStringEquals(expectedSignature, parsedSignature.v1)) {
    return {
      ok: false as const,
      reason: "invalid_signature" as const,
      ageSeconds: null,
      manifest,
    };
  }

  const signatureTimestamp = Number(parsedSignature.ts);
  const hasValidTimestamp = Number.isFinite(signatureTimestamp);
  const ageSeconds = hasValidTimestamp
    ? Math.max(0, Math.floor(((input.nowMs || Date.now()) - signatureTimestamp * 1000) / 1000))
    : null;
  const maxAgeSeconds =
    typeof input.maxAgeSeconds === "number" && input.maxAgeSeconds > 0
      ? Math.floor(input.maxAgeSeconds)
      : null;

  if (
    maxAgeSeconds !== null &&
    ageSeconds !== null &&
    ageSeconds > maxAgeSeconds
  ) {
    return {
      ok: false as const,
      reason: "expired" as const,
      ageSeconds,
      manifest,
    };
  }

  return {
    ok: true as const,
    reason: "verified" as const,
    ageSeconds,
    manifest,
  };
}

export function extractMercadoPagoPaymentIdentifiers(
  providerPayment: MercadoPagoPaymentResponse | null | undefined,
) {
  const allTxIds = collectCandidateValues(providerPayment, (normalizedKey) =>
    normalizedKey === "txid" || normalizedKey === "txidentifier",
  );
  const allEndToEndIds = collectCandidateValues(providerPayment, (normalizedKey) =>
    ["endtoendid", "endtoend", "e2eid", "e2eidpix"].includes(normalizedKey),
  );

  return {
    txId: allTxIds[0] || null,
    endToEndId: allEndToEndIds[0] || null,
    allTxIds,
    allEndToEndIds,
  };
}

export function resolveTrustedMercadoPagoPaymentTimestamps(input: {
  providerPayment: MercadoPagoPaymentResponse | null | undefined;
  currentPaidAt?: string | null;
  currentExpiresAt?: string | null;
  receivedAt?: string | null;
  resolvedStatus: PaymentOrderStatus;
}) {
  const createdAt = normalizeIsoTimestamp(input.providerPayment?.date_created || null);
  const approvedAt = normalizeIsoTimestamp(input.providerPayment?.date_approved || null);
  const lastUpdatedAt = normalizeIsoTimestamp(
    input.providerPayment?.date_last_updated || null,
  );
  const receivedAt = normalizeIsoTimestamp(input.receivedAt || null);
  const currentPaidAt = normalizeIsoTimestamp(input.currentPaidAt || null);
  const currentExpiresAt = normalizeIsoTimestamp(input.currentExpiresAt || null);
  const providerExpiresAt = normalizeIsoTimestamp(
    input.providerPayment?.date_of_expiration || null,
  );

  return {
    createdAt,
    lastUpdatedAt: lastUpdatedAt || approvedAt || createdAt || receivedAt,
    paidAt:
      input.resolvedStatus === "approved"
        ? approvedAt || currentPaidAt || lastUpdatedAt || receivedAt || new Date().toISOString()
        : null,
    expiresAt: providerExpiresAt || currentExpiresAt,
  };
}

export function resolveNextPaymentOrderStatus(
  currentStatus: PaymentOrderStatus | string | null | undefined,
  providerResolvedStatus: PaymentOrderStatus,
) {
  const current =
    typeof currentStatus === "string" ? currentStatus.trim().toLowerCase() : "";

  if (providerResolvedStatus === "approved") {
    return "approved";
  }

  if (current === "approved") {
    return "approved";
  }

  if (current === "cancelled" && providerResolvedStatus === "pending") {
    return "cancelled";
  }

  if (current === "expired" && providerResolvedStatus === "pending") {
    return "expired";
  }

  if (current === "rejected" && providerResolvedStatus === "pending") {
    return "rejected";
  }

  if (current === "failed" && providerResolvedStatus === "pending") {
    return "failed";
  }

  return providerResolvedStatus;
}
