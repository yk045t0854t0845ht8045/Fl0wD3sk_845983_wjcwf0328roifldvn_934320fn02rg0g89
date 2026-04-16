import Script from "next/script";

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { MaintenanceGate } from "@/components/common/MaintenanceGate";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { LandingFrameLines } from "@/components/landing/LandingFrameLines";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingHero } from "@/components/landing/LandingHero";
import { LandingSmoothScroll } from "@/components/landing/LandingSmoothScroll";
import { TopBetaBanner } from "@/components/landing/TopBetaBanner";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";

function buildDiscordAvatarUrl(discordUserId: string, avatarHash: string | null) {
  if (!avatarHash) return null;
  const extension = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordUserId}/${avatarHash}.${extension}?size=96`;
}

export default async function HomePage() {
  return (
    <MaintenanceGate area="landing">
      <HomePageContent />
    </MaintenanceGate>
  );
}

async function HomePageContent() {
  const user = await getCurrentUserFromSessionCookie();
  
  const authenticatedUser = user ? {
    username: user.username,
    avatarUrl: buildDiscordAvatarUrl(user.discord_user_id, user.avatar),
    href: "/servers"
  } : null;

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#040404] text-white">
      <div className="flowdesk-page-scale-80">
        <Script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4997317332626224"
          crossOrigin="anonymous"
          strategy="afterInteractive"
        />

        <LandingSmoothScroll />
        <TopBetaBanner />
        <LandingFrameLines />

        <LandingHeader authenticatedUser={authenticatedUser} />

        <main className="w-full pb-20">
          <LandingHero />
        </main>

        <LandingFooter />
      </div>
    </div>
  );
}
