"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

const ROW_MAX_WIDTH = 1124;
const MOBILE_BOX_SIZE = 68;
const BOX_SIZE = 76;
const MIN_GAP = 12;
const BASE_DELAY_MS = 900;
const ICON_REFRESH_INTERVAL_MS = 45_000;
const SERVER_LOOP_MIN_ITEMS = 12;
const SERVER_LOOP_SPEED = 42;

type ServerIcon = {
  id: string;
  name: string;
  iconUrl: string;
};

type LoopServerEntry = {
  id: string;
  name: string;
  iconUrl: string | null;
  kind: "icon" | "fallback";
  cycleId?: string;
};

type ServerIconsApiResponse = {
  icons?: ServerIcon[];
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function LandingServerUsageRow() {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const sequenceRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [marqueeStyle, setMarqueeStyle] = useState<CSSProperties>({});
  const [layout, setLayout] = useState({ count: 12, boxSize: BOX_SIZE });
  const [serverIcons, setServerIcons] = useState<ServerIcon[]>([]);
  const [loadedImageIds, setLoadedImageIds] = useState<string[]>([]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setIsVisible(true);
    }, BASE_DELAY_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadServerIcons() {
      try {
        const response = await fetch("/api/landing/server-icons", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar icones dos servidores.");
        }

        const payload = (await response.json()) as ServerIconsApiResponse;
        if (!isMounted) return;

        const nextIcons = Array.isArray(payload.icons)
          ? payload.icons.filter(
              (icon): icon is ServerIcon =>
                Boolean(icon?.id) && Boolean(icon?.iconUrl),
            )
          : [];

        setServerIcons(nextIcons);
        setLoadedImageIds((current) =>
          current.filter((id) => nextIcons.some((icon) => icon.id === id)),
        );
      } catch {
        if (!isMounted) return;
        setServerIcons([]);
        setLoadedImageIds([]);
      }
    }

    void loadServerIcons();
    const interval = window.setInterval(loadServerIcons, ICON_REFRESH_INTERVAL_MS);

    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    function syncLayout() {
      const rowWidth = rowRef.current?.clientWidth ?? ROW_MAX_WIDTH;
      const nextBoxSize = window.innerWidth < 640 ? MOBILE_BOX_SIZE : BOX_SIZE;
      const safeWidth = Math.max(nextBoxSize, Math.min(rowWidth, ROW_MAX_WIDTH));
      const nextCount = clamp(
        Math.floor((safeWidth + MIN_GAP) / (nextBoxSize + MIN_GAP)),
        3,
        12,
      );

      setLayout({ count: nextCount, boxSize: nextBoxSize });
    }

    syncLayout();

    const observer = new ResizeObserver(syncLayout);

    if (rowRef.current) {
      observer.observe(rowRef.current);
    }

    window.addEventListener("resize", syncLayout);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncLayout);
    };
  }, []);

  const items = useMemo(
    () =>
      Array.from({ length: layout.count }, (_, index) => ({
        id: `usage-box-${index}`,
      })),
    [layout.count],
  );

  const baseEntries = useMemo<LoopServerEntry[]>(
    () =>
      serverIcons.length
        ? serverIcons.map((icon) => ({
            id: icon.id,
            name: icon.name,
            iconUrl: icon.iconUrl,
            kind: "icon" as const,
          }))
        : items.map((item, index) => ({
            id: item.id,
            name: `Servidor ${index + 1}`,
            iconUrl: null,
            kind: "fallback" as const,
          })),
    [items, serverIcons],
  );

  const sequence = useMemo(() => {
    if (!baseEntries.length) {
      return [];
    }

    const repeatCount = Math.max(
      3,
      Math.ceil(Math.max(layout.count, SERVER_LOOP_MIN_ITEMS) / baseEntries.length),
    );

    return Array.from({ length: repeatCount }, (_, cycleIndex) =>
      baseEntries.map((entry, entryIndex) => ({
        ...entry,
        cycleId: `${entry.id}-${cycleIndex}-${entryIndex}`,
      })),
    ).flat();
  }, [baseEntries, layout.count]);

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
        "--flowdesk-logo-loop-duration": `${distance / SERVER_LOOP_SPEED}s`,
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
  }, [sequence.length, layout.boxSize, layout.count]);

  function handleImageLoad(id: string) {
    setLoadedImageIds((current) => (current.includes(id) ? current : [...current, id]));
  }

  function handleImageError(id: string) {
    setLoadedImageIds((current) => current.filter((currentId) => currentId !== id));
  }

  return (
    <div
      className={`mx-auto mt-[40px] w-full max-w-[1124px] transition-[opacity,transform,filter] duration-[520ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
        isVisible
          ? "translate-y-0 opacity-100 blur-0"
          : "translate-y-[14px] opacity-0 blur-[8px]"
      }`}
    >
      <div
        ref={rowRef}
        className="overflow-hidden"
        style={{
          WebkitMaskImage:
            "linear-gradient(90deg, transparent 0%, black 8%, black 92%, transparent 100%)",
          maskImage:
            "linear-gradient(90deg, transparent 0%, black 8%, black 92%, transparent 100%)",
        }}
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        <div
          style={marqueeStyle}
          className={`flowdesk-logo-marquee-track flex w-max items-center ${isPaused ? "flowdesk-logo-marquee-track--paused" : ""}`.trim()}
        >
          {[0, 1].map((copyIndex) => (
            <div
              key={`server-loop-copy-${copyIndex}`}
              ref={copyIndex === 0 ? sequenceRef : undefined}
              className="flex items-center gap-3 pr-3"
            >
              {sequence.map((entry, index) => {
                const showImage =
                  entry.kind === "icon" && loadedImageIds.includes(entry.id);
                const isAnimatedIcon =
                  entry.kind === "icon" && Boolean(entry.iconUrl?.includes(".gif"));

                return (
                  <div
                    key={`${entry.cycleId ?? entry.id}-${copyIndex}-${index}`}
                    className="group/server relative shrink-0 overflow-hidden bg-[#0E0E0E] transition-[background-color,transform] duration-200 ease-out hover:bg-[#131313]"
                    style={{
                      width: `${layout.boxSize}px`,
                      height: `${layout.boxSize}px`,
                      borderRadius: layout.boxSize < BOX_SIZE ? "20px" : "22px",
                    }}
                  >
                    {entry.kind === "icon" && entry.iconUrl ? (
                      <>
                        <Image
                          src={entry.iconUrl}
                          alt={entry.name}
                          fill
                          sizes="(max-width: 639px) 68px, 76px"
                          unoptimized={isAnimatedIcon}
                          className={`pointer-events-none absolute inset-0 h-full w-full select-none object-cover transition-[opacity,filter] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                            showImage
                              ? "opacity-100 group-hover/server:brightness-[1.06]"
                              : "opacity-0"
                          }`}
                          draggable={false}
                          style={{
                            transform: "translateZ(0)",
                            backfaceVisibility: "hidden",
                          }}
                          onLoad={() => handleImageLoad(entry.id)}
                          onError={() => handleImageError(entry.id)}
                        />
                        <div
                          className={`pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_32%,rgba(255,255,255,0.12),transparent_58%)] transition-opacity duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                            showImage ? "opacity-100" : "opacity-0"
                          }`}
                        />
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
