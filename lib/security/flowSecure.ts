import crypto from "node:crypto";
import { getServerEnv } from "@/lib/serverEnv";

const FLOWSECURE_PREFIX = "flws";
const FLOWSECURE_VERSION = "v1";
const FLOWSECURE_DEV_FALLBACK_SECRET = "flowsecure-dev-only-secret";
const REDACTED_VALUE = "[REDACTED]";
const SENSITIVE_KEY_PATTERN =
  /(pass(word)?|secret|token|authorization|cookie|session|refresh|access|document|cpf|cnpj|card|payer|email|phone|pix|api[-_]?key|key|credential|provider_payload)/i;

export type FlowSecurePurpose =
  | "auth_password_pepper"
  | "auth_email_otp_code"
  | "auth_email_otp_session"
  | "auth_session_oauth"
  | "diagnostic_fingerprint"
  | "payment_pii"
  | "rate_limit_ip"
  | "sensitive_lookup"
  | "sensitive_fingerprint";

type FlowSecureReader<T> = (value: unknown, key: string) => T;

type FlowSecureStringOptions = {
  trim?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  allowEmpty?: boolean;
  rejectThreatPatterns?: boolean;
  disallowAngleBrackets?: boolean;
  normalizeWhitespace?: boolean;
};

type FlowSecureBooleanOptions = {
  defaultValue?: boolean;
};

type FlowSecureNumberOptions = {
  integer?: boolean;
  min?: number;
  max?: number;
};

export class FlowSecureDtoError extends Error {
  issues: string[];
  statusCode: number;

  constructor(message: string, issues: string[], statusCode = 400) {
    super(message);
    this.name = "FlowSecureDtoError";
    this.issues = issues;
    this.statusCode = statusCode;
  }
}

const FLOWSECURE_THREAT_PATTERNS = [
  /<\s*script\b/i,
  /<\s*iframe\b/i,
  /javascript\s*:/i,
  /data\s*:\s*text\/html/i,
  /\bon\w+\s*=/i,
  /\bunion\b[\s\S]{0,24}\bselect\b/i,
  /\bselect\b[\s\S]{0,24}\bfrom\b/i,
  /\bdrop\b[\s\S]{0,24}\btable\b/i,
  /\binsert\b[\s\S]{0,24}\binto\b/i,
  /\bdelete\b[\s\S]{0,24}\bfrom\b/i,
  /\bupdate\b[\s\S]{0,24}\bset\b/i,
  /--/,
  /\/\*/,
  /\*\//,
  /\bor\b\s+1\s*=\s*1\b/i,
  /\band\b\s+1\s*=\s*1\b/i,
  /\bxp_cmdshell\b/i,
] as const;

class FlowSecureFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowSecureFieldError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveFlowSecureMasterSecret() {
  const candidates = [
    getServerEnv("FLOWSECURE_MASTER_KEY"),
    getServerEnv("FLOWSECURE_MASTER_SECRET"),
    getServerEnv("AUTH_SECRET"),
    getServerEnv("NEXTAUTH_SECRET"),
    getServerEnv("AUTH_COOKIE_SECRET"),
    getServerEnv("DISCORD_CLIENT_SECRET"),
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  if (process.env.NODE_ENV !== "production") {
    return FLOWSECURE_DEV_FALLBACK_SECRET;
  }

  throw new Error(
    "FLOWSECURE_MASTER_KEY/FLOWSECURE_MASTER_SECRET/AUTH_SECRET nao configurado no ambiente.",
  );
}

function deriveFlowSecureKey(input: {
  purpose: FlowSecurePurpose;
  subcontext?: string | null;
}) {
  const masterSecret = resolveFlowSecureMasterSecret();
  const info = [
    "flowsecure",
    FLOWSECURE_VERSION,
    input.purpose,
    input.subcontext?.trim() || "default",
  ].join(":");

  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      Buffer.from(masterSecret, "utf8"),
      Buffer.from("flowdesk-flowsecure", "utf8"),
      Buffer.from(info, "utf8"),
      32,
    ),
  );
}

function buildEnvelopeAad(input: {
  purpose: FlowSecurePurpose;
  aad?: string | null;
}) {
  return Buffer.from(
    [
      FLOWSECURE_PREFIX,
      FLOWSECURE_VERSION,
      input.purpose,
      input.aad?.trim() || "default",
    ].join(":"),
    "utf8",
  );
}

export function isFlowSecureEnvelope(value: string | null | undefined) {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  return parts.length === 6 && parts[0] === FLOWSECURE_PREFIX && parts[1] === FLOWSECURE_VERSION;
}

export function encryptFlowSecureValue(
  value: string | null | undefined,
  input: {
    purpose: FlowSecurePurpose;
    aad?: string | null;
    subcontext?: string | null;
  },
) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    deriveFlowSecureKey({
      purpose: input.purpose,
      subcontext: input.subcontext,
    }),
    iv,
  );
  cipher.setAAD(buildEnvelopeAad({
    purpose: input.purpose,
    aad: input.aad,
  }));

  const ciphertext = Buffer.concat([
    cipher.update(normalized, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    FLOWSECURE_PREFIX,
    FLOWSECURE_VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    authTag.toString("base64url"),
    input.purpose,
  ].join(".");
}

export function decryptFlowSecureValue(
  value: string | null | undefined,
  input: {
    purpose: FlowSecurePurpose;
    aad?: string | null;
    subcontext?: string | null;
    allowPlaintextFallback?: boolean;
  },
) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;

  if (!isFlowSecureEnvelope(normalized)) {
    return input.allowPlaintextFallback ? normalized : null;
  }

  const [
    prefix,
    version,
    ivBase64,
    ciphertextBase64,
    authTagBase64,
    purpose,
  ] = normalized.split(".");

  if (
    prefix !== FLOWSECURE_PREFIX ||
    version !== FLOWSECURE_VERSION ||
    purpose !== input.purpose
  ) {
    if (input.allowPlaintextFallback) {
      return normalized;
    }
    throw new Error("Envelope FlowSecure invalido para o contexto solicitado.");
  }

  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      deriveFlowSecureKey({
        purpose: input.purpose,
        subcontext: input.subcontext,
      }),
      Buffer.from(ivBase64, "base64url"),
    );
    decipher.setAAD(buildEnvelopeAad({
      purpose: input.purpose,
      aad: input.aad,
    }));
    decipher.setAuthTag(Buffer.from(authTagBase64, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextBase64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (input.allowPlaintextFallback) {
      return normalized;
    }

    throw error instanceof Error
      ? error
      : new Error("Nao foi possivel descriptografar o valor protegido.");
  }
}

export function hashFlowSecureValue(
  value: string | null | undefined,
  input: {
    purpose: FlowSecurePurpose;
    subcontext?: string | null;
    encoding?: "hex" | "base64url";
  },
) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;

  return crypto
    .createHmac(
      "sha256",
      deriveFlowSecureKey({
        purpose: input.purpose,
        subcontext: input.subcontext,
      }),
    )
    .update(normalized, "utf8")
    .digest(input.encoding || "hex");
}

function normalizeFlowSecureDiagnosticValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeFlowSecureDiagnosticValue(item));
  }

  if (!isRecord(value)) {
    return value ?? null;
  }

  const normalizedEntries = Object.entries(value)
    .filter(([, fieldValue]) => fieldValue !== undefined)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey, "en-US"))
    .map(([key, fieldValue]) => [
      key,
      normalizeFlowSecureDiagnosticValue(fieldValue),
    ]);

  return Object.fromEntries(normalizedEntries);
}

export function buildFlowSecureDiagnosticFingerprint(
  value: unknown,
  input?: {
    prefix?: string | null;
    subcontext?: string | null;
    maxPayloadLength?: number;
  },
) {
  const serialized = JSON.stringify(normalizeFlowSecureDiagnosticValue(value));
  if (!serialized) {
    return null;
  }

  const trimmedPayload = serialized.slice(0, input?.maxPayloadLength || 2048);
  const fingerprint = hashFlowSecureValue(trimmedPayload, {
    purpose: "diagnostic_fingerprint",
    subcontext: input?.subcontext || "default",
    encoding: "base64url",
  });

  if (!fingerprint) {
    return null;
  }

  const prefix = input?.prefix?.trim() || "fsdiag";
  return `${prefix}_${fingerprint.slice(0, 22)}`;
}

export function constantTimeEqualText(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }

  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function containsFlowSecureThreatPattern(value: string | null | undefined) {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  return FLOWSECURE_THREAT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function assertFlowSecureSafeText(
  value: string,
  input?: {
    fieldName?: string;
    disallowAngleBrackets?: boolean;
  },
) {
  const fieldName = input?.fieldName || "valor";
  if (containsFlowSecureThreatPattern(value)) {
    throw new FlowSecureFieldError(`Campo ${fieldName} contem padrao inseguro.`);
  }

  if (input?.disallowAngleBrackets !== false && /[<>]/.test(value)) {
    throw new FlowSecureFieldError(`Campo ${fieldName} contem caracteres inseguros.`);
  }
}

function redactSensitiveValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return REDACTED_VALUE;
  if (typeof value === "string") return REDACTED_VALUE;
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item));
  }
  if (isRecord(value)) {
    return redactSensitiveRecord(value);
  }
  return REDACTED_VALUE;
}

export function redactSensitiveRecord<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveRecord(item)) as T;
  }

  if (!isRecord(value)) {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = redactSensitiveValue(fieldValue);
      continue;
    }

    if (Array.isArray(fieldValue)) {
      output[key] = fieldValue.map((item) => redactSensitiveRecord(item));
      continue;
    }

    output[key] = isRecord(fieldValue)
      ? redactSensitiveRecord(fieldValue)
      : fieldValue;
  }

  return output as T;
}

function parsePlainDtoObject(payload: unknown) {
  if (!isRecord(payload)) {
    throw new FlowSecureDtoError("Payload invalido.", [
      "O corpo da requisicao precisa ser um objeto JSON.",
    ]);
  }

  return payload;
}

export function parseFlowSecureDto<T extends Record<string, unknown>>(
  payload: unknown,
  schema: {
    [K in keyof T]: FlowSecureReader<T[K]>;
  },
  input?: {
    rejectUnknown?: boolean;
  },
) {
  const source = parsePlainDtoObject(payload);
  const issues: string[] = [];
  const output = {} as T;
  const schemaKeys = new Set<string>(Object.keys(schema));

  for (const [key, reader] of Object.entries(schema) as Array<
    [keyof T, FlowSecureReader<T[keyof T]>]
  >) {
    try {
      output[key] = reader(source[key as string], key as string);
    } catch (error) {
      issues.push(
        error instanceof Error ? error.message : `Campo ${String(key)} invalido.`,
      );
    }
  }

  if (input?.rejectUnknown) {
    for (const key of Object.keys(source)) {
      if (!schemaKeys.has(key)) {
        issues.push(`Campo ${key} nao permitido nesta requisicao.`);
      }
    }
  }

  if (issues.length) {
    throw new FlowSecureDtoError("Payload invalido.", issues);
  }

  return output;
}

export const flowSecureDto = {
  string(options: FlowSecureStringOptions = {}): FlowSecureReader<string> {
    return (value, key) => {
      if (typeof value !== "string") {
        throw new FlowSecureFieldError(`Campo ${key} precisa ser texto.`);
      }

      const maybeTrimmed = options.trim === false ? value : value.trim();
      const normalized = options.normalizeWhitespace
        ? maybeTrimmed.replace(/\s+/g, " ")
        : maybeTrimmed;
      if (!options.allowEmpty && !normalized) {
        throw new FlowSecureFieldError(`Campo ${key} precisa ser preenchido.`);
      }

      if (
        typeof options.minLength === "number" &&
        normalized.length < options.minLength
      ) {
        throw new FlowSecureFieldError(
          `Campo ${key} precisa ter ao menos ${options.minLength} caracteres.`,
        );
      }

      if (
        typeof options.maxLength === "number" &&
        normalized.length > options.maxLength
      ) {
        throw new FlowSecureFieldError(
          `Campo ${key} excede o limite de ${options.maxLength} caracteres.`,
        );
      }

      if (options.pattern && normalized && !options.pattern.test(normalized)) {
        throw new FlowSecureFieldError(`Campo ${key} possui formato invalido.`);
      }

      if (options.rejectThreatPatterns !== false && normalized) {
        assertFlowSecureSafeText(normalized, {
          fieldName: key,
          disallowAngleBrackets: options.disallowAngleBrackets,
        });
      }

      return normalized;
    };
  },

  email(): FlowSecureReader<string> {
    return flowSecureDto.string({
      maxLength: 254,
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      disallowAngleBrackets: true,
    });
  },

  discordSnowflake(): FlowSecureReader<string> {
    return flowSecureDto.string({
      minLength: 17,
      maxLength: 20,
      pattern: /^\d{17,20}$/,
      disallowAngleBrackets: true,
    });
  },

  internalPath(): FlowSecureReader<string> {
    return flowSecureDto.string({
      maxLength: 2048,
      pattern: /^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@/%?#]*$/,
      disallowAngleBrackets: true,
      rejectThreatPatterns: true,
    });
  },

  base64UrlToken(options?: {
    minLength?: number;
    maxLength?: number;
  }): FlowSecureReader<string> {
    const minLength = options?.minLength ?? 16;
    const maxLength = options?.maxLength ?? 256;
    return flowSecureDto.string({
      minLength,
      maxLength,
      pattern: /^[A-Za-z0-9_-]+$/,
      disallowAngleBrackets: true,
      rejectThreatPatterns: false,
    });
  },

  personName(): FlowSecureReader<string> {
    return flowSecureDto.string({
      minLength: 3,
      maxLength: 120,
      normalizeWhitespace: true,
      pattern: /^[\p{L}\p{M}0-9 .,'’-]+$/u,
      disallowAngleBrackets: true,
    });
  },

  looseBoolean(options: FlowSecureBooleanOptions = {}): FlowSecureReader<boolean> {
    return (value, key) => {
      if (typeof value === "boolean") {
        return value;
      }

      if (value === undefined || value === null || value === "") {
        if (typeof options.defaultValue === "boolean") {
          return options.defaultValue;
        }

        throw new FlowSecureFieldError(`Campo ${key} precisa ser booleano.`);
      }

      if (typeof value === "number") {
        if (value === 1) return true;
        if (value === 0) return false;
      }

      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["1", "true", "yes", "y", "on"].includes(normalized)) {
          return true;
        }
        if (["0", "false", "no", "n", "off"].includes(normalized)) {
          return false;
        }
      }

      throw new FlowSecureFieldError(`Campo ${key} precisa ser booleano.`);
    };
  },

  boolean(options: FlowSecureBooleanOptions = {}): FlowSecureReader<boolean> {
    return (value, key) => {
      if (typeof value === "boolean") {
        return value;
      }

      if (value === undefined && typeof options.defaultValue === "boolean") {
        return options.defaultValue;
      }

      throw new FlowSecureFieldError(`Campo ${key} precisa ser booleano.`);
    };
  },

  number(options: FlowSecureNumberOptions = {}): FlowSecureReader<number> {
    return (value, key) => {
      const numeric =
        typeof value === "number"
          ? value
          : typeof value === "string" && value.trim()
            ? Number(value)
            : Number.NaN;

      if (!Number.isFinite(numeric)) {
        throw new FlowSecureFieldError(`Campo ${key} precisa ser numerico.`);
      }

      if (options.integer && !Number.isInteger(numeric)) {
        throw new FlowSecureFieldError(`Campo ${key} precisa ser inteiro.`);
      }

      if (typeof options.min === "number" && numeric < options.min) {
        throw new FlowSecureFieldError(
          `Campo ${key} precisa ser maior ou igual a ${options.min}.`,
        );
      }

      if (typeof options.max === "number" && numeric > options.max) {
        throw new FlowSecureFieldError(
          `Campo ${key} precisa ser menor ou igual a ${options.max}.`,
        );
      }

      return numeric;
    };
  },

  enum<const TValues extends readonly string[]>(
    values: TValues,
  ): FlowSecureReader<TValues[number]> {
    return (value, key) => {
      if (typeof value !== "string") {
        throw new FlowSecureFieldError(`Campo ${key} precisa ser texto.`);
      }

      const normalized = value.trim();
      if (!values.includes(normalized as TValues[number])) {
        throw new FlowSecureFieldError(`Campo ${key} possui valor invalido.`);
      }

      return normalized as TValues[number];
    };
  },

  record(): FlowSecureReader<Record<string, unknown>> {
    return (value, key) => {
      if (!isRecord(value)) {
        throw new FlowSecureFieldError(`Campo ${key} precisa ser um objeto.`);
      }

      return value;
    };
  },

  array<T>(
    reader: FlowSecureReader<T>,
    options?: {
      minLength?: number;
      maxLength?: number;
    },
  ): FlowSecureReader<T[]> {
    return (value, key) => {
      if (!Array.isArray(value)) {
        throw new FlowSecureFieldError(`Campo ${key} precisa ser uma lista.`);
      }

      if (
        typeof options?.minLength === "number" &&
        value.length < options.minLength
      ) {
        throw new FlowSecureFieldError(
          `Campo ${key} precisa ter ao menos ${options.minLength} item(ns).`,
        );
      }

      if (
        typeof options?.maxLength === "number" &&
        value.length > options.maxLength
      ) {
        throw new FlowSecureFieldError(
          `Campo ${key} excede o limite de ${options.maxLength} item(ns).`,
        );
      }

      return value.map((item, index) => reader(item, `${key}[${index}]`));
    };
  },

  unknown(): FlowSecureReader<unknown> {
    return (value) => value;
  },

  optional<T>(reader: FlowSecureReader<T>): FlowSecureReader<T | undefined> {
    return (value, key) => {
      if (value === undefined) {
        return undefined;
      }
      return reader(value, key);
    };
  },

  nullable<T>(reader: FlowSecureReader<T>): FlowSecureReader<T | null> {
    return (value, key) => {
      if (value === null) {
        return null;
      }
      return reader(value, key);
    };
  },
};
