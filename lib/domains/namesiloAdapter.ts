/**
 * lib/domains/namesiloAdapter.ts
 *
 * Implementa DomainProviderAdapter usando a API da NameSilo.
 * Toda chamada à registradora passa por este adapter — nunca pelo frontend.
 */

import { nameSiloClient, parseYesNo } from "@/lib/namesilo/client";
import type {
  DomainAvailabilityResult,
  DomainContact,
  DomainProviderAdapter,
  DomainProviderCapabilities,
  DomainProviderJob,
  DomainTransferStatus,
  ProviderDomainDetail,
} from "./adapter";

export const NAMESILO_AUTH_CODE_SENT_BY_EMAIL = "__NAMESILO_AUTH_CODE_SENT_BY_EMAIL__";

function splitFqdn(fqdn: string): { name: string; extension: string } {
  const parts = fqdn.toLowerCase().split(".").filter(Boolean);
  if (parts.length < 2) throw new Error(`FQDN invalido: ${fqdn}`);
  return { name: parts[0], extension: parts.slice(1).join(".") };
}

function normalizeContact(contact: DomainContact) {
  const nameParts = contact.fullName.trim().split(" ").filter(Boolean);
  const firstName = nameParts[0] || "N/A";
  const lastName = nameParts.slice(1).join(" ") || firstName;

  return {
    fn: firstName,
    ln: lastName,
    ad: contact.street.slice(0, 128),
    cy: contact.city.slice(0, 64),
    st: contact.state.slice(0, 64),
    zp: contact.postalCode.replace(/\s+/g, "").slice(0, 16),
    ct: (contact.country || "BR").toUpperCase().slice(0, 4),
    em: contact.email.slice(0, 128),
    ph: contact.phone.replace(/\D/g, "").slice(0, 20),
  };
}

function parseOpStatus(raw: unknown): string {
  const status = String(raw || "").trim().toLowerCase();

  const map: Record<string, string> = {
    active: "active",
    ok: "active",
    "pending transfer": "transfer_in_pending",
    pending: "registration_pending",
    expired: "expired",
    redemption: "redemption",
    suspended: "suspended",
  };

  return map[status] || (status ? "action_required" : "unknown");
}

function normalizeTransferStatus(raw: unknown): string {
  const status = String(raw || "").trim().toLowerCase();
  if (!status) return "unknown";

  if (/pending at registry|pending|submitted/i.test(status)) return "submitted_to_provider";
  if (/completed|success|transferred/i.test(status)) return "completed";
  if (/cancel/i.test(status)) return "cancelled";
  if (/fail|rejected|declined/i.test(status)) return "failed";
  if (/action|email|verify/i.test(status)) return "action_required";
  return "waiting_previous_registrar";
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") return [value as T];
  return [];
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function extractCheckAvailabilityResults(reply: Record<string, unknown>, inputFqdns: string[]) {
  const availableEntries = asArray<{ domain?: unknown; price?: unknown; renew?: unknown; premium?: unknown }>(
    (reply as { available?: unknown }).available,
  );
  const unavailableEntries = asArray<string | { domain?: unknown; reason?: unknown }>(
    (reply as { unavailable?: unknown }).unavailable,
  );
  const invalidEntries = asArray<string>((reply as { invalid?: unknown }).invalid);

  const availableMap = new Map<string, { price: number; renew: number; premium: boolean }>();
  for (const item of availableEntries) {
    const fqdn = String(item.domain || "").toLowerCase();
    if (!fqdn) continue;
    const price = toNumber(item.price, 0);
    availableMap.set(fqdn, {
      price,
      renew: toNumber(item.renew, price),
      premium: Number(item.premium) === 1,
    });
  }

  const unavailableMap = new Map<string, string>();
  for (const item of unavailableEntries) {
    if (typeof item === "string") {
      unavailableMap.set(item.toLowerCase(), "");
      continue;
    }
    if (item && typeof item === "object") {
      const domain = String(item.domain || "").toLowerCase();
      if (!domain) continue;
      unavailableMap.set(domain, String(item.reason || ""));
    }
  }

  const invalidSet = new Set(invalidEntries.map((item) => String(item || "").toLowerCase()));

  return inputFqdns.map((fqdn) => {
    const { name, extension } = splitFqdn(fqdn);
    const available = availableMap.get(fqdn);

    if (available) {
      return {
        fqdn,
        sld: name,
        tld: extension,
        isAvailable: true,
        isPremium: available.premium,
        registrationCostUsd: available.price,
        renewalCostUsd: available.renew,
        currency: "USD",
        reason: null,
      } satisfies DomainAvailabilityResult;
    }

    const reason = invalidSet.has(fqdn)
      ? "Dominio invalido para este TLD."
      : unavailableMap.get(fqdn) || "Dominio indisponivel.";

    return {
      fqdn,
      sld: name,
      tld: extension,
      isAvailable: false,
      isPremium: false,
      registrationCostUsd: 0,
      renewalCostUsd: 0,
      currency: "USD",
      reason,
    } satisfies DomainAvailabilityResult;
  });
}

const TLD_CAPABILITIES: Record<string, Partial<DomainProviderCapabilities>> = {
  com: { register: true, transferIn: true, privacy: true, billingCycleDays: 365, billingLabel: "por ano" },
  "com.br": { register: false, transferIn: false, privacy: false, requiresDocument: true, billingCycleDays: 365, billingLabel: "por ano", notes: ".br requer fluxo dedicado (parceiro/EPP)." },
  net: { register: true, transferIn: true, privacy: true, billingCycleDays: 365, billingLabel: "por ano" },
  org: { register: true, transferIn: true, privacy: true, billingCycleDays: 365, billingLabel: "por ano" },
  io: { register: true, transferIn: true, privacy: true, billingCycleDays: 365, billingLabel: "por ano" },
  ai: { register: true, transferIn: true, privacy: true, billingCycleDays: 365, billingLabel: "por ano" },
  app: { register: true, transferIn: true, privacy: true, billingCycleDays: 365, billingLabel: "por ano" },
  dev: { register: true, transferIn: true, privacy: true, billingCycleDays: 365, billingLabel: "por ano" },
  me: { register: true, transferIn: true, privacy: true, billingCycleDays: 365, billingLabel: "por ano" },
  co: { register: true, transferIn: true, privacy: true, billingCycleDays: 365, billingLabel: "por ano" },
};

const DEFAULT_CAPABILITIES: DomainProviderCapabilities = {
  tld: "",
  register: true,
  transferIn: true,
  transferOut: true,
  renew: true,
  restore: true,
  privacy: true,
  dnssec: false,
  nameserverUpdate: true,
  contactUpdate: true,
  authCodeRequest: true,
  isPremiumDomainPossible: true,
  requiresDocument: false,
  requiresLocalPresence: false,
  supportsSandbox: true,
  billingCycleDays: 365,
  billingLabel: "por ano",
};

class NamesiloAdapter implements DomainProviderAdapter {
  async checkAvailability(fqdn: string): Promise<DomainAvailabilityResult> {
    const normalized = fqdn.trim().toLowerCase();
    const { reply } = await nameSiloClient.request("checkRegisterAvailability", {
      domains: normalized,
    });

    const [result] = extractCheckAvailabilityResults(reply, [normalized]);
    return result;
  }

  async checkAvailabilityBatch(fqdns: string[]): Promise<DomainAvailabilityResult[]> {
    const normalized = fqdns.map((fqdn) => fqdn.trim().toLowerCase());
    const { reply } = await nameSiloClient.request("checkRegisterAvailability", {
      domains: normalized.join(","),
    });
    return extractCheckAvailabilityResults(reply, normalized);
  }

  async registerDomain(input: {
    name: string;
    extension: string;
    periodYears: number;
    autoRenew: boolean;
    contact: DomainContact;
    idempotencyKey: string;
  }): Promise<DomainProviderJob> {
    const fqdn = `${input.name}.${input.extension}`.toLowerCase();
    const contact = normalizeContact(input.contact);

    const { reply } = await nameSiloClient.request("registerDomain", {
      domain: fqdn,
      years: Math.max(1, Math.min(10, input.periodYears)),
      auto_renew: input.autoRenew ? 1 : 0,
      private: 1,
      ...contact,
    });

    return {
      jobId: `namesilo_register_${Date.now()}`,
      providerRef: String(reply.domain || fqdn),
      status: "processing",
      fqdn,
      message: String(reply.message || ""),
    };
  }

  async getDomain(providerDomainId: string): Promise<ProviderDomainDetail | null> {
    const fqdn = providerDomainId.trim().toLowerCase();
    if (!fqdn) return null;

    try {
      const { reply } = await nameSiloClient.request("getDomainInfo", {
        domain: fqdn,
      });

      const nameserversRaw = (reply as { nameservers?: unknown }).nameservers;
      let nameservers: string[] = [];

      if (Array.isArray(nameserversRaw)) {
        nameservers = nameserversRaw.map((item) => String(item || "").trim()).filter(Boolean);
      } else if (nameserversRaw && typeof nameserversRaw === "object") {
        const nested = asArray<{ nameserver?: unknown }>((nameserversRaw as { nameserver?: unknown }).nameserver)
          .map((item) => String(item.nameserver || item || "").trim())
          .filter(Boolean);
        nameservers = nested;
      }

      return {
        providerDomainId: fqdn,
        fqdn,
        status: parseOpStatus(reply.status),
        expirationDate: reply.expires ? `${String(reply.expires)}T00:00:00.000Z` : null,
        autoRenew: parseYesNo(reply.auto_renew),
        transferLock: parseYesNo(reply.locked),
        nameservers,
      };
    } catch {
      return null;
    }
  }

  async renewDomain(providerDomainId: string, periodYears: number): Promise<void> {
    await nameSiloClient.request("renewDomain", {
      domain: providerDomainId.trim().toLowerCase(),
      years: Math.max(1, Math.min(10, periodYears)),
    });
  }

  async updateNameservers(providerDomainId: string, nameservers: string[]): Promise<void> {
    const fqdn = providerDomainId.trim().toLowerCase();
    const payload: Record<string, string | number> = { domain: fqdn };
    nameservers.slice(0, 13).forEach((value, index) => {
      payload[`ns${index + 1}`] = value.trim().toLowerCase();
    });

    await nameSiloClient.request("changeNameServers", payload);
  }

  async setTransferLock(providerDomainId: string, locked: boolean): Promise<void> {
    const operation = locked ? "domainLock" : "domainUnlock";
    await nameSiloClient.request(operation, {
      domain: providerDomainId.trim().toLowerCase(),
    });
  }

  async requestAuthCode(providerDomainId: string): Promise<{ authCode: string }> {
    const fqdn = providerDomainId.trim().toLowerCase();
    const { reply } = await nameSiloClient.request("retrieveAuthCode", { domain: fqdn });

    const authCode =
      String(
        (reply.auth_code as string | undefined) ||
          (reply.auth as string | undefined) ||
          (reply.epp as string | undefined) ||
          "",
      ).trim();

    return {
      authCode: authCode || NAMESILO_AUTH_CODE_SENT_BY_EMAIL,
    };
  }

  async startTransferIn(input: {
    name: string;
    extension: string;
    authCode: string;
    contact: DomainContact;
    idempotencyKey: string;
  }): Promise<DomainProviderJob> {
    const fqdn = `${input.name}.${input.extension}`.toLowerCase();
    const contact = normalizeContact(input.contact);

    const { reply } = await nameSiloClient.request("transferDomain", {
      domain: fqdn,
      auth: input.authCode,
      auto_renew: 1,
      private: 1,
      ...contact,
    });

    return {
      jobId: `namesilo_transfer_${Date.now()}`,
      providerRef: String(reply.domain || fqdn),
      status: "processing",
      fqdn,
      message: String(reply.message || ""),
    };
  }

  async getTransferStatus(providerRef: string): Promise<DomainTransferStatus> {
    const fqdn = providerRef.trim().toLowerCase();

    try {
      const { reply } = await nameSiloClient.request("checkTransferStatus", {
        domain: fqdn,
      });

      return {
        status: normalizeTransferStatus(reply.status),
        detail: String(reply.message || reply.detail || ""),
        providerRef: fqdn,
      };
    } catch {
      return { status: "unknown", providerRef: fqdn };
    }
  }

  async approveTransferOut(providerDomainId: string): Promise<void> {
    // NameSilo opera aprovação de saída principalmente por fluxo de email/registry.
    // Não há endpoint público equivalente nesta API.
    void providerDomainId;
    return;
  }

  async getCapabilities(tld: string): Promise<DomainProviderCapabilities> {
    const normalizedTld = tld.toLowerCase().replace(/^\./, "");
    const overrides = TLD_CAPABILITIES[normalizedTld] || {};
    return {
      ...DEFAULT_CAPABILITIES,
      tld: normalizedTld,
      ...overrides,
    };
  }
}

export const namesiloAdapter: DomainProviderAdapter = new NamesiloAdapter();
