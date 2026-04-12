"use client";

import { useEffect, useState } from "react";
import { BadgePercent, ArrowRightLeft, CheckCircle2, Clock, Zap, Crown, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { ButtonLoader } from "@/components/login/ButtonLoader";

type PlanData = {
  code: string;
  name: string;
  status: "inactive" | "trial" | "active" | "expired";
  expiresAt: string | null;
  activatedAt: string | null;
  billingCycleDays: number;
  recurrenceLabel: string;
  isActive: boolean;
  maxLicensedServers: number;
};

const PLAN_CONFIGS: Record<string, { 
  color: string; 
  bg: string; 
  icon: React.ElementType;
  description: string;
  features: string[];
}> = {
  basic: { 
    color: "#A0A0A0", 
    bg: "rgba(100,100,100,0.12)", 
    icon: Star,
    description: "Ideal para começar e gerenciar um servidor pequeno.",
    features: ["1 Servidor licenciado", "Automações básicas", "Suporte via comunidade", "Painel web padrão"]
  },
  starter: { 
    color: "#8AB6FF", 
    bg: "rgba(0,98,255,0.1)", 
    icon: Zap,
    description: "Para quem quer crescer e profissionalizar seu servidor.",
    features: ["Até 5 Servidores licenciados", "Automações avançadas", "Logs em tempo real", "Suporte prioritário"]
  },
  pro: { 
    color: "#C4A9FF", 
    bg: "rgba(125,59,255,0.12)", 
    icon: Crown,
    description: "Nível profissional para grandes comunidades.",
    features: ["Até 15 Servidores licenciados", "Personalização total", "API Access", "Gerente de conta"]
  },
  enterprise: { 
    color: "#FFB966", 
    bg: "rgba(255,163,47,0.12)", 
    icon: Crown,
    description: "Soluções customizadas para necessidades extremas.",
    features: ["Servidores ilimitados", "White-label completo", "SLA Garantido", "Suporte 24/7 dedicado"]
  },
};
function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    active: { label: "Ativo", color: "text-[#34A853] bg-[rgba(52,168,83,0.10)]" },
    trial: { label: "Trial", color: "text-[#F2C823] bg-[rgba(242,200,35,0.10)]" },
    expired: { label: "Expirado", color: "text-[#DB4646] bg-[rgba(219,70,70,0.10)]" },
    inactive: { label: "Inativo", color: "text-[#888888] bg-[rgba(136,136,136,0.10)]" },
  };
  const s = map[status] ?? map["inactive"];
  return (
    <span className={`rounded-full ${s.color} px-[10px] py-[3px] text-[11px] font-medium`}>
      {s.label}
    </span>
  );
}

export function PlansTab() {
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    async function loadPlan() {
      try {
        const res = await fetch("/api/auth/me/account/plan");
        const json = await res.json();
        if (json.ok) setPlan(json.plan);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadPlan();
  }, []);

  if (loading) {
    return (
      <div className="mt-[32px] space-y-[24px]">
        <div className="flowdesk-shimmer h-[220px] w-full rounded-[24px] border border-[#141414] bg-[#0A0A0A]" />
        <div className="grid gap-[14px] sm:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flowdesk-shimmer h-[100px] w-full rounded-[20px] border border-[#141414] bg-[#0A0A0A]" />
          ))}
        </div>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="mt-[32px] flex flex-col items-center justify-center rounded-[18px] border border-[#141414] bg-[#090909] py-[40px] px-[20px] text-center">
        <div className="flex h-[48px] w-[48px] items-center justify-center rounded-full bg-[#111111]">
          <BadgePercent className="text-[#888888] h-[24px] w-[24px]" />
        </div>
        <p className="mt-[16px] text-[15px] font-medium text-[#E5E5E5]">Nenhum plano encontrado</p>
      </div>
    );
  }

  const config = PLAN_CONFIGS[plan.code.toLowerCase()] || PLAN_CONFIGS["starter"];
  const StatusIcon = config.icon;

  return (
    <div className="mt-[32px] space-y-[28px]">
      {/* Hero Plan Card */}
      <div className="relative overflow-hidden rounded-[32px] border border-[#141414] bg-[#070707] p-[32px] md:p-[40px]">
        {/* Abstract background elements */}
        <div 
          className="absolute -right-[60px] -top-[60px] h-[300px] w-[300px] blur-[120px] opacity-[0.15] pointer-events-none"
          style={{ backgroundColor: config.color }}
        />
        <div className="absolute right-0 top-0 h-full w-[40%] bg-[linear-gradient(to_left,rgba(0,0,0,0.4)_0%,transparent_100%)] pointer-events-none" />
        
        <div className="relative z-10">
          <div className="flex flex-col gap-[32px] lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-[24px]">
              <div 
                className="flex h-[80px] w-[80px] shrink-0 items-center justify-center rounded-[24px] border border-[rgba(255,255,255,0.05)] shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
                style={{ backgroundColor: config.bg }}
              >
                <StatusIcon className="h-[40px] w-[40px]" style={{ color: config.color }} />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-[12px]">
                  <h2 className="text-[32px] font-bold tracking-tight text-white">{plan.name}</h2>
                  <StatusBadge status={plan.status} />
                </div>
                <p className="mt-[8px] max-w-[480px] text-[16px] leading-relaxed text-[#888888]">
                  {config.description}
                </p>
              </div>
            </div>

            <button
              onClick={() => router.push("/servers/plans")}
              className="flex h-[52px] items-center gap-[10px] rounded-[16px] bg-[#FFFFFF] px-[24px] text-[15px] font-bold text-[#000000] shadow-[0_4px_20px_rgba(255,255,255,0.1)] transition-all hover:scale-[1.02] active:scale-[0.98] hover:bg-[#F2F2F2]"
            >
              <ArrowRightLeft className="h-[18px] w-[18px]" strokeWidth={2.5} />
              <span>Gerenciar Plano</span>
            </button>
          </div>

          <div className="mt-[40px] grid gap-[16px] sm:grid-cols-2 lg:grid-cols-3">
             <div className="group rounded-[20px] bg-[#0A0A0A] border border-[#141414] p-[20px] transition-all hover:border-[#1F1F1F] hover:bg-[#0D0D0D]">
                <p className="text-[12px] font-semibold uppercase tracking-widest text-[#555555]">Data de Ativação</p>
                <div className="mt-[12px] flex items-center gap-[10px]">
                  <div className="flex h-[32px] w-[32px] items-center justify-center rounded-[10px] bg-[#111111] text-[#666] group-hover:text-[#888] transition-colors">
                    <Clock className="h-[16px] w-[16px]" />
                  </div>
                  <p className="text-[16px] font-semibold text-[#EEEEEE]">{formatDate(plan.activatedAt)}</p>
                </div>
             </div>
             
             <div className="group rounded-[20px] bg-[#0A0A0A] border border-[#141414] p-[20px] transition-all hover:border-[#1F1F1F] hover:bg-[#0D0D0D]">
                <p className="text-[12px] font-semibold uppercase tracking-widest text-[#555555]">Próxima Renovação</p>
                <div className="mt-[12px] flex items-center gap-[10px]">
                  <div className="flex h-[32px] w-[32px] items-center justify-center rounded-[10px] bg-[#111111] text-[#666] group-hover:text-[#8AB6FF] transition-colors">
                    <CheckCircle2 className="h-[16px] w-[16px]" />
                  </div>
                  <p className={`text-[16px] font-semibold ${plan.status === "expired" ? "text-[#DB4646]" : "text-[#EEEEEE]"}`}>
                    {formatDate(plan.expiresAt)}
                  </p>
                </div>
             </div>

             <div className="group rounded-[20px] bg-[#0A0A0A] border border-[#141414] p-[20px] transition-all hover:border-[#1F1F1F] hover:bg-[#0D0D0D] sm:col-span-2 lg:col-span-1">
                <p className="text-[12px] font-semibold uppercase tracking-widest text-[#555555]">Ciclo de Cobrança</p>
                <div className="mt-[12px] flex items-center gap-[10px]">
                  <div className="flex h-[32px] w-[32px] items-center justify-center rounded-[10px] bg-[#111111] text-[#666] group-hover:text-[#F2C823] transition-colors">
                    <Zap className="h-[16px] w-[16px]" />
                  </div>
                  <p className="text-[16px] font-semibold text-[#EEEEEE]">{plan.recurrenceLabel}</p>
                </div>
             </div>
          </div>
        </div>
      </div>

      <div className="grid gap-[24px] lg:grid-cols-2">
        {/* Limits & Usage */}
        <div className="rounded-[28px] border border-[#141414] bg-[#0A0A0A] p-[28px]">
          <div className="flex items-center gap-[12px]">
            <div className="flex h-[36px] w-[36px] items-center justify-center rounded-[10px] bg-[#111111]">
              <Activity className="h-[18px] w-[18px] text-[#A6A6A6]" />
            </div>
            <div>
              <h3 className="text-[18px] font-bold text-white">Limites do Plano</h3>
              <p className="text-[13px] text-[#666666]">Consumo atual em relação as cotas</p>
            </div>
          </div>
          
          <div className="mt-[32px] space-y-[24px]">
            <div>
              <div className="mb-[10px] flex items-center justify-between px-[2px]">
                <span className="text-[14px] font-medium text-[#A0A0A0]">Servidores Licenciados</span>
                <span className="text-[14px] font-bold text-white">
                  {plan.maxLicensedServers === 0 ? "Ilimitados" : `${plan.maxLicensedServers}`}
                </span>
              </div>
              <div className="h-[8px] w-full overflow-hidden rounded-full bg-[#141414]">
                <div 
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{ 
                    backgroundColor: config.color,
                    width: plan.maxLicensedServers === 0 ? "100%" : "33%",
                    boxShadow: `0 0 20px ${config.color}33`
                  }}
                />
              </div>
            </div>

            <div className="pt-[20px] border-t border-[#141414] grid grid-cols-2 gap-[16px]">
               <div className="rounded-2xl border border-[#141414] bg-[#080808] p-[16px]">
                 <p className="text-[11px] font-bold uppercase tracking-widest text-[#444]">Automações</p>
                 <p className="mt-[6px] text-[15px] font-bold text-[#EEEEEE]">Habilitadas</p>
               </div>
               <div className="rounded-2xl border border-[#141414] bg-[#080808] p-[16px]">
                 <p className="text-[11px] font-bold uppercase tracking-widest text-[#444]">Prioridade</p>
                 <p className="mt-[6px] text-[15px] font-bold text-[#EEEEEE]">Normal</p>
               </div>
            </div>
          </div>
        </div>

        {/* Benefits List */}
        <div className="rounded-[28px] border border-[#141414] bg-[#0A0A0A] p-[28px]">
          <div className="flex items-center gap-[12px]">
            <div className="flex h-[36px] w-[36px] items-center justify-center rounded-[10px] bg-[#111111]">
              <CheckCircle2 className="h-[18px] w-[18px] text-[#A6A6A6]" />
            </div>
            <div>
              <h3 className="text-[18px] font-bold text-white">Vantagens Incluídas</h3>
              <p className="text-[13px] text-[#666666]">Funcionalidades liberadas no seu nível</p>
            </div>
          </div>
          
          <div className="mt-[32px] grid gap-[12px]">
            {config.features.map((feature, i) => (
              <div key={i} className="group flex items-center gap-[14px] rounded-[18px] border border-[#141414] bg-[#080808] px-[18px] py-[14px] transition-all hover:border-[#1F1F1F] hover:bg-[#0D0D0D]">
                <div className="flex h-[24px] w-[24px] items-center justify-center rounded-full bg-[rgba(52,168,83,0.1)] text-[#34A853] transition-colors group-hover:bg-[rgba(52,168,83,0.2)]">
                  <CheckCircle2 className="h-[14px] w-[14px]" />
                </div>
                <span className="text-[14px] font-medium text-[#D1D1D1] group-hover:text-white transition-colors">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
