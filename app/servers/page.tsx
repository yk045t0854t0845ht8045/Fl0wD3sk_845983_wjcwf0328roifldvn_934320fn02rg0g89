import { redirect } from "next/navigation";
import { ServersWorkspace } from "@/components/servers/ServersWorkspace";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";

type ServersPageProps = {
  searchParams?: Promise<{
    guild?: string | string[];
    tab?: string | string[];
  }>;
};

function takeFirstQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

function normalizeGuildId(value: string | null) {
  if (!value) return null;
  const guildId = value.trim();
  return /^\d{10,25}$/.test(guildId) ? guildId : null;
}

function buildDiscordAvatarUrl(discordUserId: string, avatarHash: string | null) {
  if (!avatarHash) return null;
  const extension = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordUserId}/${avatarHash}.${extension}?size=96`;
}

export default async function ServersPage({ searchParams }: ServersPageProps) {
  const user = await getCurrentUserFromSessionCookie();

  if (!user) {
    redirect("/login");
  }

  const query = searchParams ? await searchParams : {};
  const legacyGuildId = normalizeGuildId(takeFirstQueryValue(query.guild));
  if (legacyGuildId) {
    redirect(`/servers/${legacyGuildId}/`);
  }

  return (
    <ServersWorkspace
      displayName={user.display_name}
      currentAccount={{
        authUserId: user.id,
        discordUserId: user.discord_user_id,
        displayName: user.display_name,
        username: user.username,
        avatarUrl: buildDiscordAvatarUrl(user.discord_user_id, user.avatar),
      }}
    />
  );
}
