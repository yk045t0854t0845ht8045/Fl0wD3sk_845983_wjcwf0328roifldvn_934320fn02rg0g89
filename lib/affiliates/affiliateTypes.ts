// ─── Affiliate Types ──────────────────────────────────────────────────────────

export type AffiliateLevel = "bronze" | "silver" | "gold" | "diamond";

export type AffiliatePlan = "basic" | "pro" | "enterprise";

export type AffiliatePeriod = "monthly" | "annual";

export type AffiliateNotificationChannel = "email" | "push" | "webhook" | "sms";

export type SaleStatus = "pending" | "approved" | "cancelled";

export type AffiliateRankTier = 1 | 2 | 3 | null;

// ─── Level Config ─────────────────────────────────────────────────────────────

import type { LucideIcon } from "lucide-react";

export type AffiliateLevelConfig = {
  level: AffiliateLevel;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  commissionPct: number;
  rankBonusPct: number;
  minSalesPerMonth: number;
  icon: LucideIcon;
};

// ─── Affiliate Profile ────────────────────────────────────────────────────────

export type AffiliateProfile = {
  affiliateId: string;
  userId: number;
  level: AffiliateLevel;
  couponCode: string | null;
  whatsappGroupUrl: string | null;
  createdAt: string;
  isActive: boolean;
};

// ─── Affiliate Stats ──────────────────────────────────────────────────────────

export type AffiliateStats = {
  totalClicks: number;
  clicksToday: number;
  clicksThisMonth: number;
  totalSales: number;
  salesThisMonth: number;
  totalCommissionEarned: number;
  totalCommissionPending: number;
  totalCommissionWithdrawn: number;
  availableBalance: number;
  conversionRate: number; // pct
  rankThisMonth: AffiliateRankTier;
};

// ─── Affiliate Link ───────────────────────────────────────────────────────────

export type AffiliateLink = {
  linkId: string;
  affiliateId: string;
  plan: AffiliatePlan;
  period: AffiliatePeriod;
  url: string;
  shortUrl: string;
  clicks: number;
  conversions: number;
  conversionRate: number;
  createdAt: string;
};

// ─── Commission / Sale ────────────────────────────────────────────────────────

export type AffiliateCommission = {
  commissionId: string;
  affiliateId: string;
  plan: AffiliatePlan;
  period: AffiliatePeriod;
  saleAmount: number;
  commissionAmount: number;
  commissionPct: number;
  status: SaleStatus;
  approvedAt: string | null;
  createdAt: string;
};

// ─── Withdrawal ───────────────────────────────────────────────────────────────

export type AffiliateWithdrawal = {
  withdrawalId: string;
  affiliateId: string;
  amount: number;
  pixKey: string;
  status: "pending" | "processing" | "paid" | "rejected";
  requestedAt: string;
  paidAt: string | null;
  notes: string | null;
};

// ─── Notification Config ──────────────────────────────────────────────────────

export type AffiliateNotificationConfig = {
  emailEnabled: boolean;
  emailAddress: string | null;
  pushEnabled: boolean;
  smsEnabled: boolean;
  smsPhone: string | null;
  webhookEnabled: boolean;
  webhookUrl: string | null;
  webhookSecret: string | null;
  webhookEvents: SaleStatus[];
};

// ─── Ranking ──────────────────────────────────────────────────────────────────

export type AffiliateRankEntry = {
  rank: number;
  affiliateId: string;
  displayName: string;
  avatarUrl: string | null;
  level: AffiliateLevel;
  salesThisMonth: number;
  commissionThisMonth: number;
  bonusPct: number;
};

// ─── AI Insight ───────────────────────────────────────────────────────────────

export type AffiliateAIInsight = {
  type: "tip" | "warning" | "opportunity";
  title: string;
  body: string;
  confidence: number; // 0–1
};

// ─── API Responses ────────────────────────────────────────────────────────────

export type AffiliateProfileApiResponse = {
  ok: boolean;
  message?: string;
  profile?: AffiliateProfile;
  stats?: AffiliateStats;
};

export type AffiliateLinksApiResponse = {
  ok: boolean;
  message?: string;
  links?: AffiliateLink[];
};

export type AffiliateCommissionsApiResponse = {
  ok: boolean;
  message?: string;
  commissions?: AffiliateCommission[];
  totalCount?: number;
};

export type AffiliateWithdrawalsApiResponse = {
  ok: boolean;
  message?: string;
  withdrawals?: AffiliateWithdrawal[];
};

export type AffiliateRankingApiResponse = {
  ok: boolean;
  message?: string;
  ranking?: AffiliateRankEntry[];
  month?: string;
};
