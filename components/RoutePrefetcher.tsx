"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function RoutePrefetcher() {
  const router = useRouter();

  useEffect(() => {
    router.prefetch("/dashboard");
    router.prefetch("/dashboard/");
    router.prefetch("/servers");
    router.prefetch("/servers/");
    router.prefetch("/account");
    router.prefetch("/account/");
  }, [router]);

  return null;
}
