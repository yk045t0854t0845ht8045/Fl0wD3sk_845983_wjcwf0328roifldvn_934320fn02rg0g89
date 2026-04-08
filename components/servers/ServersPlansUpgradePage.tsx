"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { animate } from "motion";
import { LandingActionButton } from "@/components/landing/LandingActionButton";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import {
  buildConfigCheckoutPath,
  getAllPlanPricingDefinitions,
  getAvailableBillingPeriodsForPlan,
  isPlanCode,
  type PlanBillingPeriodCode,
  type PlanCode,
  type PlanPricingDefinition,
} from "@/lib/plans/catalog";

type CurrentPlanSnapshot = {
  planCode: string;
  status: "inactive" | "trial" | "active" | "expired";
};

type Props = {
  currentPlan: CurrentPlanSnapshot | null;
  preferredGuildId: string | null;
};

const PLAN_FEATURE_ICON_SOURCES = [
  "/cdn/icons/discord-icon.svg",
  "/cdn/icons/ticket-icon.svg",
  "/cdn/icons/star-icon.svg",
  "/cdn/icons/plugin-icon.svg",
] as const;

function formatMoney(amount: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.round(amount * 100) / 100);
}

function resolveInitialBillingPeriodCode(
  currentPlan: CurrentPlanSnapshot | null,
): PlanBillingPeriodCode {
  if (!currentPlan || currentPlan.planCode === "basic") return "monthly";
  return "monthly";
}

function isCurrentPlan(
  currentPlan: CurrentPlanSnapshot | null,
  plan: PlanPricingDefinition,
) {
  return Boolean(
    currentPlan &&
      currentPlan.planCode === plan.code &&
      (currentPlan.status === "active" || currentPlan.status === "trial"),
  );
}

const PLAN_RECOMMENDATION_ORDER: PlanCode[] = ["basic", "pro", "ultra", "master"];

function resolveRecommendedPlanCode(currentPlan: CurrentPlanSnapshot | null): PlanCode {
  if (!currentPlan) return "pro";
  const normalizedPlanCode = currentPlan.planCode.trim().toLowerCase();
  if (!isPlanCode(normalizedPlanCode)) return "pro";

  const currentIndex = PLAN_RECOMMENDATION_ORDER.indexOf(normalizedPlanCode);
  if (currentIndex < 0) return "pro";

  return PLAN_RECOMMENDATION_ORDER[
    Math.min(currentIndex + 1, PLAN_RECOMMENDATION_ORDER.length - 1)
  ];
}

function AnimatedMoneyAmount({
  value,
  currency,
  className,
}: {
  value: number;
  currency: string;
  className?: string;
}) {
  const spanRef = useRef<HTMLSpanElement | null>(null);
  const currentValueRef = useRef(value);

  useEffect(() => {
    const node = spanRef.current;
    if (!node) return;

    const controls = animate(currentValueRef.current, value, {
      type: "spring",
      stiffness: 240,
      damping: 26,
      mass: 0.9,
      onUpdate: (latest) => {
        node.textContent = formatMoney(latest, currency);
      },
    });

    currentValueRef.current = value;
    return () => {
      controls.stop();
    };
  }, [currency, value]);

  return (
    <span ref={spanRef} className={className}>
      {formatMoney(value, currency)}
    </span>
  );
}

function BillingPeriodSwitcher({
  value,
  onChange,
}: {
  value: PlanBillingPeriodCode;
  onChange: (value: PlanBillingPeriodCode) => void;
}) {
  const periods = getAvailableBillingPeriodsForPlan("pro");

  return (
    <div className="mx-auto inline-flex flex-wrap justify-center gap-[8px] rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(10,10,10,0.92)] p-[6px] shadow-[0_20px_60px_rgba(0,0,0,0.26)]">
      {periods.map((period) => {
        const isSelected = period.code === value;
        return (
          <button
            key={period.code}
            type="button"
            onClick={() => onChange(period.code)}
            className={`inline-flex h-[42px] items-center justify-center rounded-full px-[16px] text-[13px] font-semibold transition-all duration-200 ${
              isSelected
                ? "bg-[linear-gradient(180deg,#0062FF_0%,#0150CA_100%)] text-white shadow-[0_12px_28px_rgba(0,98,255,0.28)]"
                : "bg-transparent text-[rgba(218,218,218,0.62)] hover:bg-[rgba(255,255,255,0.05)] hover:text-[rgba(255,255,255,0.88)]"
            }`}
          >
            {period.label}
          </button>
        );
      })}
    </div>
  );
}

function PlanCta({
  plan,
  currentPlan,
  preferredGuildId,
  pendingKey,
  onStartNavigation,
}: {
  plan: PlanPricingDefinition;
  currentPlan: CurrentPlanSnapshot | null;
  preferredGuildId: string | null;
  pendingKey: string | null;
  onStartNavigation: (key: string) => void;
}) {
  const current = isCurrentPlan(currentPlan, plan);
  const key = `${plan.code}:${plan.billingPeriodCode}`;
  const checkoutParams = new URLSearchParams({
    fresh: "1",
    source: "servers-plans",
  });
  if (preferredGuildId) {
    checkoutParams.set("guild", preferredGuildId);
  }
  const href = `${buildConfigCheckoutPath({
    planCode: plan.code,
    billingPeriodCode: plan.billingPeriodCode,
  })}?${checkoutParams.toString()}#/payment`;

  return (
    <LandingActionButton
      href={current ? undefined : href}
      variant="light"
      className="mt-[20px] h-[50px] w-full rounded-[12px] px-6 text-[16px]"
      disabled={current}
      onClick={() => {
        if (current) return;
        onStartNavigation(key);
      }}
    >
      {current ? (
        "Plano atual"
      ) : pendingKey === key ? (
        <ButtonLoader size={18} colorClassName="text-[#2B2B2B]" />
      ) : (
        "Escolher plano"
      )}
    </LandingActionButton>
  );
}

function OfferPlanCard({
  plan,
  delay,
  recommendedPlanCode,
  currentPlan,
  preferredGuildId,
  pendingKey,
  onStartNavigation,
  compact = false,
  reveal = false,
}: {
  plan: PlanPricingDefinition;
  delay?: number;
  recommendedPlanCode: PlanCode;
  currentPlan: CurrentPlanSnapshot | null;
  preferredGuildId: string | null;
  pendingKey: string | null;
  onStartNavigation: (key: string) => void;
  compact?: boolean;
  reveal?: boolean;
}) {
  const isRecommended = plan.code === recommendedPlanCode;
  const cardBodyClass =
    "relative z-20 flex h-full flex-col items-start overflow-hidden rounded-[24px] bg-[#0A0A0A] px-[20px] pb-[18px] pt-[20px] text-left";

  const content = (
    <div className="relative w-full max-w-[372px] justify-self-center min-[1580px]:max-w-none">
      {isRecommended ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 hidden h-[304px] rounded-[25px] bg-[#0062FF] min-[1580px]:block min-[1580px]:top-[-43px]" />
          <div className="absolute inset-x-0 top-0 z-30 hidden h-[45px] items-center justify-center px-[20px] text-center text-[13px] leading-none font-medium tracking-[0.02em] text-white min-[1580px]:flex min-[1580px]:top-[-43px]">
            RECOMENDADO
          </div>
          <div className="pointer-events-none absolute left-0 z-[25] hidden h-[26px] w-[26px] rounded-tl-[24px] border-l-[2px] border-t-[2px] border-[#0062FF] min-[1580px]:block min-[1580px]:-top-[4px]" />
          <div className="pointer-events-none absolute right-0 z-[25] hidden h-[26px] w-[26px] rounded-tr-[24px] border-r-[2px] border-t-[2px] border-[#0062FF] min-[1580px]:block min-[1580px]:-top-[4px]" />
        </>
      ) : null}

      <article
        className={`${cardBodyClass} ${
          isRecommended
            ? "shadow-[inset_0_0_0_2px_#0062FF] min-[1580px]:shadow-[inset_2px_0_0_#0062FF,inset_-2px_0_0_#0062FF,inset_0_-2px_0_#0062FF]"
            : ""
        }`}
      >
        <div className="absolute right-[20px] top-[20px] rounded-[8px] bg-[#0062FF] px-[14px] py-[6px] text-[13px] leading-none font-medium text-white">
          {plan.badge}
        </div>

        <div className="mt-[28px] flex w-full flex-col items-start text-left">
          <h3 className="w-full max-w-[220px] text-[22px] leading-none font-normal text-[rgba(218,218,218,0.92)]">
            {plan.name}
          </h3>

          <p className="mt-[14px] w-full text-[16px] leading-none font-normal text-[rgba(255,255,255,0.2)] line-through">
            <AnimatedMoneyAmount
              value={plan.compareMonthlyAmount}
              currency={plan.currency}
            />
          </p>

          <div className="mt-[10px] flex w-full items-baseline justify-start gap-[4px] overflow-visible pb-[4px] text-left">
            <AnimatedMoneyAmount
              value={plan.monthlyAmount}
              currency={plan.currency}
              className={`whitespace-nowrap leading-[1.02] font-semibold tracking-[-0.04em] text-[rgba(255,255,255,0.5)] ${
                compact ? "text-[30px]" : "text-[35px]"
              }`}
            />
            <span
              className={`whitespace-nowrap leading-[1.02] font-semibold text-[rgba(255,255,255,0.5)] ${
                compact ? "text-[15px]" : "text-[17px]"
              }`}
            >
              {plan.billingLabel}
            </span>
          </div>
        </div>

        <div className="mt-[14px] flex min-h-[24px] w-full items-center justify-center rounded-[8px] bg-[#111111] px-[12px] text-center text-[12px] leading-none font-medium text-[#0062FF]">
          {plan.cycleBadge || plan.limitedOffer}
        </div>

        <PlanCta
          plan={plan}
          currentPlan={currentPlan}
          preferredGuildId={preferredGuildId}
          pendingKey={pendingKey}
          onStartNavigation={onStartNavigation}
        />

        {!compact ? (
          <>
            <p className="mt-[16px] min-h-[48px] text-[13px] leading-[1.22] font-normal text-[rgba(218,218,218,0.3)]">
              {plan.description}
            </p>

            <div className="mt-[18px] h-px w-full bg-[rgba(255,255,255,0.04)]" />

            <div className="mt-[18px] flex flex-col gap-[14px]">
              {plan.features.map((feature, featureIndex) => (
                <div
                  key={`${plan.name}-feature-${featureIndex}`}
                  className="flex items-center gap-[10px]"
                >
                  <Image
                    src={
                      PLAN_FEATURE_ICON_SOURCES[featureIndex] ??
                      PLAN_FEATURE_ICON_SOURCES[0]
                    }
                    alt=""
                    width={16}
                    height={16}
                    className="h-[16px] w-[16px] select-none object-contain"
                    draggable={false}
                  />
                  <span className="text-[14px] leading-none font-medium text-[rgba(218,218,218,0.34)]">
                    {feature}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </article>
    </div>
  );

  if (!reveal) {
    return content;
  }

  return <LandingReveal delay={delay || 0}>{content}</LandingReveal>;
}

type ComparisonPlanCode = "basic" | "pro" | "ultra" | "master";
type ComparisonCell = { type: "text"; value: string } | { type: "check" } | { type: "cross" };
type ComparisonRow = {
  label: string;
  tooltip: string;
  values: Record<ComparisonPlanCode, ComparisonCell>;
};

const COMPARISON_PLAN_ORDER: ComparisonPlanCode[] = [
  "basic",
  "pro",
  "ultra",
  "master",
];

const UNLIMITED_LIMIT = 999999;

function formatInt(value: number) {
  return new Intl.NumberFormat("pt-BR").format(Math.max(0, Math.trunc(value)));
}

function formatEntitlement(value: number, suffix = "") {
  if (value >= UNLIMITED_LIMIT) {
    return "Ilimitado";
  }

  const amount = formatInt(value);
  if (!suffix) return amount;
  return `${amount} ${suffix}`;
}

function buildComparisonSections(plans: PlanPricingDefinition[]) {
  const plansByCode = new Map<ComparisonPlanCode, PlanPricingDefinition>();
  for (const plan of plans) {
    if (
      plan.code === "basic" ||
      plan.code === "pro" ||
      plan.code === "ultra" ||
      plan.code === "master"
    ) {
      plansByCode.set(plan.code, plan);
    }
  }

  const valuesByPlan = (
    resolver: (plan: PlanPricingDefinition) => ComparisonCell,
  ): Record<ComparisonPlanCode, ComparisonCell> => {
    return {
      basic: plansByCode.get("basic")
        ? resolver(plansByCode.get("basic") as PlanPricingDefinition)
        : { type: "text", value: "-" },
      pro: plansByCode.get("pro")
        ? resolver(plansByCode.get("pro") as PlanPricingDefinition)
        : { type: "text", value: "-" },
      ultra: plansByCode.get("ultra")
        ? resolver(plansByCode.get("ultra") as PlanPricingDefinition)
        : { type: "text", value: "-" },
      master: plansByCode.get("master")
        ? resolver(plansByCode.get("master") as PlanPricingDefinition)
        : { type: "text", value: "-" },
    };
  };

  const sections: Array<{ title: string; rows: ComparisonRow[] }> = [
    {
      title: "Limites reais da conta",
      rows: [
        {
          label: "Servidores licenciados",
          tooltip: "Quantidade maxima de servidores que sua conta pode manter ativos ao mesmo tempo.",
          values: valuesByPlan((plan) => ({
            type: "text",
            value: formatEntitlement(plan.entitlements.maxLicensedServers, "servidor(es)"),
          })),
        },
        {
          label: "Tickets ativos simultaneos",
          tooltip: "Numero de tickets que podem ficar abertos ao mesmo tempo em todos os servidores da conta.",
          values: valuesByPlan((plan) => ({
            type: "text",
            value: formatEntitlement(plan.entitlements.maxActiveTickets, "ticket(s)"),
          })),
        },
        {
          label: "Automacoes liberadas",
          tooltip: "Limite de automacoes que voce pode habilitar por conta com esse plano.",
          values: valuesByPlan((plan) => ({
            type: "text",
            value: formatEntitlement(plan.entitlements.maxAutomations, "automacao(oes)"),
          })),
        },
        {
          label: "Acoes por mes",
          tooltip: "Volume mensal de acoes processadas pelo sistema de automacao e operacao da conta.",
          values: valuesByPlan((plan) => ({
            type: "text",
            value: formatEntitlement(plan.entitlements.maxMonthlyActions, "acoes"),
          })),
        },
      ],
    },
    {
      title: "Cobranca e vigencia",
      rows: [
        {
          label: "Valor mensal no periodo",
          tooltip: "Preco medio por mes considerando o periodo atualmente selecionado.",
          values: valuesByPlan((plan) => ({
            type: "text",
            value: formatMoney(plan.monthlyAmount, plan.currency),
          })),
        },
        {
          label: "Valor total no checkout",
          tooltip: "Valor total cobrado no checkout para fechar esse ciclo de pagamento.",
          values: valuesByPlan((plan) => ({
            type: "text",
            value: formatMoney(plan.totalAmount, plan.currency),
          })),
        },
        {
          label: "Ciclo atual do checkout",
          tooltip: "Duracao contratada no checkout (mensal, trimestral, semestral ou anual).",
          values: valuesByPlan((plan) => ({
            type: "text",
            value: plan.checkoutPeriodLabel,
          })),
        },
        {
          label: "Plano de teste gratuito",
          tooltip: "Indica se o plano pode ser ativado gratuitamente em modo de teste.",
          values: valuesByPlan((plan) =>
            plan.isTrial ? { type: "check" } : { type: "cross" },
          ),
        },
      ],
    },
  ];

  return sections;
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-[18px] w-[18px] text-[rgba(218,218,218,0.74)]"
      fill="none"
    >
      <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M4.7 8.25L7.1 10.6L11.35 6.2"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-[18px] w-[18px] text-[rgba(218,218,218,0.56)]"
      fill="none"
    >
      <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M5.4 5.4L10.6 10.6M10.6 5.4L5.4 10.6"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-[14px] w-[14px] text-[rgba(218,218,218,0.38)]"
      fill="none"
    >
      <circle cx="8" cy="8" r="6.6" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M8 7.2V11"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="8" cy="4.8" r="1" fill="currentColor" />
    </svg>
  );
}

function renderComparisonCell(cell: ComparisonCell) {
  if (cell.type === "check") return <CheckIcon />;
  if (cell.type === "cross") return <CrossIcon />;
  return (
    <span className="text-[14px] leading-none font-medium text-[rgba(218,218,218,0.68)]">
      {cell.value}
    </span>
  );
}

function PlanComparisonTable({ plans }: { plans: PlanPricingDefinition[] }) {
  const [openTooltipKey, setOpenTooltipKey] = useState<string | null>(null);
  const sections = useMemo(() => buildComparisonSections(plans), [plans]);
  const planMap = useMemo(() => {
    const map = new Map<string, PlanPricingDefinition>();
    for (const plan of plans) map.set(plan.code, plan);
    return map;
  }, [plans]);

  const columns = COMPARISON_PLAN_ORDER.map((code) => {
    const plan = planMap.get(code);
    return {
      code,
      label: plan?.name || code,
    };
  });

  return (
    <div className="mx-auto mt-[72px] w-full max-w-[1582px] px-[20px] min-[1580px]:px-0">
      <div className="overflow-x-auto pb-[8px]">
        <div className="min-w-[940px]">
          <div className="grid grid-cols-[minmax(240px,1.25fr)_repeat(4,minmax(160px,1fr))] border-b border-[rgba(255,255,255,0.06)] pb-[14px]">
            <div />
            {columns.map((column) => (
              <div
                key={column.code}
                className="text-center text-[13px] leading-none font-semibold text-[rgba(218,218,218,0.84)]"
              >
                {column.label}
              </div>
            ))}
          </div>

          {sections.map((section) => (
            <div key={section.title} className="mt-[44px]">
              <h2 className="text-[26px] leading-none font-semibold tracking-[-0.02em] text-[rgba(218,218,218,0.92)]">
                {section.title}
              </h2>
              <div className="mt-[18px] h-px w-full bg-[rgba(255,255,255,0.06)]" />

              <div className="mt-[2px]">
                {section.rows.map((row) => (
                  <div
                    key={row.label}
                    className="grid grid-cols-[minmax(240px,1.25fr)_repeat(4,minmax(160px,1fr))] border-b border-[rgba(255,255,255,0.06)] py-[16px]"
                  >
                    <div className="flex items-center gap-[10px] pr-[14px] text-[15px] leading-none font-semibold text-[rgba(218,218,218,0.88)]">
                      <span>{row.label}</span>
                      <div className="relative">
                        <button
                          type="button"
                          aria-label={`Informacoes sobre ${row.label}`}
                          onMouseEnter={() => setOpenTooltipKey(row.label)}
                          onMouseLeave={() => setOpenTooltipKey((current) => (current === row.label ? null : current))}
                          onFocus={() => setOpenTooltipKey(row.label)}
                          onBlur={() => setOpenTooltipKey((current) => (current === row.label ? null : current))}
                          className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full transition-colors duration-150 hover:bg-[rgba(255,255,255,0.05)] focus-visible:bg-[rgba(255,255,255,0.05)] focus-visible:outline-none"
                        >
                          <InfoIcon />
                        </button>
                        <div
                          className={`pointer-events-none absolute left-full top-1/2 z-30 ml-[10px] w-[280px] -translate-y-1/2 rounded-[12px] border border-[rgba(255,255,255,0.1)] bg-[rgba(10,10,10,0.95)] p-[12px] text-[12px] leading-[1.45] font-medium text-[rgba(218,218,218,0.84)] shadow-[0_18px_40px_rgba(0,0,0,0.45)] transition-all duration-150 ${
                            openTooltipKey === row.label
                              ? "translate-x-0 opacity-100"
                              : "pointer-events-none translate-x-[-4px] opacity-0"
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className="absolute left-0 top-1/2 h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-l border-[rgba(255,255,255,0.1)] bg-[rgba(10,10,10,0.95)]"
                          />
                          {row.tooltip}
                        </div>
                      </div>
                    </div>

                    {columns.map((column) => (
                      <div
                        key={`${row.label}-${column.code}`}
                        className="flex items-center justify-center"
                      >
                        {renderComparisonCell(row.values[column.code])}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ServersPlansUpgradePage({ currentPlan, preferredGuildId }: Props) {
  const [selectedBillingPeriodCode, setSelectedBillingPeriodCode] =
    useState<PlanBillingPeriodCode>(() =>
      resolveInitialBillingPeriodCode(currentPlan),
    );
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const plans = useMemo(
    () => getAllPlanPricingDefinitions(selectedBillingPeriodCode),
    [selectedBillingPeriodCode],
  );
  const recommendedPlanCode = useMemo(
    () => resolveRecommendedPlanCode(currentPlan),
    [currentPlan],
  );

  return (
    <div className="relative min-h-screen bg-[#050505] text-white">
      <div className="relative z-10 mx-auto w-full max-w-[1582px] px-0 pb-[120px] pt-[46px] min-[1580px]:pt-[54px]">
        <LandingReveal delay={120}>
          <h1 className="mx-auto mt-[18px] max-w-[1124px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text px-[20px] text-center text-[34px] leading-[1.08] font-normal tracking-[-0.04em] text-transparent sm:text-[40px] md:text-[46px] lg:text-[50px] min-[1580px]:px-0">
            Aproveite nossas maiores ofertas
          </h1>
        </LandingReveal>

        <LandingReveal delay={180}>
          <div className="relative z-40 mt-[26px] flex w-full justify-center px-[20px] min-[1580px]:mt-[30px] min-[1580px]:px-0">
            <BillingPeriodSwitcher
              value={selectedBillingPeriodCode}
              onChange={setSelectedBillingPeriodCode}
            />
          </div>
        </LandingReveal>

        <div className="mx-auto mt-[46px] grid w-full max-w-[372px] grid-cols-1 justify-items-center items-start gap-x-[12px] gap-y-[26px] px-[20px] min-[900px]:max-w-[756px] min-[900px]:grid-cols-2 min-[900px]:gap-y-[20px] min-[1580px]:mt-[65px] min-[1580px]:max-w-none min-[1580px]:grid-cols-4 min-[1580px]:justify-items-stretch min-[1580px]:gap-y-[12px] min-[1580px]:px-0">
          {plans.map((plan, index) => (
            <OfferPlanCard
              key={plan.code}
              plan={plan}
              delay={240 + index * 90}
              recommendedPlanCode={recommendedPlanCode}
              currentPlan={currentPlan}
              preferredGuildId={preferredGuildId}
              pendingKey={pendingKey}
              onStartNavigation={setPendingKey}
              reveal
            />
          ))}
        </div>

        <LandingReveal delay={430}>
          <div>
            <PlanComparisonTable plans={plans} />
          </div>
        </LandingReveal>
      </div>
    </div>
  );
}
