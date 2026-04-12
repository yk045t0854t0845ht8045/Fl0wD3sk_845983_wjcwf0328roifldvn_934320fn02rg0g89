import { useEffect, useState, useMemo } from "react";
import { Key, Plus, Trash, Copy, Check, Search } from "lucide-react";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import { DangerActionModal } from "../DangerActionModal";

export function ApiKeysTab() {
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [keyToRevoke, setKeyToRevoke] = useState<any>(null);
  const [revoking, setRevoking] = useState(false);

  async function loadKeys() {
    try {
      setLoading(true);
      const res = await fetch("/api/auth/me/api-keys");
      const json = await res.json();
      if (json.ok) {
        setKeys(json.keys || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadKeys();
  }, []);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "revoked">("all");

  const filteredKeys = useMemo(() => {
    return keys.filter((key) => {
      const matchSearch = key.name.toLowerCase().includes(searchQuery.toLowerCase());
      const isRevoked = !!key.revoked_at;
      const matchStatus = statusFilter === "all" || 
                         (statusFilter === "active" && !isRevoked) || 
                         (statusFilter === "revoked" && isRevoked);
      return matchSearch && matchStatus;
    });
  }, [keys, searchQuery, statusFilter]);

  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyName.trim() || creating) return;
    try {
      setCreating(true);
      const res = await fetch("/api/auth/me/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName })
      });
      const json = await res.json();
      if (json.ok) {
        setCreatedSecret(json.secret);
        setNewKeyName("");
        loadKeys();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCreating(false);
    }
  }

  async function handleRevokeConfirm() {
    if (!keyToRevoke) return;
    try {
      setRevoking(true);
      const res = await fetch(`/api/auth/me/api-keys/${keyToRevoke.id}`, { method: "DELETE" });
      if (res.ok) {
        loadKeys();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setRevoking(false);
      setKeyToRevoke(null);
    }
  }

  function handleCopy() {
    if (createdSecret) {
      navigator.clipboard.writeText(createdSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (loading && keys.length === 0) {
    return (
      <div className="mt-[32px] space-y-[24px]">
        <div className="flowdesk-shimmer h-[160px] w-full rounded-[18px] border border-[#141414] bg-[#090909]" />
        <div className="space-y-[12px]">
           {[...Array(2)].map((_, i) => (
             <div key={i} className="flowdesk-shimmer h-[70px] w-full rounded-[16px] border border-[#141414] bg-[#0A0A0A]" />
           ))}
        </div>
      </div>
    );
  }
  return (
    <div className="mt-[32px] space-y-[24px]">
      {/* Filter Card */}
      <div className="rounded-[22px] border border-[#141414] bg-[#0A0A0A] p-[20px]">
        <div className="flex flex-col gap-[16px] lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 items-center gap-[12px] rounded-[14px] border border-[#141414] bg-[#0D0D0D] px-[16px] py-[12px] transition-all focus-within:border-[#222] focus-within:bg-[#0F0F0F]">
            <Search className="h-[18px] w-[18px] shrink-0 text-[#6F6F6F]" strokeWidth={1.8} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar chaves de API..."
              className="w-full bg-transparent text-[15px] text-[#D5D5D5] outline-none placeholder:text-[#4A4A4A]"
            />
          </div>
          
          <div className="flex items-center gap-[10px]">
            <div className="flex items-center gap-[6px] rounded-[14px] border border-[#141414] bg-[#0D0D0D] p-[4px]">
              {(["all", "active", "revoked"] as const).map((opt) => {
                const isActive = statusFilter === opt;
                return (
                  <button
                    key={opt}
                    onClick={() => setStatusFilter(opt)}
                    className={`rounded-[10px] px-[16px] py-[8px] text-[13px] font-semibold transition-all ${
                      isActive
                        ? "bg-[#1A1A1A] text-[#EEEEEE] shadow-sm"
                        : "text-[#666666] hover:bg-[#111111] hover:text-[#A6A6A6]"
                    }`}
                  >
                    {opt === "all" ? "Todas" : opt === "active" ? "Ativas" : "Revogadas"}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-[18px] border border-[#141414] bg-[#090909] p-[24px]">
         <h2 className="text-[18px] font-semibold text-[#E9E9E9]">Criar nova chave API</h2>
         <p className="mt-[4px] text-[14px] text-[#888888]">As chaves permitem integração com bots externos e painéis próprios.</p>
         
         {createdSecret ? (
           <div className="mt-[20px] rounded-[14px] border border-[#058232] bg-[rgba(5,130,50,0.05)] p-[20px]">
             <p className="font-semibold text-[#34A853]">Chave gerada com sucesso!</p>
             <p className="text-[13px] text-[#A6C9A6]">Copie agora, você não poderá ver esta chave novamente.</p>
             <div className="mt-[16px] flex items-center gap-[12px] rounded-[10px] bg-[#050505] border border-[#141414] p-[12px]">
               <code className="text-[#E0E0E0] select-all flex-1 font-mono text-[13px]">{createdSecret}</code>
               <button onClick={handleCopy} className="text-[#34A853] hover:text-[#5CE67E]">
                 {copied ? <Check className="h-[20px] w-[20px]" /> : <Copy className="h-[20px] w-[20px]" />}
               </button>
             </div>
             <button onClick={() => setCreatedSecret(null)} className="mt-[16px] rounded-[10px] bg-[#111111] px-[16px] py-[8px] text-[13px] font-medium text-[#E0E0E0] hover:bg-[#1A1A1A]">
               Fechar
             </button>
           </div>
         ) : (
           <form onSubmit={handleCreateKey} className="mt-[20px] flex items-center gap-[12px]">
             <input
               type="text"
               value={newKeyName}
               onChange={(e) => setNewKeyName(e.target.value)}
               placeholder="Nome da chave (ex: Produção)"
               className="h-[44px] flex-1 rounded-[12px] border border-[#1A1A1A] bg-[#080808] px-[16px] text-[#E0E0E0] placeholder:text-[#555555] focus:border-[rgba(0,98,255,0.4)] focus:outline-none focus:ring-1 focus:ring-[rgba(0,98,255,0.4)]"
             />
             <button disabled={creating || !newKeyName.trim()} type="submit" className="flex h-[44px] items-center justify-center gap-[8px] rounded-[12px] bg-[rgba(0,98,255,0.1)] px-[20px] text-[#8AB6FF] border border-[rgba(0,98,255,0.2)] hover:bg-[rgba(0,98,255,0.2)] disabled:opacity-50">
               {creating ? <ButtonLoader size={16} /> : <Plus className="h-[16px] w-[16px]" />}
               <span>Criar Chave</span>
             </button>
           </form>
         )}
      </div>

      <div className="mt-[24px] space-y-[12px]">
        <h3 className="text-[14px] font-semibold uppercase tracking-wide text-[#555555]">Chaves Registradas</h3>
        {filteredKeys.length === 0 ? (
          <p className="text-[14px] text-[#777777]">Nenhuma chave encontrada com os filtros atuais.</p>
        ) : (
          filteredKeys.map((key) => {
            const isRevoked = !!key.revoked_at;
            return (
              <div key={key.id} className="flex items-center justify-between rounded-[16px] border border-[#131313] bg-[#0A0A0A] p-[16px]">
                <div className="flex items-center gap-[16px]">
                  <div className={`flex h-[40px] w-[40px] items-center justify-center rounded-full ${isRevoked ? "bg-[#111111] text-[#555]" : "bg-[rgba(0,98,255,0.1)] text-[#8AB6FF]"}`}>
                    <Key className="h-[20px] w-[20px]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-[8px]">
                      <p className={`text-[15px] font-semibold ${isRevoked ? "text-[#777]" : "text-[#EEEEEE]"}`}>{key.name}</p>
                      {isRevoked && <span className="rounded-full bg-[rgba(219,70,70,0.1)] px-[8px] py-[2px] text-[10px] text-[#DB4646] uppercase font-bold tracking-wide">Revogada</span>}
                    </div>
                    <p className="text-[13px] text-[#747474] font-mono mt-[2px]">
                      fdk_****************************{key.last_four}
                    </p>
                  </div>
                </div>
                {!isRevoked && (
                  <button onClick={() => setKeyToRevoke(key)} className="flex h-[36px] items-center justify-center rounded-[10px] bg-[#111111] px-[12px] text-[#A6A6A6] transition hover:bg-[rgba(219,70,70,0.1)] hover:text-[#DB4646]">
                     <Trash className="h-[16px] w-[16px] mr-[6px]" /> Revogar
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      <DangerActionModal
        isOpen={!!keyToRevoke}
        onClose={() => setKeyToRevoke(null)}
        onConfirm={handleRevokeConfirm}
        isProcessing={revoking}
        title="Revogar Chave API"
        description={`Tem certeza que deseja revogar a chave "${keyToRevoke?.name}" permanentemente? Todas as integrações utilizando esta chave pararão de funcionar imediatamente.`}
        confirmText="Revogar chave"
      />
    </div>
  );
}
