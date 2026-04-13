"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { animate } from "motion";
import { LandingActionButton } from "@/components/landing/LandingActionButton";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import {
  buildConfigCheckoutPath,
  getAllPlanPricingDefinitions,
  getAvailableBillingPeriodsForPlan,
  type PlanBillingPeriodCode,
  type PlanPricingDefinition,
} from "@/lib/plans/catalog";

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
  accountPlanCode,
  accountPlanStatus,
  isInitialLoading,
  isGlobalLoading,
  onStartLoading,
}: {
  plan: PlanPricingDefinition & { isAvailable: boolean };
  accountPlanCode: string | null;
  accountPlanStatus: string | null;
  isInitialLoading?: boolean;
  isGlobalLoading: boolean;
  onStartLoading: (planCode: string) => void;
}) {
  const planHref = `${buildConfigCheckoutPath({
    planCode: plan.code,
    billingPeriodCode: plan.billingPeriodCode,
  })}?fresh=1`;
  const [isLocalLoading, setIsLocalLoading] = useState(false);
  const isCurrentPlan =
    !!accountPlanCode &&
    accountPlanCode === plan.code &&
    (accountPlanStatus === "active" || accountPlanStatus === "trial");

  const isDisabled = isCurrentPlan || !plan.isAvailable || isInitialLoading || isGlobalLoading;

  return (
    <LandingActionButton
      href={isDisabled ? undefined : planHref}
      variant="light"
      className="mt-[20px] h-[50px] w-full rounded-[12px] px-6 text-[16px]"
      disabled={isDisabled}
      onClick={() => {
        if (isDisabled) return;
        setIsLocalLoading(true);
        onStartLoading(plan.code);
      }}
    >
      {isInitialLoading ? (
        <ButtonLoader size={18} colorClassName="text-[#2B2B2B]" />
      ) : isCurrentPlan ? (
        "Plano atual"
      ) : !plan.isAvailable ? (
        "Indisponivel"
      ) : isLocalLoading ? (
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
  accountPlanCode,
  accountPlanStatus,
  isInitialLoading,
  isGlobalLoading,
  onStartLoading,
}: {
  plan: PlanPricingDefinition & { isAvailable: boolean };
  delay: number;
  accountPlanCode: string | null;
  accountPlanStatus: string | null;
  isInitialLoading?: boolean;
  isGlobalLoading: boolean;
  onStartLoading: (planCode: string) => void;
}) {
  const isPopular = plan.code === "pro";
  const cardBodyClass =
    "relative z-20 flex h-full flex-col items-start overflow-hidden rounded-[24px] bg-[#0A0A0A] px-[20px] pb-[18px] pt-[20px] text-left";

  return (
    <LandingReveal delay={delay}>
      <div className="relative w-full max-w-[372px] justify-self-center min-[1580px]:max-w-none">
        {isPopular ? (
          <>
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 hidden h-[304px] rounded-[25px] bg-[#0062FF] min-[1580px]:block min-[1580px]:top-[-43px]" />
            <div className="absolute inset-x-0 top-0 z-30 hidden h-[45px] items-center justify-center px-[20px] text-center text-[13px] leading-none font-medium tracking-[0.02em] text-white min-[1580px]:flex min-[1580px]:top-[-43px]">
              MAIS POPULAR
            </div>
            <div className="pointer-events-none absolute left-0 z-[25] hidden h-[26px] w-[26px] rounded-tl-[24px] border-l-[2px] border-t-[2px] border-[#0062FF] min-[1580px]:block min-[1580px]:-top-[4px]" />
            <div className="pointer-events-none absolute right-0 z-[25] hidden h-[26px] w-[26px] rounded-tr-[24px] border-r-[2px] border-t-[2px] border-[#0062FF] min-[1580px]:block min-[1580px]:-top-[4px]" />
          </>
        ) : null}

        <article
          className={`${cardBodyClass} ${
            isPopular
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
                className="whitespace-nowrap text-[35px] leading-[1.02] font-semibold tracking-[-0.04em] text-[rgba(255,255,255,0.5)]"
              />
              <span className="whitespace-nowrap text-[17px] leading-[1.02] font-semibold text-[rgba(255,255,255,0.5)]">
                {plan.billingLabel}
              </span>
            </div>
          </div>

          <div className="mt-[14px] flex min-h-[24px] w-full items-center justify-center rounded-[8px] bg-[#111111] px-[12px] text-center text-[12px] leading-none font-medium text-[#0062FF]">
            {plan.cycleBadge || plan.limitedOffer}
          </div>

          <PlanCta
            plan={plan}
            accountPlanCode={accountPlanCode}
            accountPlanStatus={accountPlanStatus}
            isInitialLoading={isInitialLoading}
            isGlobalLoading={isGlobalLoading}
            onStartLoading={onStartLoading}
          />

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

          <p className="mt-auto w-full pt-[18px] text-center text-[15px] leading-none font-medium text-[rgba(218,218,218,0.22)] underline decoration-[rgba(218,218,218,0.18)] underline-offset-[5px]">
            Mais Beneficios
          </p>
        </article>
      </div>
    </LandingReveal>
  );
}

export function LandingOfferPlans() {
  const [selectedBillingPeriodCode, setSelectedBillingPeriodCode] =
    useState<PlanBillingPeriodCode>("monthly");
  const [accountPlanCode, setAccountPlanCode] = useState<string | null>(null);
  const [accountPlanStatus, setAccountPlanStatus] = useState<string | null>(null);
  const [isBasicAvailable, setIsBasicAvailable] = useState<boolean>(true);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isGlobalLoading, setIsGlobalLoading] = useState<boolean>(false);
  const [refreshTick, setRefreshTick] = useState<number>(0);

  const plans = useMemo(
    () =>
      getAllPlanPricingDefinitions(selectedBillingPeriodCode).map((plan) => ({
        ...plan,
        isAvailable: plan.code === "basic" ? isBasicAvailable : true,
      })),
    [isBasicAvailable, selectedBillingPeriodCode],
  );

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch("/api/auth/me/plan-state", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; plan?: { planCode?: string; status?: string } | null; isBasicAvailable?: boolean }
          | null;
        if (!isMounted) return;
        const isSuccess = response.ok && payload?.ok === true;
        
        setAccountPlanCode(payload?.plan?.planCode || null);
        setAccountPlanStatus(payload?.plan?.status || null);
        setIsBasicAvailable(isSuccess ? (payload?.isBasicAvailable ?? true) : true);
      } catch {
        if (!isMounted) return;
        setAccountPlanCode(null);
        setAccountPlanStatus(null);
        setIsBasicAvailable(true);
      } finally {
        if (isMounted) {
          setIsInitialLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [refreshTick]);

  // Sincronização Inteligente: Revalida quando o usuário volta para a aba
  useEffect(() => {
    const handleFocus = () => setRefreshTick((t) => t + 1);
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  return (
    <div className="mx-auto mt-[18px] w-full max-w-[1582px] pt-0 min-[1580px]:mt-[20px] min-[1580px]:pt-[45px]">
      <LandingReveal delay={1900}>
        <div className="relative z-40 flex w-full -translate-y-[45px] justify-center">
          <BillingPeriodSwitcher
            value={selectedBillingPeriodCode}
            onChange={setSelectedBillingPeriodCode}
          />
        </div>
      </LandingReveal>

      <div className="mx-auto mt-[22px] grid w-full max-w-[372px] grid-cols-1 justify-items-center items-start gap-x-[12px] gap-y-[26px] px-[20px] min-[900px]:max-w-[756px] min-[900px]:grid-cols-2 min-[900px]:gap-y-[20px] min-[1580px]:max-w-none min-[1580px]:grid-cols-4 min-[1580px]:justify-items-stretch min-[1580px]:gap-y-[12px] min-[1580px]:px-0">
        {plans.map((plan, index) => (
          <OfferPlanCard
            key={plan.code}
            plan={plan}
            delay={2040 + index * 90}
            accountPlanCode={accountPlanCode}
            accountPlanStatus={accountPlanStatus}
            isInitialLoading={isInitialLoading}
            isGlobalLoading={isGlobalLoading}
            onStartLoading={() => setIsGlobalLoading(true)}
          />
        ))}
      </div>
    </div>
  );
}
