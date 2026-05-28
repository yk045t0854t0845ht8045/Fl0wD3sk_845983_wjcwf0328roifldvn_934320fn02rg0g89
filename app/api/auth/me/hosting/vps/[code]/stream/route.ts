import { NextRequest } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import {
  getHostingProjectForUser,
  normalizeVpsCode,
} from "@/lib/hosting/vpsRuntime";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type RouteProps = {
  params: Promise<{ code: string }>;
};

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(_request: NextRequest, { params }: RouteProps) {
  const session = await getCurrentAuthSessionFromCookie();
  const { code } = await params;
  const vpsCode = normalizeVpsCode(code);
  if (!session || !vpsCode) {
    return new Response(sse("error", { message: "Nao autorizado." }), {
      status: 401,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
      },
    });
  }

  const project = await getHostingProjectForUser({
    userId: session.user.id,
    vpsCode,
  });
  if (!project) {
    return new Response(sse("error", { message: "VPS nao encontrada." }), {
      status: 404,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
      },
    });
  }

  let closed = false;
  let interval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let lastLogId = 0;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sse(event, data)));
        } catch {
          closed = true;
          if (interval) clearInterval(interval);
        }
      };

      const tick = async () => {
        if (closed) return;
        const supabase = getSupabaseAdminClientOrThrow();
        const [projectResult, metricsResult, logsResult, actionsResult] = await Promise.all([
          supabase
            .from("hosting_projects")
            .select("runtime_status, runtime_status_payload, runtime_last_seen_at, status, updated_at")
            .eq("id", project.id)
            .maybeSingle(),
          supabase
            .from("hosting_vps_metrics")
            .select("*")
            .eq("hosting_project_id", project.id)
            .order("sampled_at", { ascending: false })
            .limit(1),
          supabase
            .from("hosting_vps_logs")
            .select("*")
            .eq("hosting_project_id", project.id)
            .gt("id", lastLogId)
            .order("id", { ascending: true })
            .limit(50),
          supabase
            .from("hosting_vps_action_events")
            .select("*")
            .eq("hosting_project_id", project.id)
            .order("created_at", { ascending: false })
            .limit(8),
        ]);

        const logs = logsResult.data || [];
        if (logs.length) {
          lastLogId = Math.max(...logs.map((log) => Number(log.id) || 0));
        }

        if (closed) return;
        send("snapshot", {
          project: projectResult.data,
          metric: metricsResult.data?.[0] || null,
          logs,
          actions: actionsResult.data || [],
          at: new Date().toISOString(),
        });
      };

      await tick().catch((error) => send("error", { message: String(error) }));
      interval = setInterval(() => {
        void tick().catch((error) => send("error", { message: String(error) }));
      }, 1500);
    },
    cancel() {
      closed = true;
      if (interval) clearInterval(interval);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}
