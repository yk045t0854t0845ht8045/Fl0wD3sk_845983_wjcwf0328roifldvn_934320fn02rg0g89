import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { ServersPlansUpgradePage } from "@/components/servers/ServersPlansUpgradePage";
import { buildLoginHref } from "@/lib/auth/paths";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import { getPlanGuildsForUser } from "@/lib/plans/planGuilds";
import { getBasicPlanAvailability, getUserPlanState } from "@/lib/plans/state";

type ServersPlansPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function takeFirstQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

export default async function ServersPlansPage({
  searchParams,
}: ServersPlansPageProps) {
  const session = await getCurrentAuthSessionFromCookie();

  if (!session) {
    redirect(buildLoginHref("/servers/plans"));
  }

  const query = searchParams ? await searchParams : {};
  const shouldShowServerLimitBanner =
    takeFirstQueryValue(query.reason) === "server-limit";
  const user = session.user;
  const [userPlanState, basicPlanAvailability, licensedPlanGuilds] = await Promise.all([
    getUserPlanState(user.id),
    getBasicPlanAvailability(user.id),
    getPlanGuildsForUser(user.id),
  ]);
  const licensedGuildIdSet = new Set(
    licensedPlanGuilds.map((guild) => guild.guild_id),
  );
  const preferredGuildId = (() => {
    const activeGuildId = session.activeGuildId || null;
    if (activeGuildId && licensedGuildIdSet.has(activeGuildId)) {
      return activeGuildId;
    }

    const lastPaymentGuildId = userPlanState?.last_payment_guild_id?.trim() || null;
    if (lastPaymentGuildId && licensedGuildIdSet.has(lastPaymentGuildId)) {
      return lastPaymentGuildId;
    }

    return licensedPlanGuilds[0]?.guild_id || activeGuildId || null;
  })();

  return (
    <ServersPlansUpgradePage
      currentPlan={
        userPlanState
          ? {
              planCode: userPlanState.plan_code,
              status: userPlanState.status,
            }
          : null
      }
      preferredGuildId={preferredGuildId}
      showServerLimitBanner={shouldShowServerLimitBanner}
      basicPlanAvailable={basicPlanAvailability.isAvailable}
    />
  );
}
