import { runFlowAiJson } from "@/lib/flowai/service";
import type { AffiliateAIInsight, AffiliateAIInsightCard } from "./affiliateTypes";

const DAY_MS = 1000 * 60 * 60 * 24;
const PERIOD_DAYS = 30;
const PERIOD_LABEL = "Baseado nos últimos 30 dias";
const BRAZIL_TIMEZONE = "America/Sao_Paulo";

const HOUR_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  hour12: false,
  timeZone: BRAZIL_TIMEZONE,
});

type InsightType = AffiliateAIInsight["type"];

export type AffiliateInsightLinkSnapshot = {
  id: string;
  plan_slug?: string | null;
  period?: string | null;
  short_url?: string | null;
  target_url?: string | null;
  clicks_count?: number | null;
  conversions_count?: number | null;
  created_at?: string | null;
};

export type AffiliateInsightConversionSnapshot = {
  id: string;
  link_id?: string | null;
  plan_slug?: string | null;
  amount_total?: number | string | null;
  commission_amount?: number | string | null;
  status?: string | null;
  conversion_date?: string | null;
};

export type AffiliateInsightResult = AffiliateAIInsightCard;

type NormalizedConversion = {
  id: string;
  linkId: string | null;
  planSlug: string | null;
  status: "approved" | "pending" | "cancelled";
  amountTotal: number;
  commissionAmount: number;
  date: Date;
  dateIso: string;
};

type AffiliateAnalytics = {
  periodDays: number;
  totalClicksLifetime: number;
  totalConversionsLifetime: number;
  overallConversionRate: number;
  recentConversions: number;
  approvedConversions: number;
  pendingConversions: number;
  cancelledConversions: number;
  approvedCommission: number;
  approvedRevenue: number;
  bestHourWindow: string | null;
  bestHourWindowCount: number;
  topPlan: string | null;
  topPlanCount: number;
  strongestLinkPlan: string | null;
  strongestLinkRate: number | null;
  strongestLinkClicks: number;
  strongestLinkConversions: number;
  trendDirection: "up" | "down" | "stable";
  trendDeltaPct: number;
  lowData: boolean;
  evidence: string[];
  fingerprint: string;
};

function toNumber(value: unknown) {
  const numeric =
    typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));

  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeStatus(value: unknown): NormalizedConversion["status"] {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "approved" || normalized === "cancelled") {
    return normalized;
  }

  return "pending";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function formatPlanLabel(plan: string | null) {
  if (!plan) return null;

  const normalized = String(plan).trim().toLowerCase();
  if (normalized === "pro") return "Pro";
  if (normalized === "basic") return "Basic";
  if (normalized === "enterprise") return "Enterprise";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatHourWindow(startHour: number) {
  const endHour = (startHour + 3) % 24;
  return `${startHour}h e ${endHour}h`;
}

function getBrazilHour(date: Date) {
  const hour = Number.parseInt(HOUR_FORMATTER.format(date), 10);
  return Number.isFinite(hour) ? hour % 24 : 0;
}

function sanitizeTitle(value: unknown, fallback: string) {
  const title = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);

  return title || fallback;
}

function sanitizeBody(value: unknown, fallback: string) {
  const body = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);

  return body || fallback;
}

function normalizeInsightType(value: unknown, fallback: InsightType): InsightType {
  return value === "tip" || value === "warning" || value === "opportunity"
    ? value
    : fallback;
}

function normalizeConfidence(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return round(clamp(numeric, 0.35, 0.98), 2);
}

function normalizeConversions(
  conversions: AffiliateInsightConversionSnapshot[],
  now: Date,
) {
  return conversions
    .map((conversion) => {
      const dateIso = String(conversion.conversion_date || "").trim();
      const date = new Date(dateIso);
      if (!dateIso || Number.isNaN(date.getTime()) || date > now) {
        return null;
      }

      return {
        id: conversion.id,
        linkId: conversion.link_id ? String(conversion.link_id) : null,
        planSlug: conversion.plan_slug ? String(conversion.plan_slug) : null,
        status: normalizeStatus(conversion.status),
        amountTotal: toNumber(conversion.amount_total),
        commissionAmount: toNumber(conversion.commission_amount),
        date,
        dateIso,
      } satisfies NormalizedConversion;
    })
    .filter((conversion): conversion is NormalizedConversion => Boolean(conversion));
}

function buildAnalytics(input: {
  links: AffiliateInsightLinkSnapshot[];
  conversions: AffiliateInsightConversionSnapshot[];
}) {
  const now = new Date();
  const periodStart = new Date(now.getTime() - PERIOD_DAYS * DAY_MS);
  const recent7Start = new Date(now.getTime() - 7 * DAY_MS);
  const previous7Start = new Date(now.getTime() - 14 * DAY_MS);

  const normalizedConversions = normalizeConversions(input.conversions, now);
  const recentConversions = normalizedConversions.filter(
    (conversion) => conversion.date >= periodStart,
  );
  const approvedConversions = recentConversions.filter(
    (conversion) => conversion.status === "approved",
  );
  const pendingConversions = recentConversions.filter(
    (conversion) => conversion.status === "pending",
  );
  const cancelledConversions = recentConversions.filter(
    (conversion) => conversion.status === "cancelled",
  );

  const hourlySource =
    approvedConversions.length >= 2
      ? approvedConversions
      : recentConversions.filter((conversion) => conversion.status !== "cancelled");

  const hourBuckets = Array.from({ length: 24 }, () => 0);
  for (const conversion of hourlySource) {
    const hour = getBrazilHour(conversion.date);
    const weight = conversion.status === "approved" ? 1.4 : 1;
    hourBuckets[hour] += weight;
  }

  let bestHourWindow: string | null = null;
  let bestHourWindowCount = 0;
  if (hourlySource.length > 0) {
    for (let startHour = 0; startHour < 24; startHour += 1) {
      const score =
        hourBuckets[startHour] +
        hourBuckets[(startHour + 1) % 24] +
        hourBuckets[(startHour + 2) % 24];

      if (score > bestHourWindowCount) {
        bestHourWindowCount = score;
        bestHourWindow = formatHourWindow(startHour);
      }
    }
  }

  const planCounter = new Map<string, number>();
  for (const conversion of approvedConversions.length ? approvedConversions : recentConversions) {
    const plan = conversion.planSlug || "unknown";
    planCounter.set(plan, (planCounter.get(plan) || 0) + 1);
  }

  const topPlanEntry = Array.from(planCounter.entries()).sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )[0];

  const strongestLink = [...input.links]
    .map((link) => ({
      planSlug: link.plan_slug ? String(link.plan_slug) : null,
      clicks: Math.max(0, Math.round(toNumber(link.clicks_count))),
      conversions: Math.max(0, Math.round(toNumber(link.conversions_count))),
    }))
    .filter((link) => link.clicks > 0 || link.conversions > 0)
    .sort((left, right) => {
      const leftRate = left.clicks > 0 ? left.conversions / left.clicks : 0;
      const rightRate = right.clicks > 0 ? right.conversions / right.clicks : 0;

      return (
        rightRate - leftRate ||
        right.conversions - left.conversions ||
        right.clicks - left.clicks
      );
    })[0];

  const trendSource =
    approvedConversions.length > 0
      ? approvedConversions
      : recentConversions.filter((conversion) => conversion.status !== "cancelled");

  const current7 = trendSource.filter((conversion) => conversion.date >= recent7Start).length;
  const previous7 = trendSource.filter(
    (conversion) =>
      conversion.date >= previous7Start && conversion.date < recent7Start,
  ).length;

  let trendDeltaPct = 0;
  if (previous7 > 0) {
    trendDeltaPct = Math.round(((current7 - previous7) / previous7) * 100);
  } else if (current7 > 0) {
    trendDeltaPct = 100;
  }

  const trendDirection =
    trendDeltaPct >= 20 ? "up" : trendDeltaPct <= -20 ? "down" : "stable";

  const totalClicksLifetime = input.links.reduce(
    (total, link) => total + Math.max(0, Math.round(toNumber(link.clicks_count))),
    0,
  );
  const totalConversionsLifetime = input.links.reduce(
    (total, link) => total + Math.max(0, Math.round(toNumber(link.conversions_count))),
    0,
  );
  const overallConversionRate =
    totalClicksLifetime > 0 ? (totalConversionsLifetime / totalClicksLifetime) * 100 : 0;

  const approvedCommission = approvedConversions.reduce(
    (total, conversion) => total + conversion.commissionAmount,
    0,
  );
  const approvedRevenue = approvedConversions.reduce(
    (total, conversion) => total + conversion.amountTotal,
    0,
  );

  const evidence: string[] = [];
  if (bestHourWindow && bestHourWindowCount > 0) {
    evidence.push(`janela forte entre ${bestHourWindow}`);
  }
  if (topPlanEntry?.[0] && topPlanEntry[0] !== "unknown") {
    evidence.push(`plano com maior resposta: ${formatPlanLabel(topPlanEntry[0])}`);
  }
  if (trendDirection === "up") {
    evidence.push(`ritmo semanal subiu ${Math.abs(trendDeltaPct)}%`);
  } else if (trendDirection === "down") {
    evidence.push(`ritmo semanal caiu ${Math.abs(trendDeltaPct)}%`);
  }
  if (pendingConversions.length > approvedConversions.length && pendingConversions.length >= 2) {
    evidence.push("ha conversoes pendentes aguardando aprovacao");
  }
  if (strongestLink?.planSlug && strongestLink.clicks > 0) {
    evidence.push(
      `melhor link atual: ${formatPlanLabel(strongestLink.planSlug)} com ${round(
        (strongestLink.conversions / strongestLink.clicks) * 100,
      )}% de conversao`,
    );
  }

  const fingerprint = JSON.stringify({
    recentConversions: recentConversions.map((conversion) => ({
      id: conversion.id,
      planSlug: conversion.planSlug,
      status: conversion.status,
      date: conversion.dateIso,
      commissionAmount: round(conversion.commissionAmount, 2),
    })),
    links: input.links.map((link) => ({
      id: link.id,
      planSlug: link.plan_slug || null,
      clicks: Math.round(toNumber(link.clicks_count)),
      conversions: Math.round(toNumber(link.conversions_count)),
    })),
  });

  return {
    periodDays: PERIOD_DAYS,
    totalClicksLifetime,
    totalConversionsLifetime,
    overallConversionRate: round(overallConversionRate, 2),
    recentConversions: recentConversions.length,
    approvedConversions: approvedConversions.length,
    pendingConversions: pendingConversions.length,
    cancelledConversions: cancelledConversions.length,
    approvedCommission: round(approvedCommission, 2),
    approvedRevenue: round(approvedRevenue, 2),
    bestHourWindow,
    bestHourWindowCount: round(bestHourWindowCount, 1),
    topPlan: formatPlanLabel(topPlanEntry?.[0] || null),
    topPlanCount: topPlanEntry?.[1] || 0,
    strongestLinkPlan: formatPlanLabel(strongestLink?.planSlug || null),
    strongestLinkRate:
      strongestLink && strongestLink.clicks > 0
        ? round((strongestLink.conversions / strongestLink.clicks) * 100, 2)
        : null,
    strongestLinkClicks: strongestLink?.clicks || 0,
    strongestLinkConversions: strongestLink?.conversions || 0,
    trendDirection,
    trendDeltaPct,
    lowData:
      recentConversions.length < 2 &&
      approvedConversions.length < 1 &&
      totalClicksLifetime < 40,
    evidence,
    fingerprint,
  } satisfies AffiliateAnalytics;
}

function buildFallbackInsight(analytics: AffiliateAnalytics): AffiliateAIInsight {
  if (analytics.recentConversions === 0) {
    if (analytics.totalClicksLifetime > 0) {
      return {
        type: "opportunity",
        title: "Hora de destravar as vendas",
        body: `Você já acumulou ${analytics.totalClicksLifetime} cliques, mas ainda sem conversões nos últimos 30 dias. Reforce prova social, CTA direto e foque primeiro no plano ${analytics.strongestLinkPlan || "Pro"}.`,
        confidence: 0.52,
      };
    }

    return {
      type: "tip",
      title: "Pouco histórico ainda",
      body: "Assim que você gerar mais tráfego e conversões, a IA vai apontar horários, planos e padrões reais para otimizar suas campanhas.",
      confidence: 0.4,
    };
  }

  if (
    analytics.bestHourWindow &&
    analytics.bestHourWindowCount >= 2 &&
    analytics.approvedConversions >= 2
  ) {
    return {
      type: "opportunity",
      title: "Sua melhor janela apareceu",
      body: `Suas conversões mais fortes ficaram entre ${analytics.bestHourWindow}. Vale concentrar posts, stories e CTA principal nesse horário para ganhar mais eficiência.`,
      confidence: analytics.lowData ? 0.62 : 0.84,
    };
  }

  if (
    analytics.pendingConversions > analytics.approvedConversions &&
    analytics.pendingConversions >= 2
  ) {
    return {
      type: "warning",
      title: "Existe receita para acompanhar",
      body: `Você tem ${analytics.pendingConversions} conversões pendentes nos últimos 30 dias. Vale revisar o tráfego que mais fecha e acompanhar de perto o avanço dessas vendas.`,
      confidence: analytics.lowData ? 0.58 : 0.78,
    };
  }

  if (analytics.topPlan && analytics.topPlanCount >= 2) {
    return {
      type: "opportunity",
      title: `${analytics.topPlan} está respondendo melhor`,
      body: `O plano ${analytics.topPlan} concentrou sua melhor resposta recente. Repita a oferta, os argumentos e o formato de conteúdo que levaram a essas conversões.`,
      confidence: analytics.lowData ? 0.56 : 0.8,
    };
  }

  if (analytics.trendDirection === "down") {
    return {
      type: "warning",
      title: "Seu ritmo perdeu força",
      body: `Na última semana seu ritmo caiu ${Math.abs(analytics.trendDeltaPct)}% contra a semana anterior. Teste um CTA mais direto e retome a campanha que gerou sua melhor resposta.`,
      confidence: analytics.lowData ? 0.55 : 0.76,
    };
  }

  if (
    analytics.strongestLinkPlan &&
    analytics.strongestLinkRate !== null &&
    analytics.strongestLinkClicks >= 10
  ) {
    return {
      type: "tip",
      title: "Seu melhor link merece escala",
      body: `Seu link de ${analytics.strongestLinkPlan} está com ${analytics.strongestLinkRate}% de conversão. Vale duplicar esse ângulo em mais criativos e pontos de entrada.`,
      confidence: analytics.lowData ? 0.57 : 0.79,
    };
  }

  return {
    type: "tip",
    title: "Seu funil já dá sinais",
    body: "Há sinais suficientes para otimizar a próxima rodada. Mantenha consistência, reforce o melhor CTA e priorize o conteúdo que já trouxe resposta nas últimas semanas.",
    confidence: analytics.lowData ? 0.5 : 0.72,
  };
}

function sanitizeAiInsight(
  rawInsight: Partial<AffiliateAIInsight> | null | undefined,
  fallback: AffiliateAIInsight,
) {
  return {
    type: normalizeInsightType(rawInsight?.type, fallback.type),
    title: sanitizeTitle(rawInsight?.title, fallback.title),
    body: sanitizeBody(rawInsight?.body, fallback.body),
    confidence: normalizeConfidence(rawInsight?.confidence, fallback.confidence),
  } satisfies AffiliateAIInsight;
}

export async function generateAffiliateInsight(input: {
  affiliateId: string;
  affiliateLevel?: string | null;
  links: AffiliateInsightLinkSnapshot[];
  conversions: AffiliateInsightConversionSnapshot[];
}) {
  const analytics = buildAnalytics(input);
  const fallback = buildFallbackInsight(analytics);
  const generatedAt = new Date().toISOString();

  try {
    const result = await runFlowAiJson<AffiliateAIInsight>({
      taskKey: "affiliate_insight",
      userId: `affiliate:${input.affiliateId}`,
      cacheKey: `affiliate-insight:${analytics.fingerprint}`,
      cacheTtlMs: 1000 * 60 * 3,
      messages: [
        {
          role: "system",
          content:
            "Voce gera 1 insight premium para painel de afiliados. Responda somente JSON com type, title, body e confidence.",
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              objective:
                "Gerar um insight unico, acionavel e confiavel para o dashboard de um afiliado.",
              rules: [
                "Nao invente dados, horarios, cliques por horario ou conversoes inexistentes.",
                "Se houver horario, trate como janela de conversao observada, nao como horario exato de clique.",
                "Use tom profissional, direto e premium.",
                "title deve ter no maximo 7 palavras.",
                "body deve ter no maximo 34 palavras.",
                "confidence deve ficar entre 0.35 e 0.98.",
              ],
              affiliateContext: {
                level: input.affiliateLevel || "unknown",
                periodLabel: PERIOD_LABEL,
                analytics,
              },
              fallbackReference: fallback,
            },
            null,
            2,
          ),
        },
      ],
    });

    return {
      insight: sanitizeAiInsight(result.object, fallback),
      periodLabel: PERIOD_LABEL,
      generatedAt,
      source: "ai",
    } satisfies AffiliateInsightResult;
  } catch {
    return {
      insight: fallback,
      periodLabel: PERIOD_LABEL,
      generatedAt,
      source: "fallback",
    } satisfies AffiliateInsightResult;
  }
}
