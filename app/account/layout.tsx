import { redirect } from "next/navigation";
import { AccountWorkspace } from "@/components/account/AccountWorkspace";
import { MaintenanceGate } from "@/components/common/MaintenanceGate";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";

function buildDiscordAvatarUrl(
  discordUserId: string | null,
  avatarHash: string | null,
) {
  if (!avatarHash || !discordUserId) return null;
  const extension = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordUserId}/${avatarHash}.${extension}?size=96`;
}

async function AccountLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUserFromSessionCookie();

  if (!user) {
    redirect("/login");
  }

  return (
    <AccountWorkspace
      displayName={user.display_name}
      username={user.username}
      avatarUrl={buildDiscordAvatarUrl(user.discord_user_id, user.avatar)}
    >
      {children}
    </AccountWorkspace>
  );
}

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MaintenanceGate area="account">
      <AccountLayoutContent>{children}</AccountLayoutContent>
    </MaintenanceGate>
  );
}
