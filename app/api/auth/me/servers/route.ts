import { NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import { ensureUserPaymentDeliveryReady } from "@/lib/payments/paymentReadiness";
import {
  DEFAULT_MANAGED_SERVERS_SYNC_STATE,
  getPanelManagedServersSnapshotForCurrentSession,
} from "@/lib/servers/managedServers";
import { extractAuditErrorMessage, sanitizeErrorMessage } from "@/lib/security/errors";
import { applyNoStoreHeaders } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  extendSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";
import {
  createCoalescedRouteKey,
  runCoalescedRouteResponse,
} from "@/lib/security/routeCoalescing";

export async function GET(request: Request) {
  const requestContext = createSecurityRequestContext(request);
  const url = new URL(request.url);
  const freshValue =
    url.searchParams.get("fresh") ||
    url.searchParams.get("forceFresh") ||
    url.searchParams.get("refresh");
  const forceFresh =
    freshValue === "1" || freshValue === "true" || freshValue === "yes";
  const respond = (body: unknown, init?: ResponseInit) =>
    attachRequestId(applyNoStoreHeaders(NextResponse.json(body, init)), requestContext.requestId);
  const degradedSync = {
    ...DEFAULT_MANAGED_SERVERS_SYNC_STATE,
    degraded: true,
    usedDatabaseFallback: true,
    reason: "discord_sync_failed" as const,
  };

  const authSession = await getCurrentAuthSessionFromCookie();
  if (!authSession) {
    return respond(
      {
        ok: false,
        message: "Nao autenticado.",
        sync: DEFAULT_MANAGED_SERVERS_SYNC_STATE,
      },
      { status: 401 },
    );
  }

  const coalescedKey = createCoalescedRouteKey({
    namespace: "auth.me.servers.get",
    parts: [authSession.user.id, forceFresh ? "fresh" : "warm"],
  });

  return runCoalescedRouteResponse({
    key: coalescedKey,
    ttlMs: forceFresh ? 750 : 2500,
    producer: async () => {
  try {
    if (forceFresh) {
      await ensureUserPaymentDeliveryReady({
        userId: authSession.user.id,
        source: "managed_servers_get",
        limit: 4,
      });
    } else {
      void ensureUserPaymentDeliveryReady({
        userId: authSession.user.id,
        source: "managed_servers_get",
        limit: 3,
      }).catch(() => null);
    }

    const snapshot = await getPanelManagedServersSnapshotForCurrentSession({
      forceFresh: forceFresh || Boolean(authSession.user.discord_user_id),
    });
    const auditContext = extendSecurityRequestContext(requestContext, {
      sessionId: authSession.id,
      userId: authSession.user.id,
    });

    if (snapshot.sync.degraded || snapshot.sync.requiresDiscordRelink) {
      await logSecurityAuditEventSafe(auditContext, {
        action: "managed_servers_sync_state",
        outcome: "succeeded",
        metadata: {
          degraded: snapshot.sync.degraded,
          diagnosticsFingerprint: snapshot.sync.diagnosticsFingerprint,
          reason: snapshot.sync.reason,
          requiresDiscordRelink: snapshot.sync.requiresDiscordRelink,
          serverCount: snapshot.servers.length,
          usedDatabaseFallback: snapshot.sync.usedDatabaseFallback,
        },
      });
    }

    return respond({
      ok: true,
      servers: snapshot.servers,
      sync: snapshot.sync,
    });
  } catch (error) {
    await logSecurityAuditEventSafe(requestContext, {
      action: "managed_servers_sync_state",
      outcome: "failed",
      metadata: {
        diagnosticsFingerprint:
          DEFAULT_MANAGED_SERVERS_SYNC_STATE.diagnosticsFingerprint,
        reason: extractAuditErrorMessage(error, "managed_servers_read_failed"),
      },
    });

    const message = sanitizeErrorMessage(
      error,
      "Erro ao carregar servidores gerenciados.",
    );
    const status = message === "Nao autenticado." ? 401 : 500;

    return respond(
      {
        ok: status === 401 ? false : true,
        message,
        servers: [],
        sync: status === 401 ? DEFAULT_MANAGED_SERVERS_SYNC_STATE : degradedSync,
      },
      { status: status === 401 ? 401 : 200 },
    );
  }
    },
  });
}
