import { redirect } from "next/navigation";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";
import { AffiliatesWorkspace } from "@/components/affiliates/AffiliatesWorkspace";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard de Afiliado — Flowdesk",
  description: "Gerencie seus links, acompanhe comissões e saques no dashboard exclusivo de afiliado Flowdesk.",
};

function buildDiscordAvatarUrl(discordUserId: string, avatarHash: string | null) {
  if (!avatarHash) return null;
  const extension = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordUserId}/${avatarHash}.${extension}?size=96`;
}

export default async function AffiliatesDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUserFromSessionCookie();

  if (!user) {
    redirect("/login?redirect=/affiliates/dashboard&reason=affiliate");
  }

  const params = await searchParams;
  const validTabs = [
    "overview",
    "links",
    "commissions",
    "withdrawals",
    "ranking",
    "notifications",
    "components",
    "training",
    "templates",
  ] as const;
  type Tab = typeof validTabs[number];

  const rawTab = params.tab;
  const activeTab: Tab = validTabs.includes(rawTab as Tab) ? (rawTab as Tab) : "overview";

  return (
    <AffiliatesWorkspace
      displayName={user.username}
      username={user.username}
      avatarUrl={buildDiscordAvatarUrl(user.discord_user_id, user.avatar)}
      initialTab={activeTab}
    />
  );
}
