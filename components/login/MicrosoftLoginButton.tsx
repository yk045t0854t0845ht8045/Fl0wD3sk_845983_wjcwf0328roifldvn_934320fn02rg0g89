"use client";

import { useState } from "react";
import { ButtonLoader } from "@/components/login/ButtonLoader";

type MicrosoftLoginButtonProps = {
  href: string;
  label?: string;
  disabled?: boolean;
};

function MicrosoftLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0">
      <path fill="#F25022" d="M2 2h9.5v9.5H2z" />
      <path fill="#00A4EF" d="M12.5 2H22v9.5h-9.5z" />
      <path fill="#7FBA00" d="M2 12.5h9.5V22H2z" />
      <path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z" />
    </svg>
  );
}

export function MicrosoftLoginButton({
  href,
  label = "Continuar com Microsoft",
  disabled = false,
}: MicrosoftLoginButtonProps) {
  const [loading, setLoading] = useState(false);

  function handleClick() {
    if (loading || disabled) return;
    setLoading(true);
    window.location.assign(href);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading || disabled}
      aria-busy={loading}
      className="group relative inline-flex h-[52px] w-full items-center justify-center overflow-hidden rounded-[14px] px-6 text-[16px] leading-none font-semibold disabled:cursor-not-allowed"
    >
      <span
        aria-hidden="true"
        className={`absolute inset-0 rounded-[14px] border transition-transform duration-200 ease-out ${
          disabled
            ? "border-[rgba(255,255,255,0.05)] bg-[linear-gradient(180deg,#202020_0%,#151515_100%)]"
            : "border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,#171717_0%,#0C0C0C_100%)] group-hover:scale-[1.015] group-active:scale-[0.992]"
        }`}
      />

      <span
        className={`relative z-10 inline-flex items-center justify-center gap-[12px] ${
          disabled ? "text-[#A7A7A7]" : "text-white"
        }`}
      >
        {loading ? (
          <ButtonLoader size={22} colorClassName="text-white" />
        ) : (
          <>
            <MicrosoftLogo />
            <span>{label}</span>
          </>
        )}
      </span>
    </button>
  );
}
