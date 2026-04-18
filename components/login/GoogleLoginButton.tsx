"use client";

import { useState } from "react";
import { ButtonLoader } from "@/components/login/ButtonLoader";

type GoogleLoginButtonProps = {
  href: string;
  label?: string;
  disabled?: boolean;
};

function GoogleLogo() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[20px] w-[20px] shrink-0"
    >
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.55-.2-2.27H12v4.3h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.08 3.56-5.14 3.56-8.65Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3c-1.07.72-2.44 1.15-4.06 1.15-3.12 0-5.76-2.11-6.7-4.95H1.3v3.09A11.98 11.98 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.3 14.29A7.2 7.2 0 0 1 4.93 12c0-.8.14-1.58.37-2.29V6.62H1.3A11.98 11.98 0 0 0 0 12c0 1.94.47 3.77 1.3 5.38l4-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.35.6 4.6 1.77l3.45-3.45C17.94 1.14 15.24 0 12 0 7.31 0 3.27 2.69 1.3 6.62l4 3.09c.93-2.84 3.57-4.94 6.7-4.94Z"
      />
    </svg>
  );
}

export function GoogleLoginButton({
  href,
  label = "Continuar com Google",
  disabled = false,
}: GoogleLoginButtonProps) {
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
            ? "border-[rgba(255,255,255,0.05)] bg-[linear-gradient(180deg,#2A2A2A_0%,#1E1E1E_100%)]"
            : "border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,#FFFFFF_0%,#ECECEC_100%)] group-hover:scale-[1.015] group-active:scale-[0.992]"
        }`}
      />

      <span
        className={`relative z-10 inline-flex items-center justify-center gap-[12px] ${
          disabled ? "text-[#BFBFBF]" : "text-[#101010]"
        }`}
      >
        {loading ? (
          <ButtonLoader size={22} colorClassName="text-[#101010]" />
        ) : (
          <>
            <GoogleLogo />
            <span>{label}</span>
          </>
        )}
      </span>
    </button>
  );
}
