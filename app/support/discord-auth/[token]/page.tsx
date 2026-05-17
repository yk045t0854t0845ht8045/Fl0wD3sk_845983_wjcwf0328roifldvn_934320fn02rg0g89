import crypto from "node:crypto";
import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { buildDiscordAuthStartHref } from "@/lib/auth/paths";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

export const metadata: Metadata = {
  title: "Login seguro do atendimento | Flowdesk",
  robots: { index: false, follow: false },
};

type PageProps = {
  params: Promise<{
    token: string;
  }>;
  searchParams: Promise<{
    confirm?: string;
    logout?: string;
  }>;
};

type RefundAuthLink = {
  id: string;
  ticket_id: number;
  guild_id: string;
  channel_id: string;
  discord_user_id: string;
  status: string;
  auth_user_id: number | null;
  expires_at: string;
};

function isValidRefundAuthToken(token: string) {
  return /^[A-Za-z0-9_-]{32,96}$/.test(token.trim());
}

function hashRefundAuthToken(token: string) {
  return crypto
    .createHash("sha256")
    .update(token.trim(), "utf8")
    .digest("hex");
}

function buildDiscordAvatarUrl(discordUserId: string | null, avatarHash: string | null) {
  if (!avatarHash || !discordUserId) return null;
  const extension = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordUserId}/${avatarHash}.${extension}?size=96`;
}

function StatePage({
  title,
  description,
  tone = "default",
}: {
  title: string;
  description: string;
  tone?: "default" | "success" | "error";
}) {
  return (
    <main className="min-h-screen bg-black text-[#F2F2F2] font-sans antialiased selection:bg-[#3b82f6]/30 selection:text-white">
      <section className="mx-auto flex min-h-screen w-full max-w-[720px] items-center justify-center px-4 py-8">
        <div className="w-full overflow-hidden rounded-[28px] border border-[#111] bg-[#070707] px-6 py-8 text-center shadow-[0_32px_120px_rgba(0,0,0,0.44)] sm:px-9 sm:py-10">
          <div className="relative mx-auto h-[34px] w-[168px]">
            <Image
              src="/cdn/logos/logo.png"
              alt="Flowdesk"
              fill
              sizes="168px"
              className="object-contain object-center"
              priority
            />
          </div>
          <div
            className={`mx-auto mt-7 flex h-[66px] w-[66px] items-center justify-center rounded-full border text-[18px] font-semibold ${
              tone === "success"
                ? "border-[#21492D] bg-[#0B170F] text-[#92E8A4]"
                : tone === "error"
                  ? "border-[#3A1E1E] bg-[#160B0B] text-[#F1A7A7]"
                  : "border-[#242424] bg-[#101010] text-[#DADADA]"
            }`}
          >
            {tone === "success" ? "OK" : tone === "error" ? "!" : "..."}
          </div>
          <p className="mt-6 text-[12px] uppercase tracking-[0.18em] text-[#777]">
            Atendimento Discord
          </p>
          <h1 className="mt-3 text-[30px] leading-[1.08] font-semibold text-[#F4F4F4] sm:text-[38px]">
            {title}
          </h1>
          <p className="mx-auto mt-4 max-w-[500px] text-[14px] leading-[1.8] text-[#9A9A9A]">
            {description}
          </p>
        </div>
      </section>
    </main>
  );
}

async function loadRefundAuthLink(token: string) {
  if (!isValidRefundAuthToken(token)) return null;
  const result = await getSupabaseAdminClientOrThrow()
    .from("ticket_refund_auth_links")
    .select("id, ticket_id, guild_id, channel_id, discord_user_id, status, auth_user_id, expires_at")
    .eq("token_hash", hashRefundAuthToken(token))
    .maybeSingle<RefundAuthLink>();
  if (result.error) throw new Error(result.error.message);
  return result.data || null;
}

async function getCurrentTimestampMs() {
  return Date.now();
}

export default async function DiscordSupportAuthPage({
  params,
  searchParams,
}: PageProps) {
  const { token } = await params;
  const { confirm, logout } = await searchParams;

  const link = await loadRefundAuthLink(token);
  if (!link) {
    return (
      <StatePage
        tone="error"
        title="Link invalido"
        description="Volte ao ticket no Discord e solicite um novo login seguro para continuar."
      />
    );
  }

  const expiresAtMs = Date.parse(link.expires_at);
  const nowMs = await getCurrentTimestampMs();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    await getSupabaseAdminClientOrThrow()
      .from("ticket_refund_auth_links")
      .update({ status: "expired" })
      .eq("id", link.id)
      .eq("status", "pending");
    return (
      <StatePage
        tone="error"
        title="Link expirado"
        description="Por seguranca, este login expirou. Volte ao ticket e gere uma nova verificacao."
      />
    );
  }

  if (link.status === "confirmed") {
    return (
      <StatePage
        tone="success"
        title="Conta ja vinculada"
        description="Tudo certo. Volte ao Discord; o bot vai continuar automaticamente no ticket."
      />
    );
  }

  if (link.status !== "pending") {
    return (
      <StatePage
        tone="error"
        title="Link indisponivel"
        description="Este link de verificacao nao esta mais ativo. Volte ao ticket para continuar."
      />
    );
  }

  const authPath = `/support/discord-auth/${encodeURIComponent(token)}`;

  // ─── 1. HANDLE LOGOUT INTENT ───
  if (logout === "true") {
    const cookieStore = await cookies();
    cookieStore.delete("flowdesk_auth_session");
    cookieStore.delete("flowdesk_auth_session_proof");
    cookieStore.delete("flowdesk_oauth_discord_state");
    cookieStore.delete("flowdesk_oauth_discord_redirect_uri");
    cookieStore.delete("flowdesk_oauth_discord_next_path");
    cookieStore.delete("flowdesk_oauth_discord_mode");

    redirect(buildDiscordAuthStartHref(authPath));
  }

  const session = await getCurrentAuthSessionFromCookie();
  if (!session) {
    redirect(buildDiscordAuthStartHref(authPath));
  }

  if (!session.user.discord_user_id) {
    redirect(buildDiscordAuthStartHref(authPath, "link"));
  }

  if (session.user.discord_user_id !== link.discord_user_id) {
    return (
      <StatePage
        tone="error"
        title="Conta Discord diferente"
        description="Entre com a mesma conta Discord que abriu o ticket para autorizar esta verificacao."
      />
    );
  }

  // ─── 2. HANDLE CONFIRM INTENT ───
  if (confirm === "true") {
    const update = await getSupabaseAdminClientOrThrow()
      .from("ticket_refund_auth_links")
      .update({
        status: "confirmed",
        auth_user_id: session.user.id,
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", link.id)
      .eq("status", "pending");

    if (update.error) {
      throw new Error(update.error.message);
    }

    return (
      <StatePage
        tone="success"
        title="Conta vinculada"
        description="A verificacao foi concluida. Volte ao Discord; o bot vai atualizar a mensagem e pedir apenas o numero do pedido."
      />
    );
  }

  // ─── 3. RENDER THE PREMIUM NUI ACCOUNT SELECTION MODAL ───
  const userAvatarUrl = buildDiscordAvatarUrl(session.user.discord_user_id, session.user.avatar);
  const displayName = session.user.display_name || session.user.username || "Cliente Flowdesk";
  const userEmail = session.user.email;
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <main className="min-h-screen bg-black text-[#F2F2F2] font-sans antialiased selection:bg-[#3b82f6]/30 selection:text-white flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-[460px] overflow-hidden rounded-[24px] border border-[#161616] bg-[#0A0A0A]/95 backdrop-blur-xl p-8 shadow-[0_32px_120px_rgba(0,0,0,0.66)] text-center relative">
        {/* Decorative Top Ambient Light */}
        <div className="absolute -top-[120px] left-1/2 -translate-x-1/2 w-[280px] h-[280px] rounded-full bg-[#3b82f6]/10 blur-[90px] pointer-events-none" />

        {/* Logo */}
        <div className="relative mx-auto h-[32px] w-[148px]">
          <Image
            src="/cdn/logos/logo.png"
            alt="Flowdesk Logo"
            fill
            sizes="148px"
            className="object-contain object-center"
            priority
          />
        </div>

        {/* Title */}
        <h1 className="mt-8 text-[28px] font-semibold tracking-tight text-white leading-tight">
          Que bom que você voltou
        </h1>
        <p className="mt-2 text-[14px] text-[#8E8E8F]">
          Escolha uma conta para continuar.
        </p>

        {/* Option 1: Currently Logged In Account Box */}
        <div className="mt-8">
          <a
            href={`/support/discord-auth/${encodeURIComponent(token)}?confirm=true`}
            className="group block w-full text-left p-4 rounded-[18px] bg-[#111112] hover:bg-[#161618] border border-[#202022] hover:border-[#38383a] transition-all duration-300 shadow-[inset_0_1px_1px_rgba(255,255,255,0.02)] cursor-pointer"
          >
            <div className="flex items-center gap-4">
              {/* User Avatar */}
              <div className="relative flex-shrink-0">
                {userAvatarUrl ? (
                  <div className="w-13 h-13 rounded-full overflow-hidden border border-[#2a2a2c] group-hover:border-[#444] transition-colors duration-300">
                    <img
                      src={userAvatarUrl}
                      alt={displayName}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="w-13 h-13 rounded-full bg-gradient-to-tr from-[#3b82f6]/80 to-[#1d4ed8]/80 text-white font-semibold text-[15px] flex items-center justify-center border border-[#2a2a2c]">
                    {initials}
                  </div>
                )}
                {/* Micro-dot Status indicator */}
                <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-[#10b981] border-[2.5px] border-[#111112] group-hover:border-[#161618] transition-colors duration-300 rounded-full" />
              </div>

              {/* User Meta info */}
              <div className="flex-grow min-w-0">
                <h2 className="text-[15px] font-medium text-white group-hover:text-[#3b82f6] transition-colors duration-300 truncate">
                  {displayName}
                </h2>
                <p className="text-[12px] text-[#8E8E8F] truncate mt-0.5">
                  {userEmail}
                </p>
              </div>

              {/* Arrow Indicator */}
              <div className="flex-shrink-0 text-[#444] group-hover:text-white transition-colors duration-300 pr-1">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="2.5"
                  stroke="currentColor"
                  className="w-4 h-4"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8.25 4.5l7.5 7.5-7.5 7.5"
                  />
                </svg>
              </div>
            </div>
          </a>
        </div>

        {/* Separator "OU" */}
        <div className="relative my-6 flex items-center justify-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[#1a1a1c]" />
          </div>
          <span className="relative bg-[#0A0A0A] px-4 text-[11px] font-semibold text-[#555] uppercase tracking-[0.2em]">
            OU
          </span>
        </div>

        {/* Option 2: Logout and Log In to Another Account */}
        <div>
          <a
            href={`/support/discord-auth/${encodeURIComponent(token)}?logout=true`}
            className="block w-full text-center py-3.5 rounded-[16px] bg-transparent border border-[#222] text-white hover:bg-white hover:text-black hover:border-white transition-all duration-300 font-medium text-[14px] cursor-pointer shadow-sm"
          >
            Entre em outra conta
          </a>
        </div>
      </div>
    </main>
  );
}
