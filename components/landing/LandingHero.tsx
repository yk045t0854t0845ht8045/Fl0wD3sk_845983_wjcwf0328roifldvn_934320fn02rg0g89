"use client";

import Image from "next/image";
import { LandingActionButton } from "@/components/landing/LandingActionButton";
import { LandingFaqAccordion } from "@/components/landing/LandingFaqAccordion";
import { LandingGlowTag } from "@/components/landing/LandingGlowTag";
import { LandingLogoLoop } from "@/components/landing/LandingLogoLoop";
import { LandingOfferPlans } from "@/components/landing/LandingOfferPlans";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { LandingServerUsageRow } from "@/components/landing/LandingServerUsageRow";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import { OFFICIAL_DISCORD_INVITE_URL } from "@/lib/discordLink/config";

const FEATURE_DIVIDER_POSITIONS = [
  { left: "5.1601%" },
  { left: "37.2%" },
  { left: "69.2%" },
] as const;

const FEATURE_COLUMN_TITLES = [
  "99.9% Uptime",
  "Segurança+",
  "10x mais veloz",
] as const;

const FEATURE_COLUMN_SUBTITLES = [
  "Disponibilidade alta para manter sua operacao sempre ativa.",
  "Camadas extras de protecao para blindar o seu servidor.",
  "Respostas aceleradas com stack otimizada e bem distribuida.",
] as const;

const FEATURE_COLUMN_DESCRIPTIONS = [
  "Alta disponibilidade com foco em estabilidade constante e operacao continua no dia a dia.",
  "Infraestrutura nacional preparada para reduzir latencia, elevar a confianca e manter tudo proximo do seu publico.",
  "Arquitetura otimizada para respostas mais rapidas, fluxos mais leves e uma experiencia mais consistente.",
] as const;

const FEATURE_COLUMN_NUMBERS = ["01", "02", "03"] as const;
const DOCUMENTATION_HREF =
  process.env.NEXT_PUBLIC_DOCUMENTATION_URL || "/terms";

type LandingServiceState = "loading" | "ready" | "degraded";

function renderCheckoutActionLabel(
  serviceState: LandingServiceState,
  readyLabel: string,
) {
  if (serviceState === "loading") {
    return <ButtonLoader size={18} colorClassName="text-white" />;
  }

  if (serviceState === "degraded") {
    return "Indisponivel";
  }

  return readyLabel;
}

export function LandingHero({
  serviceState = "loading",
}: {
  serviceState?: LandingServiceState;
}) {
  const isCheckoutReady = serviceState === "ready";

  return (
    <section className="w-full">
      <div className="mx-auto mt-[35px] w-full max-w-[1582px] px-[20px] md:px-6 lg:px-8 xl:px-10 2xl:px-[20px]">
        <div className="relative isolate min-h-[620px] overflow-hidden pb-8">
          <LandingReveal delay={140}>
            <div className="pointer-events-none absolute inset-x-0 top-[21%] -translate-y-1/2">
              <div className="flowdesk-landing-soft-motion relative left-1/2 aspect-[1542/492] w-[160%] max-w-none -translate-x-1/2 scale-[1.05] transform-gpu min-[861px]:w-[98%] min-[861px]:scale-100">
                <Image
                  src="/cdn/hero-blocks-1.svg"
                  alt=""
                  fill
                  sizes="(max-width: 860px) 170vw, (max-width: 1640px) 126vw, 1772px"
                  className="pointer-events-none select-none object-contain opacity-90"
                  draggable={false}
                  priority
                />
              </div>
            </div>
          </LandingReveal>

          <div className="relative z-10">
            <div className="mx-auto flex max-w-[980px] flex-col items-center text-center">
              <LandingReveal delay={220}>
                <div className="flex w-full justify-center">
                  <LandingGlowTag>
                    O app com seguranca sendo prioridade
                  </LandingGlowTag>
                </div>
              </LandingReveal>

              <LandingReveal delay={310}>
                <h1 className="mt-[20px] max-w-[920px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[40px] leading-[1.08] font-normal tracking-[-0.04em] text-transparent md:text-[52px] lg:text-[60px]">
                  Tudo que seu Discord precisa
                  <span className="block">em um so sistema</span>
                </h1>
              </LandingReveal>

              <LandingReveal delay={400}>
                <p className="mt-[20px] max-w-[760px] text-[14px] leading-[1.45] font-normal text-[#B7B7B7] md:text-[18px]">
                  Gerencie sua comunidade com uma base solida, integrando
                  atendimento,
                  <span className="block">
                    automacoes e pagamentos de forma consistente e escalavel.
                  </span>
                </p>
              </LandingReveal>

              <LandingReveal delay={490}>
                <LandingActionButton
                  href={isCheckoutReady ? "/config?fresh=1" : undefined}
                  variant="blue"
                  disabled={!isCheckoutReady}
                  className="mt-[20px] h-[42px] min-w-[156px] rounded-[12px] px-[24px] text-[16px]"
                >
                  {renderCheckoutActionLabel(serviceState, "Comecar hoje")}
                </LandingActionButton>
              </LandingReveal>
            </div>

            <LandingReveal delay={560}>
              <div className="mx-auto mt-[60px] flex w-full justify-center">
                <div className="relative w-full max-w-[1224px]">
                  <Image
                    src="/cdn/hero/hero-banner.svg"
                    alt="Preview central do hero da landing"
                    width={1124}
                    height={356}
                    sizes="(max-width: 1180px) calc(100vw - 40px), 1124px"
                    className="pointer-events-none h-auto w-full select-none object-contain"
                    draggable={false}
                    priority
                  />
                </div>
              </div>
            </LandingReveal>
          </div>
        </div>

        <LandingLogoLoop />

        <div className="mx-auto mt-[60px] flex max-w-[1500px] flex-col items-center text-center">
          <LandingReveal delay={720}>
            <div className="flex w-full justify-center">
              <LandingGlowTag>
                Ultra velocidade de resposta e nossa proposta
              </LandingGlowTag>
            </div>
          </LandingReveal>

          <LandingReveal delay={810}>
            <h2 className="mt-[20px] max-w-[1480px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[34px] leading-[1.08] font-normal tracking-[-0.04em] text-transparent sm:text-[40px] md:text-[52px] lg:text-[50px]">
              +1.500 servidores e parceiros e clientes que confiam
              <span className="block">na Flowdesk® de forma veloz, rapida e segura</span>
            </h2>
          </LandingReveal>

          <LandingServerUsageRow />

          <LandingReveal delay={980}>
            <div className="mx-auto mt-[48px] w-full max-w-[1124px]">
              <div className="h-[2px] w-full bg-[linear-gradient(90deg,rgba(14,14,14,0.2)_0%,rgba(14,14,14,1)_50%,rgba(14,14,14,0.2)_100%)]" />

              <div className="relative hidden h-[320px] min-[1200px]:block">
                {FEATURE_DIVIDER_POSITIONS.map((divider, index) => (
                  <div
                    key={`feature-divider-${index}`}
                    className="absolute top-0 z-0 h-full w-[2px] -translate-x-1/2 bg-[#0E0E0E]"
                    style={{ left: divider.left, opacity: 1 }}
                  />
                ))}

                {FEATURE_DIVIDER_POSITIONS.map((divider, index) => (
                  <div
                    key={`feature-icon-${index}`}
                    className="pointer-events-none absolute top-[34px] z-10 -translate-x-1/2"
                    style={{ left: divider.left }}
                  >
                    <Image
                      src="/cdn/images/icon-arrow.svg"
                      alt=""
                      width={70}
                      height={70}
                      className="h-[70px] w-[70px] select-none object-contain"
                      draggable={false}
                    />
                  </div>
                ))}

                {FEATURE_DIVIDER_POSITIONS.map((divider, index) => (
                  <div
                    key={`feature-title-${index}`}
                    className="absolute top-[53px] bottom-[45px] z-10 flex w-[280px] flex-col text-left"
                    style={{ left: `calc(${divider.left} + 52px)` }}
                  >
                      <h3 className="bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[33px] leading-none font-semibold tracking-[-0.04em] text-transparent">
                        {FEATURE_COLUMN_TITLES[index]}
                      </h3>
                      <p className="mt-[12px] max-w-[248px] text-[16px] leading-[1.22] font-medium tracking-[-0.03em] text-[rgba(218,218,218,0.72)]">
                        {FEATURE_COLUMN_SUBTITLES[index]}
                      </p>
                      <p className="mt-[12px] max-w-[268px] text-[14px] leading-[1.28] font-normal tracking-[-0.03em] text-[rgba(218,218,218,0.54)]">
                        {FEATURE_COLUMN_DESCRIPTIONS[index]}
                      </p>
                      <p className="mt-auto text-[18px] leading-none font-normal tracking-[-0.04em] text-[rgba(218,218,218,0.34)]">
                        {FEATURE_COLUMN_NUMBERS[index]}
                      </p>
                  </div>
                ))}

                {FEATURE_DIVIDER_POSITIONS.map((divider, index) => (
                  <div
                    key={`feature-dot-${index}`}
                    className="pointer-events-none absolute bottom-0 z-20 -translate-x-1/2 translate-y-1/2"
                    style={{ left: divider.left }}
                  >
                    <div className="flex h-[14px] w-[14px] items-center justify-center rounded-full bg-[rgba(0,98,255,0.3)]">
                      <div className="h-[8px] w-[8px] rounded-full bg-[#0062FF]" />
                    </div>
                  </div>
                ))}

                <div className="absolute inset-x-0 bottom-0 z-0 h-[2px] bg-[linear-gradient(90deg,rgba(14,14,14,0.2)_0%,rgba(14,14,14,1)_50%,rgba(14,14,14,0.2)_100%)]" />
              </div>

              <div className="min-[1200px]:hidden">
                {[0, 1, 2].map((blockIndex) => (
                  <div
                    key={`feature-mobile-block-${blockIndex}`}
                    className="relative h-[224px]"
                  >
                    <div className="absolute left-[58px] top-0 z-0 h-full w-[2px] -translate-x-1/2 bg-[#0E0E0E]" />
                    <div className="pointer-events-none absolute left-[58px] top-[26px] z-10 -translate-x-1/2">
                      <Image
                        src="/cdn/images/icon-arrow.svg"
                        alt=""
                        width={72}
                        height={72}
                        className="h-[72px] w-[72px] select-none object-contain"
                        draggable={false}
                      />
                    </div>
                    <div className="absolute left-[96px] top-[45px] bottom-[47px] z-10 flex w-[236px] flex-col text-left">
                        <h3 className="bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[34px] leading-none font-semibold tracking-[-0.04em] text-transparent">
                        {FEATURE_COLUMN_TITLES[blockIndex]}
                      </h3>
                        <p className="mt-[10px] max-w-[220px] text-[15px] leading-[1.22] font-medium tracking-[-0.03em] text-[rgba(218,218,218,0.7)]">
                          {FEATURE_COLUMN_SUBTITLES[blockIndex]}
                        </p>
                        <p className="mt-[10px] max-w-[236px] text-[13px] leading-[1.28] font-normal tracking-[-0.03em] text-[rgba(218,218,218,0.54)]">
                          {FEATURE_COLUMN_DESCRIPTIONS[blockIndex]}
                        </p>
                    </div>
                    <p className="absolute bottom-[47px] right-0 z-10 text-right text-[16px] leading-none font-normal tracking-[-0.04em] text-[rgba(218,218,218,0.34)]">
                      {FEATURE_COLUMN_NUMBERS[blockIndex]}
                    </p>
                    <div className="pointer-events-none absolute bottom-0 left-[58px] z-20 -translate-x-1/2 translate-y-1/2">
                      <div className="flex h-[12px] w-[12px] items-center justify-center rounded-full bg-[rgba(0,98,255,0.3)]">
                        <div className="h-[7px] w-[7px] rounded-full bg-[#0062FF]" />
                      </div>
                    </div>
                    <div className="absolute inset-x-0 bottom-0 z-0 h-[2px] bg-[linear-gradient(90deg,rgba(14,14,14,0.2)_0%,rgba(14,14,14,1)_50%,rgba(14,14,14,0.2)_100%)]" />
                  </div>
                ))}
              </div>
            </div>
          </LandingReveal>

          <div className="mx-auto mt-[64px] w-full max-w-[1124px]">
            <LandingReveal delay={1020}>
              <div className="relative mb-[48px] h-[2px] w-full">
                <div className="pointer-events-none absolute inset-y-0 left-1/2 h-[2px] w-screen -translate-x-1/2 bg-[linear-gradient(90deg,rgba(14,14,14,0.2)_0%,rgba(14,14,14,1)_50%,rgba(14,14,14,0.2)_100%)]" />
              </div>
            </LandingReveal>

            <LandingReveal delay={1060}>
              <div className="flex w-full justify-start">
                <LandingGlowTag>
                  O melhor investimento para sua empresa
                </LandingGlowTag>
              </div>
            </LandingReveal>

            <div className="mt-[12px] flex flex-col items-start gap-[28px] min-[1200px]:-mt-[36px] min-[1200px]:flex-row min-[1200px]:items-center min-[1200px]:justify-between min-[1200px]:gap-[48px]">
              <LandingReveal delay={1140}>
                <h2 className="w-full max-w-[720px] text-left bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[34px] leading-[1.08] font-normal tracking-[-0.04em] text-transparent sm:text-[40px] md:text-[46px] min-[1200px]:text-[50px]">
                  Tudo isso em um valor surreal
                </h2>
              </LandingReveal>

              <LandingReveal delay={1220}>
                <div className="flex w-full max-w-[420px] flex-col items-start text-left">
                  <p className="text-[14px] leading-[1.45] font-normal text-[#B7B7B7] sm:text-[17px] min-[1200px]:text-[16px]">
                    Uma estrutura completa, com um custo que acompanha o seu
                    crescimento, mantendo eficiencia e organizacao em cada
                    etapa da sua evolucao.
                  </p>

                  <LandingActionButton
                    href={isCheckoutReady ? "/config?fresh=1" : undefined}
                    variant="blue"
                    disabled={!isCheckoutReady}
                    className="mt-[20px] h-[42px] min-w-[156px] rounded-[12px] px-[24px] text-[16px]"
                  >
                    {renderCheckoutActionLabel(serviceState, "Comecar hoje")}
                  </LandingActionButton>
                </div>
              </LandingReveal>
            </div>

            <LandingReveal delay={1300}>
              <div className="mt-[48px] flex w-full justify-center">
                <div className="relative w-full max-w-[1124px]">
                  <Image
                    src="/cdn/images/plans-comp.svg"
                    alt="Comparativo de planos da Flowdesk"
                    width={1124}
                    height={640}
                    sizes="(max-width: 1180px) calc(100vw - 40px), 1124px"
                    style={{ width: "100%", height: "auto" }}
                    className="pointer-events-none select-none object-contain"
                    draggable={false}
                  />
                </div>
              </div>
            </LandingReveal>
          </div>

          <LandingReveal delay={1340}>
            <div className="relative mt-[72px] mb-[48px] h-[2px] w-full">
              <div className="pointer-events-none absolute inset-y-0 left-1/2 h-[2px] w-screen -translate-x-1/2 bg-[linear-gradient(90deg,rgba(14,14,14,0.2)_0%,rgba(14,14,14,1)_50%,rgba(14,14,14,0.2)_100%)]" />
            </div>
          </LandingReveal>

          <div className="relative isolate w-full min-h-[420px] overflow-hidden">

            <LandingReveal delay={1380}>
              <div className="pointer-events-none absolute inset-x-0 top-[34%] -translate-y-1/2">
                <div className="flowdesk-landing-soft-motion relative left-1/2 aspect-[1542/492] w-[160%] max-w-none -translate-x-1/2 scale-[1.05] transform-gpu min-[861px]:w-[98%] min-[861px]:scale-100">
                  <Image
                    src="/cdn/hero-blocks-1.svg"
                    alt=""
                    fill
                    sizes="(max-width: 860px) 170vw, (max-width: 1640px) 126vw, 1772px"
                    className="pointer-events-none select-none object-contain opacity-90"
                    draggable={false}
                  />
                </div>
              </div>
            </LandingReveal>

            <div className="relative z-10 mx-auto flex max-w-[980px] flex-col items-center text-center">
              <LandingReveal delay={1460}>
                <div className="flex w-full justify-center">
                  <LandingGlowTag>
                    Ainda esta com duvidas?
                  </LandingGlowTag>
                </div>
              </LandingReveal>

              <LandingReveal delay={1540}>
                <h2 className="mt-[20px] max-w-[980px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[34px] leading-[1.08] font-normal tracking-[-0.04em] text-transparent sm:text-[40px] md:text-[52px] lg:text-[50px]">
                  Oque esta esperando para
                  <span className="block">migrar seus sistemas para Flow?</span>
                </h2>
              </LandingReveal>

              <LandingReveal delay={1620}>
                <p className="mt-[20px] max-w-[900px] text-[14px] leading-[1.42] font-normal text-[#B7B7B7] md:text-[16px]">
                  Venha para Flowdesk e teste voce mesmo a exclusividade pro
                  que nossos sistemas
                  <span className="block">
                    podem proporcionar para sua moderacao aprimorada e a
                    facilidade do dia a dia
                  </span>
                  <span className="block">para seus moderadores</span>
                </p>
              </LandingReveal>

              <LandingReveal delay={1700}>
                <LandingActionButton
                  href={isCheckoutReady ? "/config?fresh=1" : undefined}
                  variant="blue"
                  disabled={!isCheckoutReady}
                  className="mt-[20px] h-[42px] min-w-[170px] rounded-[12px] px-[24px] text-[16px]"
                >
                  {renderCheckoutActionLabel(serviceState, "Comecar agora")}
                </LandingActionButton>
              </LandingReveal>
            </div>
          </div>

          <LandingReveal delay={1780}>
            <div className="relative -mt-[40px] h-[2px] w-full" />
          </LandingReveal>

          <div id="plans" className="w-full">
            <LandingReveal delay={1860}>
              <h2 className="mx-auto mt-[28px] max-w-[1124px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-center text-[34px] leading-[1.08] font-normal tracking-[-0.04em] text-transparent sm:text-[40px] md:text-[46px] lg:text-[50px]">
                Aproveite nossas maiores ofertas
              </h2>
            </LandingReveal>

            <LandingOfferPlans serviceState={serviceState} />
          </div>

          <div className="mx-auto mt-[88px] flex w-full max-w-[1320px] flex-col items-center text-center">
            <LandingReveal delay={2280}>
              <div className="flex w-full justify-center">
                <LandingGlowTag>
                  Saiba mais informacoes sobre a Flowdesk
                </LandingGlowTag>
              </div>
            </LandingReveal>

            <LandingReveal delay={2360}>
              <h2 className="mt-[20px] max-w-[1280px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[34px] leading-[1.08] font-normal tracking-[-0.04em] text-transparent sm:text-[40px] md:text-[52px] lg:text-[50px]">
                Informacoes e perguntas frequentes
              </h2>
            </LandingReveal>

            <LandingReveal delay={2440}>
              <p className="mt-[20px] max-w-[1280px] text-[14px] leading-[1.42] font-normal text-[#B7B7B7] md:text-[17px]">
                <span className="block">
                  Caso ainda tenha alguma duvida sobre a Flowdesk. Voce pode
                  entrar em contato com nossa equipe,
                </span>
                <span className="mt-[4px] block">
                  que prestaremos todo o suporte{" "}
                  <a
                    href={OFFICIAL_DISCORD_INVITE_URL}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline decoration-[rgba(218,218,218,0.72)] underline-offset-[4px] transition-colors duration-200 hover:text-[#DADADA]"
                  >
                    Entre em contato
                  </a>
                  . Ou acesse nossa{" "}
                  <a
                    href={DOCUMENTATION_HREF}
                    className="underline decoration-[rgba(218,218,218,0.72)] underline-offset-[4px] transition-colors duration-200 hover:text-[#DADADA]"
                  >
                    Docs
                  </a>
                  .
                </span>
              </p>
            </LandingReveal>

            <LandingReveal delay={2520}>
              <LandingActionButton
                href={OFFICIAL_DISCORD_INVITE_URL}
                variant="light"
                className="mt-[28px] h-[46px] rounded-[12px] px-6 text-[16px]"
              >
                Entre em contato
              </LandingActionButton>
            </LandingReveal>

            <LandingReveal delay={2600}>
              <LandingFaqAccordion />
            </LandingReveal>
          </div>

          <LandingReveal delay={2680}>
            <div className="relative mt-[72px] mb-[48px] h-[2px] w-full">
              <div className="pointer-events-none absolute inset-y-0 left-1/2 h-[2px] w-screen -translate-x-1/2 bg-[linear-gradient(90deg,rgba(14,14,14,0.2)_0%,rgba(14,14,14,1)_50%,rgba(14,14,14,0.2)_100%)]" />
            </div>
          </LandingReveal>

          <div className="mx-auto flex w-full max-w-[1320px] flex-col items-center text-center">
            <LandingReveal delay={2760}>
              <div className="flex w-full justify-center">
                <LandingGlowTag>Voce merece o melhor</LandingGlowTag>
              </div>
            </LandingReveal>

            <LandingReveal delay={2840}>
              <h2 className="mt-[20px] max-w-[1320px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[34px] leading-[1.08] font-normal tracking-[-0.04em] text-transparent sm:text-[40px] md:text-[52px] lg:text-[50px]">
                Comece hoje mesmo a usar Flowdesk{"\u00AE"}
                <span className="block">em seus atendimentos</span>
              </h2>
            </LandingReveal>

            <LandingReveal delay={2920}>
              <p className="mt-[20px] max-w-[1280px] text-[14px] leading-[1.42] font-normal text-[#B7B7B7] md:text-[17px]">
                Comece hoje mesmo a usar o Flowdesk{"\u00AE"} e transforme
                seus atendimentos no Discord em uma operacao
                <span className="block">
                  mais organizada, automatizada e eficiente, com mais controle
                  e consistencia em cada interacao.
                </span>
              </p>
            </LandingReveal>

            <LandingReveal delay={3000}>
              <div className="mt-[28px] flex flex-col items-center gap-[12px] sm:flex-row sm:justify-center">
                <LandingActionButton
                  href="/#plans"
                  variant="light"
                  className="h-[46px] rounded-[12px] px-6 text-[16px]"
                >
                  Escolha um plano
                </LandingActionButton>
                <LandingActionButton
                  href={isCheckoutReady ? "/config?fresh=1" : undefined}
                  variant="blue"
                  disabled={!isCheckoutReady}
                  className="h-[46px] rounded-[12px] px-6 text-[16px]"
                >
                  {renderCheckoutActionLabel(serviceState, "Comece gratuitamente")}
                </LandingActionButton>
              </div>
            </LandingReveal>
          </div>

          <LandingReveal delay={3080}>
            <div className="relative mt-[48px] h-[2px] w-full">
              <div className="pointer-events-none absolute inset-y-0 left-1/2 h-[2px] w-screen -translate-x-1/2 bg-[linear-gradient(90deg,rgba(14,14,14,0.2)_0%,rgba(14,14,14,1)_50%,rgba(14,14,14,0.2)_100%)]" />
            </div>
          </LandingReveal>
        </div>
      </div>
    </section>
  );
}
