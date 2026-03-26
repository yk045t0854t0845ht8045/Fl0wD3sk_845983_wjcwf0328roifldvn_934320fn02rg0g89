"use client";

import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { DiscordLoginButton } from "@/components/login/DiscordLoginButton";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { PRIVACY_PATH, TERMS_PATH } from "@/lib/legal/content";

export function LoginPanel() {
  const termsUrl = process.env.NEXT_PUBLIC_TERMS_URL || TERMS_PATH;
  const privacyUrl = process.env.NEXT_PUBLIC_PRIVACY_URL || PRIVACY_PATH;

  return (
    <section className="relative w-full max-w-[560px]">
      <LandingReveal delay={100}>
        <div className="relative overflow-hidden rounded-[32px] bg-transparent px-[26px] py-[28px] shadow-[0_28px_90px_rgba(0,0,0,0.44)] sm:px-[34px] sm:py-[36px]">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[32px] border border-[#0E0E0E]"
          />
          <span
            aria-hidden="true"
            className="flowdesk-tag-border-glow pointer-events-none absolute inset-[-2px] rounded-[32px]"
          />
          <span
            aria-hidden="true"
            className="flowdesk-tag-border-core pointer-events-none absolute inset-[-1px] rounded-[32px]"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-[1px] rounded-[31px] bg-[linear-gradient(180deg,rgba(8,8,8,0.98)_0%,rgba(4,4,4,0.98)_100%)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-[1px] top-[1px] h-[180px] rounded-t-[31px] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0.02)_32%,transparent_74%)]"
          />
          <div className="relative z-10">
            <LandingReveal delay={170}>
              <Link
                href="/"
                className="relative mx-auto block h-[36px] w-[182px]"
                aria-label="Voltar para a pagina inicial da Flowdesk"
              >
                <Image
                  src="/cdn/logos/logo.png"
                  alt="Flowdesk"
                  fill
                  sizes="182px"
                  className="object-contain object-center"
                  priority
                />
              </Link>
            </LandingReveal>

            <LandingReveal delay={240}>
              <h1 className="mt-[28px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-center text-[32px] leading-[0.98] font-normal tracking-[-0.05em] text-transparent sm:text-[40px]">
                Entre com sua
                <br />
                conta Discord
              </h1>
            </LandingReveal>

            <LandingReveal delay={450}>
              <div className="mt-[22px]">
                <DiscordLoginButton href="/api/auth/discord" />
              </div>
            </LandingReveal>
          </div>
        </div>
      </LandingReveal>

      <LandingReveal delay={520}>
        <div className="mt-[14px] flex flex-wrap items-center justify-center gap-x-[16px] gap-y-[8px] text-[13px] leading-none font-normal">
          <Link
            href={termsUrl}
            className="flowdesk-login-legal-link"
            style={{ "--flowdesk-login-legal-delay": "0s" } as CSSProperties}
          >
            Termos
          </Link>
          <Link
            href={privacyUrl}
            className="flowdesk-login-legal-link"
            style={{ "--flowdesk-login-legal-delay": "1.1s" } as CSSProperties}
          >
            Politica de Privacidade
          </Link>
          <Link
            href={privacyUrl}
            className="flowdesk-login-legal-link"
            style={{ "--flowdesk-login-legal-delay": "2.2s" } as CSSProperties}
          >
            Cookies
          </Link>
        </div>
      </LandingReveal>
    </section>
  );
}
