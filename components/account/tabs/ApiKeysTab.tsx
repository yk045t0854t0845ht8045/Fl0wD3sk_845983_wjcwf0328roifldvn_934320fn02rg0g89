import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Key, Search, Trash } from "lucide-react";
import { DangerActionModal } from "../DangerActionModal";
import { LandingActionButton } from "@/components/landing/LandingActionButton";
import { CreateApiKeyModal } from "@/components/account/CreateApiKeyModal";

type ApiKeyItem = {
  id: number;
  name: string;
  token_prefix?: string | null;
  last_four: string;
  rate_limit_per_minute?: number | null;
  expires_at?: string | null;
  revoked_at?: string | null;
  metadata?: {
    reason?: string | null;
  } | null;
};

function formatDateLabel(value: string | null | undefined) {
  if (!value) {
    return "Sem expiracao";
  }

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "Expiracao invalida";
  }

  return date.toLocaleDateString("pt-BR");
}

export function ApiKeysTab() {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createModalError, setCreateModalError] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKeyItem | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "revoked">(
    "all",
  );

  async function parseJsonResponse(response: Response) {
    return await response.json().catch(() => null);
  }

  async function loadKeys() {
    try {
      setLoading(true);
      setLoadError(null);

      const response = await fetch("/api/auth/me/api-keys", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        throw new Error(payload?.message || "Falha ao carregar as chaves API.");
      }

      if (!payload?.ok) {
        throw new Error(payload?.message || "Falha ao carregar as chaves API.");
      }

      setKeys(Array.isArray(payload.keys) ? payload.keys : []);
    } catch (error) {
      console.error(error);
      setLoadError(
        error instanceof Error ? error.message : "Falha ao carregar as chaves API.",
      );
      setKeys([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadKeys();
  }, []);

  const filteredKeys = useMemo(() => {
    return keys.filter((key) => {
      const matchSearch = key.name
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      const isRevoked = Boolean(key.revoked_at);
      const matchStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && !isRevoked) ||
        (statusFilter === "revoked" && isRevoked);

      return matchSearch && matchStatus;
    });
  }, [keys, searchQuery, statusFilter]);

  async function handleCreateKey(input: {
    name: string;
    reason: string;
    expiresAt: string | null;
  }) {
    try {
      setCreating(true);
      setCreateModalError(null);
      setLoadError(null);

      const response = await fetch("/api/auth/me/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: input.name,
          reason: input.reason,
          expiresAt: input.expiresAt,
        }),
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        throw new Error(payload?.message || "Falha ao criar a chave API.");
      }

      if (!payload?.ok) {
        throw new Error(payload?.message || "Falha ao criar a chave API.");
      }

      setCreatedSecret(typeof payload.secret === "string" ? payload.secret : null);
      setIsCreateModalOpen(false);
      await loadKeys();
    } catch (error) {
      console.error(error);
      setCreateModalError(
        error instanceof Error ? error.message : "Falha ao criar a chave API.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleRevokeConfirm() {
    if (!keyToRevoke) {
      return;
    }

    try {
      setRevoking(true);
      setLoadError(null);

      const response = await fetch(`/api/auth/me/api-keys/${keyToRevoke.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        throw new Error(payload?.message || "Falha ao revogar a chave API.");
      }

      await loadKeys();
    } catch (error) {
      console.error(error);
      setLoadError(
        error instanceof Error ? error.message : "Falha ao revogar a chave API.",
      );
    } finally {
      setRevoking(false);
      setKeyToRevoke(null);
    }
  }

  function handleCopy() {
    if (!createdSecret) {
      return;
    }

    navigator.clipboard.writeText(createdSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading && keys.length === 0) {
    return (
      <div className="mt-[32px] space-y-[24px]">
        <div className="flowdesk-shimmer h-[120px] w-full rounded-[18px] border border-[#141414] bg-[#090909]" />
        <div className="space-y-[12px]">
          {[...Array(2)].map((_, index) => (
            <div
              key={index}
              className="flowdesk-shimmer h-[70px] w-full rounded-[16px] border border-[#141414] bg-[#0A0A0A]"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-[32px] space-y-[24px]">
      <div className="rounded-[22px] border border-[#141414] bg-[#0A0A0A] p-[20px]">
        <div className="flex flex-col gap-[16px] lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 items-center gap-[12px] rounded-[14px] border border-[#141414] bg-[#0D0D0D] px-[16px] py-[12px] transition-all focus-within:border-[#222] focus-within:bg-[#0F0F0F]">
            <Search
              className="h-[18px] w-[18px] shrink-0 text-[#6F6F6F]"
              strokeWidth={1.8}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Buscar chaves de API..."
              className="w-full bg-transparent text-[15px] text-[#D5D5D5] outline-none placeholder:text-[#4A4A4A]"
            />
          </div>

          <div className="flex items-center gap-[10px]">
            <div className="flex items-center gap-[6px] rounded-[14px] border border-[#141414] bg-[#0D0D0D] p-[4px]">
              {(["all", "active", "revoked"] as const).map((option) => {
                const isActive = statusFilter === option;

                return (
                  <button
                    key={option}
                    onClick={() => setStatusFilter(option)}
                    className={`rounded-[10px] px-[16px] py-[8px] text-[13px] font-semibold transition-all ${
                      isActive
                        ? "bg-[#1A1A1A] text-[#EEEEEE] shadow-sm"
                        : "text-[#666666] hover:bg-[#111111] hover:text-[#A6A6A6]"
                    }`}
                  >
                    {option === "all"
                      ? "Todas"
                      : option === "active"
                        ? "Ativas"
                        : "Revogadas"}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-[18px] border border-[#141414] bg-[#090909] p-[24px]">
        <div className="flex flex-col gap-[14px] sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[18px] font-semibold text-[#E9E9E9]">
              Chaves de API
            </h2>
            <p className="mt-[4px] text-[14px] text-[#888888]">
              Crie e gerencie chaves para autenticar integracoes externas com o
              FlowAI.
            </p>
          </div>

          <LandingActionButton
            variant="light"
            className="h-[46px] px-6 text-[14px] sm:h-[48px] sm:px-7 sm:text-[15px]"
            onClick={() => {
              setCreateModalError(null);
              setIsCreateModalOpen(true);
            }}
          >
            Criar Chave
          </LandingActionButton>
        </div>

        {loadError ? (
          <div className="mt-[16px] rounded-[12px] border border-[rgba(219,70,70,0.2)] bg-[rgba(219,70,70,0.08)] px-[14px] py-[12px] text-[13px] text-[#FFB4B4]">
            {loadError}
          </div>
        ) : null}

        {createdSecret ? (
          <div className="mt-[20px] rounded-[14px] border border-[#058232] bg-[rgba(5,130,50,0.05)] p-[20px]">
            <p className="font-semibold text-[#34A853]">
              Chave gerada com sucesso!
            </p>
            <p className="text-[13px] text-[#A6C9A6]">
              Copie agora, voce nao podera ver esta chave novamente.
            </p>
            <div className="mt-[16px] flex items-center gap-[12px] rounded-[10px] border border-[#141414] bg-[#050505] p-[12px]">
              <code className="flex-1 select-all font-mono text-[13px] text-[#E0E0E0]">
                {createdSecret}
              </code>
              <button
                onClick={handleCopy}
                className="text-[#34A853] hover:text-[#5CE67E]"
              >
                {copied ? (
                  <Check className="h-[20px] w-[20px]" />
                ) : (
                  <Copy className="h-[20px] w-[20px]" />
                )}
              </button>
            </div>
            <button
              onClick={() => setCreatedSecret(null)}
              className="mt-[16px] rounded-[10px] bg-[#111111] px-[16px] py-[8px] text-[13px] font-medium text-[#E0E0E0] hover:bg-[#1A1A1A]"
            >
              Fechar
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-[24px] space-y-[12px]">
        <h3 className="text-[14px] font-semibold uppercase tracking-wide text-[#555555]">
          Chaves Registradas
        </h3>
        {filteredKeys.length === 0 ? (
          <p className="text-[14px] text-[#777777]">
            Nenhuma chave encontrada com os filtros atuais.
          </p>
        ) : (
          filteredKeys.map((key) => {
            const isRevoked = Boolean(key.revoked_at);
            const maskedToken = `${key.token_prefix || "flai_live_"}********${key.last_four}`;

            return (
              <div
                key={key.id}
                className="rounded-[16px] border border-[#131313] bg-[#0A0A0A] p-[16px]"
              >
                <div className="flex flex-col gap-[14px] xl:flex-row xl:items-center xl:gap-[18px]">
                  <div className="flex min-w-0 items-center gap-[16px]">
                    <div
                      className={`flex h-[40px] w-[40px] items-center justify-center rounded-full ${
                        isRevoked
                          ? "bg-[#111111] text-[#555]"
                          : "bg-[rgba(0,98,255,0.1)] text-[#8AB6FF]"
                      }`}
                    >
                      <Key className="h-[20px] w-[20px]" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-[8px]">
                        <p
                          className={`truncate text-[15px] font-semibold ${
                            isRevoked ? "text-[#777]" : "text-[#EEEEEE]"
                          }`}
                        >
                          {key.name}
                        </p>
                        {isRevoked ? (
                          <span className="rounded-full bg-[rgba(219,70,70,0.1)] px-[8px] py-[2px] text-[10px] font-bold uppercase tracking-wide text-[#DB4646]">
                            Revogada
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex min-w-0 flex-col gap-[10px] xl:ml-auto xl:flex-row xl:items-center xl:justify-end xl:gap-[12px]">
                    <div className="flex min-w-0 flex-wrap items-center gap-[8px]">
                      <span className="inline-flex max-w-full items-center gap-[6px] rounded-full border border-[#1A1A1A] bg-[#0D0D0D] px-[12px] py-[7px] text-[11px] text-[#BABABA]">
                        <span className="text-[#666666]">API</span>
                        <code className="max-w-[240px] truncate font-mono text-[11px] text-[#E4E4E4]">
                          {maskedToken}
                        </code>
                      </span>
                      <span className="inline-flex items-center gap-[6px] rounded-full border border-[#1A1A1A] bg-[#0D0D0D] px-[12px] py-[7px] text-[11px] text-[#BABABA]">
                        <span className="text-[#666666]">Limite</span>
                        <span className="text-[#E4E4E4]">
                          {key.rate_limit_per_minute || 60}/min
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-[6px] rounded-full border border-[#1A1A1A] bg-[#0D0D0D] px-[12px] py-[7px] text-[11px] text-[#BABABA]">
                        <span className="text-[#666666]">Expira em</span>
                        <span className="text-[#E4E4E4]">
                          {formatDateLabel(key.expires_at)}
                        </span>
                      </span>
                      {key.metadata?.reason ? (
                        <span className="inline-flex items-center gap-[6px] rounded-full border border-[#1A1A1A] bg-[#0D0D0D] px-[12px] py-[7px] text-[11px] text-[#BABABA]">
                          <span className="text-[#666666]">Razao</span>
                          <span className="text-[#E4E4E4]">
                            {key.metadata.reason}
                          </span>
                        </span>
                      ) : null}
                    </div>

                    {!isRevoked ? (
                      <button
                        onClick={() => setKeyToRevoke(key)}
                        className="inline-flex h-[38px] shrink-0 items-center justify-center self-start rounded-[10px] bg-[#111111] px-[14px] text-[13px] font-medium text-[#A6A6A6] transition hover:bg-[rgba(219,70,70,0.1)] hover:text-[#DB4646] xl:self-center"
                      >
                        <Trash className="mr-[6px] h-[16px] w-[16px]" /> Revogar
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <CreateApiKeyModal
        isOpen={isCreateModalOpen}
        isProcessing={creating}
        errorMessage={createModalError}
        onClose={() => {
          if (!creating) {
            setIsCreateModalOpen(false);
            setCreateModalError(null);
          }
        }}
        onSubmit={handleCreateKey}
      />

      <DangerActionModal
        isOpen={Boolean(keyToRevoke)}
        onClose={() => setKeyToRevoke(null)}
        onConfirm={handleRevokeConfirm}
        isProcessing={revoking}
        title="Revogar Chave API"
        description={`Tem certeza que deseja revogar a chave "${keyToRevoke?.name}" permanentemente? Todas as integracoes utilizando esta chave pararao de funcionar imediatamente.`}
        confirmText="Revogar chave"
      />
    </div>
  );
}
