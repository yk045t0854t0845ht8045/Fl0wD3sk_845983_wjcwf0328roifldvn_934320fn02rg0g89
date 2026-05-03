"use client";

import {
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

type LandingRevealProps = {
  children: ReactNode;
  delay?: number;
  duration?: number;
  className?: string;
};

export function LandingReveal({
  children,
  delay = 0,
  duration = 620,
  className,
}: LandingRevealProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    let raf = 0;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const revealNow = () => {
      setIsVisible(true);
    };

    // Use rAF for smoothness, but keep a timeout fallback (background tabs/BFCache can skip rAF).
    raf = window.requestAnimationFrame(revealNow);
    timeout = setTimeout(revealNow, 80);

    // When returning via back/forward cache, effects may not rerun as expected.
    // These events ensure we never stay stuck in the hidden state.
    window.addEventListener("pageshow", revealNow);
    window.addEventListener("focus", revealNow);
    document.addEventListener("visibilitychange", revealNow);

    return () => {
      window.cancelAnimationFrame(raf);
      if (timeout) clearTimeout(timeout);
      window.removeEventListener("pageshow", revealNow);
      window.removeEventListener("focus", revealNow);
      document.removeEventListener("visibilitychange", revealNow);
    };
  }, []);

  return (
    <div
      className={`${className ?? ""} flowdesk-landing-reveal`.trim()}
      style={
        {
          "--flowdesk-reveal-delay": `${delay}ms`,
          "--flowdesk-reveal-duration": `${duration}ms`,
        } as CSSProperties
      }
      data-flowdesk-visible={isVisible ? "true" : "false"}
    >
      {children}
    </div>
  );
}
