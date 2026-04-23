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
        "/dashboard/billing/subscriptions",
        "/servers",
        "/servers/",
        "/servers/plans",
        "/account",
        "/account/",
        "/account/tickets",
        "/account/status",
      ],
      {
        router,
        delayMs: 90,
        prefetchDocument: false,
      },
    );
  }, [pathname, router]);

  return null;
}
