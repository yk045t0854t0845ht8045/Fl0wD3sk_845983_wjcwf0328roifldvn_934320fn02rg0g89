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
};

export function LandingReveal({
  children,
  delay = 0,
}: LandingRevealProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setIsVisible(true);
    });

    return () => {
      window.cancelAnimationFrame(frame);
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
    } as CSSProperties,
    // We explicitly use a string "false" during the first render to match hydration
    "data-flowdesk-visible": isVisible ? "true" : "false",
  });
}
