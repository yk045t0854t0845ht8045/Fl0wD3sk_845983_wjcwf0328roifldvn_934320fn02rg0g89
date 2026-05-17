import crypto from "node:crypto";
import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
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
    <main className="min-h-screen bg-black text-[#F2F2F2]">
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

export default async function DiscordSupportAuthPage({ params }: PageProps) {
  const { token } = await params;
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
