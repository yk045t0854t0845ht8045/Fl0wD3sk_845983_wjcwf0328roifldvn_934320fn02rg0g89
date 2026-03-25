"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { LandingReveal } from "@/components/landing/LandingReveal";

type HeroCardConfig = {
  id: string;
  src: string;
  alt: string;
  width: number;
  height: number;
  offset: number;
  zIndex: number;
  skeletonColor: string;
};

const HERO_CARDS: HeroCardConfig[] = [
  {
    id: "left-far",
    src: "/cdn/hero/1.png",
    alt: "Preview de automacoes do Flowdesk",
    width: 360,
    height: 284,
    offset: -382,
    zIndex: 10,
    skeletonColor: "#070707",
  },
  {
    id: "left-mid",
    src: "/cdn/hero/2.png",
    alt: "Preview de atendimento do Flowdesk",
    width: 408,
    height: 318,
    offset: -228,
    zIndex: 20,
    skeletonColor: "#0A0A0A",
  },
  {
    id: "center",
    src: "/cdn/hero/3.png",
    alt: "Preview central do sistema Flowdesk",
    width: 456,
    height: 356,
    offset: 0,
    zIndex: 30,
    skeletonColor: "#0E0E0E",
  },
  {
    id: "right-mid",
    src: "/cdn/hero/4.png",
    alt: "Preview de pagamentos do Flowdesk",
    width: 408,
    height: 318,
    offset: 228,
    zIndex: 20,
    skeletonColor: "#0A0A0A",
  },
  {
    id: "right-far",
    src: "/cdn/hero/5.png",
    alt: "Preview de analytics do Flowdesk",
    width: 360,
    height: 284,
    offset: 382,
    zIndex: 10,
    skeletonColor: "#070707",
  },
];

function HeroImageCard({
  card,
  className = "",
  style,
  mobile = false,
}: {
  card: HeroCardConfig;
  className?: string;
  style?: CSSProperties;
  mobile?: boolean;
}) {
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [isStageReady, setIsStageReady] = useState(false);

  useEffect(() => {
    const delay = window.setTimeout(() => {
      setIsStageReady(true);
    }, 360 + HERO_CARDS.findIndex((entry) => entry.id === card.id) * 110);

    return () => {
      window.clearTimeout(delay);
    };
  }, [card.id]);

  const isVisible = isImageLoaded && isStageReady;

  return (
    <div
      className={`flowdesk-landing-soft-motion group relative shrink-0 overflow-hidden rounded-[34px] ${className}`.trim()}
      style={{
        ...style,
        backgroundColor: card.skeletonColor,
      }}
    >
      <div
        className={`flowdesk-shimmer absolute inset-0 transition-opacity duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isVisible ? "opacity-0" : "opacity-100"
        }`}
        style={{ backgroundColor: card.skeletonColor }}
      />

      <Image
        src={card.src}
        alt={card.alt}
        fill
        sizes={
          mobile
            ? "(max-width: 860px) 78vw, 456px"
            : "(max-width: 1640px) 456px, 456px"
        }
        className={`object-cover transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isVisible
            ? "opacity-100 scale-100"
            : "opacity-0 scale-[1.03]"
        }`}
        onLoad={() => setIsImageLoaded(true)}
      />

      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.02)_0%,rgba(255,255,255,0)_22%,rgba(0,0,0,0.04)_100%)]" />
    </div>
  );
}

export function LandingHeroCards() {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function syncInitialScroll() {
      const node = scrollRef.current;

      if (!node) {
        return;
      }

      const centeredOffset = Math.max(0, (1124 - node.clientWidth) / 2);
      node.scrollLeft = centeredOffset;
    }

    const frame = window.requestAnimationFrame(syncInitialScroll);
    window.addEventListener("resize", syncInitialScroll);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", syncInitialScroll);
    };
  }, []);

  return (
    <div className="mt-[35px] w-full">
      <LandingReveal delay={560}>
        <div
          ref={scrollRef}
          className="-mx-[20px] overflow-x-auto px-[20px] pb-2 thin-scrollbar touch-pan-x [scrollbar-gutter:stable] min-[1180px]:overflow-visible"
        >
          <div className="relative mx-auto h-[356px] w-[1124px] min-w-[1124px]">
            {HERO_CARDS.map((card) => (
              <HeroImageCard
                key={card.id}
                card={card}
                mobile
                className="absolute top-1/2 left-1/2 shadow-[0_26px_80px_rgba(0,0,0,0.38)]"
                style={{
                  width: `${card.width}px`,
                  height: `${card.height}px`,
                  zIndex: card.zIndex,
                  transform: `translate(calc(-50% + ${card.offset}px), -50%)`,
                }}
              />
            ))}
          </div>
        </div>
      </LandingReveal>
    </div>
  );
}
