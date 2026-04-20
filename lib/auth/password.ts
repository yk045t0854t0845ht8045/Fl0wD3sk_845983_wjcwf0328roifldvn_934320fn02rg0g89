import crypto from "node:crypto";

const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_HASH_PREFIX = "scryptv2";
const LEGACY_PASSWORD_HASH_PREFIX = "scrypt";
const DEFAULT_PASSWORD_SCRYPT_N = 32_768;
const DEFAULT_PASSWORD_SCRYPT_R = 8;
const DEFAULT_PASSWORD_SCRYPT_P = 1;
const PASSWORD_SCRYPT_MIN_MAXMEM_BYTES = 32 * 1024 * 1024;
const PASSWORD_SCRYPT_MAX_N = 1 << 20;
const PASSWORD_SCRYPT_MAX_R = 32;
const PASSWORD_SCRYPT_MAX_P = 16;

type ResolvedScryptParams = {
  N: number;
  r: number;
  p: number;
  maxmem: number;
};

function resolvePasswordPepper() {
  const candidates = [
    process.env.AUTH_PASSWORD_PEPPER,
    process.env.FLOWSECURE_MASTER_KEY,
    process.env.AUTH_SECRET,
    process.env.NEXTAUTH_SECRET,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  if (process.env.NODE_ENV !== "production") {
    return "flowdesk-password-pepper-dev";
  }

  return null;
}

function readPositiveIntegerEnv(name: string, fallback: number) {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) return fallback;

  const parsedValue = Number(rawValue);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return fallback;
  }

  return parsedValue;
}

function isPowerOfTwo(value: number) {
  return Number.isInteger(value) && value > 1 && (value & (value - 1)) === 0;
}

function calculateRequiredScryptMaxmemBytes(N: number, r: number, p: number) {
  // OpenSSL scrypt precisa de memoria adicional alem de 128 * N * r.
  return 128 * N * r + 128 * r * p + 256 * r + 4096;
}

function buildScryptMemoryErrorMessage(action: "hash" | "verify") {
  return action === "hash"
    ? "Nao foi possivel proteger sua senha agora. Tente novamente em alguns instantes."
    : "Nao foi possivel validar sua senha agora. Tente novamente em alguns instantes.";
}

function normalizeScryptRuntimeError(
  error: unknown,
  action: "hash" | "verify",
) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (
    message.includes("invalid scrypt params") ||
    message.includes("memory limit exceeded")
  ) {
    return new Error(buildScryptMemoryErrorMessage(action));
  }

  return error instanceof Error ? error : new Error(buildScryptMemoryErrorMessage(action));
}

function resolveDefaultScryptParams(): ResolvedScryptParams {
  const configuredN = readPositiveIntegerEnv(
    "AUTH_PASSWORD_SCRYPT_N",
    DEFAULT_PASSWORD_SCRYPT_N,
  );
  const configuredR = readPositiveIntegerEnv(
    "AUTH_PASSWORD_SCRYPT_R",
    DEFAULT_PASSWORD_SCRYPT_R,
  );
  const configuredP = readPositiveIntegerEnv(
    "AUTH_PASSWORD_SCRYPT_P",
    DEFAULT_PASSWORD_SCRYPT_P,
  );

  const N = isPowerOfTwo(configuredN) && configuredN <= PASSWORD_SCRYPT_MAX_N
    ? configuredN
    : DEFAULT_PASSWORD_SCRYPT_N;
  const r = configuredR <= PASSWORD_SCRYPT_MAX_R
    ? configuredR
    : DEFAULT_PASSWORD_SCRYPT_R;
  const p = configuredP <= PASSWORD_SCRYPT_MAX_P
    ? configuredP
    : DEFAULT_PASSWORD_SCRYPT_P;

  const requestedMaxmemMb = readPositiveIntegerEnv(
    "AUTH_PASSWORD_SCRYPT_MAXMEM_MB",
    0,
  );
  const requestedMaxmemBytes = requestedMaxmemMb > 0
    ? requestedMaxmemMb * 1024 * 1024
    : 0;
  const requiredMaxmemBytes = calculateRequiredScryptMaxmemBytes(N, r, p);
  const recommendedMaxmemBytes = Math.max(
    PASSWORD_SCRYPT_MIN_MAXMEM_BYTES,
    Math.ceil(requiredMaxmemBytes * 2),
  );

  return {
    N,
    r,
    p,
    maxmem: Math.max(requestedMaxmemBytes, recommendedMaxmemBytes),
  };
}

function resolveStoredHashScryptParams(
  N: number,
  r: number,
  p: number,
): ResolvedScryptParams | null {
  if (
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    !isPowerOfTwo(N) ||
    N <= 1 ||
    r <= 0 ||
    p <= 0 ||
    N > PASSWORD_SCRYPT_MAX_N ||
    r > PASSWORD_SCRYPT_MAX_R ||
    p > PASSWORD_SCRYPT_MAX_P
  ) {
    return null;
  }

  const requiredMaxmemBytes = calculateRequiredScryptMaxmemBytes(N, r, p);
  return {
    N,
    r,
    p,
    maxmem: Math.max(
      PASSWORD_SCRYPT_MIN_MAXMEM_BYTES,
      Math.ceil(requiredMaxmemBytes * 2),
    ),
  };
}

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: crypto.ScryptOptions,
) {
  return new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey as Buffer);
    });
  });
}

function preparePasswordForPrefix(password: string, prefix: string) {
  if (prefix !== PASSWORD_HASH_PREFIX) {
    return password;
  }

  const pepper = resolvePasswordPepper();
  if (!pepper) {
    throw new Error("AUTH_PASSWORD_PEPPER/FLOWSECURE_MASTER_KEY nao configurado no ambiente.");
  }

  return crypto
    .createHmac("sha256", pepper)
    .update(password, "utf8")
    .digest("base64url");
}

export async function hashPassword(password: string) {
  const scryptParams = resolveDefaultScryptParams();
  const salt = crypto.randomBytes(16);
  let derivedKey: Buffer;
  const preparedPassword = preparePasswordForPrefix(password, PASSWORD_HASH_PREFIX);

  try {
    derivedKey = (await scryptAsync(preparedPassword, salt, PASSWORD_KEY_LENGTH, {
      N: scryptParams.N,
      r: scryptParams.r,
      p: scryptParams.p,
      maxmem: scryptParams.maxmem,
    })) as Buffer;
  } catch (error) {
    throw normalizeScryptRuntimeError(error, "hash");
  }

  return [
    PASSWORD_HASH_PREFIX,
    String(scryptParams.N),
    String(scryptParams.r),
    String(scryptParams.p),
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  storedHash: string | null | undefined,
) {
  if (!storedHash || typeof storedHash !== "string") {
    return false;
  }

  const [prefix, rawN, rawR, rawP, saltBase64, keyBase64] = storedHash.split("$");
  const supportsPrefix =
    prefix === PASSWORD_HASH_PREFIX || prefix === LEGACY_PASSWORD_HASH_PREFIX;
  if (!supportsPrefix || !rawN || !rawR || !rawP || !saltBase64 || !keyBase64) {
    return false;
  }

  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  const scryptParams = resolveStoredHashScryptParams(N, r, p);
  if (!scryptParams) {
    return false;
  }

  const salt = Buffer.from(saltBase64, "base64url");
  const expectedKey = Buffer.from(keyBase64, "base64url");
  let derivedKey: Buffer;
  const preparedPassword = preparePasswordForPrefix(password, prefix);

  try {
    derivedKey = (await scryptAsync(preparedPassword, salt, expectedKey.length, {
      N: scryptParams.N,
      r: scryptParams.r,
      p: scryptParams.p,
      maxmem: scryptParams.maxmem,
    })) as Buffer;
  } catch (error) {
    throw normalizeScryptRuntimeError(error, "verify");
  }

  if (derivedKey.length !== expectedKey.length) {
    return false;
  }

  return crypto.timingSafeEqual(derivedKey, expectedKey);
}

export function shouldUpgradePasswordHash(storedHash: string | null | undefined) {
  if (!storedHash || typeof storedHash !== "string") {
    return true;
  }

  const [prefix, rawN, rawR, rawP] = storedHash.split("$");
  if (prefix !== PASSWORD_HASH_PREFIX) {
    return true;
  }

  const defaults = resolveDefaultScryptParams();
  return (
    Number(rawN) < defaults.N ||
    Number(rawR) < defaults.r ||
    Number(rawP) < defaults.p
  );
}
