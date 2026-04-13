import { useMemo, useState } from "react";
import { CreditCard, Trash, Search } from "lucide-react";
import { usePaymentHistory } from "@/hooks/useAccountData";

type SavedMethod = {
  id?: string;
  brand: string;
  lastFour: string;
  expMonth: number | string;
  expYear: number | string;
};

export function PaymentMethodsTab() {
  const { methods, loading } = usePaymentHistory();
  const [searchQuery, setSearchQuery] = useState("");
  const [brandFilter, setBrandFilter] = useState("all");

  const filteredMethods = useMemo(() => {
    return (methods as SavedMethod[]).filter((m) => {
      const brand = (m.brand || "").toLowerCase();
      const lastFour = (m.lastFour || "").toLowerCase();
      const query = searchQuery.toLowerCase();
      
      const matchesSearch = brand.includes(query) || lastFour.includes(query);
      const matchesBrand = brandFilter === "all" || brand === brandFilter.toLowerCase();
      
      return matchesSearch && matchesBrand;
    });
  }, [methods, searchQuery, brandFilter]);

  const uniqueBrands = useMemo(() => {
    const brands = new Set((methods as SavedMethod[]).map((m) => (m.brand || "Desconhecido").toLowerCase()));
    return Array.from(brands) as string[];
  }, [methods]);

  if (loading) {
    return (
      <div className="mt-[32px] space-y-[12px]">
        <div className="flowdesk-shimmer h-[70px] w-full rounded-[18px] border border-[#141414] bg-[#0A0A0A]" />
        {[...Array(2)].map((_, i) => (
          <div key={i} className="flowdesk-shimmer h-[70px] w-full rounded-[16px] border border-[#141414] bg-[#0A0A0A]" />
        ))}
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
              placeholder="Buscar por bandeira ou final do cartão..."
              className="w-full bg-transparent text-[15px] text-[#D5D5D5] outline-none placeholder:text-[#4A4A4A]"
            />
          </div>
          
          <div className="flex items-center gap-[10px]">
            <div className="flex items-center gap-[6px] rounded-[14px] border border-[#141414] bg-[#0D0D0D] p-[4px]">
              <button
                onClick={() => setBrandFilter("all")}
                className={`rounded-[10px] px-[16px] py-[8px] text-[13px] font-semibold transition-all ${
                  brandFilter === "all"
                    ? "bg-[#1A1A1A] text-[#EEEEEE] shadow-sm"
                    : "text-[#666666] hover:bg-[#111111] hover:text-[#A6A6A6]"
                }`}
              >
                Todas
              </button>
              {uniqueBrands.map((brand) => {
                const isActive = brandFilter === brand;
                return (
                  <button
                    key={brand}
                    onClick={() => setBrandFilter(brand)}
                    className={`rounded-[10px] px-[16px] py-[8px] text-[13px] font-semibold transition-all uppercase ${
                      isActive
                        ? "bg-[#1A1A1A] text-[#EEEEEE] shadow-sm"
                        : "text-[#666666] hover:bg-[#111111] hover:text-[#A6A6A6]"
                    }`}
                  >
                    {brand}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {methods.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[18px] border border-[#141414] bg-[#090909] py-[40px] px-[20px] text-center">
          <div className="flex h-[48px] w-[48px] items-center justify-center rounded-full bg-[#111111]">
            <CreditCard className="text-[#888888] h-[24px] w-[24px]" />
          </div>
          <p className="mt-[16px] text-[15px] font-medium text-[#E5E5E5]">Nenhum cartão salvo</p>
          <p className="mt-[4px] text-[14px] text-[#777777]">Sua conta não possui métodos de pagamento.</p>
        </div>
      ) : filteredMethods.length === 0 ? (
        <div className="rounded-[16px] border border-[#141414] bg-[#0A0A0A] p-[24px] text-center">
          <p className="text-[14px] text-[#777777]">Nenhum cartão encontrado com os filtros atuais.</p>
        </div>
      ) : (
        <div className="space-y-[12px]">
          {(filteredMethods as SavedMethod[]).map((method) => {
            return (
              <div key={method.id || Math.random()} className="flex items-center justify-between rounded-[16px] border border-[#131313] bg-[#0A0A0A] p-[16px] transition hover:border-[#222222]">
                <div className="flex items-center gap-[16px]">
                  <div className="flex h-[40px] w-[56px] items-center justify-center rounded-[6px] bg-[#141414] border border-[#1E1E1E]">
                    <span className="text-[12px] font-bold text-[#D0D0D0] uppercase">{method.brand || "CARD"}</span>
                  </div>
                  <div>
                    <p className="text-[15px] font-semibold text-[#EEEEEE]">
                      •••• •••• •••• {method.lastFour || "****"}
                    </p>
                    <p className="text-[13px] text-[#747474]">
                      Vence em {method.expMonth}/{method.expYear}
                    </p>
                  </div>
                </div>
                <div>
                  <button className="flex h-[36px] items-center justify-center rounded-[10px] bg-[#111111] px-[12px] text-[#A6A6A6] transition hover:bg-[rgba(219,70,70,0.1)] hover:text-[#DB4646]">
                    <Trash className="h-[16px] w-[16px]" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
