import { redirect } from "next/navigation";
import { validateTab } from "@/lib/account/tabs";
import { TabRenderer } from "@/components/account/TabRegistry";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";

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

  return (
    <TabRenderer 
      id={activeTab} 
      displayName={user?.display_name || ""} 
      avatarUrl={user?.avatar ? `https://cdn.discordapp.com/avatars/${user.discord_user_id}/${user.avatar}.png` : null} 
    />
  );
}
