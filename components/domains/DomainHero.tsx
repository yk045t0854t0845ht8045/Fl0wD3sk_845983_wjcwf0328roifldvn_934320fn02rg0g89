"use client";

import Image from "next/image";
import { LandingGlowTag } from "@/components/landing/LandingGlowTag";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { DomainSearchSection } from "./DomainSearchSection";

type DomainHeroProps = {
  initialTab?: "register" | "ai";
};

export function DomainHero({ initialTab = "register" }: DomainHeroProps) {
  return (
    <div className="relative isolate min-h-[600px] overflow-visible">
      {/* Background Blocks Pattern */}
      <LandingReveal delay={140}>
        <div className="pointer-events-none absolute inset-x-0 top-[145px] -translate-y-1/2">
          <div className="flowdesk-landing-soft-motion relative left-1/2 aspect-[1542/492] w-[160%] max-w-none -translate-x-1/2 scale-[1.05] transform-gpu min-[861px]:w-[98%] min-[861px]:scale-100">
            <Image
              src="/cdn/hero-blocks-1.svg"
              alt=""
              fill
              sizes="(max-width: 860px) 170vw, (max-width: 1640px) 126vw, 1772px"
              className="pointer-events-none select-none object-contain opacity-70"
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
                Encontre a identidade perfeita para seu projeto
              </LandingGlowTag>
            </div>
          </LandingReveal>

          <LandingReveal delay={310}>
            <h1 className="mt-[20px] max-w-[920px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[40px] leading-[1.08] font-normal tracking-[-0.04em] text-transparent md:text-[52px] lg:text-[60px]">
              Encontre o seu dominio
              <span className="block">de forma rapida e segura</span>
            </h1>
          </LandingReveal>

          <LandingReveal delay={400}>
            <div className="mt-[48px] w-full max-w-[1200px]">
              <DomainSearchSection initialTab={initialTab} />
            </div>
          </LandingReveal>
        </div>
      </div>
    </div>
  );
}
