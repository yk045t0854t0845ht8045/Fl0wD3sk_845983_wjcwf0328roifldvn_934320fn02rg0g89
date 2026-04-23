import { NextResponse } from "next/server";
import { resolveSessionAccessToken } from "@/lib/auth/discordGuildAccess";
import {
  attachRequestId,
  createSecurityRequestContext,
  extendSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";
import { applyNoStoreHeaders } from "@/lib/security/http";
import {
  getViolationStatusForUser,
  syncDiscordViolationRoles,
} from "@/lib/account/violations";
import { sendAccountStatusChangedEmailSafe } from "@/lib/mail/transactional";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

async function shouldSendStatusEmailToday(input: {
  userId: number;
  statusLevel: number;
}) {
  if (input.statusLevel <= 0) return false;

  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_security_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", input.userId)
    .eq("action", "account_status_email_sent")
    .gte("created_at", sinceIso);

  if (result.error) return true;
  return (result.count || 0) === 0;
}

// ─── Helper: resolve internal user ID + discord ID from session ───────────────
async function resolveUserFromSession() {
  const sessionData = await resolveSessionAccessToken();
  if (!sessionData?.authSession) return null;

  const authSession = sessionData.authSession;

  return {
    authSession,
    discordUserId: authSession.user.discord_user_id,
    internalUserId: authSession.user.id,
  };
}

// ─── GET: Fetch the user's current violation status ──────────────────────────
export async function GET(request: Request) {
  const requestContext = createSecurityRequestContext(request);
  const respond = (body: unknown, init?: ResponseInit) =>
    attachRequestId(applyNoStoreHeaders(NextResponse.json(body, init)), requestContext.requestId);

  try {
    const user = await resolveUserFromSession();
    if (!user) {
      return respond({ ok: false, message: "Não autorizado." }, { status: 401 });
    }

    const auditContext = extendSecurityRequestContext(requestContext, {
      sessionId: user.authSession.id,
      userId: user.internalUserId,
    });

    const violationStatus = await getViolationStatusForUser(user.internalUserId);

    await logSecurityAuditEventSafe(auditContext, {
      action: "account_violations_read",
      outcome: "succeeded",
      metadata: {
        activeCount: violationStatus.activeViolations.length,
        expiredCount: violationStatus.expiredViolations.length,
        level: violationStatus.level,
      },
    });

    return respond({
      ok: true,
      status: violationStatus.label,
      statusLevel: violationStatus.level,
      discordUserId: user.discordUserId,
      activeViolations: violationStatus.activeViolations,
      expiredViolations: violationStatus.expiredViolations,
    });

  } catch (error) {
    console.error("[AccountStatus GET] Error:", error);
    await logSecurityAuditEventSafe(requestContext, {
      action: "account_violations_read",
      outcome: "failed",
    });
    return respond({ ok: false, message: "Erro interno." }, { status: 500 });
  }
}

// ─── POST: Sync Discord roles to current violation status ─────────────────────
// Called automatically from the status page on load to ensure Discord is in sync.
export async function POST(request: Request) {
  const requestContext = createSecurityRequestContext(request);
  const respond = (body: unknown, init?: ResponseInit) =>
    attachRequestId(applyNoStoreHeaders(NextResponse.json(body, init)), requestContext.requestId);

  try {
    const user = await resolveUserFromSession();
    if (!user) {
      return respond({ ok: false, message: "Não autorizado." }, { status: 401 });
    }

    const auditContext = extendSecurityRequestContext(requestContext, {
      sessionId: user.authSession.id,
      userId: user.internalUserId,
    });

    const violationStatus = await getViolationStatusForUser(user.internalUserId);

    // Fire role sync in the background, don't block the response
    if (user.discordUserId) {
      syncDiscordViolationRoles(user.discordUserId, violationStatus.level).catch((err) => {
        console.error("[AccountStatus POST] Discord role sync error:", err);
      });
    }

    if (await shouldSendStatusEmailToday({
      userId: user.internalUserId,
      statusLevel: violationStatus.level,
    })) {
      void sendAccountStatusChangedEmailSafe({
        user: user.authSession.user,
        statusLabel: violationStatus.label,
        detail: violationStatus.activeViolations[0]?.reason || null,
      });
      void logSecurityAuditEventSafe(auditContext, {
        action: "account_status_email_sent",
        outcome: "succeeded",
        metadata: {
          level: violationStatus.level,
          label: violationStatus.label,
        },
      });
    }

    await logSecurityAuditEventSafe(auditContext, {
      action: "account_violations_discord_sync",
      outcome: "succeeded",
      metadata: { level: violationStatus.level },
    });

    return respond({ ok: true, synced: true, level: violationStatus.level });

  } catch (error) {
    console.error("[AccountStatus POST] Error:", error);
    await logSecurityAuditEventSafe(requestContext, {
      action: "account_violations_discord_sync",
      outcome: "failed",
    });
    return respond({ ok: false, message: "Erro interno ao sincronizar cargos." }, { status: 500 });
  }
}
