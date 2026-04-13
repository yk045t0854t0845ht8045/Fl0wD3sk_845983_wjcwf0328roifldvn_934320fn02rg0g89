import { validateTab } from "@/lib/account/tabs";
import { redirect } from "next/navigation";
import { AccountWorkspace } from "@/components/account/AccountWorkspace";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";

function buildDiscordAvatarUrl(discordUserId: string, avatarHash: string | null) {
  if (!avatarHash) return null;
  const extension = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordUserId}/${avatarHash}.${extension}?size=96`;
}

export default async function AccountLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUserFromSessionCookie();

  if (!user) {
    redirect("/login");
  }

  const { tab: rawTab } = await params;
  const activeTab = validateTab(rawTab);

  return (
    <AccountWorkspace
      displayName={user.display_name}
      username={user.username}
      avatarUrl={buildDiscordAvatarUrl(user.discord_user_id, user.avatar)}
      initialTab={activeTab}
    >
      {children}
    </AccountWorkspace>
  );
}
