"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";

const ADSENSE_SRC =
  "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4997317332626224";
const BLOCKED_PATH_PREFIXES = [
  "/payment",
  "/config",
  "/dashboard",
  "/servers",
  "/account",
  "/login",
  "/status",
];

function isExplicitlyEnabled(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function AdsenseScript() {
  const pathname = usePathname();
  const adsenseEnabled = isExplicitlyEnabled(
    process.env.NEXT_PUBLIC_ENABLE_ADSENSE,
  );

  if (!adsenseEnabled) {
    return null;
  }

  if (
    pathname &&
    BLOCKED_PATH_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  ) {
    return null;
  }

  return (
    <Script
      async
      src={ADSENSE_SRC}
      crossOrigin="anonymous"
      strategy="afterInteractive"
    />
  );
}
