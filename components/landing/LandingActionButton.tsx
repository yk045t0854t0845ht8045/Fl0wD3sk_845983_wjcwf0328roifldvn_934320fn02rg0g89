import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

type LandingActionButtonProps = {
  href?: string;
  disabled?: boolean;
  children: ReactNode;
  variant?: "light" | "dark" | "blue";
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  "data-flowdesk-visible"?: "true" | "false";
};

export function LandingActionButton({
  href,
  disabled = false,
  children,
  variant = "dark",
  className = "",
  style,
  onClick,
  "data-flowdesk-visible": dataFlowdeskVisible,
}: LandingActionButtonProps) {
  const baseClassName =
    "group relative inline-flex h-[46px] shrink-0 items-center justify-center overflow-visible whitespace-nowrap rounded-[12px] px-6 text-[16px] leading-none font-semibold";

  const surfaceClassName =
    variant === "light"
      ? "bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)]"
      : variant === "blue"
        ? "bg-[linear-gradient(180deg,#0062FF_0%,#0153D5_100%)]"
      : "bg-[#111111]";

  const textClassName =
    variant === "light"
      ? "text-[#282828]"
      : variant === "blue"
        ? "bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] bg-clip-text text-transparent"
        : "text-[#B7B7B7]";

  const composedClassName = `${baseClassName} ${className} ${
    disabled ? "cursor-not-allowed opacity-70" : ""
  }`.trim();

  const surfaceMotionClass = disabled
    ? "transition-opacity duration-150 ease-out"
    : "transition-transform duration-150 ease-out group-hover:scale-[1.02] group-active:scale-[0.985]";

  if (!href || disabled) {
    return (
      <button
        type="button"
        style={style}
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        data-flowdesk-visible={dataFlowdeskVisible}
        className={composedClassName}
      >
        <span
          aria-hidden="true"
          className={`absolute inset-0 rounded-[12px] ${surfaceMotionClass} ${surfaceClassName}`}
        />
        <span
          className={`relative z-10 inline-flex items-center justify-center whitespace-nowrap leading-none ${textClassName}`}
        >
          {children}
        </span>
      </button>
    );
  }

  return (
    <Link
      href={href}
      style={style}
      onClick={onClick}
      data-flowdesk-visible={dataFlowdeskVisible}
      className={composedClassName}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-0 rounded-[12px] ${surfaceMotionClass} ${surfaceClassName}`}
      />
      <span
        className={`relative z-10 inline-flex items-center justify-center whitespace-nowrap leading-none ${textClassName}`}
      >
        {children}
      </span>
    </Link>
  );
}
