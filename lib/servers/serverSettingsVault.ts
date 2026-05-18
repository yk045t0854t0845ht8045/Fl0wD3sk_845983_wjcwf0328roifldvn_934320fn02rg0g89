import {
  decryptFlowSecureValue,
  encryptFlowSecureValue,
} from "@/lib/security/flowSecure";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

export type ServerSettingsVaultModule =
  | "ticket_settings"
  | "ticket_staff_settings"
  | "welcome_settings"
  | "antilink_settings"
  | "autorole_settings"
  | "sales_settings"
  | "sales_payment_methods"
  | "security_logs_settings";

type ServerSettingsVaultRow = {
  guild_id: string;
  module_key: ServerSettingsVaultModule;
  payload_encrypted: string | null;
  updated_at: string | null;
};

type ParsedVaultPayload<TValue> =
  | { ok: true; payload: TValue }
  | {
      ok: false;
      reason: string;
      errorKind: "empty" | "decrypt_failed" | "json_invalid";
      envelopeDetected: boolean;
    };

type ServerSettingsVaultRecovery = {
  unreadable: true;
  reason: string;
  errorKind: "empty" | "decrypt_failed" | "json_invalid";
  envelopeDetected: boolean;
};

const unreadableSnapshotWarnings = new Map<string, number>();
const UNREADABLE_WARNING_TTL_MS = 10 * 60 * 1000;

function isMissingVaultRelationError(error: {
  code?: string | null;
  message?: string | null;
} | null | undefined) {
  const code = typeof error?.code === "string" ? error.code : "";
  const message =
    typeof error?.message === "string" ? error.message.toLowerCase() : "";
  return (
    code === "42P01" ||
    message.includes("guild_settings_secure_snapshots") ||
    message.includes("relation") ||
    message.includes("does not exist")
  );
}

function classifyDecryptFailure(reason: string) {
  const normalized = reason.toLowerCase();
  if (
    normalized.includes("authenticate") ||
    normalized.includes("Unsupported state".toLowerCase()) ||
    normalized.includes("bad decrypt") ||
    normalized.includes("invalid tag")
  ) {
    return "decrypt_failed" as const;
  }
  return "decrypt_failed" as const;
}

function shouldLogUnreadableSnapshot(warningKey: string) {
  const lastAt = unreadableSnapshotWarnings.get(warningKey) || 0;
  if (Date.now() - lastAt < UNREADABLE_WARNING_TTL_MS) {
    return false;
  }
  unreadableSnapshotWarnings.set(warningKey, Date.now());
  return true;
}

function parseVaultPayload<TValue>(input: {
  guildId: string;
  moduleKey: ServerSettingsVaultModule;
  payloadEncrypted: string | null;
  updatedAt?: string | null;
}): ParsedVaultPayload<TValue> {
  if (typeof input.payloadEncrypted !== "string" || !input.payloadEncrypted.trim()) {
    return {
      ok: false,
      reason: "Snapshot vazio ou sem payload criptografado.",
      errorKind: "empty",
      envelopeDetected: false,
    };
  }

  const envelopeDetected = input.payloadEncrypted.startsWith("flws.");

  try {
    const decrypted = decryptFlowSecureValue(input.payloadEncrypted, {
      purpose: "server_settings_snapshot",
      aad: input.guildId,
      subcontext: input.moduleKey,
    });
    if (!decrypted) {
      return {
        ok: false,
        reason: "FlowSecure retornou payload vazio.",
        errorKind: "empty",
        envelopeDetected,
      };
    }

    try {
      return { ok: true, payload: JSON.parse(decrypted) as TValue };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "Payload descriptografado nao e JSON valido.",
        errorKind: "json_invalid",
        envelopeDetected,
      };
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown decrypt failure";
    const errorKind = classifyDecryptFailure(reason);
    const warningKey = `${input.guildId}:${input.moduleKey}:${errorKind}:${reason}`;
    if (shouldLogUnreadableSnapshot(warningKey)) {
      console.warn("[serverSettingsVault] ignoring unreadable secure snapshot", {
        reason,
        errorKind,
        guildId: input.guildId,
        moduleKey: input.moduleKey,
        updatedAt: input.updatedAt || null,
        envelopeDetected,
        encryptedLength: input.payloadEncrypted.length,
        recovery:
          "Falling back to canonical database settings. If a canonical record exists, routes may rewrite this snapshot with the current FlowSecure key.",
      });
    }
    return {
      ok: false,
      reason,
      errorKind,
      envelopeDetected,
    };
  }
}

function serializeVaultPayload(input: {
  guildId: string;
  moduleKey: ServerSettingsVaultModule;
  payload: unknown;
}) {
  return encryptFlowSecureValue(JSON.stringify(input.payload ?? {}), {
    purpose: "server_settings_snapshot",
    aad: input.guildId,
    subcontext: input.moduleKey,
  });
}

export async function readServerSettingsVaultSnapshot<TValue>(input: {
  guildId: string;
  moduleKey: ServerSettingsVaultModule;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("guild_settings_secure_snapshots")
    .select("guild_id, module_key, payload_encrypted, updated_at")
    .eq("guild_id", input.guildId)
    .eq("module_key", input.moduleKey)
    .maybeSingle<ServerSettingsVaultRow>();

  if (result.error) {
    if (isMissingVaultRelationError(result.error)) {
      return null;
    }
    throw new Error(result.error.message);
  }

  if (!result.data) {
    return null;
  }

  const payload = parseVaultPayload<TValue>({
    guildId: input.guildId,
    moduleKey: input.moduleKey,
    payloadEncrypted: result.data.payload_encrypted,
    updatedAt: result.data.updated_at,
  });
  if (!payload.ok) {
    return {
      payload: null,
      updatedAt:
        typeof result.data.updated_at === "string" ? result.data.updated_at : null,
      recovery: {
        unreadable: true,
        reason: payload.reason,
        errorKind: payload.errorKind,
        envelopeDetected: payload.envelopeDetected,
      } satisfies ServerSettingsVaultRecovery,
    };
  }

  return {
    payload: payload.payload,
    updatedAt:
      typeof result.data.updated_at === "string" ? result.data.updated_at : null,
  };
}

export async function readServerSettingsVaultSnapshots(input: {
  guildId: string;
  moduleKeys: ServerSettingsVaultModule[];
}) {
  const moduleKeys = Array.from(new Set(input.moduleKeys));
  if (!moduleKeys.length) {
    return new Map<
      ServerSettingsVaultModule,
      { payload: unknown; updatedAt: string | null }
    >();
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("guild_settings_secure_snapshots")
    .select("guild_id, module_key, payload_encrypted, updated_at")
    .eq("guild_id", input.guildId)
    .in("module_key", moduleKeys)
    .returns<ServerSettingsVaultRow[]>();

  if (result.error) {
    if (isMissingVaultRelationError(result.error)) {
      return new Map();
    }
    throw new Error(result.error.message);
  }

  const output = new Map<
    ServerSettingsVaultModule,
    {
      payload: unknown | null;
      updatedAt: string | null;
      recovery?: ServerSettingsVaultRecovery;
    }
  >();

  for (const row of result.data || []) {
    const payload = parseVaultPayload<unknown>({
      guildId: input.guildId,
      moduleKey: row.module_key,
      payloadEncrypted: row.payload_encrypted,
      updatedAt: row.updated_at,
    });
    if (!payload.ok) {
      output.set(row.module_key, {
        payload: null,
        updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
        recovery: {
          unreadable: true,
          reason: payload.reason,
          errorKind: payload.errorKind,
          envelopeDetected: payload.envelopeDetected,
        },
      });
      continue;
    }
    output.set(row.module_key, {
      payload: payload.payload,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    });
  }

  return output;
}

export async function writeServerSettingsVaultSnapshot(input: {
  guildId: string;
  moduleKey: ServerSettingsVaultModule;
  payload: unknown;
  configuredByUserId: number;
}) {
  const payloadEncrypted = serializeVaultPayload({
    guildId: input.guildId,
    moduleKey: input.moduleKey,
    payload: input.payload,
  });

  if (!payloadEncrypted) {
    throw new Error("Falha ao cifrar o snapshot seguro das configuracoes.");
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("guild_settings_secure_snapshots")
    .upsert(
      {
        guild_id: input.guildId,
        module_key: input.moduleKey,
        payload_encrypted: payloadEncrypted,
        configured_by_user_id: input.configuredByUserId,
      },
      { onConflict: "guild_id,module_key" },
    )
    .select("payload_encrypted, updated_at")
    .single<Pick<ServerSettingsVaultRow, "payload_encrypted" | "updated_at">>();

  if (result.error) {
    if (isMissingVaultRelationError(result.error)) {
      return null;
    }
    throw new Error(result.error.message);
  }

  const payload = parseVaultPayload({
    guildId: input.guildId,
    moduleKey: input.moduleKey,
    payloadEncrypted: result.data?.payload_encrypted || payloadEncrypted,
    updatedAt: result.data?.updated_at,
  });

  return {
    payload: payload.ok ? payload.payload : null,
    updatedAt:
      typeof result.data?.updated_at === "string" ? result.data.updated_at : null,
  };
}

export async function rewriteUnreadableServerSettingsVaultSnapshot(input: {
  guildId: string;
  moduleKey: ServerSettingsVaultModule;
  payload: unknown;
  configuredByUserId: number;
  recovery?: ServerSettingsVaultRecovery | null;
}) {
  if (!input.recovery?.unreadable) {
    return null;
  }

  try {
    const result = await writeServerSettingsVaultSnapshot({
      guildId: input.guildId,
      moduleKey: input.moduleKey,
      payload: input.payload,
      configuredByUserId: input.configuredByUserId,
    });
    console.info("[serverSettingsVault] unreadable secure snapshot rewritten", {
      guildId: input.guildId,
      moduleKey: input.moduleKey,
      previousErrorKind: input.recovery.errorKind,
      previousReason: input.recovery.reason,
      updatedAt: result?.updatedAt || null,
    });
    return result;
  } catch (error) {
    console.warn("[serverSettingsVault] failed to rewrite unreadable secure snapshot", {
      guildId: input.guildId,
      moduleKey: input.moduleKey,
      previousErrorKind: input.recovery.errorKind,
      previousReason: input.recovery.reason,
      reason: error instanceof Error ? error.message : "unknown rewrite failure",
    });
    return null;
  }
}
