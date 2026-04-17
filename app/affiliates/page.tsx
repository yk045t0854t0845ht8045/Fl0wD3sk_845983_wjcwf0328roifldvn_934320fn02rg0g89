import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";
import { AffiliatesLanding } from "@/components/affiliates/AffiliatesLanding";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { LandingFrameLines } from "@/components/landing/LandingFrameLines";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Programa de Afiliados — Flowdesk",
  description:
    "Indique o Flowdesk e ganhe até 35% de comissão por cada venda aprovada. Dashboard exclusivo, ranking com bônus, webhook em tempo real e muito mais.",
};

function buildDiscordAvatarUrl(
  discordUserId: string | null,
  avatarHash: string | null,
) {
  if (!avatarHash || !discordUserId) return null;
  const extension = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordUserId}/${avatarHash}.${extension}?size=96`;
}

import { TopBetaBanner } from "@/components/landing/TopBetaBanner";

export default async function AffiliatesPage() {
  const user = await getCurrentUserFromSessionCookie();

  const authenticatedUser = user
    ? {
        username: user.username,
        avatarUrl: buildDiscordAvatarUrl(user.discord_user_id, user.avatar),
        href: "/affiliates/dashboard",
      }
    : null;

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#040404] text-white">
      <div className="flowdesk-page-scale-80">
        <TopBetaBanner />
        <LandingFrameLines />
        <LandingHeader authenticatedUser={authenticatedUser} />
        <main className="w-full pb-20">
          <AffiliatesLanding isAuthenticated={Boolean(user)} />
        </main>
        <LandingFooter />
      </div>
    </div>
  );
}
