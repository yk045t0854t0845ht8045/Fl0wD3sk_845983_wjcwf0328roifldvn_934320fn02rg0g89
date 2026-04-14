import { redirect } from "next/navigation";
import { getCurrentUserFromSessionCookie, getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import { TabRenderer } from "@/components/account/TabRegistry";
import { getAccountSummary } from "@/lib/account/summary";

export default async function AccountSettingsPage() {
  const user = await getCurrentUserFromSessionCookie();
  const session = await getCurrentAuthSessionFromCookie();

  if (!user || !session) {
    redirect("/login");
  }

  const initialSummary = await getAccountSummary(
    user.id.toString(), 
    session.user.discord_user_id
  ).catch(err => {
    console.error("Failed to pre-fetch account summary:", err);
    return null;
  });

  return (
    <TabRenderer 
      id="overview" 
      displayName={user.display_name} 
      avatarUrl={user.avatar ? `https://cdn.discordapp.com/avatars/${user.discord_user_id}/${user.avatar}.png` : null} 
      initialSummary={initialSummary}
    />
  );
}
