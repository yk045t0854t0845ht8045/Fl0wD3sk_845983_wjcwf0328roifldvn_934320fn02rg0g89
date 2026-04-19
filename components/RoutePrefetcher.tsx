"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { buildBrowserRoutingTargetFromInternalPath } from "@/lib/routing/subdomains";

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

    ["/dashboard", "/dashboard/", "/servers", "/servers/", "/account", "/account/"].forEach(
      (href) => {
        const target = buildBrowserRoutingTargetFromInternalPath(href);
        if (target.sameOrigin) {
          router.prefetch(target.path);
        }
      },
    );
  }, [pathname, router]);

  return null;
}
