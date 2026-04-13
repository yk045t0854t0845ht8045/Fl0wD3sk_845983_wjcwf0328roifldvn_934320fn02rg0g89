import useSWR from "swr";

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

