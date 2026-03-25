"use client";

/* eslint-disable @next/next/no-img-element */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { LandingReveal } from "@/components/landing/LandingReveal";

type LoopLogo = {
  id: string;
  src: string;
  alt: string;
};

const LOGO_MIN_ITEMS = 12;
const LOGO_LOOP_SPEED = 48;

function buildSequence(logos: LoopLogo[]) {
  if (logos.length === 0) {
    return [];
  }

  const orderedLogos = [...logos].reverse();
  const repeatCount = Math.max(3, Math.ceil(LOGO_MIN_ITEMS / logos.length));

  return Array.from({ length: repeatCount }, (_, cycleIndex) =>
    orderedLogos.map((logo, logoIndex) => ({
      ...logo,
      cycleId: `${logo.id}-${cycleIndex}-${logoIndex}`,
    })),
  ).flat();
}

export function LandingLogoLoop() {
  const [logos, setLogos] = useState<LoopLogo[]>([]);
  const [marqueeStyle, setMarqueeStyle] = useState<CSSProperties>({});
  const sequenceRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadLogos() {
      try {
        const response = await fetch("/api/landing/loop-logos", {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as { logos?: LoopLogo[] };

        if (!isMounted) {
          return;
        }

        setLogos(Array.isArray(payload.logos) ? payload.logos : []);
      } catch {
        if (isMounted) {
          setLogos([]);
        }
      }
    }

    loadLogos();

    return () => {
      isMounted = false;
    };
  }, []);

  const sequence = useMemo(() => buildSequence(logos), [logos]);

  useEffect(() => {
    const node = sequenceRef.current;

    if (!node || sequence.length === 0) {
      return;
    }

    function syncMarqueeMetrics() {
      const distance = sequenceRef.current?.scrollWidth ?? 0;

      if (!distance) {
        return;
      }

      setMarqueeStyle({
        "--flowdesk-logo-loop-distance": `-${distance}px`,
        "--flowdesk-logo-loop-duration": `${distance / LOGO_LOOP_SPEED}s`,
      } as CSSProperties);
    }

    syncMarqueeMetrics();

    const observer = new ResizeObserver(syncMarqueeMetrics);
    observer.observe(node);
    window.addEventListener("resize", syncMarqueeMetrics);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncMarqueeMetrics);
    };
  }, [sequence.length]);

  if (sequence.length === 0) {
    return null;
  }

  return (
    <LandingReveal delay={640}>
      <section className="relative mt-[60px] w-full pb-[40px]">
        <div
          className="flowdesk-logo-loop-hover overflow-hidden"
          style={{
            WebkitMaskImage:
              "linear-gradient(90deg, transparent 0%, black 8%, black 92%, transparent 100%)",
            maskImage:
              "linear-gradient(90deg, transparent 0%, black 8%, black 92%, transparent 100%)",
          }}
        >
          <div
            style={marqueeStyle}
            className="flowdesk-logo-marquee-track flex w-max items-center"
          >
            <div ref={sequenceRef} className="flex items-center gap-[40px] pr-[40px]">
              {sequence.map((logo, index) => (
                <div
                  key={`${logo.cycleId}-${index}`}
                  className="group/logo flex h-[36px] shrink-0 items-center justify-center"
                >
                  <img
                    src={logo.src}
                    alt={logo.alt}
                    draggable={false}
                    className="h-[36px] w-auto max-w-none select-none opacity-100 transition-[filter,opacity] duration-200 ease-out [filter:brightness(0)_saturate(100%)_invert(15%)_sepia(0%)_saturate(0%)_hue-rotate(180deg)_brightness(96%)_contrast(92%)] group-hover/logo:[filter:brightness(0)_saturate(100%)_invert(18%)_sepia(0%)_saturate(0%)_hue-rotate(180deg)_brightness(112%)_contrast(90%)]"
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center gap-[40px] pr-[40px]">
              {sequence.map((logo, index) => (
                <div
                  key={`${logo.cycleId}-duplicate-${index}`}
                  className="group/logo flex h-[36px] shrink-0 items-center justify-center"
                >
                  <img
                    src={logo.src}
                    alt={logo.alt}
                    draggable={false}
                    className="h-[36px] w-auto max-w-none select-none opacity-100 transition-[filter,opacity] duration-200 ease-out [filter:brightness(0)_saturate(100%)_invert(15%)_sepia(0%)_saturate(0%)_hue-rotate(180deg)_brightness(96%)_contrast(92%)] group-hover/logo:[filter:brightness(0)_saturate(100%)_invert(18%)_sepia(0%)_saturate(0%)_hue-rotate(180deg)_brightness(112%)_contrast(90%)]"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 left-1/2 h-[2px] w-screen -translate-x-1/2 bg-[linear-gradient(90deg,rgba(14,14,14,0.2)_0%,rgba(14,14,14,1)_50%,rgba(14,14,14,0.2)_100%)]" />
      </section>
    </LandingReveal>
  );
}
