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
        "/dashboard/hosting",
        "/dashboard/flowai-api",
        "/dashboard/domains",
        "/dashboard/billing/subscriptions",
        "/servers",
        "/servers/",
        "/servers/plans",
        "/account",
        "/account/",
        "/account/tickets",
        "/account/status",
        "/discord/link",
      ],
      {
        router,
        delayMs: 90,
      },
    );
  }, [pathname, router]);

  return null;
}
