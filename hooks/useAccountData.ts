import useSWR from "swr";
import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function usePaymentHistory() {
  const { data, error, isLoading, mutate } = useSWR("/api/auth/me/payments/history", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 10000, // 10s
    fallbackData: { ok: true, orders: [], methods: [] },
  });

  return {
    orders: data?.orders || [],
    methods: data?.methods || [],
    loading: isLoading,
    error,
    mutate,
  };
}

export function usePlanState() {
  const { data, error, isLoading, mutate } = useSWR("/api/auth/me/plan-state", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000, // 30s
  });

  return {
    planState: data?.ok ? data : null,
    loading: isLoading,
    error,
    mutate,
  };
}

export function useAccountSummary() {
  const { data, error, isLoading, mutate } = useSWR("/api/auth/me/account/summary", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60000, // 60s
  });

  return {
    summary: data?.ok ? data.summary : null,
    loading: isLoading,
    error,
    mutate,
  };
}

export function usePlanInfo() {
  const { data, error, isLoading, mutate } = useSWR("/api/auth/me/account/plan", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000, // 30s
  });

  return {
    plan: data?.ok ? data.plan : null,
    loading: isLoading,
    error,
    mutate,
  };
}

export function useAccountStatus() {
  const { data, error, isLoading, mutate } = useSWR("/api/auth/me/account/status", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000, // 30s
  });

  // Real-time synchronization:
  // We listen for a broadcast from the bot to refresh data when a violation changes.
  useEffect(() => {
    const discordUserId = data?.discordUserId;
    if (!discordUserId || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return;

    const channel = supabaseBrowser
      .channel(`user_violations:${discordUserId}`)
      .on("broadcast", { event: "refresh" }, () => {
        console.log("[useAccountStatus] Real-time refresh triggered!");
        mutate();
      })
      .subscribe();

    return () => {
      supabaseBrowser.removeChannel(channel);
    };
  }, [data?.discordUserId, mutate]);

  return {
    statusData: data?.ok ? data : null,
    loading: isLoading,
    error,
    mutate,
  };
}

