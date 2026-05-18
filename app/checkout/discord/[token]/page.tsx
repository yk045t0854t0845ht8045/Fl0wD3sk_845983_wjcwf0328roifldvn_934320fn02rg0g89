import crypto from "node:crypto";
import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { buildDiscordAuthStartHref } from "@/lib/auth/paths";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import {
  hashSalesCheckoutToken,
  isValidSalesCheckoutToken,
} from "@/lib/sales/checkoutSecurity";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

export const metadata: Metadata = {
  title: "Confirmar compra Discord | Flowdesk",
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

type CheckoutLink = {
  id: string;
  cart_id: string;
  guild_id: string;
  discord_user_id: string;
  status: string;
  auth_user_id: number | null;
  expires_at: string;
};

function normalizeEmail(value: string | null | undefined) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

function isMissingOptionalCartColumnError(error: {
  code?: string | null;
  message?: string | null;
} | null | undefined) {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = typeof error?.message === "string" ? error.message.toLowerCase() : "";
  return (
    code === "42703" ||
    code === "PGRST204" ||
    message.includes("customer_email") ||
    message.includes("customer_name") ||
    (message.includes("guild_sales_carts") &&
      (message.includes("schema cache") || message.includes("column")))
  );
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
    <main className="relative min-h-screen overflow-hidden bg-black text-[#F2F2F2] font-sans antialiased selection:bg-[#3b82f6]/30 selection:text-white">
      <section className="mx-auto flex min-h-screen w-full max-w-[720px] items-center justify-center px-4 py-8">
        <div className="relative w-full overflow-hidden rounded-[32px] border border-[#111] bg-[#070707] px-[24px] py-[28px] text-center shadow-[0_32px_120px_rgba(0,0,0,0.44)] sm:px-[34px] sm:py-[36px]">
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
            className={`mx-auto mt-[28px] flex h-[66px] w-[66px] items-center justify-center rounded-full border text-[18px] font-semibold ${
              tone === "success"
                ? "border-[#21492D] bg-[#0B170F] text-[#92E8A4]"
                : tone === "error"
                  ? "border-[#3A1E1E] bg-[#160B0B] text-[#F1A7A7]"
                  : "border-[#242424] bg-[#101010] text-[#DADADA]"
            }`}
          >
            {tone === "success" ? "OK" : tone === "error" ? "!" : "..."}
          </div>
          <p className="mt-[24px] text-[12px] uppercase tracking-[0.18em] text-[#777]">
            Compra Discord
          </p>
          <h1 className="mt-[12px] text-[30px] leading-[1.04] font-semibold tracking-[-0.05em] text-[#F4F4F4] sm:text-[38px]">
            {title}
          </h1>
          <p className="mx-auto mt-[14px] max-w-[500px] text-[14px] leading-[1.8] text-[#9A9A9A]">
            {description}
          </p>
        </div>
      </section>
    </main>
  );
}

async function loadCheckoutLink(token: string) {
  if (!isValidSalesCheckoutToken(token)) return null;
  const tokenHash = hashSalesCheckoutToken(token);
  const result = await getSupabaseAdminClientOrThrow()
    .from("guild_sales_checkout_links")
    .select("id, cart_id, guild_id, discord_user_id, status, auth_user_id, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle<CheckoutLink>();
  if (result.error) throw new Error(result.error.message);
  return result.data || null;
}

async function getCurrentTimestampMs() {
  return Date.now();
}

export default async function DiscordCheckoutLinkPage({
  params,
  searchParams,
}: PageProps) {
  const { token } = await params;
  const { confirm, logout } = await searchParams;

  const link = await loadCheckoutLink(token);
  if (!link) {
    return (
      <StatePage
        tone="error"
        title="Link invalido"
        description="Gere um novo link no carrinho do Discord para continuar a compra."
      />
    );
  }

  const expiresAtMs = Date.parse(link.expires_at);
  const nowMs = await getCurrentTimestampMs();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    await getSupabaseAdminClientOrThrow()
      .from("guild_sales_checkout_links")
      .update({ status: "expired" })
      .eq("id", link.id);
    return (
      <StatePage
        tone="error"
        title="Link expirado"
        description="Volte ao carrinho no Discord e solicite uma nova confirmacao segura."
      />
    );
  }

  if (link.status === "confirmed") {
    return (
      <StatePage
        tone="success"
        title="Compra ja vinculada"
        description="Tudo certo. Volte ao carrinho no Discord e clique para continuar com quantidade e pagamento PIX."
      />
    );
  }

  const checkoutPath = `/checkout/discord/${encodeURIComponent(token)}`;

  // ─── 1. HANDLE LOGOUT INTENT ───
  if (logout === "true") {
    redirect(`/api/auth/logout-redirect?redirect=${encodeURIComponent(checkoutPath)}`);
  }

  const session = await getCurrentAuthSessionFromCookie();
  if (!session) {
    redirect(buildDiscordAuthStartHref(checkoutPath));
  }

  if (!session.user.discord_user_id) {
    redirect(buildDiscordAuthStartHref(checkoutPath, "link"));
  }

  if (session.user.discord_user_id !== link.discord_user_id) {
    const displayName = session.user.display_name || session.user.username || "Cliente Flowdesk";

    return (
      <main className="min-h-screen bg-black text-[#F2F2F2] font-sans antialiased selection:bg-[#3b82f6]/30 selection:text-white flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-[460px] overflow-hidden rounded-[24px] border border-[#161616] bg-[#0A0A0A]/95 backdrop-blur-xl p-8 shadow-[0_32px_120px_rgba(0,0,0,0.66)] text-center relative">
          {/* Decorative Top Ambient Light */}
          <div className="absolute -top-[120px] left-1/2 -translate-x-1/2 w-[280px] h-[280px] rounded-full bg-[#ef4444]/5 blur-[90px] pointer-events-none" />

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

          {/* Alert Icon */}
          <div className="mt-8 flex justify-center">
            <div className="relative w-16 h-16 bg-[#ef4444]/10 rounded-full flex items-center justify-center border border-[#ef4444]/20 animate-pulse">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-8 h-8 text-[#ef4444]">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
          </div>

          {/* Title */}
          <h1 className="mt-6 text-[26px] font-semibold tracking-tight text-white leading-tight">
            Conta Discord diferente
          </h1>
          <p className="mt-3 text-[14px] leading-[1.6] text-[#8E8E8F]">
            Você está logado no site como <span className="text-white font-medium">{displayName}</span>, mas este link de compra requer a conta Discord com ID <span className="text-white font-mono text-[13px]">{link.discord_user_id}</span>.
          </p>

          {/* Actions */}
          <div className="mt-8 flex flex-col gap-3">
            <a
              href={`${checkoutPath}?logout=true`}
              className="block w-full text-center py-3.5 rounded-[16px] bg-[#ef4444] hover:bg-[#dc2626] text-white transition-all duration-300 font-medium text-[14px] cursor-pointer shadow-md"
            >
              Trocar de conta Discord
            </a>
            <a
              href="https://discord.com/app"
              target="_blank"
              rel="noreferrer"
              className="block w-full text-center py-3.5 rounded-[16px] bg-transparent border border-[#222] text-white hover:bg-white hover:text-black hover:border-white transition-all duration-300 font-medium text-[14px] cursor-pointer"
            >
              Voltar ao Discord
            </a>
          </div>
        </div>
      </main>
    );
  }

  const customerEmail = normalizeEmail(session.user.email);
  if (!customerEmail) {
    return (
      <StatePage
        tone="error"
        title="Email necessario"
        description="Entre com uma conta Flowdesk que tenha email valido para receber o comprovante e a entrega desta compra."
      />
    );
  }

  // ─── 2. HANDLE CONFIRM INTENT ───
  if (confirm === "true") {
    const supabase = getSupabaseAdminClientOrThrow();
    await supabase
      .from("guild_sales_checkout_links")
      .update({
        status: "confirmed",
        auth_user_id: session.user.id,
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", link.id);

    const cartUpdate = await supabase
      .from("guild_sales_carts")
      .update({
        status: "open",
        auth_user_id: session.user.id,
        customer_email: customerEmail,
        customer_name:
          session.user.display_name || session.user.username || "Cliente Flowdesk",
      })
      .eq("id", link.cart_id)
      .in("status", ["link_required", "open"]);

    if (cartUpdate.error && isMissingOptionalCartColumnError(cartUpdate.error)) {
      const fallbackUpdate = await supabase
        .from("guild_sales_carts")
        .update({
          status: "open",
          auth_user_id: session.user.id,
        })
        .eq("id", link.cart_id)
        .in("status", ["link_required", "open"]);
      if (fallbackUpdate.error) throw new Error(fallbackUpdate.error.message);
    } else if (cartUpdate.error) {
      throw new Error(cartUpdate.error.message);
    }

    return (
      <StatePage
        tone="success"
        title="Compra vinculada"
        description="Tudo certo. Volte ao carrinho no Discord e clique para continuar com quantidade e pagamento PIX."
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
            href={`/checkout/discord/${encodeURIComponent(token)}?confirm=true`}
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
            href={`/checkout/discord/${encodeURIComponent(token)}?logout=true`}
            className="block w-full text-center py-3.5 rounded-[16px] bg-transparent border border-[#222] text-white hover:bg-white hover:text-black hover:border-white transition-all duration-300 font-medium text-[14px] cursor-pointer shadow-sm"
          >
            Entre em outra conta
          </a>
        </div>
      </div>
    </main>
  );
}
