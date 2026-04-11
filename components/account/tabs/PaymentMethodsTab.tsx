import { useEffect, useState } from "react";
import { CreditCard, Trash } from "lucide-react";
import { ButtonLoader } from "@/components/login/ButtonLoader";

export function PaymentMethodsTab() {
  const [methods, setMethods] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadMethods() {
      try {
        const res = await fetch("/api/auth/me/payments/history");
        const json = await res.json();
        if (json.ok) {
          setMethods(json.methods || []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadMethods();
  }, []);

  if (loading) {
    return (
      <div className="flex h-[200px] items-center justify-center">
        <ButtonLoader size={24} />
      </div>
    );
  }

  if (methods.length === 0) {
    return (
      <div className="mt-[32px] flex flex-col items-center justify-center rounded-[18px] border border-[#141414] bg-[#090909] py-[40px] px-[20px] text-center">
        <div className="flex h-[48px] w-[48px] items-center justify-center rounded-full bg-[#111111]">
          <CreditCard className="text-[#888888] h-[24px] w-[24px]" />
        </div>
        <p className="mt-[16px] text-[15px] font-medium text-[#E5E5E5]">Nenhum cartão salvo</p>
        <p className="mt-[4px] text-[14px] text-[#777777]">Sua conta não possui métodos de pagamento.</p>
      </div>
    );
  }

  return (
    <div className="mt-[32px] space-y-[12px]">
      {methods.map((method) => {
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
  );
}
