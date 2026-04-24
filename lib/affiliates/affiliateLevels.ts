import type {
  AffiliateLevel,
  AffiliateRankTier,
  AffiliateLevelConfig,
} from "./affiliateTypes";
import { Trophy, Zap, Star, Sparkles } from "lucide-react";

export const AFFILIATE_LEVELS: Record<AffiliateLevel, AffiliateLevelConfig> = {
  bronze: {
    level: "bronze",
    label: "Bronze",
    color: "#707070",
    bgColor: "rgba(112, 112, 112, 0.08)",
    borderColor: "rgba(112, 112, 112, 0.22)",
    commissionPct: 15,
    rankBonusPct: 0,
    minSalesPerMonth: 0,
    icon: Trophy,
  },
  silver: {
    level: "silver",
    label: "Prata",
    color: "#A0A0A0",
    bgColor: "rgba(160, 160, 160, 0.08)",
    borderColor: "rgba(160, 160, 160, 0.22)",
    commissionPct: 20,
    rankBonusPct: 0,
    minSalesPerMonth: 10,
    icon: Zap,
  },
  gold: {
    level: "gold",
    label: "Ouro",
    color: "#D0D0D0",
    bgColor: "rgba(208, 208, 208, 0.08)",
    borderColor: "rgba(208, 208, 208, 0.24)",
    commissionPct: 27,
    rankBonusPct: 3,
    minSalesPerMonth: 30,
    icon: Star,
  },
  diamond: {
    level: "diamond",
    label: "Diamante",
    color: "#FFFFFF",
    bgColor: "rgba(255, 255, 255, 0.08)",
    borderColor: "rgba(255, 255, 255, 0.3)",
    commissionPct: 35,
    rankBonusPct: 5,
    minSalesPerMonth: 80,
    icon: Sparkles,
  },
};

// ─── Rank Bonus Table ─────────────────────────────────────────────────────────

export const RANK_BONUS: Record<NonNullable<AffiliateRankTier>, { bonusPct: number; label: string }> = {
  1: { bonusPct: 5, label: "1º Lugar" },
  2: { bonusPct: 3, label: "2º Lugar" },
  3: { bonusPct: 2, label: "3º Lugar" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getLevelConfig(level: AffiliateLevel): AffiliateLevelConfig {
  return AFFILIATE_LEVELS[level];
}

export function getEffectiveCommissionPct(
  level: AffiliateLevel,
  rankTier: AffiliateRankTier,
): number {
  const baseConfig = AFFILIATE_LEVELS[level];
  const bonus = rankTier !== null ? RANK_BONUS[rankTier].bonusPct : 0;
  return baseConfig.commissionPct + bonus;
}

export function getLevelFromSalesCount(salesThisMonth: number): AffiliateLevel {
  if (salesThisMonth >= AFFILIATE_LEVELS.diamond.minSalesPerMonth) return "diamond";
  if (salesThisMonth >= AFFILIATE_LEVELS.gold.minSalesPerMonth) return "gold";
  if (salesThisMonth >= AFFILIATE_LEVELS.silver.minSalesPerMonth) return "silver";
  return "bronze";
}

export function getNextLevelInfo(level: AffiliateLevel): {
  nextLevel: AffiliateLevel | null;
  nextLevelConfig: AffiliateLevelConfig | null;
  salesNeeded: number;
} {
  const progression: AffiliateLevel[] = ["bronze", "silver", "gold", "diamond"];
  const currentIndex = progression.indexOf(level);
  const nextLevel = currentIndex < progression.length - 1 ? progression[currentIndex + 1] : null;

  if (!nextLevel) {
    return { nextLevel: null, nextLevelConfig: null, salesNeeded: 0 };
  }

  return {
    nextLevel,
    nextLevelConfig: AFFILIATE_LEVELS[nextLevel],
    salesNeeded: AFFILIATE_LEVELS[nextLevel].minSalesPerMonth,
  };
}

export function formatCommissionPct(pct: number): string {
  return `${pct}%`;
}

export function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
