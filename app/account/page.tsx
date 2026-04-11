import { redirect } from "next/navigation";
import { AccountWorkspace } from "@/components/account/AccountWorkspace";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";

function buildDiscordAvatarUrl(discordUserId: string, avatarHash: string | null) {
  if (!avatarHash) return null;
  const extension = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordUserId}/${avatarHash}.${extension}?size=96`;
}

export default async function AccountSettingsPage() {
  const user = await getCurrentUserFromSessionCookie();

  if (!user) {
    redirect("/login");
  }

  return (
    <AccountWorkspace
      displayName={user.display_name}
      username={user.username}
      avatarUrl={buildDiscordAvatarUrl(user.discord_user_id, user.avatar)}
    />
  );
}
