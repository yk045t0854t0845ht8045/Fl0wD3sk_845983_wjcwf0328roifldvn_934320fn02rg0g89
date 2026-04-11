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

const PLAN_BADGE_STYLES: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  basic: { bg: "bg-[rgba(100,100,100,0.12)]", text: "text-[#A0A0A0]", icon: Star },
  starter: { bg: "bg-[rgba(0,98,255,0.1)]", text: "text-[#8AB6FF]", icon: Zap },
  pro: { bg: "bg-[rgba(125,59,255,0.12)]", text: "text-[#C4A9FF]", icon: Crown },
  enterprise: { bg: "bg-[rgba(255,163,47,0.12)]", text: "text-[#FFB966]", icon: Crown },
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function PlanBadge({ code }: { code: string }) {
  const style = PLAN_BADGE_STYLES[code.toLowerCase()] ?? PLAN_BADGE_STYLES["starter"];
  const Icon = style.icon;
  return (
    <span className={`inline-flex items-center gap-[5px] rounded-full ${style.bg} px-[10px] py-[4px] text-[11px] font-semibold uppercase tracking-wider ${style.text}`}>
      <Icon className="h-[10px] w-[10px]" />
      {code.charAt(0).toUpperCase() + code.slice(1)}
    </span>
  );
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
        if (json.ok) {
          setPlan(json.plan);
        }
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
      <div className="flex h-[200px] items-center justify-center">
        <ButtonLoader size={24} />
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
        <p className="mt-[4px] text-[14px] text-[#777777]">Não foi possível carregar as informações do plano.</p>
      </div>
    );
  }

  return (
    <div className="mt-[32px] space-y-[16px]">
      {/* Current Plan Card */}
      <div className="rounded-[20px] border border-[#181818] bg-[#0A0A0A] p-[24px]">
        <div className="flex flex-col gap-[16px] sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-[16px]">
            <div className={`flex h-[52px] w-[52px] items-center justify-center rounded-[16px] ${PLAN_BADGE_STYLES[plan.code.toLowerCase()]?.bg ?? "bg-[rgba(0,98,255,0.1)]"}`}>
              <BadgePercent className={`h-[24px] w-[24px] ${PLAN_BADGE_STYLES[plan.code.toLowerCase()]?.text ?? "text-[#8AB6FF]"}`} />
            </div>
            <div>
              <div className="flex items-center gap-[10px]">
                <p className="text-[20px] font-bold text-[#EEEEEE] tracking-tight">
                  {plan.name}
                </p>
                <PlanBadge code={plan.code} />
              </div>
              <div className="mt-[6px] flex items-center gap-[8px]">
                <StatusBadge status={plan.status} />
                {plan.recurrenceLabel !== "N/A" && (
                  <>
                    <span className="h-[3px] w-[3px] rounded-full bg-[#333333]" />
                    <span className="text-[13px] text-[#666666]">{plan.recurrenceLabel}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={() => router.push("/#plans")}
            className="flex h-[40px] items-center justify-center gap-[8px] rounded-[12px] border border-[#1E1E1E] bg-[#111111] px-[18px] text-[13px] font-medium text-[#D8D8D8] transition hover:bg-[#1A1A1A] hover:text-[#FFFFFF]"
          >
            <ArrowRightLeft className="h-[14px] w-[14px]" />
            Alterar Plano
          </button>
        </div>

        {/* Plan Details Grid */}
        <div className="mt-[20px] grid grid-cols-2 gap-[12px] border-t border-[#141414] pt-[20px] sm:grid-cols-3">
          <div className="rounded-[12px] border border-[#141414] bg-[#080808] p-[14px]">
            <p className="text-[11px] uppercase tracking-wider text-[#555555]">Ativado em</p>
            <p className="mt-[6px] text-[14px] font-semibold text-[#DDDDDD]">{formatDate(plan.activatedAt)}</p>
          </div>
          <div className="rounded-[12px] border border-[#141414] bg-[#080808] p-[14px]">
            <p className="text-[11px] uppercase tracking-wider text-[#555555]">Expira em</p>
            <p className={`mt-[6px] text-[14px] font-semibold ${plan.status === "expired" ? "text-[#DB4646]" : "text-[#DDDDDD]"}`}>{formatDate(plan.expiresAt)}</p>
          </div>
          <div className="rounded-[12px] border border-[#141414] bg-[#080808] p-[14px]">
            <p className="text-[11px] uppercase tracking-wider text-[#555555]">Servidores máximos</p>
            <p className="mt-[6px] text-[14px] font-semibold text-[#DDDDDD]">
              {plan.maxLicensedServers === 0 ? "Sem limite" : plan.maxLicensedServers}
            </p>
          </div>
        </div>
      </div>

      {/* Upgrade CTA — only show for basic/inactive plans */}
      {(plan.code === "basic" || plan.status === "inactive" || plan.status === "expired") && (
        <div className="rounded-[20px] border border-[#181818] bg-[#0A0A0A] p-[24px]">
          <div className="flex items-start gap-[16px]">
            <div className="flex h-[44px] w-[44px] items-center justify-center rounded-[14px] border border-[#1A1A1A] bg-[#111111]">
              <Zap className="h-[20px] w-[20px] text-[#888888]" />
            </div>
            <div className="flex-1">
              <p className="text-[16px] font-semibold text-[#EEEEEE]">Faça upgrade do seu plano</p>
              <p className="mt-[4px] text-[14px] text-[#666666]">
                Desbloqueie mais servidores, automações avançadas e suporte prioritário.
              </p>
              <button
                onClick={() => router.push("/#plans")}
                className="group relative mt-[14px] inline-flex h-[42px] shrink-0 items-center justify-center overflow-visible whitespace-nowrap rounded-[12px] px-5 text-[13px] leading-none font-semibold"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-[12px] bg-[#F3F3F3] transition-transform duration-150 ease-out group-hover:scale-[1.02] group-active:scale-[0.985]"
                />
                <span className="relative z-10 inline-flex items-center gap-[8px] whitespace-nowrap leading-none text-[#111111]">
                  Ver planos disponíveis
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
