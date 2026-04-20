"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { scheduleWarmBrowserRoutes } from "@/lib/routing/browserWarmup";

export function RoutePrefetcher() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (
      pathname === "/payment" ||
      pathname?.startsWith("/payment/") ||
      pathname === "/config" ||
      pathname?.startsWith("/config/")
    ) {
      return;
    }

    return scheduleWarmBrowserRoutes(
      [
        "/dashboard",
        "/dashboard/",
        "/servers",
        "/servers/",
        "/servers/plans",
        "/account",
        "/account/",
        "/discord/link",
      ],
      {
        router,
        delayMs: 120,
      },
    );
  }, [pathname, router]);

  return null;
}
