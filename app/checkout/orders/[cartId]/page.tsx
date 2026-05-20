import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { buildDiscordAuthStartHref } from "@/lib/auth/paths";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import { syncSalesCartPayment } from "@/lib/sales/checkoutRuntime";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

export const metadata: Metadata = {
  title: "Entrega da compra | Flowdesk",
  robots: { index: false, follow: false },
};

type PageProps = {
  params: Promise<{
    cartId: string;
  }>;
};

type DeliveryRow = {
  id: string;
  delivery_method: string;
  status: string;
  delivery_payload: Record<string, unknown> | null;
  delivered_at: string;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function shouldSyncCartBeforeRender(status: string) {
  return ["payment_pending", "paid", "delivery_failed"].includes(status);
}

function methodLabel(value: string) {
  if (value === "discord_dm") return "Discord DM";
  if (value === "email") return "Email";
  return "Website";
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="font-semibold text-[#F2F2F2]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

function DeliveryMessage({ message }: { message: string }) {
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div className="mt-[16px] rounded-[18px] border border-[#1D1D1D] bg-[#050505] p-[15px] text-left">
      <div className="space-y-[10px]">
        {lines.map((line, index) => {
          if (line.startsWith("### ")) {
            return (
              <h4 key={index} className="pt-[4px] text-[14px] font-semibold text-[#F1F1F1]">
                {renderInlineMarkdown(line.slice(4))}
              </h4>
            );
          }
          if (line.startsWith("## ")) {
            return (
              <h3 key={index} className="text-[17px] font-semibold tracking-[-0.03em] text-[#F4F4F4]">
                {renderInlineMarkdown(line.slice(3))}
              </h3>
            );
          }
          if (line.startsWith("# ")) {
            return (
              <h2 key={index} className="text-[20px] font-semibold tracking-[-0.04em] text-[#F4F4F4]">
                {renderInlineMarkdown(line.slice(2))}
              </h2>
            );
          }
          const fieldMatch = line.match(/^\*\*([^:]+):\*\*\s*(.*)$/);
          if (fieldMatch) {
            return (
              <div
                key={index}
                className="grid gap-[4px] rounded-[14px] border border-[#171717] bg-[#080808] px-[12px] py-[10px] sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-[12px]"
              >
                <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#858585]">
                  {fieldMatch[1]}
                </span>
                <span className="min-w-0 break-words text-[13px] leading-[1.6] text-[#D7D7D7]">
                  {fieldMatch[2] || "-"}
                </span>
              </div>
            );
          }
          return (
            <p key={index} className="break-words text-[13px] leading-[1.65] text-[#D7D7D7]">
              {renderInlineMarkdown(line)}
            </p>
          );
        })}
      </div>
    </div>
  );
}

export default async function SalesOrderDeliveryPage({ params }: PageProps) {
  const { cartId } = await params;
  if (!isUuid(cartId)) redirect("/");

  const session = await getCurrentAuthSessionFromCookie();
  if (!session) {
    redirect(buildDiscordAuthStartHref(`/checkout/orders/${encodeURIComponent(cartId)}`));
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const cartResult = await supabase
    .from("guild_sales_carts")
    .select("id, auth_user_id, status, total_amount, currency, paid_at, delivered_at")
    .eq("id", cartId)
    .eq("auth_user_id", session.user.id)
    .maybeSingle<{
      id: string;
      auth_user_id: number;
      status: string;
      total_amount: string | number | null;
      currency: string | null;
      paid_at: string | null;
      delivered_at: string | null;
    }>();

  if (cartResult.error) throw new Error(cartResult.error.message);
  if (!cartResult.data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-4 text-[#F2F2F2]">
        <div className="max-w-[560px] text-center">
          <h1 className="text-[32px] font-semibold tracking-[-0.05em]">
            Pedido nao encontrado
          </h1>
          <p className="mt-3 text-[14px] leading-[1.7] text-[#9A9A9A]">
            Entre com a mesma conta usada na compra para abrir esta entrega.
          </p>
        </div>
      </main>
    );
  }

  let deliveries: DeliveryRow[] | null = null;
  if (shouldSyncCartBeforeRender(cartResult.data.status)) {
    try {
      const synced = await syncSalesCartPayment(cartId);
      deliveries = (synced.deliveries || []).map((delivery) => ({
        id: delivery.id,
        delivery_method: delivery.deliveryMethod,
        status: delivery.status,
        delivery_payload: {
          productTitle: delivery.productTitle,
          message: delivery.message,
        },
        delivered_at: "",
      }));
    } catch (error) {
      console.warn("[sales-order] failed to sync cart before render", {
        cartId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  if (!deliveries) {
    const deliveriesResult = await supabase
      .from("guild_sales_order_deliveries")
      .select("id, delivery_method, status, delivery_payload, delivered_at")
      .eq("cart_id", cartId)
      .eq("auth_user_id", session.user.id)
      .order("created_at", { ascending: true })
      .returns<DeliveryRow[]>();
    if (deliveriesResult.error) throw new Error(deliveriesResult.error.message);
    deliveries = deliveriesResult.data || [];
  }

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-[#F2F2F2] sm:px-6">
      <section className="mx-auto w-full max-w-[880px]">
        <div className="relative h-[34px] w-[168px]">
          <Image
            src="/cdn/logos/logo.png"
            alt="Flowdesk"
            fill
            sizes="168px"
            className="object-contain object-left"
            priority
          />
        </div>

        <div className="mt-[28px] rounded-[28px] border border-[#151515] bg-[#080808] p-[22px] sm:p-[28px]">
          <p className="text-[12px] uppercase tracking-[0.18em] text-[#777]">
            Entrega da compra
          </p>
          <h1 className="mt-[10px] text-[32px] font-semibold tracking-[-0.05em] text-[#F4F4F4]">
            Pedido {cartId.slice(0, 8)}
          </h1>
          <p className="mt-[12px] max-w-[640px] text-[14px] leading-[1.7] text-[#9A9A9A]">
            Estes dados ficam disponiveis apenas para a conta autenticada que vinculou
            a compra no Discord.
          </p>
        </div>

        <div className="mt-[18px] space-y-[14px]">
          {deliveries.length ? (
            deliveries.map((delivery) => {
              const payload = delivery.delivery_payload || {};
              const productTitle =
                typeof payload.productTitle === "string"
                  ? payload.productTitle
                  : "Produto";
              const message =
                typeof payload.message === "string"
                  ? payload.message
                  : "Entrega indisponivel.";
              return (
                <article
                  key={delivery.id}
                  className="rounded-[24px] border border-[#171717] bg-[#090909] p-[18px] sm:p-[22px]"
                >
                  <div className="flex flex-col gap-[10px] sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-[18px] font-semibold text-[#F1F1F1]">
                        {productTitle}
                      </h2>
                      <p className="mt-[5px] text-[12px] text-[#777]">
                        {methodLabel(delivery.delivery_method)} - {delivery.status === "failed" ? "falhou" : "entregue"}
                      </p>
                    </div>
                  </div>
                  <DeliveryMessage message={message} />
                </article>
              );
            })
          ) : (
            <div className="rounded-[24px] border border-[#171717] bg-[#090909] p-[24px] text-center">
              <h2 className="text-[18px] font-semibold text-[#F1F1F1]">
                Entrega ainda nao liberada
              </h2>
              <p className="mt-[8px] text-[14px] leading-[1.7] text-[#8A8A8A]">
                Quando o pagamento for aprovado, os dados aparecem aqui automaticamente.
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
