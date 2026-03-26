"use client";

import { useState } from "react";
import Image from "next/image";
import { ButtonLoader } from "@/components/login/ButtonLoader";

type DiscordLoginButtonProps = {
  href: string;
};

export function DiscordLoginButton({ href }: DiscordLoginButtonProps) {
  const [loading, setLoading] = useState(false);

  function handleClick() {
    if (loading) return;

    setLoading(true);

    window.setTimeout(() => {
      window.location.assign(href);
    }, 1200);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      aria-busy={loading}
      className="group relative inline-flex h-[52px] w-full items-center justify-center overflow-hidden rounded-[14px] px-6 text-[16px] leading-none font-semibold disabled:cursor-not-allowed"
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-[14px] bg-[linear-gradient(180deg,#0062FF_0%,#0153D5_100%)] transition-transform duration-200 ease-out group-hover:scale-[1.015] group-active:scale-[0.992]"
      />

      <span className="relative z-10 inline-flex items-center justify-center gap-[12px] text-white">
        {loading ? (
          <ButtonLoader size={22} colorClassName="text-white" />
        ) : (
          <>
            <Image
              src="/cdn/icons/discord-login.svg"
              alt="Discord"
              width={20}
              height={20}
              className="h-[20px] w-auto shrink-0"
              priority
            />
            <span>Continuar com Discord</span>
          </>
        )}
      </span>
    </button>
  );
}
