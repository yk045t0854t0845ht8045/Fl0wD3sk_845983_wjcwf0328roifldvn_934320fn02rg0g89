"use client";

import {
  cloneElement,
  isValidElement,
  useEffect,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";

type LandingRevealProps = {
  children: ReactElement<{
    className?: string;
    style?: CSSProperties;
    "data-flowdesk-visible"?: "true" | "false";
  }>;
  delay?: number;
  duration?: number;
};

export function LandingReveal({
  children,
  delay = 0,
  duration = 620,
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

  if (!isValidElement(children)) {
    return children;
  }

  const childProps = (children.props ?? {}) as {
    className?: string;
    style?: CSSProperties;
    "data-flowdesk-visible"?: "true" | "false";
  };

  return cloneElement(children, {
    className: `${childProps.className ?? ""} flowdesk-landing-reveal`.trim(),
    style: {
      ...(childProps.style ?? {}),
      "--flowdesk-reveal-delay": `${delay}ms`,
      "--flowdesk-reveal-duration": `${duration}ms`,
    } as CSSProperties,
    // We explicitly use a string "false" during the first render to match hydration
    "data-flowdesk-visible": isVisible ? "true" : "false",
  });
}
