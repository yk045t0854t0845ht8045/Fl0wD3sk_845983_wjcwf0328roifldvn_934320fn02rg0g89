import crypto from "node:crypto";
import { cookies } from "next/headers";
import type { DiscordUser } from "@/lib/auth/discord";
import { authConfig } from "@/lib/auth/config";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type CreateSessionContext = {
  ipAddress: string | null;
  userAgent: string | null;
};

type AuthUserRecord = {
  id: number;
  discord_user_id: string;
  username: string;
  global_name: string | null;
  display_name: string;
  avatar: string | null;
};

function buildDisplayName(discordUser: DiscordUser) {
  return discordUser.global_name || discordUser.username;
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createOAuthState() {
  return crypto.randomBytes(24).toString("hex");
}

function createSessionToken() {
  return crypto.randomBytes(48).toString("base64url");
}

async function upsertAuthUser(discordUser: DiscordUser) {
  const supabase = getSupabaseAdminClientOrThrow();

  const payload = {
    discord_user_id: discordUser.id,
    username: discordUser.username,
    global_name: discordUser.global_name,
    display_name: buildDisplayName(discordUser),
    avatar: discordUser.avatar,
    email: discordUser.email || null,
    locale: discordUser.locale || null,
    raw_user: discordUser,
  };

  const result = await supabase
    .from("auth_users")
    .upsert(payload, { onConflict: "discord_user_id" })
    .select(
      "id, discord_user_id, username, global_name, display_name, avatar",
    )
    .single<AuthUserRecord>();

  if (result.error) {
    throw new Error(`Erro ao salvar usuario no Supabase: ${result.error.message}`);
  }

  return result.data;
}

async function createSession(userId: number, context: CreateSessionContext) {
  const sessionToken = createSessionToken();
  const sessionTokenHash = hashToken(sessionToken);
  const expiresAt = new Date(
    Date.now() + authConfig.sessionTtlHours * 60 * 60 * 1000,
  ).toISOString();

  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase.from("auth_sessions").insert({
    user_id: userId,
    session_token_hash: sessionTokenHash,
    ip_address: context.ipAddress,
    user_agent: context.userAgent,
    expires_at: expiresAt,
  });

  if (result.error) {
    throw new Error(`Erro ao criar sessao no Supabase: ${result.error.message}`);
  }

  return {
    sessionToken,
    expiresAt,
  };
}

export async function createUserSessionFromDiscordUser(
  discordUser: DiscordUser,
  context: CreateSessionContext,
) {
  const user = await upsertAuthUser(discordUser);
  const session = await createSession(user.id, context);

  return {
    user,
    session,
  };
}

export async function getCurrentUserFromSessionCookie() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(authConfig.sessionCookieName)?.value;

  if (!sessionCookie) return null;

  const sessionTokenHash = hashToken(sessionCookie);
  const supabase = getSupabaseAdminClientOrThrow();
  const nowIso = new Date().toISOString();

  const result = await supabase
    .from("auth_sessions")
    .select(
      "id, expires_at, revoked_at, user:auth_users(id, discord_user_id, username, global_name, display_name, avatar)",
    )
    .eq("session_token_hash", sessionTokenHash)
    .is("revoked_at", null)
    .gt("expires_at", nowIso)
    .maybeSingle();

  if (result.error) {
    throw new Error(`Erro ao validar sessao: ${result.error.message}`);
  }

  if (!result.data) return null;

  const userData = result.data.user as AuthUserRecord | AuthUserRecord[] | null;

  if (!userData) return null;
  if (Array.isArray(userData)) return userData[0] || null;

  return userData;
}
