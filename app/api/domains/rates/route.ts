import { NextResponse } from "next/server";
import { getUSDToBRLRate } from "@/lib/currency";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rate = await getUSDToBRLRate();
    return NextResponse.json({
      ok: true,
      base: "USD",
      target: "BRL",
      rate,
      timestamp: new Date().toISOString(),
      source: "exchangerate-api.com (through FlowAPI caching)"
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      message: "Falha ao obter taxa de cambio em tempo real."
    }, { status: 500 });
  }
}
