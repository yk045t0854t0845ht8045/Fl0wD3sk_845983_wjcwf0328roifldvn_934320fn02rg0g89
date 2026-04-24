import { clearPlanStateCacheForUser } from "@/lib/account/managedPlanState";
import { reconcileRecentPaymentOrders } from "@/lib/payments/reconciliation";
import { cleanupExpiredUnpaidServerSetups } from "@/lib/payments/setupCleanup";

type EnsureUserPaymentDeliveryReadyInput = {
  userId: number;
  guildId?: string | null;
  source?: string;
  limit?: number;
};

export async function ensureUserPaymentDeliveryReady(
  input: EnsureUserPaymentDeliveryReadyInput,
) {
  const userId = Number.isSafeInteger(input.userId) ? input.userId : 0;
  if (userId <= 0) {
    return {
      cleanup: null,
      reconciliation: null,
    };
  }

  const source = input.source || "payment_readiness";
  const limit = Math.max(1, Math.min(input.limit || 8, 20));

  const [cleanup, reconciliation] = await Promise.allSettled([
    cleanupExpiredUnpaidServerSetups({
      userId,
      guildId: input.guildId || null,
      source,
    }),
    reconcileRecentPaymentOrders({
      userId,
      guildId: input.guildId || null,
      source,
      limit,
    }),
  ]);

  clearPlanStateCacheForUser(userId);

  return {
    cleanup: cleanup.status === "fulfilled" ? cleanup.value : null,
    reconciliation:
      reconciliation.status === "fulfilled" ? reconciliation.value : null,
  };
}
