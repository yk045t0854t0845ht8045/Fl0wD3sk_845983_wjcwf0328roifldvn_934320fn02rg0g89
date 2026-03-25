import Image from "next/image";
import { LandingActionButton } from "@/components/landing/LandingActionButton";
import { LandingReveal } from "@/components/landing/LandingReveal";

const PLAN_FEATURE_ICON_SOURCES = [
  "/cdn/icons/discord-icon.svg",
  "/cdn/icons/ticket-icon.svg",
  "/cdn/icons/star-icon.svg",
  "/cdn/icons/plugin-icon.svg",
] as const;

type OfferPlan = {
  name: string;
  badge: string;
  oldPrice: string;
  price: string;
  suffix: string;
  limitedOffer: string;
  buttonLabel: string;
  description: string;
  features: string[];
  popular?: boolean;
};

const OFFER_PLANS: OfferPlan[] = [
  {
    name: "Flow Basic",
    badge: "Gratuitamente",
    oldPrice: "R$00,00",
    price: "R$0,00",
    suffix: "/7 dias",
    limitedOffer: "Oferta por tempo limitado",
    buttonLabel: "Em breve",
    description:
      "Plano com teste gratuitamente. Liberacao do plano entrara em vigor em breve.",
    features: [
      "1 Servidor licenciado",
      "2 Tickets ativos",
      "0 Automacoes liberadas",
      "50 acoes",
    ],
  },
  {
    name: "Flow Pro",
    badge: "50% de desconto",
    oldPrice: "R$19,00",
    price: "R$9,99",
    suffix: "/mes",
    limitedOffer: "Oferta por tempo limitado",
    buttonLabel: "Escolher Plano",
    description:
      "Renovacao por R$ 9,99/mes. Cancele a qualquer momento.",
    features: [
      "1 Servidor licenciado",
      "50 Tickets ativos",
      "2 Automacoes liberadas",
      "1.000 acoes/mes",
    ],
    popular: true,
  },
  {
    name: "Flow Ultra",
    badge: "60% de desconto",
    oldPrice: "R$49,00",
    price: "R$19,90",
    suffix: "/mes",
    limitedOffer: "Oferta por tempo limitado",
    buttonLabel: "Em breve",
    description:
      "Renovacao por R$ 19,90/mes. Cancele a qualquer momento.",
    features: [
      "5 Servidores licenciados",
      "1000 Tickets ativos",
      "15 Automacoes liberadas",
      "20.000 acoes/mes",
    ],
  },
  {
    name: "Flow Master",
    badge: "80% de desconto",
    oldPrice: "R$144,00",
    price: "R$29,90",
    suffix: "/mes",
    limitedOffer: "Oferta por tempo limitado",
    buttonLabel: "Em breve",
    description:
      "Renovacao por R$ 29,90/mes. Cancele a qualquer momento.",
    features: [
      "10 Servidores licenciados",
      "Tickets ilimitados",
      "Automacoes ilimitadas",
      "Uso ilimitado",
    ],
  },
];

function PlanCta({
  buttonLabel,
  disabled,
}: {
  buttonLabel: string;
  disabled: boolean;
}) {
  if (disabled) {
    return (
      <div className="mt-[20px] inline-flex h-[50px] w-full items-center justify-center rounded-[12px] bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] px-6 text-[16px] leading-none font-semibold text-[rgba(40,40,40,0.72)]">
        {buttonLabel}
      </div>
    );
  }

  return (
    <LandingActionButton
      href="/config"
      variant="light"
      className="mt-[20px] h-[50px] w-full rounded-[12px] px-6 text-[16px]"
    >
      {buttonLabel}
    </LandingActionButton>
  );
}

function OfferPlanCard({
  plan,
  delay,
}: {
  plan: OfferPlan;
  delay: number;
}) {
  const isPopular = Boolean(plan.popular);
  const isDisabled = plan.buttonLabel !== "Escolher Plano";
  const cardBodyClass =
    "relative z-20 flex flex-col items-start overflow-hidden rounded-[24px] bg-[#0A0A0A] px-[20px] pb-[18px] pt-[20px] text-left";
  const cardContent = (
    <>
      <div className="absolute right-[20px] top-[20px] rounded-[8px] bg-[#0062FF] px-[14px] py-[6px] text-[13px] leading-none font-medium text-white">
        {plan.badge}
      </div>

      <div className="mt-[28px] flex w-full flex-col items-start text-left">
        <h3 className="w-full max-w-[220px] text-[22px] leading-none font-normal text-[rgba(218,218,218,0.92)]">
          {plan.name}
        </h3>

        <p className="mt-[18px] w-full text-[16px] leading-none font-normal text-[rgba(255,255,255,0.2)] line-through">
          {plan.oldPrice}
        </p>

        <div className="mt-[10px] flex w-full items-baseline justify-start gap-[4px] overflow-visible pb-[4px] text-left">
          <span className="whitespace-nowrap text-[35px] leading-[1.02] font-semibold tracking-[-0.04em] text-[rgba(255,255,255,0.5)]">
            {plan.price}
          </span>
          <span className="whitespace-nowrap text-[17px] leading-[1.02] font-semibold text-[rgba(255,255,255,0.5)]">
            {plan.suffix}
          </span>
        </div>
      </div>

      <div className="mt-[20px] flex h-[24px] w-full items-center justify-center rounded-[8px] bg-[#111111] px-[12px] text-center text-[12px] leading-none font-medium text-[#0062FF]">
        {plan.limitedOffer}
      </div>

      <PlanCta buttonLabel={plan.buttonLabel} disabled={isDisabled} />

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
    </>
  );

  return (
    <LandingReveal delay={delay}>
      <div
        className={`relative w-full max-w-[372px] justify-self-center min-[1580px]:max-w-none ${
          "h-[520px]"
        }`}
      >
        {isPopular ? (
          <>
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 hidden h-[304px] rounded-[25px] bg-[#0062FF] min-[1580px]:block min-[1580px]:top-[-43px]" />
            <div className="absolute inset-x-0 top-0 z-30 hidden h-[45px] items-center justify-center px-[20px] text-center text-[13px] leading-none font-medium tracking-[0.02em] text-white min-[1580px]:flex min-[1580px]:top-[-43px]">
              MAIS POPULAR
            </div>
            <div className="pointer-events-none absolute left-0 z-[25] hidden h-[26px] w-[26px] rounded-tl-[24px] border-l-[2px] border-t-[2px] border-[#0062FF] min-[1580px]:block min-[1580px]:-top-[4px]" />
            <div className="pointer-events-none absolute right-0 z-[25] hidden h-[26px] w-[26px] rounded-tr-[24px] border-r-[2px] border-t-[2px] border-[#0062FF] min-[1580px]:block min-[1580px]:-top-[4px]" />
            <article
              className={`${cardBodyClass} absolute inset-x-0 bottom-0 h-[520px] shadow-[inset_0_0_0_2px_#0062FF] min-[1580px]:top-[-2px] min-[1580px]:h-auto min-[1580px]:shadow-[inset_2px_0_0_#0062FF,inset_-2px_0_0_#0062FF,inset_0_-2px_0_#0062FF]`}
            >
              {cardContent}
            </article>
          </>
        ) : null}

        {isPopular ? null : (
          <article className={`${cardBodyClass} h-[520px]`}>
            {cardContent}
          </article>
        )}
      </div>
    </LandingReveal>
  );
}

export function LandingOfferPlans() {
  return (
    <div className="mx-auto mt-[48px] w-full max-w-[1582px] pt-0 min-[1580px]:pt-[45px]">
      <div className="mx-auto grid w-full max-w-[372px] grid-cols-1 justify-items-center items-start gap-x-[12px] gap-y-[26px] px-[20px] min-[900px]:max-w-[756px] min-[900px]:grid-cols-2 min-[900px]:gap-y-[20px] min-[1580px]:max-w-none min-[1580px]:grid-cols-4 min-[1580px]:justify-items-stretch min-[1580px]:gap-y-[12px] min-[1580px]:px-0">
        {OFFER_PLANS.map((plan, index) => (
          <OfferPlanCard
            key={plan.name}
            plan={plan}
            delay={1940 + index * 90}
          />
        ))}
      </div>
    </div>
  );
}
