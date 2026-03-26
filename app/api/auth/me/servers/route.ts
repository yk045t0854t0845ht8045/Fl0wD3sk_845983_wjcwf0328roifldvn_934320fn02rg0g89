import { NextResponse } from "next/server";
import {
  getManagedServersForCurrentSession,
} from "@/lib/servers/managedServers";
import { applyNoStoreHeaders } from "@/lib/security/http";

export async function GET() {
  try {
    const servers = await getManagedServersForCurrentSession();

    return applyNoStoreHeaders(
      NextResponse.json({
      ok: true,
      servers,
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao carregar servidores gerenciados.",
      },
      { status: 500 },
      ),
    );
  }
}
