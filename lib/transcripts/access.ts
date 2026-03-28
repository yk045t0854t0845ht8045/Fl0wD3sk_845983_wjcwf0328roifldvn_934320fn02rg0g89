import crypto from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { isSecureRequest } from "@/lib/auth/config";

const TRANSCRIPT_SESSION_TTL_SECONDS = 10 * 60;

type TranscriptSessionPayload = {
  protocol: string;
  exp: number;
};

function getTranscriptAccessSecret() {
  const secret =
    process.env.TRANSCRIPT_ACCESS_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "";

  if (!secret) {
    throw new Error("Segredo de transcript indisponivel.");
  }

  return secret;
}

function signTranscriptValue(value: string) {
  return crypto
    .createHmac("sha256", getTranscriptAccessSecret())
    .update(value)
    .digest("base64url");
}

export function buildTranscriptCookieName(protocol: string) {
  const suffix = crypto
    .createHash("sha1")
    .update(protocol)
    .digest("hex")
    .slice(0, 16);

  return `flowdesk_transcript_${suffix}`;
}

export function hashTranscriptAccessCode(protocol: string, code: string) {
  return crypto
    .createHmac("sha256", getTranscriptAccessSecret())
    .update(`${protocol}:${String(code || "").trim()}`)
    .digest("hex");
}

export function createTranscriptSessionToken(protocol: string, expiresAtMs: number) {
  const payload = Buffer.from(
    JSON.stringify({
      protocol,
      exp: expiresAtMs,
    } satisfies TranscriptSessionPayload),
  ).toString("base64url");

  const signature = signTranscriptValue(payload);
  return `${payload}.${signature}`;
}

export function parseTranscriptSessionToken(
  token: string | null | undefined,
  protocol: string,
): TranscriptSessionPayload | null {
  if (!token || !token.includes(".")) return null;

  const [payloadSegment, signature] = token.split(".", 2);
  const expectedSignature = signTranscriptValue(payloadSegment);

  if (!signature || signature !== expectedSignature) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(payloadSegment, "base64url").toString("utf8"),
    ) as Partial<TranscriptSessionPayload>;

    if (payload.protocol !== protocol) return null;
    if (!Number.isFinite(payload.exp)) return null;
    if ((payload.exp || 0) <= Date.now()) return null;

    return {
      protocol: payload.protocol,
      exp: Number(payload.exp),
    };
  } catch {
    return null;
  }
}

export async function getTranscriptSessionFromCookie(protocol: string) {
  const cookieStore = await cookies();
  const token = cookieStore.get(buildTranscriptCookieName(protocol))?.value;
  return parseTranscriptSessionToken(token, protocol);
}

export function setTranscriptSessionCookie(
  response: NextResponse,
  request: NextRequest,
  protocol: string,
  expiresAtMs: number,
) {
  response.cookies.set(
    buildTranscriptCookieName(protocol),
    createTranscriptSessionToken(protocol, expiresAtMs),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureRequest(request),
      maxAge: TRANSCRIPT_SESSION_TTL_SECONDS,
      path: "/",
      priority: "high",
    },
  );
}

export function clearTranscriptSessionCookie(
  response: NextResponse,
  request: NextRequest,
  protocol: string,
) {
  response.cookies.set(buildTranscriptCookieName(protocol), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(request),
    maxAge: 0,
    path: "/",
    expires: new Date(0),
  });
}

export function getTranscriptSessionTtlSeconds() {
  return TRANSCRIPT_SESSION_TTL_SECONDS;
}
