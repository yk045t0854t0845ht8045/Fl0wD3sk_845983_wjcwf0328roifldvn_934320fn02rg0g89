import { redirect } from "next/navigation";
import { validateTab } from "@/lib/account/tabs";
import { TabRenderer } from "@/components/account/TabRegistry";
import {
  getCurrentAuthSessionFromCookie,
  getCurrentUserFromSessionCookie,
} from "@/lib/auth/session";
import { getSupportTicketsForDiscordUser } from "@/lib/account/supportTickets";

export default async function AccountTabPage({
  params,
}: {
  params: Promise<{ tab: string }>;
}) {
  const { tab: rawTab } = await params;
  if (rawTab === "overview") {
    redirect("/account");
  }
  
  const activeTab = validateTab(rawTab);
  
  const user = await getCurrentUserFromSessionCookie();
  const session = await getCurrentAuthSessionFromCookie();

  if (!user || !session) {
    redirect("/login");
  }

  const initialTickets =
    activeTab === "tickets"
      ? await getSupportTicketsForDiscordUser(session.user.discord_user_id).catch(
          (error) => {
            console.error("Failed to pre-fetch support tickets:", error);
            return undefined;
          },
        )
      : undefined;

  return (
    <TabRenderer 
      id={activeTab} 
      displayName={user.display_name}
      avatarUrl={user.avatar ? `https://cdn.discordapp.com/avatars/${user.discord_user_id}/${user.avatar}.png` : null}
      initialTickets={initialTickets}
    />
  );
}
