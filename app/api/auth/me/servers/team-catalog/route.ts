import { NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import {
  DEFAULT_MANAGED_SERVERS_SYNC_STATE,
  filterTeamCatalogManagedServers,
  getManagedServersSnapshotForCurrentSession,
} from "@/lib/servers/managedServers";
import { extractAuditErrorMessage, sanitizeErrorMessage } from "@/lib/security/errors";
import { applyNoStoreHeaders } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  extendSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";

export async function GET(request: Request) {
  const requestContext = createSecurityRequestContext(request);
  const respond = (body: unknown, init?: ResponseInit) =>
    attachRequestId(applyNoStoreHeaders(NextResponse.json(body, init)), requestContext.requestId);

  try {
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

    const snapshot = await getManagedServersSnapshotForCurrentSession();
    const auditContext = extendSecurityRequestContext(requestContext, {
      sessionId: authSession.id,
      userId: authSession.user.id,
    });

    if (snapshot.sync.degraded || snapshot.sync.requiresDiscordRelink) {
      await logSecurityAuditEventSafe(auditContext, {
        action: "managed_servers_team_catalog_sync_state",
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
      servers: filterTeamCatalogManagedServers(snapshot.servers),
      sync: snapshot.sync,
    });
  } catch (error) {
    await logSecurityAuditEventSafe(requestContext, {
      action: "managed_servers_team_catalog_sync_state",
      outcome: "failed",
      metadata: {
        diagnosticsFingerprint:
          DEFAULT_MANAGED_SERVERS_SYNC_STATE.diagnosticsFingerprint,
        reason: extractAuditErrorMessage(
          error,
          "managed_servers_team_catalog_read_failed",
        ),
      },
    });

    const message = sanitizeErrorMessage(
      error,
      "Erro ao carregar servidores da equipe.",
    );
    const status = message === "Nao autenticado." ? 401 : 500;

    return respond(
      {
        ok: false,
        message,
        sync: DEFAULT_MANAGED_SERVERS_SYNC_STATE,
      },
      { status },
    );
  }
}
