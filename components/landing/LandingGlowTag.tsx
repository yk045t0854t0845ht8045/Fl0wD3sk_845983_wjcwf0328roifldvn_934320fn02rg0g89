import type { ReactNode } from "react";

type LandingGlowTagProps = {
  children: ReactNode;
  className?: string;
};

export function LandingGlowTag({
  children,
  className = "",
}: LandingGlowTagProps) {
  return (
    <div
      className={`relative inline-flex h-[40px] w-fit max-w-full items-center justify-center overflow-hidden rounded-full bg-transparent px-[30px] ${className}`.trim()}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-full border border-[#0E0E0E]"
      />
      <span
        aria-hidden="true"
        className="flowdesk-tag-border-glow absolute inset-[-2px] rounded-full"
      />
      <span
        aria-hidden="true"
        className="flowdesk-tag-border-core absolute inset-[-1px] rounded-full"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-[1px] rounded-full bg-[#040404]"
      />

      <span className="relative z-10 text-center text-[16px] leading-none font-normal text-[#B7B7B7]">
        {children}
      </span>
    </div>
  );
}
