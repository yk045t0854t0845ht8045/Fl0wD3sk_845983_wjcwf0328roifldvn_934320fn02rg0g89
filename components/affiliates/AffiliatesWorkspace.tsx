"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import {
  MousePointerClick,
  Sparkles,
  Star,
  TrendingUp,
  Trophy,
  Webhook,
  Zap,
  Bell,
  BookOpen,
  ChevronDown,
  Code2,
  Copy,
  DollarSign,
  Globe,
  History,
  Link2,
  LogOut,
  Search,
  Settings2,
  Users,
  Check,
  ArrowRight,
  BarChart3,
  Ticket,
  type LucideIcon,
} from "lucide-react";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { LandingGlowTag } from "@/components/landing/LandingGlowTag";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import { AFFILIATE_LEVELS, formatCurrency, getLevelConfig } from "@/lib/affiliates/affiliateLevels";
import type {
  AffiliateLevel,
  AffiliateAIInsightCard,
  AffiliateProfile,
  AffiliateStats,
  AffiliateLink,
  AffiliateRankEntry,
  AffiliateCommission,
  AffiliateWithdrawal,
} from "@/lib/affiliates/affiliateTypes";

// ─── Types ────────────────────────────────────────────────────────────────────

type AffiliateTab =
  | "overview"
  | "links"
  | "commissions"
  | "withdrawals"
  | "ranking"
  | "notifications"
  | "components"
  | "training"
  | "templates";

type NavItem = {
  id: AffiliateTab;
  label: string;
  icon: LucideIcon;
  badge?: number;
};

export type AffiliatesWorkspaceProps = {
  displayName: string;
  username: string;
  avatarUrl: string | null;
  initialTab?: AffiliateTab;
};

// ─── Hook: Dados Reais ────────────────────────────────────────────────────────

function useAffiliateData() {
  const [data, setData] = useState<{
    profile: AffiliateProfile | null;
    stats: AffiliateStats | null;
    insight: AffiliateAIInsightCard | null;
    settings: any | null;
    links: AffiliateLink[];
    conversions: AffiliateCommission[];
    withdrawals: AffiliateWithdrawal[];
    ranking: AffiliateRankEntry[];
  }>({
    profile: null,
    stats: null,
    insight: null,
    settings: null,
    links: [],
    conversions: [],
    withdrawals: [],
    ranking: []
  });
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const res = await fetch("/api/affiliates/me");
      const json = await res.json();
      if (json.ok) {
        setData({
          profile: json.profile,
          stats: json.stats,
          insight: json.insight || null,
          settings: json.settings,
          links: json.links || [],
          conversions: json.conversions || [],
          withdrawals: json.withdrawals || [],
          ranking: json.ranking || []
        });
      }
    } catch (e) {
      console.error("Failed to load affiliate data", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return { ...data, loading, reload: load };
}

// ─── Skeletons ────────────────────────────────────────────────────────────────

function SkeletonBar({
  width,
  height,
  className = "",
}: {
  width: number | string;
  height: number | string;
  className?: string;
}) {
  return (
    <div
      className={`flowdesk-shimmer rounded-[12px] bg-[#171717] ${className}`.trim()}
      style={{ width, height }}
    />
  );
}

function TabSkeleton({ tab }: { tab: AffiliateTab }) {
  if (tab === "overview") {
    return (
      <div className="space-y-[32px]">
        {/* Banner */}
        <div className="h-[140px] rounded-[24px] border border-[#161616] bg-[#090909] p-[24px]">
          <SkeletonBar width={120} height={20} className="rounded-full" />
          <SkeletonBar width="40%" height={32} className="mt-[14px]" />
          <SkeletonBar width="60%" height={16} className="mt-[10px]" />
        </div>
        {/* Metric Grid */}
        <div className="grid gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-[100px] rounded-[22px] border border-[#161616] bg-[#090909] p-[20px]">
               <SkeletonBar width="40%" height={12} />
               <SkeletonBar width="70%" height={24} className="mt-[12px]" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (tab === "links") {
    return (
      <div className="space-y-[14px]">
        <div className="h-[80px] rounded-[20px] border border-[#161616] bg-[#090909]" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-[140px] rounded-[20px] border border-[#161616] bg-[#090909] p-[20px]">
             <div className="flex gap-[8px]">
                <SkeletonBar width={60} height={20} className="rounded-full" />
                <SkeletonBar width={60} height={20} className="rounded-full" />
             </div>
             <SkeletonBar width="100%" height={40} className="mt-[12px]" />
          </div>
        ))}
      </div>
    );
  }

  if (tab === "commissions" || tab === "withdrawals") {
    return (
      <div className="rounded-[20px] border border-[#161616] bg-[#090909] overflow-hidden">
        <div className="p-[20px] border-b border-[#161616]">
          <SkeletonBar width={120} height={16} />
        </div>
        {[1, 2, 3, 4, 5].map((i) => (
           <div key={i} className="flex items-center justify-between p-[20px] border-b border-[#0A0A0A] last:border-0 text-center">
             <SkeletonBar width="15%" height={12} />
             <SkeletonBar width="20%" height={12} />
             <SkeletonBar width="15%" height={12} />
             <SkeletonBar width="15%" height={12} />
           </div>
        ))}
      </div>
    );
  }

  if (tab === "notifications") {
    return (
      <div className="space-y-[14px]">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between gap-[20px] rounded-[20px] border border-[#161616] bg-[#090909] p-[20px]">
             <div className="min-w-0 flex-1">
                <SkeletonBar width="30%" height={14} />
                <SkeletonBar width="60%" height={12} className="mt-[6px]" />
             </div>
             <SkeletonBar width={40} height={22} className="rounded-full" />
          </div>
        ))}
        <SkeletonBar width={160} height={44} className="rounded-[14px]" />
      </div>
    );
  }

  if (tab === "ranking") {
      return (
        <div className="rounded-[24px] border border-[#161616] bg-[#090909] overflow-hidden">
             {[1, 2, 3, 4, 5].map((i) => (
                 <div key={i} className="flex items-center gap-[16px] p-[20px] border-b border-[#0A0A0A]">
                    <SkeletonBar width={24} height={16} />
                    <SkeletonBar width={40} height={40} className="rounded-full" />
                    <div className="flex-1">
                        <SkeletonBar width="25%" height={14} />
                        <SkeletonBar width="15%" height={10} className="mt-[4px]" />
                    </div>
                    <SkeletonBar width={80} height={20} className="rounded-full" />
                 </div>
             ))}
        </div>
      );
  }

  // Default grid skeleton for training, templates, components
  return (
    <div className="grid gap-[14px] sm:grid-cols-2">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-[200px] rounded-[22px] border border-[#161616] bg-[#090909] p-[22px]">
           <SkeletonBar width={48} height={48} className="rounded-[14px]" />
           <SkeletonBar width="50%" height={18} className="mt-[14px]" />
           <SkeletonBar width="80%" height={14} className="mt-[8px]" />
           <SkeletonBar width={100} height={32} className="mt-[20px] rounded-full" />
        </div>
      ))}
    </div>
  );
}

// ─── Nav Config ───────────────────────────────────────────────────────────────

const NAV_GROUPS: { category: string; icon: LucideIcon; items: NavItem[] }[] = [
  {
    category: "Visão Geral",
    icon: BarChart3,
    items: [
      { id: "overview", label: "Dashboard", icon: BarChart3 },
      { id: "links", label: "Meus Links", icon: Link2 },
      { id: "commissions", label: "Comissões", icon: DollarSign },
      { id: "withdrawals", label: "Histórico de Saques", icon: History },
    ],
  },
  {
    category: "Comunidade",
    icon: Users,
    items: [
      { id: "ranking", label: "Ranking", icon: Trophy },
      { id: "training", label: "Treinamento", icon: BookOpen },
    ],
  },
  {
    category: "Ferramentas",
    icon: Settings2,
    items: [
      { id: "notifications", label: "Notificações & Webhook", icon: Bell },
      { id: "components", label: "Componentes Prontos", icon: Code2 },
      { id: "templates", label: "Templates de Site", icon: Globe },
    ],
  },
];

const PAGE_META: Record<AffiliateTab, { eyebrow: string; title: string; subtitle: string }> = {
  overview: {
    eyebrow: "Afiliado",
    title: "Dashboard",
    subtitle: "Acompanhe suas métricas, conversões e ganhos em tempo real.",
  },
  links: {
    eyebrow: "Ferramentas",
    title: "Meus Links",
    subtitle: "Links exclusivos por plano e período para você divulgar.",
  },
  commissions: {
    eyebrow: "Financeiro",
    title: "Comissões",
    subtitle: "Histórico completo de pagamentos aprovados com seu link.",
  },
  withdrawals: {
    eyebrow: "Financeiro",
    title: "Histórico de Saques",
    subtitle: "Todos os saques realizados e seu status atual.",
  },
  ranking: {
    eyebrow: "Comunidade",
    title: "Ranking de Afiliados",
    subtitle: "Top afiliados do mês com bônus e benefícios especiais.",
  },
  notifications: {
    eyebrow: "Configurações",
    title: "Notificações & Webhook",
    subtitle: "Configure alertas por email, SMS, push e webhook personalizado.",
  },
  components: {
    eyebrow: "Ferramentas",
    title: "Componentes Prontos",
    subtitle: "Botões e cards em HTML e React para implantar no seu site.",
  },
  training: {
    eyebrow: "Comunidade",
    title: "Treinamento",
    subtitle: "Aprenda as melhores estratégias para vender mais.",
  },
  templates: {
    eyebrow: "Ferramentas",
    title: "Templates de Site",
    subtitle: "Sites prontos para afiliados com subdomínio personalizado.",
  },
};

// ─── Sidebar Avatar ───────────────────────────────────────────────────────────

function AccountAvatar({
  avatarUrl,
  displayName,
  size = 38,
}: {
  avatarUrl: string | null;
  displayName: string;
  size?: number;
}) {
  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt={displayName}
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
        unoptimized
      />
    );
  }
  const initials = displayName.slice(0, 2).toUpperCase();
  return (
    <div
      className="flex items-center justify-center rounded-full bg-[linear-gradient(135deg,#1a3a7a,#0d1f47)] font-semibold text-[#8AB6FF]"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </div>
  );
}

// ─── Level Badge ──────────────────────────────────────────────────────────────

function LevelBadge({ level, size = "sm" }: { level: AffiliateLevel; size?: "sm" | "lg" }) {
  const config = getLevelConfig(level);
  const isLg = size === "lg";
  const Icon = config.icon;
  return (
    <span
      className={`inline-flex items-center gap-[6px] rounded-full font-semibold ${isLg ? "px-[14px] py-[6px] text-[13px]" : "px-[9px] py-[3px] text-[11px]"}`}
      style={{
        color: config.color,
        background: config.bgColor,
        border: `1px solid ${config.borderColor}`,
      }}
    >
      <Icon className="h-[12px] w-[12px]" strokeWidth={2.2} />
      {config.label}
    </span>
  );
}

// ─── Metric Card ──────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  trend,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  trend?: string;
}) {
  return (
    <div className="rounded-[20px] border border-[#0E0E0E] bg-[#070707] p-[20px]">
      <div className="flex items-center justify-between">
        <div
          className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-[12px] border border-[#131313] bg-[#0C0C0C] text-[#E5E5E5]"
        >
          <Icon className="h-[17px] w-[17px]" strokeWidth={1.8} />
        </div>
        {trend && (
          <span className="flex items-center gap-[4px] text-[12px] text-[#A0A0A0]">
            <TrendingUp className="h-[11px] w-[11px]" />
            {trend}
          </span>
        )}
      </div>
      <p className="mt-[14px] text-[26px] font-semibold leading-none tracking-[-0.04em] text-[#FFFFFF]">
        {value}
      </p>
      <p className="mt-[6px] text-[12px] text-[#5A5A5A]">{label}</p>
      {sub && <p className="mt-[2px] text-[11px] text-[#484848]">{sub}</p>}
    </div>
  );
}

// ─── Copy Button ──────────────────────────────────────────────────────────────

function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // noop
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-[6px] rounded-[10px] border border-[#191919] bg-[#0D0D0D] px-[10px] py-[6px] text-[12px] font-medium text-[#B0B0B0] transition-colors hover:border-[#252525] hover:text-[#E8E8E8]"
    >
      {copied ? (
        <>
          <Check className="h-[12px] w-[12px] text-[#FFFFFF]" strokeWidth={2.5} />
          Copiado!
        </>
      ) : (
        <>
          <Copy className="h-[12px] w-[12px]" strokeWidth={1.9} />
          {label}
        </>
      )}
    </button>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({
  profile,
  stats,
  insight,
}: {
  profile: AffiliateProfile | null;
  stats: AffiliateStats | null;
  insight: AffiliateAIInsightCard | null;
}) {
  const level = profile?.level ?? "bronze";
  const config = getLevelConfig(level);
  const insightType = insight?.insight.type ?? "tip";
  const insightConfidence = Math.round((insight?.insight.confidence ?? 0.5) * 100);
  const insightTone =
    insightType === "warning"
      ? {
          border: "rgba(255,255,255,0.1)",
          badge: "border-[#252525] bg-[#101010] text-[#D8D8D8]",
          eyebrow: "Atenção da IA",
        }
      : insightType === "opportunity"
        ? {
            border: "rgba(255,255,255,0.14)",
            badge: "border-[#2A2A2A] bg-[#111111] text-[#FFFFFF]",
            eyebrow: "Oportunidade com IA",
          }
        : {
            border: "rgba(255,255,255,0.08)",
            badge: "border-[#1F1F1F] bg-[#0C0C0C] text-[#D0D0D0]",
            eyebrow: "Insight com IA",
          };

  return (
    <div className="space-y-[20px]">
      {/* Level banner */}
      <div
        className="relative overflow-hidden rounded-[24px] border p-[24px]"
        style={{
          borderColor: config.borderColor,
          background: `linear-gradient(135deg, #070707 0%, ${config.bgColor} 100%)`,
        }}
      >
        <div className="flex flex-col gap-[14px] sm:flex-row sm:items-center sm:justify-between">
          <div>
            <LevelBadge level={level} size="lg" />
            <p className="mt-[10px] text-[22px] font-medium tracking-[-0.04em] text-[#E5E5E5]">
              Comissão atual: <span style={{ color: config.color }}>{config.commissionPct}%</span>
            </p>
            {stats?.rankThisMonth && (
              <p className="mt-[4px] text-[13px]" style={{ color: config.color }}>
                + {stats.rankThisMonth === 1 ? "5" : stats.rankThisMonth === 2 ? "3" : "2"}% bônus de ranking
              </p>
            )}
          </div>
          {profile?.affiliateId && (
            <div className="shrink-0">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#555]">Seu ID de Afiliado</p>
              <div className="mt-[6px] flex items-center gap-[8px]">
                <code className="rounded-[8px] border border-[#151515] bg-[#0A0A0A] px-[10px] py-[5px] font-mono text-[12px] text-[#C4C4C4]">
                  {profile.affiliateId}
                </code>
                <CopyButton text={profile.affiliateId} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Cliques hoje"
          value={String(stats?.clicksToday ?? 0)}
          sub={`Total: ${stats?.totalClicks ?? 0} cliques`}
          icon={MousePointerClick}
        />
        <MetricCard
          label="Vendas este mês"
          value={String(stats?.salesThisMonth ?? 0)}
          sub={`Total: ${stats?.totalSales ?? 0} vendas`}
          icon={TrendingUp}
        />
        <MetricCard
          label="Comissão pendente"
          value={formatCurrency(stats?.totalCommissionPending ?? 0)}
          sub="Aguardando aprovação"
          icon={DollarSign}
        />
        <MetricCard
          label="Saldo disponível"
          value={formatCurrency(stats?.availableBalance ?? 0)}
          sub="Disponível para saque"
          icon={Zap}
        />
      </div>

      {/* Coupon display */}
      {profile?.couponCode && (
        <div className="rounded-[20px] border border-[#0E0E0E] bg-[#070707] p-[20px]">
          <p className="text-[12px] uppercase tracking-[0.16em] text-[#555]">Cupom personalizado</p>
          <div className="mt-[10px] flex items-center gap-[12px]">
            <code className="rounded-[12px] border border-[#181818] bg-[#0C0C0C] px-[16px] py-[10px] font-mono text-[20px] font-bold tracking-widest text-[#E8E8E8]">
              {profile.couponCode}
            </code>
            <CopyButton text={profile.couponCode} label="Copiar cupom" />
          </div>
          <p className="mt-[8px] text-[12px] text-[#484848]">
            Compartilhe este cupom para que compradores identifiquem sua indicação.
          </p>
        </div>
      )}

      {/* WhatsApp group */}
      {profile?.whatsappGroupUrl && (
        <div className="rounded-[20px] border border-[#181818] bg-[#070707] p-[20px]">
          <div className="flex items-center justify-between gap-[14px]">
            <div className="flex items-center gap-[12px]">
              <div className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-[12px] border border-[#181818] bg-[#0A0A0A] text-white">
                <Users className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </div>
              <div>
                <p className="text-[14px] font-medium text-[#E0E0E0]">Grupo Exclusivo de Afiliados</p>
                <p className="text-[12px] text-[#636363]">Treinamentos, dicas e suporte direto</p>
              </div>
            </div>
            <a
              href={profile.whatsappGroupUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-[6px] rounded-[12px] border border-[#181818] bg-[#FFFFFF] px-[14px] py-[8px] text-[13px] font-semibold text-[#000000] transition-opacity hover:opacity-90"
            >
              Entrar no grupo
              <ArrowRight className="h-[13px] w-[13px]" strokeWidth={2.2} />
            </a>
          </div>
        </div>
      )}

      {/* AI Insight placeholder */}
      <div
        className="rounded-[20px] border bg-[#070707] p-[20px]"
        style={{ borderColor: insightTone.border }}
      >
        <div className="flex items-center justify-between gap-[12px]">
          <div className="flex items-center gap-[8px]">
            <Sparkles className="h-[16px] w-[16px] text-[#FFFFFF]" strokeWidth={1.8} />
            <p className="text-[12px] uppercase tracking-[0.16em] text-[#555]">
              {insightTone.eyebrow}
            </p>
          </div>
          <span
            className={`inline-flex rounded-full border px-[9px] py-[4px] text-[10px] font-semibold uppercase tracking-[0.08em] ${insightTone.badge}`}
          >
            {insightConfidence}% conf.
          </span>
        </div>
        <p className="mt-[12px] text-[16px] font-medium tracking-[-0.03em] text-[#E8E8E8]">
          {insight?.insight.title || "Seu painel está aprendendo com seus dados"}
        </p>
        <p className="mt-[8px] text-[14px] leading-[1.65] text-[#909090]">
          {insight?.insight.body ||
            "Assim que houver mais dados reais de performance, a IA vai destacar o melhor próximo passo para você converter mais."}
        </p>
        <p className="mt-[8px] text-[12px] text-[#555]">
          {insight?.periodLabel || "Baseado nos últimos 30 dias"}
        </p>
      </div>
    </div>
  );
}

// ─── Links Tab ────────────────────────────────────────────────────────────────

function LinksTab({ links, reload }: { links: AffiliateLink[]; reload: () => void }) {
  const [isCreating, setIsCreating] = useState(false);
  const [plan, setPlan] = useState("pro");
  const [period, setPeriod] = useState("monthly");
  const [loading, setLoading] = useState(false);

  const PLAN_LABELS: Record<string, string> = { basic: "Basic", pro: "Pro", enterprise: "Enterprise" };
  const PERIOD_LABELS: Record<string, string> = { monthly: "Mensal", annual: "Anual" };

  const handleCreate = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/affiliates/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planSlug: plan, period }),
      });
      const json = await res.json();
      if (json.ok) {
        setIsCreating(false);
        reload();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-[14px]">
      {/* Create Link Section */}
      <div className="rounded-[20px] border border-[#0E0E0E] bg-[#070707] p-[20px]">
        {isCreating ? (
          <div className="space-y-[16px]">
             <div className="grid grid-cols-2 gap-[12px]">
                <div className="space-y-[6px]">
                  <p className="text-[12px] text-[#555]">Plano</p>
                  <select 
                    value={plan} 
                    onChange={(e) => setPlan(e.target.value)}
                    className="w-full rounded-[10px] border border-[#151515] bg-[#0A0A0A] px-[12px] py-[8px] text-[13px] text-[#E0E0E0] outline-none"
                  >
                    <option value="basic">Basic</option>
                    <option value="pro">Pro</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                <div className="space-y-[6px]">
                  <p className="text-[12px] text-[#555]">Período</p>
                  <select 
                    value={period} 
                    onChange={(e) => setPeriod(e.target.value)}
                    className="w-full rounded-[10px] border border-[#151515] bg-[#0A0A0A] px-[12px] py-[8px] text-[13px] text-[#E0E0E0] outline-none"
                  >
                    <option value="monthly">Mensal</option>
                    <option value="annual">Anual</option>
                  </select>
                </div>
             </div>
             <div className="flex gap-[8px]">
                <button 
                  onClick={handleCreate} 
                  disabled={loading}
                  className="flex-1 rounded-[12px] bg-white py-[10px] text-[13px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {loading ? <ButtonLoader size={16} colorClassName="text-black" /> : "Gerar Link de Afiliado"}
                </button>
                <button 
                  onClick={() => setIsCreating(false)} 
                  className="rounded-[12px] border border-[#151515] bg-[#0A0A0A] px-5 py-[10px] text-[13px] font-medium text-[#888] hover:bg-[#111]"
                >
                  Cancelar
                </button>
             </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-[20px]">
            <div>
              <p className="text-[14px] font-medium text-[#E0E0E0]">Gerar novo link</p>
              <p className="mt-[2px] text-[12px] text-[#555]">Crie links personalizados para planos específicos.</p>
            </div>
            <button 
              onClick={() => setIsCreating(true)}
              className="rounded-[12px] border border-[#1A1A1A] bg-[#0C0C0C] px-[16px] py-[8px] text-[13px] font-medium text-[#E0E0E0] transition-colors hover:border-[#222] hover:bg-[#111]"
            >
              Novo Link
            </button>
          </div>
        )}
      </div>

      {links.length === 0 ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center rounded-[24px] border border-dashed border-[#151515] bg-[#050505] p-[40px] text-center">
          <div className="flex h-[48px] w-[48px] items-center justify-center rounded-full border border-[#181818] bg-[#0A0A0A] text-[#444]">
            <Link2 className="h-[20px] w-[20px]" />
          </div>
          <p className="mt-[16px] text-[14px] font-medium text-[#E0E0E0]">Nenhum link gerado</p>
          <p className="mt-[4px] text-[12px] text-[#555]">Crie seu primeiro link acima para começar a divulgar.</p>
        </div>
      ) : (
        links.map((link) => (
          <div key={link.linkId} className="rounded-[20px] border border-[#0E0E0E] bg-[#070707] p-[20px]">
            <div className="flex flex-col gap-[16px]">
              <div className="space-y-[12px]">
                <div className="flex flex-wrap items-center gap-[8px]">
                  <span className="rounded-full border border-[#181818] bg-[#0C0C0C] px-[9px] py-[3px] text-[11px] font-semibold text-[#D0D0D0]">
                    {PLAN_LABELS[link.plan as any] || link.plan}
                  </span>
                  <span className="rounded-full border border-[#181818] bg-[#0C0C0C] px-[9px] py-[3px] text-[11px] text-[#888]">
                    {PERIOD_LABELS[link.period as any] || link.period}
                  </span>
                </div>
                <div className="flex items-center gap-[8px]">
                  <code className="min-w-0 flex-1 truncate rounded-[10px] border border-[#131313] bg-[#0A0A0A] px-[12px] py-[8px] font-mono text-[13px] text-[#C0C0C0]">
                    {link.shortUrl}
                  </code>
                  <CopyButton text={link.url} />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-[10px] border-t border-[#121212] pt-[16px]">
                <div>
                  <p className="text-[12px] text-[#555]">Cliques</p>
                  <p className="mt-[2px] text-[16px] font-semibold text-[#E5E5E5]">{link.clicks || 0}</p>
                </div>
                <div>
                  <p className="text-[12px] text-[#555]">Conversões</p>
                  <p className="mt-[2px] text-[16px] font-semibold text-[#E5E5E5]">{link.conversions || 0}</p>
                </div>
                <div>
                  <p className="text-[12px] text-[#555]">Taxa</p>
                  <p className="mt-[2px] text-[16px] font-semibold text-[#E5E5E5]">
                    {link.conversionRate?.toFixed(1) || "0.0"}%
                  </p>
                </div>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Components Tab ───────────────────────────────────────────────────────────

function ComponentsTab({ profile }: { profile: AffiliateProfile | null }) {
  const affiliateId = profile?.affiliateId || (profile as any)?.affiliate_id || "---";
  const demoAffId = affiliateId;
  const [activeSnippet, setActiveSnippet] = useState<"html" | "react">("html");

  const htmlSnippet = `<!-- Botão Flowdesk — CDN: cdn.flwdesk.com/affiliate/v1.css -->
<link rel="stylesheet" href="https://cdn.flwdesk.com/affiliate/v1.css" />

<a
  href="https://flwdesk.com/r/${demoAffId}"
  class="flwdesk-btn flwdesk-btn-primary"
  data-affiliate-id="${demoAffId}"
>
  Assinar Flowdesk
</a>

<!-- Botão Pro -->
<a
  href="https://flwdesk.com/r/${demoAffId}?plan=pro"
  class="flwdesk-btn flwdesk-btn-pro"
>
  Plano Pro — Começar agora
</a>`;

  const reactSnippet = `// npm install @flowdesk/affiliate-sdk
import { FlowdeskButton, FlowdeskCard } from '@flowdesk/affiliate-sdk';

// Botão simples
export function MyPage() {
  return (
    <FlowdeskButton
      affiliateId="${demoAffId}"
      plan="pro"
      period="monthly"
    >
      Assinar Flowdesk Pro
    </FlowdeskButton>
  );
}`;

  return (
    <div className="space-y-[20px]">
      <div className="rounded-[20px] border border-[#0E0E0E] bg-[#070707] p-[24px]">
        <p className="text-[12px] uppercase tracking-[0.16em] text-[#555]">Seu ID de afiliado</p>
        <div className="mt-[8px] flex items-center gap-[8px]">
          <code className="rounded-[10px] border border-[#151515] bg-[#0A0A0A] px-[12px] py-[6px] font-mono text-[13px] text-[#C8C8C8]">
            {demoAffId}
          </code>
          <CopyButton text={demoAffId} />
        </div>
      </div>

      <div className="rounded-[20px] border border-[#0E0E0E] bg-[#070707] overflow-hidden">
        <div className="flex border-b border-[#0E0E0E]">
          {(["html", "react"] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => setActiveSnippet(lang)}
              className={`flex-1 py-[12px] text-[13px] font-medium transition-colors ${
                activeSnippet === lang
                  ? "bg-[#0C0C0C] text-[#E0E0E0]"
                  : "text-[#5A5A5A] hover:text-[#9A9A9A]"
              }`}
            >
              {lang === "html" ? "HTML + CDN" : "React / Next.js"}
            </button>
          ))}
        </div>
        <div className="p-[20px]">
          <pre className="overflow-x-auto font-mono text-[12px] text-[#888]">
            <code>{activeSnippet === "html" ? htmlSnippet : reactSnippet}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}

// ─── Ranking Tab ──────────────────────────────────────────────────────────────

function RankingTab({ ranking }: { ranking: AffiliateRankEntry[] }) {
  const rankColors = ["#FFFFFF", "#D0D0D0", "#A0A0A0"];
  const rankIcons = [Trophy, Star, Zap];

  if (ranking.length === 0) {
    return (
      <div className="flex h-[300px] flex-col items-center justify-center rounded-[24px] border border-dashed border-[#151515] bg-[#050505] p-[40px] text-center">
        <Trophy className="h-[32px] w-[32px] text-[#222]" />
        <p className="mt-[16px] text-[14px] font-medium text-[#E0E0E0]">Ranking em processamento</p>
        <p className="mt-[4px] text-[12px] text-[#555]">Os dados de performance deste mês ainda estão sendo calculados.</p>
      </div>
    );
  }

  return (
    <div className="space-y-[12px]">
      <div className="grid gap-[12px] sm:grid-cols-3">
        {ranking.slice(0, 3).map((entry) => {
          const rankColor = rankColors[entry.rank - 1];
          const RankIcon = rankIcons[entry.rank - 1];
          return (
            <div
              key={entry.affiliateId}
              className="relative overflow-hidden rounded-[20px] border border-[#121212] bg-[#070707] p-[20px] text-center"
              style={{ borderColor: `${rankColor}15` }}
            >
              <div className="absolute top-[12px] right-[12px] text-[#444]">
                <RankIcon className="h-[18px] w-[18px]" strokeWidth={2} />
              </div>
              <div
                className="mx-auto flex h-[48px] w-[48px] items-center justify-center rounded-full text-[20px] font-bold bg-[#111] text-[#E5E5E5] border border-[#181818]"
              >
                {entry.avatarUrl ? (
                    <Image src={entry.avatarUrl} alt={entry.displayName} width={48} height={48} className="rounded-full" unoptimized />
                ) : entry.displayName[0]}
              </div>
              <p className="mt-[10px] text-[15px] font-medium text-[#E8E8E8]">{entry.displayName}</p>
              <div className="mt-[12px] text-[20px] font-semibold" style={{ color: rankColor }}>
                {formatCurrency(entry.commissionThisMonth || 0)}
              </div>
              <p className="text-[12px] text-[#666]">{entry.salesThisMonth || 0} vendas</p>
            </div>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-[20px] border border-[#0E0E0E] bg-[#070707]">
        {ranking.slice(3).map((entry, i) => {
          return (
            <div
              key={entry.affiliateId}
              className={`flex items-center gap-[14px] px-[20px] py-[16px] ${i > 0 ? "border-t border-[#0A0A0A]" : ""}`}
            >
              <span className="w-[24px] text-center text-[14px] font-semibold text-[#444]">{entry.rank}º</span>
              <div
                className="flex h-[36px] w-[36px] items-center justify-center rounded-full text-[14px] font-bold bg-[#111] text-[#AFAFAF] border border-[#151515]"
              >
                {entry.avatarUrl ? (
                    <Image src={entry.avatarUrl} alt={entry.displayName} width={36} height={36} className="rounded-full" unoptimized />
                ) : entry.displayName[0]}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-[#D0D0D0]">{entry.displayName}</p>
              </div>
              <div className="text-right">
                <p className="text-[14px] font-semibold text-[#E0E0E0]">{formatCurrency(entry.commissionThisMonth || 0)}</p>
                <p className="text-[11px] text-[#555]">{entry.salesThisMonth || 0} vendas</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Commissions Tab ──────────────────────────────────────────────────────────

function CommissionsTab({ commissions }: { commissions: AffiliateCommission[] }) {
  if (commissions.length === 0) {
    return (
      <div className="flex h-[300px] flex-col items-center justify-center rounded-[24px] border border-dashed border-[#151515] bg-[#050505] p-[40px] text-center">
        <DollarSign className="h-[32px] w-[32px] text-[#222]" />
        <p className="mt-[16px] text-[14px] font-medium text-[#E0E0E0]">Nenhuma comissão registrada</p>
        <p className="mt-[4px] text-[12px] text-[#555]">Suas comissões aparecerão aqui assim que as vendas forem aprovadas.</p>
      </div>
    );
  }

  return (
    <div className="rounded-[20px] border border-[#0E0E0E] bg-[#070707] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-[#0E0E0E] bg-[#0A0A0A] text-[#555]">
              <th className="px-[20px] py-[14px] font-medium">Data</th>
              <th className="px-[20px] py-[14px] font-medium">Pedido</th>
              <th className="px-[20px] py-[14px] font-medium">Valor Venda</th>
              <th className="px-[20px] py-[14px] font-medium">Comissão</th>
              <th className="px-[20px] py-[14px] font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#0A0A0A]">
            {commissions.map((c) => (
              <tr key={c.commissionId} className="hover:bg-[#090909] transition-colors">
                <td className="px-[20px] py-[16px] text-[#A0A0A0] whitespace-nowrap">
                  {new Date(c.createdAt).toLocaleDateString("pt-BR")}
                </td>
                <td className="px-[20px] py-[16px] text-[#E0E0E0] font-mono whitespace-nowrap">
                    #{c.commissionId.split("-")[0].toUpperCase()}
                </td>
                <td className="px-[20px] py-[16px] text-[#A0A0A0]">
                  {formatCurrency(c.saleAmount)}
                </td>
                <td className="px-[20px] py-[16px] font-medium text-[#FFFFFF]">
                  {formatCurrency(c.commissionAmount)}
                </td>
                <td className="px-[20px] py-[16px]">
                  <span className={`inline-flex rounded-full px-[8px] py-[2px] text-[10px] font-bold uppercase border ${
                    c.status === "approved" ? "border-[#FFFFFF]/20 bg-[#FFFFFF]/5 text-[#FFFFFF]" :
                    c.status === "pending" ? "border-[#444]/20 bg-[#444]/5 text-[#666]" :
                    "border-red-900/20 bg-red-900/5 text-red-500"
                  }`}>
                    {c.status === "approved" ? "Aprovado" : c.status === "pending" ? "Pendente" : "Cancelado"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Withdrawals Tab ──────────────────────────────────────────────────────────

function WithdrawalsTab({ withdrawals }: { withdrawals: AffiliateWithdrawal[] }) {
  if (withdrawals.length === 0) {
    return (
      <div className="flex h-[300px] flex-col items-center justify-center rounded-[24px] border border-dashed border-[#151515] bg-[#050505] p-[40px] text-center">
        <History className="h-[32px] w-[32px] text-[#222]" />
        <p className="mt-[16px] text-[14px] font-medium text-[#E0E0E0]">Nenhum saque solicitado</p>
        <p className="mt-[4px] text-[12px] text-[#555]">Você poderá ver seu histórico completo de saques aqui.</p>
      </div>
    );
  }

  return (
    <div className="rounded-[20px] border border-[#0E0E0E] bg-[#070707] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-[#0E0E0E] bg-[#0A0A0A] text-[#555]">
              <th className="px-[20px] py-[14px] font-medium">Data</th>
              <th className="px-[20px] py-[14px] font-medium">Valor</th>
              <th className="px-[20px] py-[14px] font-medium">Chave PIX</th>
              <th className="px-[20px] py-[14px] font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#0A0A0A]">
            {withdrawals.map((w) => (
              <tr key={w.withdrawalId} className="hover:bg-[#090909] transition-colors">
                <td className="px-[20px] py-[16px] text-[#A0A0A0]">
                  {new Date(w.requestedAt).toLocaleDateString("pt-BR")}
                </td>
                <td className="px-[20px] py-[16px] font-medium text-[#FFFFFF]">
                  {formatCurrency(w.amount)}
                </td>
                <td className="px-[20px] py-[16px] text-[#A0A0A0] font-mono">
                  {w.pixKey}
                </td>
                <td className="px-[20px] py-[16px]">
                  <span className={`inline-flex rounded-full px-[8px] py-[2px] text-[10px] font-bold uppercase border ${
                    w.status === "paid" ? "border-[#FFFFFF]/20 bg-[#FFFFFF]/5 text-[#FFFFFF]" :
                    "border-[#444]/20 bg-[#444]/5 text-[#666]"
                  }`}>
                    {w.status === "paid" ? "Pago" : "Pendente"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ─── Notifications Tab ────────────────────────────────────────────────────────

function NotificationsTab({ settings, reload }: { settings: any; reload: () => void }) {
  const [emailEnabled, setEmailEnabled] = useState(settings?.notify_email ?? true);
  const [smsEnabled, setSmsEnabled] = useState(settings?.notify_sms ?? false);
  const [webhookEnabled, setWebhookEnabled] = useState(!!settings?.webhook_url);
  const [webhookUrl, setWebhookUrl] = useState(settings?.webhook_url || "");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) {
      setEmailEnabled(settings.notify_email);
      setSmsEnabled(settings.notify_sms);
      setWebhookEnabled(!!settings.webhook_url);
      setWebhookUrl(settings.webhook_url || "");
    }
  }, [settings]);

  const handleSave = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/affiliates/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUrl: webhookEnabled ? webhookUrl : null,
          notifyEmail: emailEnabled,
          notifySms: smsEnabled,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setSaved(true);
        reload();
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={onToggle}
        className={`relative h-[22px] w-[38px] rounded-full transition-colors duration-200 ${enabled ? "bg-[#FFFFFF]" : "bg-[#1A1A1A]"}`}
      >
        <span
          className={`absolute top-[3px] left-[3px] h-[16px] w-[16px] rounded-full transition-transform duration-200 ${enabled ? "translate-x-[16px] bg-[#000]" : "translate-x-0 bg-[#333]"}`}
        />
      </button>
    );
  }

  return (
    <div className="space-y-[14px]">
      {[
        { label: "Notificações por Email", desc: "Receba um email a cada venda aprovada, pendente ou cancelada.", enabled: emailEnabled, onToggle: () => setEmailEnabled(!emailEnabled) },
        { label: "Notificações por SMS", desc: "Alerta no celular a cada venda aprovada.", enabled: smsEnabled, onToggle: () => setSmsEnabled(!smsEnabled) },
      ].map((item) => (
        <div key={item.label} className="flex items-center justify-between gap-[20px] rounded-[20px] border border-[#0E0E0E] bg-[#070707] p-[20px]">
          <div>
            <p className="text-[14px] font-medium text-[#D8D8D8]">{item.label}</p>
            <p className="mt-[4px] text-[12px] leading-[1.55] text-[#5A5A5A]">{item.desc}</p>
          </div>
          <Toggle enabled={item.enabled} onToggle={item.onToggle} />
        </div>
      ))}

      {/* Webhook */}
      <div className="rounded-[20px] border border-[#0E0E0E] bg-[#070707] p-[20px]">
        <div className="flex items-center justify-between gap-[20px]">
          <div>
            <p className="text-[14px] font-medium text-[#D8D8D8]">Webhook Personalizado</p>
            <p className="mt-[4px] text-[12px] leading-[1.55] text-[#5A5A5A]">
              Receba um POST em tempo real para vendas Pendentes, Aprovadas e Canceladas.
            </p>
          </div>
          <Toggle enabled={webhookEnabled} onToggle={() => setWebhookEnabled(!webhookEnabled)} />
        </div>
        {webhookEnabled && (
          <div className="mt-[16px] space-y-[10px]">
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://meusite.com/webhook/flowdesk"
              className="h-[44px] w-full rounded-[14px] border border-[#151515] bg-[#0A0A0A] px-[14px] text-[13px] text-[#E0E0E0] outline-none transition-colors placeholder:text-[#444] focus:border-[rgba(255,255,255,0.12)]"
            />
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={loading}
        className="group relative inline-flex h-[44px] items-center justify-center overflow-visible whitespace-nowrap rounded-[14px] px-6 text-[14px] font-semibold"
      >
        <span className="absolute inset-0 rounded-[14px] bg-[#F3F3F3] transition-transform duration-150 group-hover:scale-[1.02] group-active:scale-[0.985]" />
        <span className="relative z-10 flex items-center gap-[7px] text-[#111]">
          {loading ? <ButtonLoader size={16} colorClassName="text-black" /> : saved ? <><Check className="h-[14px] w-[14px]" strokeWidth={2.5} /> Salvo!</> : "Salvar configurações"}
        </span>
      </button>
    </div>
  );
}

// ─── Training Tab ─────────────────────────────────────────────────────────────

function TrainingTab() {
  const modules = [
    { title: "Como divulgar no Instagram", duration: "12 min", icon: Globe, available: true },
    { title: "Estratégias no YouTube", duration: "19 min", icon: Zap, available: true },
    { title: "Email marketing para afiliados", duration: "24 min", icon: Bell, available: true },
    { title: "Criando conteúdo que converte", duration: "31 min", icon: Sparkles, available: false },
    { title: "Vendas com grupos de WhatsApp", duration: "15 min", icon: Users, available: false },
  ];

  return (
    <div className="space-y-[10px]">
      {modules.map((mod) => (
        <div
          key={mod.title}
          className={`flex items-center gap-[16px] rounded-[18px] border border-[#0E0E0E] bg-[#070707] p-[18px] ${mod.available ? "cursor-pointer hover:border-[#181818]" : "opacity-50 cursor-not-allowed"}`}
        >
          <div className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-[12px] bg-[#111] border border-[#181818] text-[#8A8A8A]">
            <mod.icon className="h-[20px] w-[20px]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium text-[#D8D8D8]">{mod.title}</p>
            <p className="text-[12px] text-[#555]">{mod.duration}</p>
          </div>
          {mod.available ? (
            <ArrowRight className="h-[15px] w-[15px] shrink-0 text-[#444]" strokeWidth={1.8} />
          ) : (
            <span className="rounded-full border border-[#1A1A1A] px-[8px] py-[3px] text-[10px] text-[#555]">Em breve</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Templates Tab ────────────────────────────────────────────────────────────

function TemplatesTab({ profile }: { profile: any }) {
  const router = useRouter();
  const templates = [
    { name: "Landing Minimalista", desc: "Design clean para conversão focada.", icon: BarChart3, status: "available", plan: "basic" },
    { name: "Landing Premium", desc: "Visual premium com seções completas.", icon: Zap, status: "available", plan: "pro" },
    { name: "Página de IA", desc: "Apresente recursos de automação.", icon: Sparkles, status: "soon", plan: "pro" },
    { name: "Blog de Afiliado", desc: "Conteúdo focado em SEO.", icon: BookOpen, status: "soon", plan: "basic" },
  ];

  const handleUseTemplate = (plan: string) => {
    if (!profile) return;
    const url = `https://flwdesk.com/register?aff=${profile.affiliateId}&template=${plan}`;
    window.open(url, "_blank");
  };

  return (
    <div className="grid gap-[14px] sm:grid-cols-2">
      {templates.map((tpl) => (
        <div key={tpl.name} className="rounded-[22px] border border-[#0E0E0E] bg-[#070707] p-[22px]">
          <div className="inline-flex h-[48px] w-[48px] items-center justify-center rounded-[14px] bg-[#111] border border-[#181818] text-[#8A8A8A]">
            <tpl.icon className="h-[24px] w-[24px]" />
          </div>
          <h3 className="mt-[14px] text-[16px] font-medium text-[#E0E0E0]">{tpl.name}</h3>
          <p className="mt-[6px] text-[13px] leading-[1.6] text-[#656565]">{tpl.desc}</p>
          <div className="mt-[18px]">
            {tpl.status === "available" ? (
              <button
                type="button"
                onClick={() => handleUseTemplate(tpl.plan)}
                className="inline-flex items-center gap-[6px] rounded-[12px] border border-[#1A1A1A] bg-[#0C0C0C] px-[14px] py-[8px] text-[13px] font-medium text-[#C8C8C8] transition-colors hover:border-[#252525] hover:text-[#E8E8E8]"
              >
                Usar template <ArrowRight className="h-[12px] w-[12px]" strokeWidth={2} />
              </button>
            ) : (
              <span className="inline-flex rounded-full border border-[#1A1A1A] px-[10px] py-[5px] text-[11px] text-[#555]">
                Em breve
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Placeholder for unused icon ──────────────────────────────────────────────
function MousePointerClickIcon({ className, strokeWidth }: { className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth ?? 1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 4.5v15.6l4.5-5.1 4.5 5.1V4.5a1.5 1.5 0 0 0-1.5-1.5h-6A1.5 1.5 0 0 0 9 4.5z" />
    </svg>
  );
}

// ─── Main Workspace ───────────────────────────────────────────────────────────

export function AffiliatesWorkspace({
  displayName,
  username,
  avatarUrl,
  initialTab = "overview",
}: AffiliatesWorkspaceProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AffiliateTab>(initialTab);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  const { profile, stats, insight, links, conversions, withdrawals, ranking, settings, loading, reload } = useAffiliateData();

  function navigateToTab(tab: AffiliateTab) {
    setActiveTab(tab);
    router.push(`/affiliates/dashboard?tab=${tab}`, { scroll: false });
  }

  const matchesSearch = (item: NavItem) => {
    if (!sidebarSearch.trim()) return true;
    return item.label.toLowerCase().includes(sidebarSearch.trim().toLowerCase());
  };

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.replace("/login");
    } catch {
      window.location.replace("/login");
    }
  };

  const sidebarShellClass = "relative overflow-hidden border border-[#121212] bg-[#050505] shadow-[0_24px_80px_rgba(0,0,0,0.54)]";

  const renderSidebarContent = () => (
    <div className="flex h-full flex-col px-[14px] pb-[14px] pt-[20px]">
      <div className="flex items-center gap-[10px] rounded-[16px] border border-[#141414] bg-[#080808] px-[14px] py-[12px]">
        <Search className="h-[18px] w-[18px] shrink-0 text-[#6F6F6F]" strokeWidth={1.85} aria-hidden="true" />
        <input
          type="text"
          value={sidebarSearch}
          onChange={(e) => setSidebarSearch(e.target.value)}
          placeholder="Buscar..."
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-[#D5D5D5] outline-none placeholder:text-[#5A5A5A]"
        />
        <span className="inline-flex h-[28px] min-w-[28px] items-center justify-center rounded-[9px] border border-[#1A1A1A] bg-[#101010] px-[8px] text-[12px] font-medium text-[#A7A7A7]">
          F
        </span>
      </div>

      <div className="mt-[14px] flex-1 overflow-y-auto pr-[2px]">
        {NAV_GROUPS.map((group, groupIndex) => {
          const visibleItems = group.items.filter(matchesSearch);
          if (!visibleItems.length) return null;

          return (
            <div key={group.category} className={groupIndex > 0 ? "mt-[12px] border-t border-[#121212] pt-[12px]" : ""}>
               <div className="flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left text-[#B5B5B5]">
                  <span className="inline-flex h-[22px] w-[22px] items-center justify-center text-[#8A8A8A]">
                    <group.icon className="h-[16px] w-[16px]" strokeWidth={1.9} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px] leading-none font-medium tracking-[-0.03em]">
                    {group.category}
                  </span>
               </div>

               <div className="mt-[6px] space-y-[4px] pl-[12px]">
                  {visibleItems.map((item) => {
                    const isActive = activeTab === item.id;
                    const Icon = item.icon;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => navigateToTab(item.id)}
                        className={`group flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[10px] text-left transition-all duration-200 ${
                          isActive
                            ? "bg-[#1A1A1A] text-[#F0F0F0]"
                            : "text-[#AFAFAF] hover:bg-[#101010] hover:text-[#E3E3E3]"
                        }`}
                      >
                        <span
                          className={`inline-flex h-[20px] w-[20px] items-center justify-center ${
                            isActive ? "text-[#F0F0F0]" : "text-[#7F7F7F] group-hover:text-[#DADADA]"
                          }`}
                        >
                          <Icon className="h-[16px] w-[16px]" strokeWidth={1.9} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[14px] leading-none font-medium tracking-[-0.03em]">
                          {item.label}
                        </span>
                      </button>
                    );
                  })}
               </div>
            </div>
          );
        })}
      </div>

      <div ref={profileMenuRef} className="mt-[14px] border-t border-[#121212] pt-[14px]">
        <div className="relative">
          {isProfileMenuOpen && (
            <div
              className="absolute inset-x-0 bottom-[calc(100%+10px)] z-[140] overflow-hidden rounded-[22px] border border-[#151515] bg-[#070707] p-[12px] shadow-[0_26px_80px_rgba(0,0,0,0.54)]"
            >
              <div className="space-y-[4px]">
                <button
                  type="button"
                  onClick={() => router.push("/servers")}
                  className="flex w-full items-center gap-[12px] rounded-[14px] border border-[#171717] bg-[#0D0D0D] px-[12px] py-[11px] text-left text-[#D8D8D8] transition-colors hover:border-[#222222] hover:bg-[#111111]"
                >
                  <Settings2 className="h-[15px] w-[15px] shrink-0 text-[#888]" />
                  <span className="text-[13px]">Central de servidores</span>
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  className="flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left text-[#DB9E9E] transition-colors hover:bg-[#111111] disabled:opacity-70"
                >
                  {isLoggingOut ? (
                    <ButtonLoader size={15} colorClassName="text-[#DB8A8A]" />
                  ) : (
                    <LogOut className="h-[15px] w-[15px] shrink-0" strokeWidth={1.9} />
                  )}
                  <span className="text-[13px]">Sair</span>
                </button>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setIsProfileMenuOpen((p) => !p)}
            className="flex w-full items-center justify-between gap-[12px] rounded-[18px] border border-[#111111] bg-[#080808] px-[10px] py-[10px] text-left transition-colors hover:border-[#1A1A1A] hover:bg-[#0B0B0B]"
          >
            <div className="flex min-w-0 items-center gap-[10px]">
              <AccountAvatar avatarUrl={avatarUrl} displayName={displayName} size={38} />
              <div className="min-w-0">
                <p className="truncate text-[15px] leading-none font-medium tracking-[-0.03em] text-[#E5E5E5]">
                  {displayName}
                </p>
                <p className="mt-[5px] truncate text-[12px] leading-none text-[#686868]">
                  @{username}
                </p>
              </div>
            </div>
            <ChevronDown className="h-[14px] w-[14px] shrink-0 text-[#7E7E7E]" strokeWidth={1.9} />
          </button>
        </div>
      </div>
    </div>
  );

  const meta = PAGE_META[activeTab];

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#040404] text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0.012)_28%,transparent_68%)]"
      />

      <div className="hidden xl:block">
        <aside className="fixed inset-y-0 left-0 z-20 w-[318px]">
          <div className={`${sidebarShellClass} h-full border-y-0 border-l-0 border-r-[#151515]`}>
            <LandingReveal delay={90}>
              {renderSidebarContent()}
            </LandingReveal>
          </div>
        </aside>
      </div>

      <main className="relative px-[20px] pt-[32px] pb-[56px] md:px-6 lg:px-8 xl:min-h-screen xl:pl-[358px] xl:pr-[42px]">
        <div className="mx-auto w-full max-w-[1220px]">
          <aside className="mb-[20px] xl:hidden">
            <LandingReveal delay={90}>
              <div className={`${sidebarShellClass} rounded-[28px]`}>
                {renderSidebarContent()}
              </div>
            </LandingReveal>
          </aside>

          <section className="min-w-0">
            <LandingReveal delay={120}>
              <div>
                <LandingGlowTag className="px-[24px]">{meta.eyebrow}</LandingGlowTag>
                <h1 className="mt-[18px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[34px] leading-[1.02] font-normal tracking-[-0.05em] text-transparent md:text-[42px]">
                  {meta.title}
                </h1>
                <p className="mt-[14px] max-w-[760px] text-[15px] leading-[1.55] text-[#7D7D7D] md:text-[16px]">
                  {meta.subtitle}
                </p>
              </div>
            </LandingReveal>

            <LandingReveal delay={180}>
              <div className="mt-[28px]">
                {loading ? (
                   <TabSkeleton tab={activeTab} />
                ) : (
                  <>
                    {activeTab === "overview" && <OverviewTab profile={profile} stats={stats} insight={insight} />}
                    {activeTab === "links" && <LinksTab links={links} reload={reload} />}
                    {activeTab === "ranking" && <RankingTab ranking={ranking} />}
                    {activeTab === "notifications" && <NotificationsTab settings={settings} reload={reload} />}
                    {activeTab === "components" && <ComponentsTab profile={profile} />}
                    {activeTab === "training" && <TrainingTab />}
                    {activeTab === "templates" && <TemplatesTab profile={profile} />}
                    {activeTab === "commissions" && <CommissionsTab commissions={conversions} />}
                    {activeTab === "withdrawals" && <WithdrawalsTab withdrawals={withdrawals} />}
                  </>
                )}
              </div>
            </LandingReveal>
          </section>
        </div>
      </main>
    </div>
  );
}

