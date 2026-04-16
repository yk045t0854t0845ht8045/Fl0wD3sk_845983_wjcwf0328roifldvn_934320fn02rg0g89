import crypto from "node:crypto";

function normalizeSecret(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function secureTokenEquals(expected: string, received: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(received);

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function getCandidateTokens(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authorization);
  const bearerToken = bearerMatch?.[1]?.trim() || "";
  const headerToken = request.headers.get("x-flowai-token")?.trim() || "";

  return [bearerToken, headerToken].filter(Boolean);
}

export function hasFlowAiInternalTokenAuth(request: Request) {
  const expectedTokens = Array.from(
    new Set(
      [
        process.env.FLOWAI_INTERNAL_API_TOKEN,
        process.env.CRON_SECRET,
        process.env.OPENAI_API_KEY,
      ]
        .map(normalizeSecret)
        .filter(Boolean),
    ),
  );

  if (expectedTokens.length === 0) {
    return process.env.NODE_ENV !== "production";
  }

  const candidates = getCandidateTokens(request);
  return candidates.some((candidate) =>
    expectedTokens.some((expected) => secureTokenEquals(expected, candidate)),
  );
}
