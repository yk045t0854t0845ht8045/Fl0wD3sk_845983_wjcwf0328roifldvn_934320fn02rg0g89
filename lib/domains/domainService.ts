/**
 * lib/domains/domainService.ts
 *
 * Orquestra todas as operações de domínio:
 * - Cotação com markup FlowDesk
 * - Registro assíncrono com idempotência
 * - Listagem e detalhe por usuário
 * - Renovação, lock, nameservers
 * - Audit log automático
 *
 * NUNCA importar este módulo no lado cliente (browser).
 * Usar exclusivamente em API routes do Next.js (server-side).
 */

import crypto from "node:crypto";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { getUSDToBRLRate } from "@/lib/currency";
import { getActiveDomainProvider, getActiveDomainProviderName } from "./provider";
import { NAMESILO_AUTH_CODE_SENT_BY_EMAIL } from "./namesiloAdapter";
import {
  applyDomainMarkup,
  buildDomainRegistrationIdempotencyKey,
  buildDomainTransferIdempotencyKey,
  parseFqdn,
  tldRequiresBrDocument,
  type DomainContact,
  type DomainProviderJob,
  type DomainQuote,
  type DomainRecord,
  type DomainTransferRecord,
} from "./adapter";

// ─── Constantes ───────────────────────────────────────────────────────────────

const DEFAULT_MARKUP_PERCENT = 22.5;
const QUOTE_TTL_MINUTES = 15;
const domainProvider = getActiveDomainProvider();
const domainProviderName = getActiveDomainProviderName();

function assertActiveProviderForDomain(domainProviderNameFromDb: string) {
  if (domainProviderNameFromDb === domainProviderName) return;
  throw new Error(
    `Este dominio esta vinculado ao provedor '${domainProviderNameFromDb}'. A FlowDesk esta configurada para operar com '${domainProviderName}'.`,
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateQuoteId(): string {
  return crypto.randomUUID();
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

// ─── Audit log ────────────────────────────────────────────────────────────────

export async function logDomainEvent(input: {
  domainId?: string | null;
  authUserId?: number | null;
  eventType: string;
  payload?: Record<string, unknown>;
  providerRef?: string | null;
}): Promise<void> {
  try {
    const supabase = getSupabaseAdminClientOrThrow();
    await supabase.from("domain_events").insert({
      domain_id: input.domainId || null,
      auth_user_id: input.authUserId || null,
      event_type: input.eventType,
      payload: input.payload || {},
      provider_ref: input.providerRef || null,
    });
  } catch {
    // Audit log nunca deve quebrar o fluxo principal
    console.warn("[DomainService] Falha ao registrar domain_event:", input.eventType);
  }
}

// ─── Cotação de preço ─────────────────────────────────────────────────────────

export type QuoteDomainInput = {
  authUserId: number;
  fqdn: string;
  operation?: "register" | "renew" | "transfer" | "restore";
  periodYears?: number;
};

export async function quoteDomain(input: QuoteDomainInput): Promise<DomainQuote> {
  const supabase = getSupabaseAdminClientOrThrow();

  const parsed = parseFqdn(input.fqdn);
  if (!parsed) throw new Error("FQDN inválido.");

  const fqdn = `${parsed.sld}.${parsed.tld}`;
  const operation = input.operation || "register";
  const periodYears = input.periodYears || 1;

  // 1. Checar disponibilidade e custo no provedor
  const availability = await domainProvider.checkAvailability(fqdn);

  if (!availability.isAvailable && operation === "register") {
    throw new Error(`O domínio ${fqdn} não está disponível para registro.`);
  }

  // 2. Taxa de câmbio USD → BRL
  const exchangeRateUsdBrl = await getUSDToBRLRate();

  // 3. Custo por período
  const costUsd =
    operation === "restore"
      ? availability.registrationCostUsd * 2      // redemption costuma ser ~2x
      : operation === "renew"
        ? availability.renewalCostUsd * periodYears
        : availability.registrationCostUsd * periodYears;

  // 4. Aplicar markup
  const { subtotalBrl, totalBrl, markupPercent } = applyDomainMarkup({
    costUsd,
    exchangeRateUsdBrl,
    markupPercent: DEFAULT_MARKUP_PERCENT,
  });

  const quoteId = generateQuoteId();
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MINUTES * 60 * 1000).toISOString();

  // 5. Persistir a cotação
  await supabase.from("domain_quotes").insert({
    id: quoteId,
    auth_user_id: input.authUserId,
    fqdn,
    tld: parsed.tld,
    operation,
    period_years: periodYears,
    provider_cost_usd: roundMoney(costUsd),
    exchange_rate_usd_brl: exchangeRateUsdBrl,
    markup_percent: markupPercent,
    subtotal_brl: subtotalBrl,
    total_brl: totalBrl,
    is_premium: availability.isPremium,
    expires_at: expiresAt,
  });

  return {
    id: quoteId,
    fqdn,
    tld: parsed.tld,
    operation,
    periodYears,
    providerCostUsd: roundMoney(costUsd),
    exchangeRateUsdBrl,
    markupPercent,
    subtotalBrl,
    totalBrl,
    isPremium: availability.isPremium,
    expiresAt,
  };
}

// ─── Aceitar cotação ──────────────────────────────────────────────────────────

export async function acceptQuote(input: {
  authUserId: number;
  quoteId: string;
}): Promise<{ quoteId: string; totalBrl: number; expiresAt: string }> {
  const supabase = getSupabaseAdminClientOrThrow();

  const quoteResult = await supabase
    .from("domain_quotes")
    .select("id, total_brl, expires_at, is_accepted")
    .eq("id", input.quoteId)
    .eq("auth_user_id", input.authUserId)
    .single<{ id: string; total_brl: number; expires_at: string; is_accepted: boolean }>();

  if (quoteResult.error || !quoteResult.data) {
    throw new Error("Cotação não encontrada para esta conta.");
  }

  const quote = quoteResult.data;
  if (new Date(quote.expires_at).getTime() <= Date.now()) {
    throw new Error("Cotação expirada. Gere uma nova cotação para continuar.");
  }

  if (quote.is_accepted) {
    return {
      quoteId: quote.id,
      totalBrl: quote.total_brl,
      expiresAt: quote.expires_at,
    };
  }

  const result = await supabase
    .from("domain_quotes")
    .update({ is_accepted: true, accepted_at: new Date().toISOString() })
    .eq("id", input.quoteId)
    .eq("auth_user_id", input.authUserId)
    .eq("is_accepted", false)
    .select("id, total_brl, expires_at")
    .single<{ id: string; total_brl: number; expires_at: string }>();

  if (result.error || !result.data) {
    throw new Error(
      "Cotação não encontrada, já aceita ou expirada. Por favor, gere uma nova cotação.",
    );
  }

  return {
    quoteId: result.data.id,
    totalBrl: result.data.total_brl,
    expiresAt: result.data.expires_at,
  };
}

// ─── Registrar domínio ────────────────────────────────────────────────────────

export type RegisterDomainInput = {
  authUserId: number;
  quoteId: string;
  contact: DomainContact;
  paymentOrderId?: number | null;
};

export async function registerDomain(input: RegisterDomainInput): Promise<DomainRecord> {
  const supabase = getSupabaseAdminClientOrThrow();

  // 1. Buscar a cotação aceita
  const quoteResult = await supabase
    .from("domain_quotes")
    .select("*")
    .eq("id", input.quoteId)
    .eq("auth_user_id", input.authUserId)
    .eq("is_accepted", true)
    .eq("operation", "register")
    .gt("expires_at", new Date().toISOString())
    .single<{
      id: string; fqdn: string; tld: string; period_years: number;
      total_brl: number; provider_cost_usd: number;
      exchange_rate_usd_brl: number; markup_percent: number;
    }>();

  if (quoteResult.error || !quoteResult.data) {
    throw new Error("Cotação não encontrada ou expirada. Gere uma nova cotação para prosseguir.");
  }

  const quote = quoteResult.data;
  const parsed = parseFqdn(quote.fqdn);
  if (!parsed) throw new Error("FQDN inválido na cotação.");

  if (tldRequiresBrDocument(parsed.tld)) {
    const documentDigits = (input.contact.documentNumber || "").replace(/\D/g, "");
    if (input.contact.documentType === "none" || documentDigits.length < 11) {
      throw new Error("Este TLD exige CPF/CNPJ válido do titular para registro.");
    }
  }

  // 2. Idempotência — evitar dupla compra
  const idempotencyKey = buildDomainRegistrationIdempotencyKey({
    userId: input.authUserId,
    fqdn: quote.fqdn,
    quoteId: quote.id,
  });

  const existingResult = await supabase
    .from("domains")
    .select("id, status, fqdn")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle<{ id: string; status: string; fqdn: string }>();

  if (existingResult.data) {
    // Já existe uma tentativa para esta cotação — retornar sem duplicar
    const existing = existingResult.data;
    const domainResult = await supabase
      .from("domains")
      .select("*")
      .eq("id", existing.id)
      .single<DomainDbRow>();

    if (domainResult.data) return mapDbRowToDomainRecord(domainResult.data);
  }

  // 3. Criar/salvar contato do titular
  let contactId: string | null = null;
  const rawDocument = (input.contact.documentNumber || "").trim();
  const normalizedDocument =
    input.contact.documentType === "passport"
      ? rawDocument.toUpperCase().replace(/[^A-Z0-9]/g, "")
      : rawDocument.replace(/\D/g, "");

  try {
    const contactResult = await supabase
      .from("domain_contacts")
      .insert({
        auth_user_id: input.authUserId,
        full_name: input.contact.fullName,
        email: input.contact.email,
        phone: input.contact.phone,
        street: input.contact.street,
        city: input.contact.city,
        state: input.contact.state,
        postal_code: input.contact.postalCode,
        country: input.contact.country || "BR",
        document_type: input.contact.documentType,
        document_hash: normalizedDocument
          ? crypto
              .createHash("sha256")
              .update(normalizedDocument)
              .digest("hex")
          : null,
        document_last4: normalizedDocument
          ? normalizedDocument.slice(-4)
          : null,
        provider: domainProviderName,
      })
      .select("id")
      .single<{ id: string }>();

    contactId = contactResult.data?.id || null;
  } catch {
    // contato não crítico para o fluxo de registro
  }

  // 4. Criar registro de domínio em status "payment_pending"
  const domainInsertResult = await supabase
    .from("domains")
    .insert({
      auth_user_id: input.authUserId,
      fqdn: quote.fqdn,
      sld: parsed.sld,
      tld: parsed.tld,
      provider: domainProviderName,
      registrant_contact_id: contactId,
      status: input.paymentOrderId ? "registration_requested" : "payment_pending",
      domain_type: "pending",
      registration_period: quote.period_years,
      auto_renew: true,
      transfer_lock: true,
      flowdesk_managed_dns: false,
      purchase_price_brl: quote.total_brl,
      renewal_price_brl: quote.total_brl,
      provider_cost_usd: quote.provider_cost_usd,
      markup_percent: quote.markup_percent,
      payment_order_id: input.paymentOrderId || null,
      idempotency_key: idempotencyKey,
    })
    .select("*")
    .single<DomainDbRow>();

  if (domainInsertResult.error || !domainInsertResult.data) {
    throw new Error(
      domainInsertResult.error?.message ||
        "Falha ao criar registro do domínio.",
    );
  }

  const domain = domainInsertResult.data;

  await logDomainEvent({
    domainId: domain.id,
    authUserId: input.authUserId,
    eventType: "registration_initiated",
    payload: {
      fqdn: quote.fqdn,
      quoteId: quote.id,
      totalBrl: quote.total_brl,
      paymentOrderId: input.paymentOrderId || null,
    },
  });

  // 5. Se pagamento já aprovado, disparar registro no provedor
  if (input.paymentOrderId) {
    await dispatchDomainRegistration({
      domain: mapDbRowToDomainRecord(domain),
      contact: input.contact,
      quote,
    });
  }

  return mapDbRowToDomainRecord(domain);
}

// ─── Despachar registro para o provedor ──────────────────────────────────────

type DispatchInput = {
  domain: DomainRecord;
  contact: DomainContact;
  quote: { fqdn: string; period_years: number };
};

export async function dispatchDomainRegistration(input: DispatchInput): Promise<void> {
  const supabase = getSupabaseAdminClientOrThrow();
  const parsed = parseFqdn(input.domain.fqdn);
  if (!parsed) return;

  try {
    const job: DomainProviderJob = await domainProvider.registerDomain({
      name: parsed.sld,
      extension: parsed.tld,
      periodYears: input.quote.period_years,
      autoRenew: input.domain.autoRenew,
      contact: input.contact,
      idempotencyKey: input.domain.idempotencyKey || input.domain.id,
    });

    await supabase
      .from("domains")
      .update({
        status: "registration_pending",
        provider_domain_id: job.providerRef || null,
        domain_type: "registered",
      })
      .eq("id", input.domain.id);

    await logDomainEvent({
      domainId: input.domain.id,
      authUserId: input.domain.authUserId,
      eventType: "registration_submitted",
      payload: { jobId: job.jobId, providerRef: job.providerRef },
      providerRef: job.providerRef || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await supabase
      .from("domains")
      .update({ status: "failed" })
      .eq("id", input.domain.id);

    await logDomainEvent({
      domainId: input.domain.id,
      authUserId: input.domain.authUserId,
      eventType: "registration_failed",
      payload: { error: message },
    });

    throw new Error(`Falha ao registrar domínio: ${message}`);
  }
}

// ─── Listar domínios do usuário ───────────────────────────────────────────────

export async function listUserDomains(authUserId: number): Promise<DomainRecord[]> {
  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase
    .from("domains")
    .select("*")
    .eq("auth_user_id", authUserId)
    .order("created_at", { ascending: false });

  if (result.error) throw new Error(result.error.message);

  return (result.data || []).map(mapDbRowToDomainRecord);
}

// ─── Detalhe de um domínio ────────────────────────────────────────────────────

export async function getUserDomain(
  authUserId: number,
  domainId: string,
): Promise<DomainRecord | null> {
  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase
    .from("domains")
    .select("*")
    .eq("id", domainId)
    .eq("auth_user_id", authUserId)
    .maybeSingle<DomainDbRow>();

  if (result.error) throw new Error(result.error.message);
  if (!result.data) return null;

  return mapDbRowToDomainRecord(result.data);
}

// ─── Auto-renovação ───────────────────────────────────────────────────────────

export async function setDomainAutoRenew(input: {
  authUserId: number;
  domainId: string;
  autoRenew: boolean;
}): Promise<void> {
  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase
    .from("domains")
    .update({ auto_renew: input.autoRenew })
    .eq("id", input.domainId)
    .eq("auth_user_id", input.authUserId)
    .eq("status", "active")
    .select("id, fqdn")
    .single<{ id: string; fqdn: string }>();

  if (result.error || !result.data) {
    throw new Error("Domínio não encontrado ou não pode ser modificado.");
  }

  await logDomainEvent({
    domainId: input.domainId,
    authUserId: input.authUserId,
    eventType: "auto_renew_toggled",
    payload: { autoRenew: input.autoRenew },
  });
}

// ─── Nameservers ──────────────────────────────────────────────────────────────

export async function updateDomainNameservers(input: {
  authUserId: number;
  domainId: string;
  nameservers: string[];
}): Promise<void> {
  if (input.nameservers.length < 2) {
    throw new Error("Informe pelo menos 2 nameservers.");
  }

  const supabase = getSupabaseAdminClientOrThrow();

  const domainResult = await supabase
    .from("domains")
    .select("id, fqdn, provider_domain_id, status, provider")
    .eq("id", input.domainId)
    .eq("auth_user_id", input.authUserId)
    .single<{ id: string; fqdn: string; provider_domain_id: string | null; status: string; provider: string }>();

  if (domainResult.error || !domainResult.data) {
    throw new Error("Domínio não encontrado.");
  }

  const domain = domainResult.data;
  assertActiveProviderForDomain(domain.provider);

  if (domain.provider_domain_id) {
    await domainProvider.updateNameservers(
      domain.provider_domain_id,
      input.nameservers,
    );
  }

  await supabase
    .from("domains")
    .update({ nameservers: input.nameservers })
    .eq("id", input.domainId);

  await logDomainEvent({
    domainId: input.domainId,
    authUserId: input.authUserId,
    eventType: "nameservers_updated",
    payload: { nameservers: input.nameservers },
  });
}

// ─── Transfer lock ────────────────────────────────────────────────────────────

export async function setDomainTransferLock(input: {
  authUserId: number;
  domainId: string;
  locked: boolean;
}): Promise<void> {
  const supabase = getSupabaseAdminClientOrThrow();

  const domainResult = await supabase
    .from("domains")
    .select("id, fqdn, provider_domain_id, status, provider")
    .eq("id", input.domainId)
    .eq("auth_user_id", input.authUserId)
    .single<{ id: string; fqdn: string; provider_domain_id: string | null; status: string; provider: string }>();

  if (domainResult.error || !domainResult.data) {
    throw new Error("Domínio não encontrado.");
  }

  const domain = domainResult.data;
  assertActiveProviderForDomain(domain.provider);

  if (domain.provider_domain_id) {
    await domainProvider.setTransferLock(domain.provider_domain_id, input.locked);
  }

  await supabase
    .from("domains")
    .update({ transfer_lock: input.locked })
    .eq("id", input.domainId);

  await logDomainEvent({
    domainId: input.domainId,
    authUserId: input.authUserId,
    eventType: "transfer_lock_toggled",
    payload: { locked: input.locked },
  });
}

// ─── Auth Code ────────────────────────────────────────────────────────────────
// CRÍTICO: auth code NÃO é persistido em texto puro.
// Exibir ao usuário uma única vez; persistir apenas o hash SHA-256.

export async function requestDomainAuthCode(input: {
  authUserId: number;
  domainId: string;
}): Promise<{ authCode: string }> {
  const supabase = getSupabaseAdminClientOrThrow();

  const domainResult = await supabase
    .from("domains")
    .select("id, fqdn, provider_domain_id, status, transfer_lock, provider")
    .eq("id", input.domainId)
    .eq("auth_user_id", input.authUserId)
    .single<{ id: string; fqdn: string; provider_domain_id: string | null; status: string; transfer_lock: boolean; provider: string }>();

  if (domainResult.error || !domainResult.data) {
    throw new Error("Domínio não encontrado.");
  }

  const domain = domainResult.data;
  assertActiveProviderForDomain(domain.provider);

  if (domain.status !== "active") {
    throw new Error("Apenas domínios ativos podem ter Auth Code solicitado.");
  }

  if (domain.transfer_lock) {
    throw new Error(
      "O domínio está com bloqueio de transferência ativo. Desative-o antes de solicitar o Auth Code.",
    );
  }

  if (!domain.provider_domain_id) {
    throw new Error("Domínio ainda não sincronizado com o provedor.");
  }

  const { authCode } = await domainProvider.requestAuthCode(domain.provider_domain_id);

  if (authCode === NAMESILO_AUTH_CODE_SENT_BY_EMAIL) {
    await supabase.from("domain_events").insert({
      domain_id: input.domainId,
      auth_user_id: input.authUserId,
      event_type: "auth_code_requested",
      payload: {
        delivery: "email",
        requestedAt: new Date().toISOString(),
      },
    });

    return { authCode };
  }

  // Persistir apenas hash — nunca o código completo
  const authCodeHash = crypto
    .createHash("sha256")
    .update(authCode)
    .digest("hex");

  await supabase
    .from("domain_events")
    .insert({
      domain_id: input.domainId,
      auth_user_id: input.authUserId,
      event_type: "auth_code_requested",
      payload: { authCodeHash, requestedAt: new Date().toISOString() },
    });

  return { authCode };
}

// ─── Eventos de domínio ───────────────────────────────────────────────────────

export type DomainEventRecord = {
  id: string;
  domainId: string | null;
  authUserId: number | null;
  eventType: string;
  payload: Record<string, unknown>;
  providerRef: string | null;
  createdAt: string;
};

export async function listDomainEvents(input: {
  authUserId: number;
  domainId: string;
  limit?: number;
}): Promise<DomainEventRecord[]> {
  const supabase = getSupabaseAdminClientOrThrow();
  const limit = Math.max(1, Math.min(200, input.limit ?? 50));

  const ownedDomainResult = await supabase
    .from("domains")
    .select("id")
    .eq("id", input.domainId)
    .eq("auth_user_id", input.authUserId)
    .single<{ id: string }>();

  if (ownedDomainResult.error || !ownedDomainResult.data) {
    throw new Error("Domínio não encontrado.");
  }

  const eventsResult = await supabase
    .from("domain_events")
    .select("id, domain_id, auth_user_id, event_type, payload, provider_ref, created_at")
    .eq("domain_id", input.domainId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (eventsResult.error) {
    throw new Error(eventsResult.error.message);
  }

  return (eventsResult.data || []).map((row) => ({
    id: String(row.id),
    domainId: (row.domain_id as string | null) ?? null,
    authUserId: (row.auth_user_id as number | null) ?? null,
    eventType: String(row.event_type || "unknown"),
    payload: (row.payload || {}) as Record<string, unknown>,
    providerRef: (row.provider_ref as string | null) ?? null,
    createdAt: String(row.created_at),
  }));
}

// ─── Transferências de domínio ───────────────────────────────────────────────

export type StartTransferInInput = {
  authUserId: number;
  fqdn: string;
  authCode: string;
  contact: DomainContact;
  quoteId?: string | null;
  paymentOrderId?: number | null;
};

type DomainTransferDbRow = {
  id: string;
  domain_id: string | null;
  auth_user_id: number;
  fqdn: string;
  direction: "in" | "out";
  status: string;
  provider_ref: string | null;
  quote_id: string | null;
  payment_order_id: number | null;
  error_message: string | null;
  initiated_at: string;
  completed_at: string | null;
  updated_at: string;
};

function mapDbRowToDomainTransferRecord(row: DomainTransferDbRow): DomainTransferRecord {
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    domainId: row.domain_id,
    fqdn: row.fqdn,
    direction: row.direction,
    status: row.status as DomainTransferRecord["status"],
    providerRef: row.provider_ref,
    quoteId: row.quote_id,
    paymentOrderId: row.payment_order_id,
    errorMessage: row.error_message,
    initiatedAt: row.initiated_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

export async function listUserDomainTransfers(input: {
  authUserId: number;
  direction?: "in" | "out";
}): Promise<DomainTransferRecord[]> {
  const supabase = getSupabaseAdminClientOrThrow();

  let query = supabase
    .from("domain_transfers")
    .select("*")
    .eq("auth_user_id", input.authUserId)
    .order("initiated_at", { ascending: false });

  if (input.direction) {
    query = query.eq("direction", input.direction);
  }

  const result = await query;
  if (result.error) {
    throw new Error(result.error.message);
  }

  return (result.data || []).map((row) =>
    mapDbRowToDomainTransferRecord(row as DomainTransferDbRow),
  );
}

export async function startDomainTransferIn(
  input: StartTransferInInput,
): Promise<DomainTransferRecord> {
  const supabase = getSupabaseAdminClientOrThrow();
  const parsed = parseFqdn(input.fqdn);
  if (!parsed) {
    throw new Error("Informe um domínio válido para transferência.");
  }

  const fqdn = `${parsed.sld}.${parsed.tld}`.toLowerCase();
  const authCode = String(input.authCode || "").trim();
  if (authCode.length < 4) {
    throw new Error("Auth Code inválido.");
  }

  if (tldRequiresBrDocument(parsed.tld)) {
    const documentDigits = (input.contact.documentNumber || "").replace(/\D/g, "");
    if (input.contact.documentType === "none" || documentDigits.length < 11) {
      throw new Error("Este TLD exige CPF/CNPJ válido do titular.");
    }
  }

  const capabilities = await domainProvider.getCapabilities(parsed.tld);
  if (!capabilities.transferIn) {
    throw new Error(`Transferência de entrada não suportada para .${parsed.tld}.`);
  }

  if (input.quoteId) {
    const quoteResult = await supabase
      .from("domain_quotes")
      .select("id, expires_at, is_accepted, operation, fqdn")
      .eq("id", input.quoteId)
      .eq("auth_user_id", input.authUserId)
      .single<{
        id: string;
        expires_at: string;
        is_accepted: boolean;
        operation: "register" | "renew" | "transfer" | "restore";
        fqdn: string;
      }>();

    if (quoteResult.error || !quoteResult.data) {
      throw new Error("Cotação de transferência não encontrada.");
    }

    if (quoteResult.data.operation !== "transfer") {
      throw new Error("A cotação informada não é do tipo transferência.");
    }

    if (!quoteResult.data.is_accepted) {
      throw new Error("Aceite a cotação de transferência antes de continuar.");
    }

    if (new Date(quoteResult.data.expires_at).getTime() <= Date.now()) {
      throw new Error("Cotação expirada. Gere uma nova cotação.");
    }
  }

  const idempotencyKey = buildDomainTransferIdempotencyKey({
    userId: input.authUserId,
    fqdn,
    direction: "in",
    quoteId: input.quoteId || undefined,
  });

  const existingResult = await supabase
    .from("domain_transfers")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle<DomainTransferDbRow>();

  if (existingResult.data) {
    return mapDbRowToDomainTransferRecord(existingResult.data);
  }

  const linkedDomainResult = await supabase
    .from("domains")
    .select("id")
    .eq("auth_user_id", input.authUserId)
    .eq("fqdn", fqdn)
    .maybeSingle<{ id: string }>();

  const authCodeHash = crypto.createHash("sha256").update(authCode).digest("hex");

  const insertResult = await supabase
    .from("domain_transfers")
    .insert({
      domain_id: linkedDomainResult.data?.id || null,
      auth_user_id: input.authUserId,
      fqdn,
      direction: "in",
      status: input.paymentOrderId ? "initiated" : "waiting_payment",
      auth_code_hash: authCodeHash,
      quote_id: input.quoteId || null,
      payment_order_id: input.paymentOrderId || null,
      idempotency_key: idempotencyKey,
    })
    .select("*")
    .single<DomainTransferDbRow>();

  if (insertResult.error || !insertResult.data) {
    throw new Error(insertResult.error?.message || "Falha ao iniciar transferência.");
  }

  const transferId = insertResult.data.id;
  let transferRow = insertResult.data;

  await logDomainEvent({
    domainId: linkedDomainResult.data?.id || null,
    authUserId: input.authUserId,
    eventType: "transfer_in_started",
    payload: {
      transferId,
      fqdn,
      waitingPayment: !input.paymentOrderId,
    },
  });

  if (!input.paymentOrderId) {
    return mapDbRowToDomainTransferRecord(transferRow);
  }

  try {
    const providerJob = await domainProvider.startTransferIn({
      name: parsed.sld,
      extension: parsed.tld,
      authCode,
      contact: input.contact,
      idempotencyKey,
    });

    const updateResult = await supabase
      .from("domain_transfers")
      .update({
        status: "submitted_to_provider",
        provider_ref: providerJob.providerRef || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", transferId)
      .select("*")
      .single<DomainTransferDbRow>();

    if (updateResult.error || !updateResult.data) {
      throw new Error(updateResult.error?.message || "Falha ao atualizar transferência.");
    }

    transferRow = updateResult.data;

    await logDomainEvent({
      domainId: linkedDomainResult.data?.id || null,
      authUserId: input.authUserId,
      eventType: "transfer_in_submitted",
      payload: {
        transferId,
        providerRef: providerJob.providerRef,
      },
      providerRef: providerJob.providerRef || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao enviar transferência.";
    await supabase
      .from("domain_transfers")
      .update({
        status: "failed",
        error_message: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", transferId);

    await logDomainEvent({
      domainId: linkedDomainResult.data?.id || null,
      authUserId: input.authUserId,
      eventType: "transfer_in_failed",
      payload: {
        transferId,
        error: message,
      },
    });

    throw new Error(message);
  }

  return mapDbRowToDomainTransferRecord(transferRow);
}

// ─── Sincronização com provedor ───────────────────────────────────────────────

export async function syncDomainFromProvider(domainId: string): Promise<void> {
  const supabase = getSupabaseAdminClientOrThrow();

  const domainResult = await supabase
    .from("domains")
    .select("id, auth_user_id, provider_domain_id, fqdn, provider")
    .eq("id", domainId)
    .single<{ id: string; auth_user_id: number; provider_domain_id: string | null; fqdn: string; provider: string }>();

  if (domainResult.error || !domainResult.data || !domainResult.data.provider_domain_id) {
    return;
  }

  const domain = domainResult.data;
  assertActiveProviderForDomain(domain.provider);
  const providerDomainId = domain.provider_domain_id;
  if (!providerDomainId) return;
  const providerDetail = await domainProvider.getDomain(providerDomainId);

  if (!providerDetail) return;

  await supabase
    .from("domains")
    .update({
      status: providerDetail.status,
      expiration_date: providerDetail.expirationDate || null,
      auto_renew: providerDetail.autoRenew ?? undefined,
      transfer_lock: providerDetail.transferLock ?? undefined,
      nameservers: providerDetail.nameservers || undefined,
      last_synced_at: new Date().toISOString(),
      domain_type: providerDetail.status === "active" ? "registered" : undefined,
    })
    .eq("id", domainId);

  await logDomainEvent({
    domainId,
    authUserId: domain.auth_user_id,
    eventType: "sync_completed",
    payload: { status: providerDetail.status, expirationDate: providerDetail.expirationDate },
  });
}

// ─── Mapeamento DB → tipo canônico ────────────────────────────────────────────

type DomainDbRow = {
  id: string;
  auth_user_id: number;
  fqdn: string;
  sld: string;
  tld: string;
  provider: string;
  provider_domain_id: string | null;
  registrant_contact_id: string | null;
  status: string;
  domain_type: string;
  registration_period: number;
  auto_renew: boolean;
  transfer_lock: boolean;
  privacy_enabled: boolean;
  dnssec_enabled: boolean;
  registered_at: string | null;
  expiration_date: string | null;
  nameservers: string[] | null;
  flowdesk_managed_dns: boolean;
  current_dns_provider: string | null;
  purchase_price_brl: number | null;
  renewal_price_brl: number | null;
  provider_cost_usd: number | null;
  markup_percent: number;
  payment_order_id: number | null;
  idempotency_key: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapDbRowToDomainRecord(row: DomainDbRow): DomainRecord {
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    fqdn: row.fqdn,
    sld: row.sld,
    tld: row.tld,
    provider: row.provider,
    providerDomainId: row.provider_domain_id,
    registrantContactId: row.registrant_contact_id,
    status: row.status as DomainRecord["status"],
    domainType: row.domain_type as DomainRecord["domainType"],
    registrationPeriodYears: row.registration_period,
    autoRenew: row.auto_renew,
    transferLock: row.transfer_lock,
    privacyEnabled: row.privacy_enabled,
    dnssecEnabled: row.dnssec_enabled,
    registeredAt: row.registered_at,
    expirationDate: row.expiration_date,
    nameservers: row.nameservers,
    flowdeskManagedDns: row.flowdesk_managed_dns,
    currentDnsProvider: row.current_dns_provider,
    purchasePriceBrl: row.purchase_price_brl,
    renewalPriceBrl: row.renewal_price_brl,
    providerCostUsd: row.provider_cost_usd,
    markupPercent: row.markup_percent,
    paymentOrderId: row.payment_order_id,
    idempotencyKey: row.idempotency_key,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
