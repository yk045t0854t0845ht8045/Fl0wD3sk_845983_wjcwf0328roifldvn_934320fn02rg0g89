import { NextResponse } from "next/server";
import { syncSalesCartPayment } from "@/lib/sales/checkoutRuntime";
import { applyNoStoreHeaders } from "@/lib/security/http";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

function getTrimmedText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

async function resolveCartId(request: Request, body: Record<string, unknown>) {
  const url = new URL(request.url);
  const cartId = getTrimmedText(url.searchParams.get("cartId"), 64);
  if (isUuid(cartId)) return cartId;

  const data = body.data && typeof body.data === "object"
    ? (body.data as Record<string, unknown>)
    : {};
  const paymentId = getTrimmedText(data.id || url.searchParams.get("data.id"), 80);
  if (!paymentId) return null;

  const result = await getSupabaseAdminClientOrThrow()
    .from("guild_sales_carts")
    .select("id")
    .eq("provider", "mercado_pago")
    .eq("provider_payment_id", paymentId)
    .maybeSingle<{ id: string }>();

  if (result.error) throw new Error(result.error.message);
  return result.data?.id || null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const cartId = await resolveCartId(request, body);
    if (cartId) {
      await syncSalesCartPayment(cartId);
    }
    return applyNoStoreHeaders(NextResponse.json({ ok: true }));
  } catch (error) {
    console.error("[sales-webhook] failed", error);
    return applyNoStoreHeaders(NextResponse.json({ ok: true }));
  }
}

export async function GET() {
  return applyNoStoreHeaders(NextResponse.json({ ok: true }));
}
