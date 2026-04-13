import { NextResponse } from "next/server";
import { getSystemStatus, subscribeToStatus } from "@/lib/status/service";

export async function GET() {
  try {
    const status = await getSystemStatus();
    return NextResponse.json({ ok: true, ...status });
  } catch (error) {
    console.error("Error fetching system status:", error);
    return NextResponse.json({ ok: false, error: "Failed to fetch system status" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, target } = body;

    if (!type || !target) {
      return NextResponse.json({ ok: false, error: "Type and target are required" }, { status: 400 });
    }

    await subscribeToStatus(type, target);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error subscribing to system status:", error);
    return NextResponse.json({ ok: false, error: "Failed to subscribe" }, { status: 500 });
  }
}
