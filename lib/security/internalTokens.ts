import crypto from "node:crypto";

type InternalTokenAuthInput = {
  request: Request;
  expectedTokens: Array<string | null | undefined>;
  headerNames?: string[];
  allowDevWithoutToken?: boolean;
};

function normalizeToken(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function secureTokenEquals(expected: string, received: string) {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() || "";
}

export function hasSecureInternalTokenAuth(input: InternalTokenAuthInput) {
  const expectedTokens = Array.from(
    new Set(input.expectedTokens.map(normalizeToken).filter(Boolean)),
  );

  if (!expectedTokens.length) {
    return Boolean(input.allowDevWithoutToken) && process.env.NODE_ENV !== "production";
  }

  const headerTokens = (input.headerNames || [])
    .map((name) => input.request.headers.get(name)?.trim() || "")
    .filter(Boolean);
  const candidateTokens = [readBearerToken(input.request), ...headerTokens].filter(Boolean);

  return candidateTokens.some((candidate) =>
    expectedTokens.some((expected) => secureTokenEquals(expected, candidate)),
  );
}
