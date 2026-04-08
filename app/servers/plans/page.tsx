import { redirect } from "next/navigation";
import { ServersPlansUpgradePage } from "@/components/servers/ServersPlansUpgradePage";
import { buildLoginHref } from "@/lib/auth/paths";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import { getUserPlanState } from "@/lib/plans/state";

type ServersPlansPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ServersPlansPage({
  searchParams: _searchParams,
}: ServersPlansPageProps) {
  const session = await getCurrentAuthSessionFromCookie();

  if (!session) {
    redirect(buildLoginHref("/servers/plans"));
  }

  void _searchParams;
  const user = session.user;
  const userPlanState = await getUserPlanState(user.id);

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
      preferredGuildId={session.activeGuildId || null}
    />
  );
}
