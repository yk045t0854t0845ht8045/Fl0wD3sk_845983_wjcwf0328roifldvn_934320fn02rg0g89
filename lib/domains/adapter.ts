// ─── Tipos Canônicos ──────────────────────────────────────────────────────────
// Estes tipos são independentes de provedor. O adapter normaliza a resposta
// da registradora ativa (ou qualquer outro futuro provedor) para esses formatos.

export type DomainStatus =
  | "draft"
  | "quote_created"
  | "payment_pending"
  | "registration_requested"
  | "registration_pending"
  | "active"
  | "action_required"
  | "suspended"
  | "client_hold"
  | "server_hold"
  | "expired"
  | "redemption"
  | "pending_delete"
  | "transfer_in_pending"
  | "transfer_out_pending"
  | "failed"
  | "cancelled";

export type DomainType = "registered" | "transferred" | "external" | "pending";

export type DomainContact = {
  fullName: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  documentType: "cpf" | "cnpj" | "passport" | "none";
  /** Apenas para transmissão ao provedor — nunca persistir em texto puro no DB */
  documentNumber?: string | null;
};

/** Modelo canônico de domínio dentro da FlowDesk (independente de provedor) */
export type DomainRecord = {
  id: string;
  authUserId: number;
  fqdn: string;
  sld: string;
  tld: string;
  provider: string;
  providerDomainId?: string | null;
  registrantContactId?: string | null;
  status: DomainStatus;
  domainType: DomainType;
  registrationPeriodYears: number;
  autoRenew: boolean;
  transferLock: boolean;
  privacyEnabled: boolean;
  dnssecEnabled: boolean;
  registeredAt?: string | null;
  expirationDate?: string | null;
  nameservers?: string[] | null;
  flowdeskManagedDns: boolean;
  currentDnsProvider?: string | null;
  purchasePriceBrl?: number | null;
  renewalPriceBrl?: number | null;
  providerCostUsd?: number | null;
  markupPercent: number;
  paymentOrderId?: number | null;
  idempotencyKey?: string | null;
  lastSyncedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DomainTransferStatusValue =
  | "initiated"
  | "waiting_auth_code"
  | "waiting_unlock"
  | "waiting_payment"
  | "submitted_to_provider"
  | "waiting_previous_registrar"
  | "action_required"
  | "completed"
  | "failed"
  | "cancelled";

export type DomainTransferRecord = {
  id: string;
  authUserId: number;
  domainId?: string | null;
  fqdn: string;
  direction: "in" | "out";
  status: DomainTransferStatusValue;
  providerRef?: string | null;
  quoteId?: string | null;
  paymentOrderId?: number | null;
  errorMessage?: string | null;
  initiatedAt: string;
  completedAt?: string | null;
  updatedAt: string;
};

/** Resultado de disponibilidade de um domínio */
export type DomainAvailabilityResult = {
  fqdn: string;
  sld: string;
  tld: string;
  isAvailable: boolean;
  isPremium: boolean;
  /** Preço de registro em USD (custo do provedor) */
  registrationCostUsd: number;
  /** Preço de renovação anual em USD (custo do provedor) */
  renewalCostUsd: number;
  currency: string;
  reason?: string | null;
};

/** Cotação de preço com markup FlowDesk em BRL */
export type DomainQuote = {
  id: string;
  fqdn: string;
  tld: string;
  operation: "register" | "renew" | "transfer" | "restore";
  periodYears: number;
  providerCostUsd: number;
  exchangeRateUsdBrl: number;
  markupPercent: number;
  subtotalBrl: number;
  totalBrl: number;
  isPremium: boolean;
  expiresAt: string;
};

/** Job assíncrono de registro/transferência */
export type DomainProviderJob = {
  jobId: string;
  providerRef?: string | null;
  status: "pending" | "processing" | "completed" | "failed";
  fqdn: string;
  message?: string | null;
};

/** Detalhe do domínio conforme retornado pelo provedor */
export type ProviderDomainDetail = {
  providerDomainId: string;
  fqdn: string;
  status: string;
  expirationDate?: string | null;
  autoRenew?: boolean | null;
  transferLock?: boolean | null;
  nameservers?: string[] | null;
};

/** Status de uma transferência */
export type DomainTransferStatus = {
  status: string;
  detail?: string | null;
  providerRef?: string | null;
};

// ─── Interface DomainProviderAdapter ─────────────────────────────────────────
// Cada provedor de registro implementa esta interface.
// A FlowDesk nunca chama APIs de registrador diretamente do frontend —
// toda lógica passa por este adapter no servidor.

export interface DomainProviderAdapter {
  /**
   * Verifica disponibilidade e preço de custo de um domínio.
   * Não aplica markup — retorna custo bruto do provedor.
   */
  checkAvailability(fqdn: string): Promise<DomainAvailabilityResult>;

  /**
   * Verifica disponibilidade de múltiplos domínios em lote.
   */
  checkAvailabilityBatch(
    fqdns: string[],
  ): Promise<DomainAvailabilityResult[]>;

  /**
   * Registra um domínio no provedor de forma idempotente.
   * Retorna um job para acompanhamento assíncrono.
   */
  registerDomain(input: {
    name: string;
    extension: string;
    periodYears: number;
    autoRenew: boolean;
    contact: DomainContact;
    idempotencyKey: string;
  }): Promise<DomainProviderJob>;

  /**
   * Consulta o status atual de um domínio no provedor.
   */
  getDomain(providerDomainId: string): Promise<ProviderDomainDetail | null>;

  /**
   * Renova o domínio por um período adicional.
   */
  renewDomain(providerDomainId: string, periodYears: number): Promise<void>;

  /**
   * Atualiza os nameservers do domínio.
   */
  updateNameservers(
    providerDomainId: string,
    nameservers: string[],
  ): Promise<void>;

  /**
   * Ativa ou desativa o bloqueio de transferência.
   */
  setTransferLock(providerDomainId: string, locked: boolean): Promise<void>;

  /**
   * Solicita o AuthCode/EPP Code para transferência de saída.
   * CRÍTICO: o auth code deve ser exibido ao usuário e descartado — nunca
   * persistido em texto puro no banco de dados.
   */
  requestAuthCode(providerDomainId: string): Promise<{ authCode: string }>;

  /**
   * Inicia uma transferência de entrada (de outro registrador para FlowDesk).
   */
  startTransferIn(input: {
    name: string;
    extension: string;
    authCode: string;
    contact: DomainContact;
    idempotencyKey: string;
  }): Promise<DomainProviderJob>;

  /**
   * Consulta o status de uma transferência em andamento.
   */
  getTransferStatus(providerRef: string): Promise<DomainTransferStatus>;

  /**
   * Aprova uma transferência de saída quando solicitado pelo registry.
   */
  approveTransferOut(providerDomainId: string): Promise<void>;

  /**
   * Retorna as capacidades suportadas por este provedor para um TLD específico.
   */
  getCapabilities(tld: string): Promise<DomainProviderCapabilities>;
}

/** Capacidades do provedor por TLD */
export type DomainProviderCapabilities = {
  tld: string;
  register: boolean;
  transferIn: boolean;
  transferOut: boolean;
  renew: boolean;
  restore: boolean;
  privacy: boolean;
  dnssec: boolean;
  nameserverUpdate: boolean;
  contactUpdate: boolean;
  authCodeRequest: boolean;
  isPremiumDomainPossible: boolean;
  requiresDocument: boolean;          // ex: CPF/CNPJ para .br
  requiresLocalPresence: boolean;     // ex: alguns ccTLDs
  supportsSandbox: boolean;
  billingCycleDays: number;           // 365 para anuais, 30 para mensais, etc.
  billingLabel: string;               // "por ano", "por mês"
  notes?: string | null;
};

// ─── Helpers de preço ─────────────────────────────────────────────────────────

/** Aplica markup FlowDesk (padrão 22.5%) e converte USD → BRL */
export function applyDomainMarkup(input: {
  costUsd: number;
  exchangeRateUsdBrl: number;
  markupPercent?: number;
}): {
  subtotalBrl: number;
  totalBrl: number;
  markupPercent: number;
} {
  const markupPercent = input.markupPercent ?? 22.5;
  const subtotalBrl = roundMoney(input.costUsd * input.exchangeRateUsdBrl);
  const markup = roundMoney(subtotalBrl * (markupPercent / 100));
  const totalBrl = roundMoney(subtotalBrl + markup);

  return { subtotalBrl, totalBrl, markupPercent };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Formata um preço em BRL para exibição */
export function formatDomainPriceBrl(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Separa SLD e TLD de um FQDN */
export function parseFqdn(fqdn: string): { sld: string; tld: string } | null {
  const normalized = fqdn.trim().toLowerCase().replace(/^www\./, "");
  if (!normalized) return null;

  const parts = normalized.split(".").filter(Boolean);
  if (parts.length < 2) return null;

  return {
    sld: parts[0],
    tld: parts.slice(1).join("."),
  };
}

/** Gera a chave de idempotência para compra de domínio */
export function buildDomainRegistrationIdempotencyKey(input: {
  userId: number | string;
  fqdn: string;
  quoteId: string;
}): string {
  return `domain_register:${input.userId}:${input.fqdn.toLowerCase()}:${input.quoteId}`;
}

/** Gera a chave de idempotência para transferência */
export function buildDomainTransferIdempotencyKey(input: {
  userId: number | string;
  fqdn: string;
  direction: "in" | "out";
  quoteId?: string;
}): string {
  const suffix = input.quoteId ? `:${input.quoteId}` : "";
  return `domain_transfer_${input.direction}:${input.userId}:${input.fqdn.toLowerCase()}${suffix}`;
}

/** Lista de TLDs que requerem CPF/CNPJ (documentos brasileiros) */
export const TLD_REQUIRES_BR_DOCUMENT = new Set([
  "com.br",
  "net.br",
  "org.br",
  "gov.br",
  "edu.br",
  "mil.br",
  "ind.br",
  "arq.br",
  "art.br",
  "ato.br",
  "bio.br",
  "bmd.br",
  "cim.br",
  "cng.br",
  "cnt.br",
  "ecn.br",
  "eco.br",
  "eng.br",
  "esp.br",
  "etc.br",
  "eti.br",
  "far.br",
  "flog.br",
  "fnd.br",
  "fot.br",
  "fst.br",
  "g12.br",
  "geo.br",
  "ggf.br",
  "imb.br",
  "inf.br",
  "jor.br",
  "jus.br",
  "leg.br",
  "lel.br",
  "log.br",
  "mat.br",
  "med.br",
  "mp.br",
  "mus.br",
  "not.br",
  "ntr.br",
  "odo.br",
  "ppg.br",
  "pro.br",
  "psc.br",
  "pub.br",
  "qsl.br",
  "radio.br",
  "rec.br",
  "recife.br",
  "slg.br",
  "srv.br",
  "taxi.br",
  "teo.br",
  "tmp.br",
  "trd.br",
  "tur.br",
  "tv.br",
  "vet.br",
  "vlog.br",
  "wiki.br",
  "zlg.br",
]);

export function tldRequiresBrDocument(tld: string): boolean {
  return TLD_REQUIRES_BR_DOCUMENT.has(tld.toLowerCase().replace(/^\./, ""));
}
