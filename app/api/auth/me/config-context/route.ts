import { NextResponse } from "next/server";
import {
  normalizeConfigStep,
  sanitizeConfigDraft,
} from "@/lib/auth/configContext";
import {
  getCurrentAuthSessionFromCookie,
  updateSessionConfigContext,
} from "@/lib/auth/session";
import {
  assertUserAdminInGuildOrNull,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";

type ConfigContextBody = {
  activeGuildId?: unknown;
  activeStep?: unknown;
  draft?: unknown;
};

function normalizeGuildId(value: unknown) {
  if (typeof value !== "string") return null;
  const guildId = value.trim();
  return /^\d{10,25}$/.test(guildId) ? guildId : null;
}

export async function GET() {
  try {
    const session = await getCurrentAuthSessionFromCookie();
    if (!session) {
      return applyNoStoreHeaders(NextResponse.json(
        { ok: false, message: "Nao autenticado." },
        { status: 401 },
      ));
    }

    return applyNoStoreHeaders(NextResponse.json({
      ok: true,
      activeGuildId: session.activeGuildId || null,
      activeStep: session.configCurrentStep || 1,
      draft: session.configDraft,
      updatedAt: session.configContextUpdatedAt || null,
    }));
  } catch (error) {
    return applyNoStoreHeaders(NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao carregar contexto de configuracao.",
      },
      { status: 500 },
    ));
  }
}

export async function PUT(request: Request) {
  try {
    const securityResponse = ensureSameOriginJsonMutationRequest(request);
    if (securityResponse) return securityResponse;

    const session = await getCurrentAuthSessionFromCookie();
    if (!session) {
      return applyNoStoreHeaders(NextResponse.json(
        { ok: false, message: "Nao autenticado." },
        { status: 401 },
      ));
    }

    let body: ConfigContextBody = {};
    try {
      body = (await request.json()) as ConfigContextBody;
    } catch {
      return applyNoStoreHeaders(NextResponse.json(
        { ok: false, message: "Payload JSON invalido." },
        { status: 400 },
      ));
    }

    const hasActiveGuildPatch = Object.prototype.hasOwnProperty.call(
      body,
      "activeGuildId",
    );
    const hasActiveStepPatch = Object.prototype.hasOwnProperty.call(
      body,
      "activeStep",
    );
    const hasDraftPatch = Object.prototype.hasOwnProperty.call(body, "draft");

    if (!hasActiveGuildPatch && !hasActiveStepPatch && !hasDraftPatch) {
      return applyNoStoreHeaders(NextResponse.json(
        { ok: false, message: "Nenhuma alteracao informada." },
        { status: 400 },
      ));
    }

    const activeGuildId = hasActiveGuildPatch
      ? body.activeGuildId === null
        ? null
        : normalizeGuildId(body.activeGuildId)
      : undefined;

    if (hasActiveGuildPatch && body.activeGuildId !== null && !activeGuildId) {
      return applyNoStoreHeaders(NextResponse.json(
        { ok: false, message: "Guild ID invalido." },
        { status: 400 },
      ));
    }

    let activeStep: ReturnType<typeof normalizeConfigStep> | undefined = undefined;
    if (hasActiveStepPatch) {
      activeStep = normalizeConfigStep(body.activeStep);
    }

    if (hasActiveStepPatch && !activeStep) {
      return applyNoStoreHeaders(NextResponse.json(
        { ok: false, message: "Etapa ativa invalida." },
        { status: 400 },
      ));
    }

    const draft = hasDraftPatch ? sanitizeConfigDraft(body.draft) : undefined;

    if (activeGuildId) {
      const sessionData = await resolveSessionAccessToken();
      if (!sessionData?.authSession || sessionData.authSession.id !== session.id) {
        return applyNoStoreHeaders(NextResponse.json(
          { ok: false, message: "Nao autenticado." },
          { status: 401 },
        ));
      }

      if (!sessionData.accessToken) {
        return applyNoStoreHeaders(NextResponse.json(
          { ok: false, message: "Token OAuth ausente na sessao." },
          { status: 401 },
        ));
      }

      const accessibleGuild = await assertUserAdminInGuildOrNull(
        {
          authSession: sessionData.authSession,
          accessToken: sessionData.accessToken,
        },
        activeGuildId,
      );

      if (!accessibleGuild) {
        return applyNoStoreHeaders(NextResponse.json(
          { ok: false, message: "Servidor nao encontrado para este usuario." },
          { status: 403 },
        ));
      }
    }

    const updatedContext = await updateSessionConfigContext(session.id, {
      ...(hasActiveGuildPatch ? { activeGuildId } : {}),
      ...(hasActiveStepPatch && activeStep
        ? { configCurrentStep: activeStep }
        : {}),
      ...(hasDraftPatch ? { configDraft: draft } : {}),
    });

    return applyNoStoreHeaders(NextResponse.json({
      ok: true,
      activeGuildId: updatedContext.activeGuildId,
      activeStep: updatedContext.configCurrentStep,
      draft: updatedContext.configDraft,
      updatedAt: updatedContext.configContextUpdatedAt || null,
    }));
  } catch (error) {
    return applyNoStoreHeaders(NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao salvar contexto de configuracao.",
      },
      { status: 500 },
    ));
  }
}
