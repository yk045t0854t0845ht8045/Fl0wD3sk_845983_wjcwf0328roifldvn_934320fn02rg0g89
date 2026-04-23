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
  | "security_logs_settings";

type ServerSettingsVaultRow = {
  guild_id: string;
  module_key: ServerSettingsVaultModule;
  payload_encrypted: string | null;
  updated_at: string | null;
};

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

function parseVaultPayload<TValue>(input: {
  guildId: string;
  moduleKey: ServerSettingsVaultModule;
  payloadEncrypted: string | null;
}) {
  if (typeof input.payloadEncrypted !== "string" || !input.payloadEncrypted.trim()) {
    return null;
  }

  try {
    const decrypted = decryptFlowSecureValue(input.payloadEncrypted, {
      purpose: "server_settings_snapshot",
      aad: input.guildId,
      subcontext: input.moduleKey,
    });
    if (!decrypted) {
      return null;
    }

    return JSON.parse(decrypted) as TValue;
  } catch (error) {
    console.error("[serverSettingsVault] failed to decrypt snapshot", {
      error,
      guildId: input.guildId,
      moduleKey: input.moduleKey,
    });
    return null;
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
  });
  if (!payload) {
    return null;
  }

  return {
    payload,
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
    { payload: unknown; updatedAt: string | null }
  >();

  for (const row of result.data || []) {
    const payload = parseVaultPayload<unknown>({
      guildId: input.guildId,
      moduleKey: row.module_key,
      payloadEncrypted: row.payload_encrypted,
    });
    if (!payload) continue;
    output.set(row.module_key, {
      payload,
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
    .select("updated_at")
    .single<{ updated_at: string | null }>();

  if (result.error) {
    if (isMissingVaultRelationError(result.error)) {
      return null;
    }
    throw new Error(result.error.message);
  }

  return {
    updatedAt:
      typeof result.data?.updated_at === "string" ? result.data.updated_at : null,
  };
}
