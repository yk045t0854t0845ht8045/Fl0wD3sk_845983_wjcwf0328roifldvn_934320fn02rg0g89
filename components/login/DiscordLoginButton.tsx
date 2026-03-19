"use client";

import { useState } from "react";
import Image from "next/image";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import { loginScale } from "@/components/login/loginScale";

type DiscordLoginButtonProps = {
  href: string;
};

export function DiscordLoginButton({ href }: DiscordLoginButtonProps) {
  const [loading, setLoading] = useState(false);

  function handleClick() {
    if (loading) return;

    setLoading(true);

    // Exibe o loader por 2 segundos antes de iniciar o fluxo OAuth.
    setTimeout(() => {
      window.location.assign(href);
    }, 2000);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      aria-busy={loading}
      className="flex w-full items-center justify-center gap-[4px] border border-[#2E2E2E] bg-[#0A0A0A] font-medium text-[#D8D8D8] transition-colors hover:border-[#3A3A3A] disabled:cursor-not-allowed"
      style={{
        height: `${loginScale.buttonHeight}px`,
        borderRadius: `${loginScale.buttonRadius}px`,
        fontSize: `${loginScale.buttonTextSize}px`,
      }}
    >
      {loading ? (
        <ButtonLoader size={loginScale.buttonLoaderSize} />
      ) : (
        <>
          <Image
            src="/cdn/logos/dc_buttom.png"
            alt="Discord"
            width={loginScale.buttonIconSize}
            height={loginScale.buttonIconSize}
            priority
          />
          <span>Continue com Discord</span>
        </>
      )}
    </button>
  );
}
