import { LandingFooter } from "@/components/landing/LandingFooter";
import { LandingFrameLines } from "@/components/landing/LandingFrameLines";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingSmoothScroll } from "@/components/landing/LandingSmoothScroll";
import { TopBetaBanner } from "@/components/landing/TopBetaBanner";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";
import { DomainHero } from "@/components/domains/DomainHero";

type DomainMode = "register" | "ai";

function buildDiscordAvatarUrl(
  discordUserId: string | null,
  avatarHash: string | null,
) {
  if (!avatarHash || !discordUserId) return null;
  const extension = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordUserId}/${avatarHash}.${extension}?size=96`;
}

export async function DomainsPageShell({ initialMode = "register" }: { initialMode?: DomainMode }) {
  const user = await getCurrentUserFromSessionCookie();

  const authenticatedUser = user
    ? {
        username: user.username,
        avatarUrl: buildDiscordAvatarUrl(user.discord_user_id, user.avatar),
        href: "/dashboard",
      }
    : null;

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#040404] text-white">
      <div className="flowdesk-page-scale-80">
        <LandingSmoothScroll />
        <TopBetaBanner />
        <LandingFrameLines />

        <LandingHeader authenticatedUser={authenticatedUser} />

        <main className="relative z-10 w-full pt-[35px] pb-24">
          <div className="mx-auto w-full max-w-[1582px] px-[20px] md:px-6 lg:px-8 xl:px-10 2xl:px-[20px]">
            <DomainHero initialTab={initialMode} />
          </div>
        </main>

        <LandingFooter baseDelay={600} bottomDelay={1000} />
      </div>
    </div>
  );
}
