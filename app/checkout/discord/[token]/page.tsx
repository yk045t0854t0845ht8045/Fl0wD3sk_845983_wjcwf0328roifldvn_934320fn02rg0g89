import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
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
    <main className="relative min-h-screen overflow-hidden bg-black text-[#F2F2F2]">
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

export default async function DiscordCheckoutLinkPage({ params }: PageProps) {
  const { token } = await params;
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

  const session = await getCurrentAuthSessionFromCookie();
  if (!session) {
    redirect(buildDiscordAuthStartHref(`/checkout/discord/${encodeURIComponent(token)}`));
  }

  if (!session.user.discord_user_id || session.user.discord_user_id !== link.discord_user_id) {
    return (
      <StatePage
        tone="error"
        title="Conta Discord diferente"
        description="Entre com a mesma conta Discord que iniciou o carrinho para autorizar esta compra."
      />
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

  const supabase = getSupabaseAdminClientOrThrow();
  await supabase
    .from("guild_sales_checkout_links")
    .update({
      status: "confirmed",
      auth_user_id: session.user.id,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", link.id);

  await supabase
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

  return (
    <StatePage
      tone="success"
      title="Compra vinculada"
      description="Tudo certo. Volte ao carrinho no Discord e clique para continuar com quantidade e pagamento PIX."
    />
  );
}
