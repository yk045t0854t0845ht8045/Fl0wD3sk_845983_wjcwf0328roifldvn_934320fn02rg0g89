"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  BadgeDollarSign,
  Check,
  ChevronDown,
  CreditCard,
  Landmark,
  ListFilter,
  Pencil,
  Power,
  Receipt,
  Search,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import { useNotifications } from "@/components/notifications/NotificationsProvider";
import {
  ServerButton,
  ServerDiscordRelinkState,
  ServerEmptyState,
  ServerSectionHeading,
  ServerSurface,
  ServerTextInput,
  cn,
} from "@/components/servers/ServerUi";
import { useBodyScrollLock } from "@/lib/ui/useBodyScrollLock";

type PaymentMethodKey =
  | "mercado_pago"
  | "flowpay"
  | "card"
  | "boleto"
  | "paypal"
  | "nupay";

type PaymentMethod = {
  methodKey: PaymentMethodKey;
  title: string;
  description: string;
  logoLabel: string;
  provider: string;
  paymentRail: "pix" | "card" | "boleto" | "wallet" | "";
  status: "active" | "disabled";
  canActivate: boolean;
  credentialsConfigured: boolean;
  environment: "production" | "test";
  lastHealthStatus: "unchecked" | "ok" | "failed";
  lastHealthError: string;
  updatedAt: string | null;
};

type MethodsResponse = {
  ok: boolean;
  code?: string;
  reauthRequired?: boolean;
  message?: string;
  detail?: string;
  methods?: PaymentMethod[];
};

type SalesPaymentMethodsPanelProps = {
  guildId: string;
  readOnly?: boolean;
};

const methodIcon: Record<PaymentMethodKey, typeof WalletCards> = {
  mercado_pago: BadgeDollarSign,
  flowpay: WalletCards,
  card: CreditCard,
  boleto: Receipt,
  paypal: Landmark,
  nupay: ShieldCheck,
};

const methodAccent: Record<PaymentMethodKey, string> = {
  mercado_pago: "border-[#17465E] bg-[#07131A] text-[#8FDBFF]",
  flowpay: "border-[#343434] bg-[#111] text-[#E8E8E8]",
  card: "border-[#3A2B52] bg-[#110D18] text-[#CDB8FF]",
  boleto: "border-[#3D341D] bg-[#151207] text-[#E8D18A]",
  paypal: "border-[#17365A] bg-[#081120] text-[#9CC6FF]",
  nupay: "border-[#3A2040] bg-[#130A16] text-[#E8B3F2]",
};

const methodLogoSrc: Partial<Record<PaymentMethodKey, string>> = {
  mercado_pago: "/cdn/payment-methods/mercado_pago.png",
  card: "/cdn/payment-methods/card.png",
  boleto: "/cdn/payment-methods/boleto.png",
  paypal: "/cdn/payment-methods/paypal.png",
  nupay: "/cdn/payment-methods/nupay.png",
};

const statusFilterOptions: Array<["all" | "active" | "disabled", string]> = [
  ["all", "Todos"],
  ["active", "Ativos"],
  ["disabled", "Desativados"],
];

function formatUpdatedAt(value: string | null) {
  if (!value) return "Nunca configurado";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Atualizado recentemente";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function SelectMenu<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={open ? "relative z-[220] min-w-[168px]" : "relative z-[1] min-w-[168px]"}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        className="flowdesk-server-button flex h-[42px] w-full items-center justify-between rounded-[14px] border border-[#292929] bg-[#0D0D0D] px-[14px] text-left text-[13px] text-[#EDEDED] transition hover:border-[#444] disabled:cursor-not-allowed disabled:opacity-55"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-[8px]">
          <ListFilter className="h-[15px] w-[15px] text-[#777]" />
          {options.find(([option]) => option === value)?.[1] || "Selecionar"}
        </span>
        <ChevronDown
          className={`h-[16px] w-[16px] text-[#777] transition ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="flowdesk-scale-in-soft absolute left-0 right-0 top-[50px] z-[220] rounded-[18px] border border-[#1E1E1E] bg-[#080808] p-[8px] shadow-[0_24px_70px_rgba(0,0,0,0.48)]">
          {options.map(([option, label]) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded-[13px] px-[12px] py-[10px] text-left text-[13px] transition ${
                option === value
                  ? "bg-[#151515] text-[#F1F1F1]"
                  : "text-[#AFAFAF] hover:bg-[#111] hover:text-white"
              }`}
            >
              {label}
              {option === value ? <Check className="h-[15px] w-[15px]" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PaymentLogo({ method }: { method: PaymentMethod }) {
  const Icon = methodIcon[method.methodKey];
  const targetPath = methodLogoSrc[method.methodKey] || "/cdn/payment-methods/";
  return (
    <span
      className={cn(
        "inline-flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-[12px] border border-[#242424] bg-[#111] text-[#EAEAEA]",
        methodAccent[method.methodKey],
      )}
      title={`Coloque o PNG em ${targetPath}`}
    >
      <Icon className="h-[20px] w-[20px]" />
    </span>
  );
}

function PaymentMethodModal({
  method,
  readOnly,
  saving,
  onClose,
  onActivate,
  onDeactivate,
}: {
  method: PaymentMethod | null;
  readOnly: boolean;
  saving: boolean;
  onClose: () => void;
  onActivate: (input: {
    accessToken: string;
    publicKey: string;
    webhookSecret: string;
    statementDescriptor: string;
    environment: "production" | "test";
  }) => void;
  onDeactivate: () => void;
}) {
  const [accessToken, setAccessToken] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [statementDescriptor, setStatementDescriptor] = useState("FLOWDESK");
  const [environment, setEnvironment] = useState<"production" | "test">(
    () => method?.environment || "production",
  );

  useBodyScrollLock(Boolean(method));

  useEffect(() => {
    if (!method) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [method, onClose]);

  if (!method) return null;
  const portalTarget = typeof document === "undefined" ? null : document.body;
  if (!portalTarget) return null;

  const canSubmit =
    method.canActivate &&
    !readOnly &&
    !saving &&
    (method.credentialsConfigured || accessToken.trim().length > 0);

  return createPortal(
    <div className="fixed inset-0 z-[2600] isolate overflow-y-auto overscroll-contain">
      <button
        type="button"
        aria-label="Fechar modal"
        className="absolute inset-0 bg-[rgba(0,0,0,0.84)] backdrop-blur-[7px]"
        onClick={onClose}
      />
      <div className="relative z-10 flex min-h-full items-center justify-center px-[18px] py-[28px]">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Editar ${method.title}`}
          className="flowdesk-stage-fade relative w-full max-w-[680px] overflow-hidden rounded-[30px] border border-[#111] bg-[#070707] shadow-[0_34px_110px_rgba(0,0,0,0.52)]"
        >
          <div className="flex items-start justify-between gap-[16px] border-b border-[#171717] px-[20px] py-[20px] sm:px-[24px]">
            <div className="flex min-w-0 items-start gap-[13px]">
              <PaymentLogo method={method} />
              <div className="min-w-0">
                <p className="text-[12px] uppercase tracking-[0.18em] text-[#686868]">
                  Metodo de pagamento
                </p>
                <h3 className="mt-[7px] text-[22px] font-semibold tracking-[-0.04em] text-[#F1F1F1]">
                  {method.title}
                </h3>
                <p className="mt-[8px] text-[13px] leading-[1.55] text-[#858585]">
                  {method.canActivate
                    ? "Configure PIX com credenciais de producao ou teste do Mercado Pago."
                    : "Este provedor esta desativado nesta fase do produto."}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[13px] border border-[#1C1C1C] bg-[#0D0D0D] text-[#8C8C8C] transition hover:border-[#2C2C2C] hover:text-white"
              aria-label="Fechar"
            >
              <X className="h-[16px] w-[16px]" />
            </button>
          </div>

          <div className="space-y-[16px] px-[20px] py-[20px] sm:px-[24px] sm:py-[24px]">
            {!method.canActivate ? (
              <div className="rounded-[18px] border border-[#202020] bg-[#0D0D0D] px-[15px] py-[14px] text-[13px] leading-[1.6] text-[#AFAFAF]">
                Cartao, Boleto, PayPal e Nupay permanecem desativados.
                O checkout so libera PIX via Mercado Pago neste momento.
              </div>
            ) : (
              <>
                {method.credentialsConfigured ? (
                  <div className="rounded-[18px] border border-[#203D2D] bg-[#0B160F] px-[15px] py-[13px] text-[13px] leading-[1.55] text-[#A8E8B8]">
                    Credenciais ja guardadas no cofre seguro. Envie novos valores apenas
                    se quiser substituir a configuracao atual.
                  </div>
                ) : null}

                <div className="rounded-[18px] border border-[#243242] bg-[#091019] px-[15px] py-[13px] text-[13px] leading-[1.6] text-[#AFC7E8]">
                  Para PIX transparente, o Mercado Pago usa o Access Token da
                  conta vendedora. Client ID e Client Secret sao credenciais de
                  app/OAuth e nao entram na geracao direta do PIX.
                </div>

                <div className="grid gap-[12px] sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="mb-[8px] block text-[12px] font-semibold text-[#AFAFAF]">
                      Access Token Mercado Pago
                    </label>
                    <ServerTextInput
                      type="password"
                      value={accessToken}
                      onChange={(event) => setAccessToken(event.currentTarget.value)}
                      placeholder={
                        method.credentialsConfigured
                          ? "Manter credencial atual"
                          : "APP_USR... ou TEST-..."
                      }
                      autoComplete="new-password"
                      disabled={readOnly || saving}
                    />
                  </div>
                  <div>
                    <label className="mb-[8px] block text-[12px] font-semibold text-[#AFAFAF]">
                      Public Key
                    </label>
                    <ServerTextInput
                      type="password"
                      value={publicKey}
                      onChange={(event) => setPublicKey(event.currentTarget.value)}
                      placeholder="Opcional para PIX; usado em cartao"
                      autoComplete="new-password"
                      disabled={readOnly || saving}
                    />
                  </div>
                  <div>
                    <label className="mb-[8px] block text-[12px] font-semibold text-[#AFAFAF]">
                      Webhook Secret
                    </label>
                    <ServerTextInput
                      type="password"
                      value={webhookSecret}
                      onChange={(event) => setWebhookSecret(event.currentTarget.value)}
                      placeholder="Opcional, recomendado"
                      autoComplete="new-password"
                      disabled={readOnly || saving}
                    />
                  </div>
                  <div>
                    <label className="mb-[8px] block text-[12px] font-semibold text-[#AFAFAF]">
                      Ambiente
                    </label>
                    <div className="grid grid-cols-2 rounded-[14px] border border-[#252525] bg-[#0D0D0D] p-[4px]">
                      {(["production", "test"] as const).map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setEnvironment(option)}
                          disabled={readOnly || saving}
                          className={cn(
                            "h-[36px] rounded-[11px] text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-55",
                            environment === option
                              ? "bg-[#F1F1F1] text-[#080808]"
                              : "text-[#9A9A9A] hover:bg-[#151515] hover:text-white",
                          )}
                        >
                          {option === "production" ? "Producao" : "Teste"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="mb-[8px] block text-[12px] font-semibold text-[#AFAFAF]">
                      Nome no extrato
                    </label>
                    <ServerTextInput
                      value={statementDescriptor}
                      onChange={(event) =>
                        setStatementDescriptor(
                          event.currentTarget.value.toUpperCase().replace(/[^A-Z0-9 ]/g, "").slice(0, 22),
                        )
                      }
                      placeholder="FLOWDESK"
                      maxLength={22}
                      disabled={readOnly || saving}
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="flex flex-col-reverse gap-[10px] border-t border-[#171717] px-[20px] py-[18px] sm:flex-row sm:items-center sm:justify-end sm:px-[24px]">
            <ServerButton onClick={onClose} disabled={saving}>
              Cancelar
            </ServerButton>
            {method.status === "active" ? (
              <ServerButton
                onClick={onDeactivate}
                disabled={readOnly || saving}
                variant="danger"
                className="min-w-[132px]"
              >
                {saving ? <ButtonLoader size={15} /> : <Power className="h-[15px] w-[15px]" />}
                Desativar
              </ServerButton>
            ) : null}
            {method.canActivate ? (
              <ServerButton
                onClick={() =>
                  onActivate({
                    accessToken,
                    publicKey,
                    webhookSecret,
                    statementDescriptor,
                    environment,
                  })
                }
                disabled={!canSubmit}
                variant="primary"
                className="min-w-[168px]"
              >
                {saving ? (
                  <ButtonLoader size={15} colorClassName="text-[#080808]" />
                ) : (
                  <Check className="h-[15px] w-[15px]" />
                )}
                {method.status === "active" ? "Salvar pagamento" : "Ativar pagamento"}
              </ServerButton>
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    portalTarget,
  );
}

export function SalesPaymentMethodsPanel({
  guildId,
  readOnly = false,
}: SalesPaymentMethodsPanelProps) {
  const notifications = useNotifications();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "disabled">("all");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [needsDiscordRelink, setNeedsDiscordRelink] = useState(false);
  const [editingMethod, setEditingMethod] = useState<PaymentMethod | null>(null);
  const [savingMethodKey, setSavingMethodKey] = useState<PaymentMethodKey | null>(null);

  const loadMethods = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setNeedsDiscordRelink(false);
    try {
      const response = await fetch(
        `/api/auth/me/guilds/sales-payment-methods?guildId=${encodeURIComponent(guildId)}`,
        { credentials: "include", cache: "no-store" },
      );
      const payload = (await response.json().catch(() => ({}))) as MethodsResponse;
      if (!response.ok || !payload.ok) {
        if (payload.reauthRequired || payload.code === "DISCORD_RELINK_REQUIRED") {
          setNeedsDiscordRelink(true);
        }
        throw new Error(payload.message || "Erro ao carregar metodos.");
      }
      setMethods(payload.methods || []);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Erro ao carregar metodos.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [guildId]);

  useEffect(() => {
    void loadMethods();
  }, [loadMethods]);

  const filteredMethods = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return methods.filter((method) => {
      if (method.methodKey === "flowpay") return false;
      if (statusFilter !== "all" && method.status !== statusFilter) return false;
      if (!normalized) return true;
      return `${method.title} ${method.methodKey} ${method.provider} ${method.paymentRail}`
        .toLowerCase()
        .includes(normalized);
    });
  }, [methods, query, statusFilter]);

  const saveMethod = useCallback(
    async (
      method: PaymentMethod,
      input:
        | {
            action: "activate";
            accessToken: string;
            publicKey: string;
            webhookSecret: string;
            statementDescriptor: string;
            environment: "production" | "test";
          }
        | { action: "deactivate" },
    ) => {
      if (readOnly || savingMethodKey) return;
      setSavingMethodKey(method.methodKey);
      setErrorMessage(null);
      try {
        const response = await fetch("/api/auth/me/guilds/sales-payment-methods", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            guildId,
            methodKey: method.methodKey,
            ...input,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as MethodsResponse;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.message || "Erro ao salvar metodo.");
        }
        setMethods(payload.methods || []);
        setEditingMethod((current) => {
          if (!current) return null;
          return (payload.methods || []).find((item) => item.methodKey === current.methodKey) || null;
        });
        notifications.success(
          input.action === "deactivate"
            ? "Metodo desativado. As credenciais ficaram guardadas para reativacao."
            : "Pagamento PIX ativado com Mercado Pago.",
          { title: "Pagamentos" },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro ao salvar metodo.";
        setErrorMessage(message);
        notifications.error(message, { title: "Pagamentos" });
      } finally {
        setSavingMethodKey(null);
      }
    },
    [guildId, notifications, readOnly, savingMethodKey],
  );

  return (
    <div className="space-y-[18px]">
      <ServerSectionHeading
        eyebrow="Vendas"
        title="Metodos de pagamento"
        description="Ative o PIX via Mercado Pago e mantenha os demais provedores desativados ate a liberacao comercial."
      />

      <ServerSurface className="overflow-hidden">
        <div className="flex flex-col gap-[12px] border-b border-[#171717] px-[18px] py-[16px] lg:flex-row lg:items-center lg:justify-between lg:px-[22px]">
          <div className="relative w-full lg:max-w-[420px]">
            <Search className="pointer-events-none absolute left-[14px] top-1/2 h-[16px] w-[16px] -translate-y-1/2 text-[#666]" />
            <ServerTextInput
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Pesquisar metodo de pagamento"
              className="pl-[40px]"
            />
          </div>
          <div className="flex flex-wrap items-center gap-[8px]">
            <SelectMenu
              value={statusFilter}
              options={statusFilterOptions}
              onChange={setStatusFilter}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="grid gap-[14px] p-[18px] sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="min-h-[188px] animate-pulse rounded-[20px] border border-[#171717] bg-[#0D0D0D]"
              />
            ))}
          </div>
        ) : needsDiscordRelink ? (
          <ServerDiscordRelinkState />
        ) : errorMessage ? (
          <ServerEmptyState
            icon={<WalletCards className="h-[24px] w-[24px]" />}
            title="Nao foi possivel carregar pagamentos"
            description={errorMessage}
            action={<ServerButton onClick={() => void loadMethods()}>Tentar novamente</ServerButton>}
          />
        ) : filteredMethods.length ? (
          <div className="space-y-[1px] bg-[#171717]">
            {filteredMethods.map((method) => {
              const Icon = methodIcon[method.methodKey];
              const isActive = method.status === "active";
              return (
                <article
                  key={method.methodKey}
                  className={cn(
                    "relative flex flex-col gap-[14px] bg-[#0B0B0B] px-[18px] py-[16px] transition hover:bg-[#0E0E0E] sm:px-[22px] lg:flex-row lg:items-center",
                    isActive ? "shadow-[inset_3px_0_0_#2F8F4E]" : "",
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-[14px]">
                    <PaymentLogo method={method} />
                    <div className="min-w-0">
                      <h4 className="truncate text-[15px] font-semibold text-[#F1F1F1]">
                        {method.title}
                      </h4>
                      <p className="mt-[5px] line-clamp-1 text-[13px] leading-[1.5] text-[#777]">
                        {method.description}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-[8px] sm:flex sm:items-center">
                    <span
                      className={cn(
                        "rounded-full border px-[10px] py-[6px] text-center text-[12px]",
                        isActive
                          ? "border-[#21492D] bg-[#0B170F] text-[#92E8A4]"
                          : "border-[#2A2A2A] bg-[#101010] text-[#8A8A8A]",
                      )}
                    >
                      {isActive ? "Ativo" : "Desativado"}
                    </span>
                    <span className="rounded-full border border-[#242424] bg-[#101010] px-[9px] py-[6px] text-[11px] text-[#BDBDBD]">
                      {method.environment === "production" ? "Producao" : "Teste"}
                    </span>
                    <Icon className="hidden h-[16px] w-[16px] text-[#777] sm:block" />
                    <span className="hidden text-[12px] text-[#777] xl:inline">
                      {formatUpdatedAt(method.updatedAt)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Editar ${method.title}`}
                      title="Editar metodo"
                      disabled={readOnly}
                      onClick={() => setEditingMethod(method)}
                      className="flowdesk-server-button inline-flex h-[34px] w-[34px] items-center justify-center rounded-[12px] border border-[#252525] bg-[#111] text-[#DADADA] transition hover:border-[#3A3A3A] hover:bg-[#171717] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Pencil className="h-[15px] w-[15px]" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <ServerEmptyState
            icon={<WalletCards className="h-[24px] w-[24px]" />}
            title="Nenhum metodo encontrado"
            description="Ajuste a pesquisa ou o filtro de status para ver os provedores cadastrados."
          />
        )}
      </ServerSurface>

      <PaymentMethodModal
        key={editingMethod?.methodKey || "closed"}
        method={editingMethod}
        readOnly={readOnly}
        saving={Boolean(editingMethod && savingMethodKey === editingMethod.methodKey)}
        onClose={() => {
          if (!savingMethodKey) setEditingMethod(null);
        }}
        onActivate={(input) => {
          if (!editingMethod) return;
          void saveMethod(editingMethod, { action: "activate", ...input });
        }}
        onDeactivate={() => {
          if (!editingMethod) return;
          void saveMethod(editingMethod, { action: "deactivate" });
        }}
      />
    </div>
  );
}
