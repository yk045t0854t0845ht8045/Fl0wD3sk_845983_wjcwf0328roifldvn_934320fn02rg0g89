import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { buildDiscordAuthStartHref } from "@/lib/auth/paths";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
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

function methodLabel(value: string) {
  if (value === "discord_dm") return "Discord DM";
  if (value === "email") return "Email";
  return "Website";
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

  const deliveriesResult = await supabase
    .from("guild_sales_order_deliveries")
    .select("id, delivery_method, status, delivery_payload, delivered_at")
    .eq("cart_id", cartId)
    .eq("auth_user_id", session.user.id)
    .order("created_at", { ascending: true })
    .returns<DeliveryRow[]>();
  if (deliveriesResult.error) throw new Error(deliveriesResult.error.message);

  const deliveries = deliveriesResult.data || [];

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
                  <pre className="mt-[16px] whitespace-pre-wrap rounded-[18px] border border-[#1D1D1D] bg-[#050505] p-[15px] text-left text-[13px] leading-[1.65] text-[#D7D7D7]">
                    {message}
                  </pre>
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
