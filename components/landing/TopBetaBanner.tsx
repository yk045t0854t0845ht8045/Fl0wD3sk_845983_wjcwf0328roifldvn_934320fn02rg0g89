import Link from "next/link";
import { LandingReveal } from "@/components/landing/LandingReveal";

const DEFAULT_BETA_BANNER_URL = "/config";

function ArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-[24px] w-[24px] shrink-0 text-[#B7B7B7] transition-transform duration-200 group-hover:translate-x-[2px] group-hover:text-white"
      fill="none"
    >
      <path
        d="M7 4.75L12.25 10L7 15.25"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TopBetaBanner() {
  const bannerHref =
    process.env.NEXT_PUBLIC_LANDING_BETA_URL || DEFAULT_BETA_BANNER_URL;

  return (
    <LandingReveal delay={0}>
      <Link
        href={bannerHref}
        className="flowdesk-landing-soft-motion group flex h-[60px] w-full items-center justify-center bg-[#111111] px-8 transition-colors duration-200 hover:bg-[#151515]"
        aria-label="Ir para a oferta beta do Flowdesk"
      >
        <span className="flex min-w-0 items-center gap-3 overflow-hidden text-center text-[20px] leading-none font-normal sm:text-[20px]">
          <span className="truncate text-[#B7B7B7]">
            Torne-se membro beta
            <span className="px-2 text-[#6A6A6A]">-</span>
            Virando beta na{" "}
            <span className="font-semibold text-white">Flowdesk</span> voce paga
            para sempre <span className="font-semibold text-white">R$ 9,99</span>.
            Sem alteracoes futuras
          </span>
          <ArrowIcon />
        </span>
      </Link>
    </LandingReveal>
  );
}
