import Script from "next/script";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { LandingFrameLines } from "@/components/landing/LandingFrameLines";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingHero } from "@/components/landing/LandingHero";
import { LandingSmoothScroll } from "@/components/landing/LandingSmoothScroll";
import { TopBetaBanner } from "@/components/landing/TopBetaBanner";

export default function HomePage() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#040404] text-white">
      <Script
        async
        src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4997317332626224"
        crossOrigin="anonymous"
        strategy="afterInteractive"
      />

      <LandingSmoothScroll />
      <TopBetaBanner />
      <LandingFrameLines />

      <LandingHeader />

      <main className="w-full pb-20">
        <LandingHero />
      </main>

      <LandingFooter />
    </div>
  );
}