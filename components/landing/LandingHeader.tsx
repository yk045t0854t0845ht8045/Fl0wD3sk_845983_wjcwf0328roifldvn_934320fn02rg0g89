"use client";

import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LandingActionButton } from "@/components/landing/LandingActionButton";
import { LandingReveal } from "@/components/landing/LandingReveal";

type NavigationItem = {
  label: string;
  href: string;
  hasChevron?: boolean;
  hideFirstOnTightDesktop?: boolean;
};

const LEFT_NAV_ITEMS: NavigationItem[] = [
  { label: "Servicos", href: "/#services", hasChevron: true },
  { label: "Produtos", href: "/#products", hasChevron: true },
  { label: "Solucoes", href: "/#solutions", hasChevron: true },
  {
    label: "Sobre",
    href: "/#about",
    hasChevron: true,
    hideFirstOnTightDesktop: true,
  },
  { label: "Planos", href: "/#plans" },
];

const TABLET_NAV_BREAKPOINT = 1250;
const MOBILE_MENU_ITEMS: NavigationItem[] = [
  { label: "Servicos", href: "/#services" },
  { label: "Produtos", href: "/#products" },
  { label: "Solucoes", href: "/#solutions" },
];

function ChevronIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-[16px] w-[16px] shrink-0 text-[#B7B7B7]"
      fill="none"
    >
      <path
        d="M3.5 5.75L8 10.25L12.5 5.75"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HamburgerIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[24px] w-[24px] shrink-0"
      fill="none"
    >
      <path
        d="M4 7H20M4 12H20M4 17H20"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[24px] w-[24px] shrink-0"
      fill="none"
    >
      <path
        d="M6 6L18 18M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 28 28"
      className="h-[28px] w-[28px] shrink-0 text-[#B7B7B7]"
      fill="none"
    >
      <path
        d="M14 2L16.6 11.4L26 14L16.6 16.6L14 26L11.4 16.6L2 14L11.4 11.4L14 2Z"
        fill="currentColor"
      />
    </svg>
  );
}

function NavLink({
  item,
  className = "",
  onClick,
  style,
  "data-flowdesk-visible": dataFlowdeskVisible,
}: {
  item: NavigationItem;
  className?: string;
  onClick?: () => void;
  style?: CSSProperties;
  "data-flowdesk-visible"?: "true" | "false";
}) {
  return (
    <Link
      href={item.href}
      onClick={onClick}
      style={style}
      data-flowdesk-visible={dataFlowdeskVisible}
      className={`inline-flex items-center whitespace-nowrap text-[20px] leading-none font-normal text-[#B7B7B7] ${className}`.trim()}
    >
      <span className="inline-flex items-center gap-[14px]">
        <span>{item.label}</span>
        {item.hasChevron ? <ChevronIcon /> : null}
      </span>
    </Link>
  );
}

export function LandingHeader() {
  const documentationHref =
    process.env.NEXT_PUBLIC_DOCUMENTATION_URL || "/terms";
  const headerShellRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openFrameRef = useRef<number | null>(null);
  const lastScrollYRef = useRef(0);
  const floatingHeaderUnlockedRef = useRef(false);
  const floatingHeaderStateRef = useRef(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMenuMounted, setIsMenuMounted] = useState(false);
  const [viewportWidth, setViewportWidth] = useState<number | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [isFloatingHeader, setIsFloatingHeader] = useState(false);
  const [isFloatingHeaderVisible, setIsFloatingHeaderVisible] = useState(true);

  const closeMenu = useCallback(() => {
    if (openFrameRef.current !== null) {
      window.cancelAnimationFrame(openFrameRef.current);
      openFrameRef.current = null;
    }

    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
    }

    setIsMenuOpen(false);
    closeTimeoutRef.current = setTimeout(() => {
      setIsMenuMounted(false);
      closeTimeoutRef.current = null;
    }, 320);
  }, []);

  const openMenu = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }

    setIsMenuMounted(true);

    if (openFrameRef.current !== null) {
      window.cancelAnimationFrame(openFrameRef.current);
    }

    openFrameRef.current = window.requestAnimationFrame(() => {
      setIsMenuOpen(true);
      openFrameRef.current = null;
    });
  }, []);

  const toggleMenu = useCallback(() => {
    if (isMenuMounted && isMenuOpen) {
      closeMenu();
      return;
    }

    openMenu();
  }, [closeMenu, isMenuMounted, isMenuOpen, openMenu]);

  useEffect(() => {
    function syncViewportWidth() {
      const nextViewportWidth = window.innerWidth;
      setViewportWidth(nextViewportWidth);

      if (nextViewportWidth >= TABLET_NAV_BREAKPOINT) {
        closeMenu();
      }
    }

    syncViewportWidth();
    window.addEventListener("resize", syncViewportWidth);

    return () => {
      window.removeEventListener("resize", syncViewportWidth);
    };
  }, [closeMenu]);

  const resolvedViewportWidth = viewportWidth ?? 1920;
  const isTabletMode = resolvedViewportWidth < TABLET_NAV_BREAKPOINT;
  const showAboutLink = resolvedViewportWidth >= 1420;
  const shouldForceHeaderVisible = isMenuMounted || isMenuOpen;

  useEffect(() => {
    floatingHeaderStateRef.current = isFloatingHeader;
  }, [isFloatingHeader]);

  useEffect(() => {
    if (!isMenuMounted) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isMenuMounted]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current) {
        return;
      }

      if (!menuRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMenu();
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [closeMenu]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }

      if (openFrameRef.current !== null) {
        window.cancelAnimationFrame(openFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    function syncHeaderHeight() {
      const nextHeight = headerShellRef.current?.offsetHeight ?? 0;

      if (nextHeight > 0) {
        setHeaderHeight(nextHeight);
      }
    }

    syncHeaderHeight();

    const observedNode = headerShellRef.current;

    if (!observedNode) {
      return;
    }

    const observer = new ResizeObserver(syncHeaderHeight);
    observer.observe(observedNode);
    window.addEventListener("resize", syncHeaderHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncHeaderHeight);
    };
  }, [isTabletMode, showAboutLink]);

  useEffect(() => {
    lastScrollYRef.current = window.scrollY;

    function handleScroll() {
      const currentScrollY = window.scrollY;
      const previousScrollY = lastScrollYRef.current;
      const delta = currentScrollY - previousScrollY;
      const activationOffset = Math.max(headerHeight, 96);
      const wasFloatingHeader = floatingHeaderStateRef.current;

      if (currentScrollY <= 4) {
        setIsFloatingHeader(false);
        setIsFloatingHeaderVisible(true);
        floatingHeaderUnlockedRef.current = false;
        floatingHeaderStateRef.current = false;
        lastScrollYRef.current = currentScrollY;
        return;
      }

      if (currentScrollY <= activationOffset) {
        setIsFloatingHeader(false);
        setIsFloatingHeaderVisible(true);
        floatingHeaderUnlockedRef.current = false;
        floatingHeaderStateRef.current = false;
        lastScrollYRef.current = currentScrollY;
        return;
      }

      if (Math.abs(delta) < 4) {
        return;
      }

      if (delta < 0) {
        floatingHeaderUnlockedRef.current = true;
        setIsFloatingHeader(true);
        floatingHeaderStateRef.current = true;
        setIsFloatingHeaderVisible(true);
        lastScrollYRef.current = currentScrollY;
        return;
      }

      if (!floatingHeaderUnlockedRef.current && !wasFloatingHeader) {
        lastScrollYRef.current = currentScrollY;
        return;
      }

      setIsFloatingHeader(true);
      floatingHeaderStateRef.current = true;
      setIsFloatingHeaderVisible(false);

      lastScrollYRef.current = currentScrollY;
    }

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [headerHeight]);

  const responsiveTransitionClassName =
    "flowdesk-landing-soft-motion overflow-hidden";
  const shouldShowFloatingHeader =
    !isFloatingHeader || shouldForceHeaderVisible || isFloatingHeaderVisible;

  return (
    <header
      className="relative z-40 w-full"
      style={isFloatingHeader ? { height: `${headerHeight}px` } : undefined}
    >
      <div
        ref={headerShellRef}
        className={`w-full transition-transform duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isFloatingHeader
            ? `fixed inset-x-0 top-0 ${
                shouldShowFloatingHeader ? "translate-y-0" : "-translate-y-[115%]"
              }`
            : "relative translate-y-0"
        }`}
      >
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute top-0 right-[max(2px,_calc(50%_-_799px))] bottom-[28px] left-[max(2px,_calc(50%_-_799px))] bg-[rgba(4,4,4,0.08)] ${
            isFloatingHeader ? "opacity-100" : "opacity-0"
          }`}
        />
        <div
          aria-hidden="true"
          style={{
            backdropFilter: "blur(28px)",
            WebkitBackdropFilter: "blur(28px)",
          }}
          className={`pointer-events-none absolute top-0 right-[max(2px,_calc(50%_-_799px))] bottom-[28px] left-[max(2px,_calc(50%_-_799px))] ${
            isFloatingHeader ? "opacity-100" : "opacity-0"
          }`}
        />

        <div
          style={{
            transitionDelay:
              isFloatingHeader && shouldShowFloatingHeader ? "40ms" : "0ms",
          }}
          className={`relative transition-[opacity,filter] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
            isFloatingHeader
              ? shouldShowFloatingHeader
                ? "opacity-100 blur-0"
                : "opacity-0 blur-[6px]"
              : "opacity-100 blur-0"
          }`}
        >
          <div className="relative mx-auto flex w-full max-w-[1582px] flex-col px-[20px] pt-[20px] pb-10 md:px-6 lg:px-8 xl:px-10 2xl:px-[20px]">
        <div className="relative flex min-h-[88px] items-center justify-between gap-6">
          <div className="flex min-w-0 items-center">
            <LandingReveal delay={90}>
              <Link
                href="/"
                className="flowdesk-landing-soft-motion relative block h-[30px] w-[150px] shrink-0 sm:h-[36px] sm:w-[180px] xl:h-[42px] xl:w-[210px]"
                aria-label="Ir para a pagina inicial do Flowdesk"
              >
                <Image
                  src="/cdn/logos/logo.png"
                  alt="Flowdesk"
                  fill
                  sizes="(max-width: 640px) 150px, (max-width: 1280px) 180px, 210px"
                  className="object-contain"
                  priority
                />
              </Link>
            </LandingReveal>

            <nav
              className={`flex min-w-0 items-center ${responsiveTransitionClassName} ${
                isTabletMode
                  ? "pointer-events-none ml-0 max-w-0 -translate-y-1 opacity-0"
                  : "ml-10 max-w-[1200px] translate-y-0 opacity-100"
              }`}
            >
              {LEFT_NAV_ITEMS.map((item, index) => {
                const itemWrapperClassName = item.hideFirstOnTightDesktop
                  ? `${responsiveTransitionClassName} ${
                      showAboutLink
                        ? "ml-7 max-w-[220px] translate-y-0 opacity-100"
                        : "pointer-events-none ml-0 max-w-0 -translate-y-1 opacity-0"
                    }`
                  : `${responsiveTransitionClassName} ${index === 0 ? "" : "ml-7"}`;

                return (
                  <div
                    key={item.label}
                    className={itemWrapperClassName}
                  >
                    <LandingReveal delay={150 + index * 55}>
                      <NavLink item={item} />
                    </LandingReveal>
                  </div>
                );
              })}
            </nav>
          </div>

          <div className="flex shrink-0 items-center justify-end">
            <LandingReveal delay={410}>
              <div
                className={`flex shrink-0 items-center ${responsiveTransitionClassName} ${
                  isTabletMode
                    ? "pointer-events-none max-w-0 translate-y-1 opacity-0"
                    : "max-w-[720px] translate-y-0 opacity-100"
                }`}
              >
                <LandingReveal delay={500}>
                  <div className="flowdesk-landing-soft-motion flex h-[46px] shrink-0 items-center">
                    <Link
                      href={documentationHref}
                      className="inline-flex h-[46px] items-center whitespace-nowrap text-[20px] leading-none font-normal text-[#B7B7B7]"
                    >
                      Documentacao
                    </Link>
                  </div>
                </LandingReveal>

                <div className="ml-[30px] flex items-center gap-6">
                  <LandingReveal delay={570}>
                    <LandingActionButton href="/login" variant="dark">
                      Login
                    </LandingActionButton>
                  </LandingReveal>
                  <LandingReveal delay={640}>
                    <LandingActionButton href="/login" variant="light">
                      Sign Up
                    </LandingActionButton>
                  </LandingReveal>
                </div>
              </div>
            </LandingReveal>

            <LandingReveal delay={410}>
              <div
                className={`ml-4 flex shrink-0 items-center gap-4 ${responsiveTransitionClassName} ${
                  isTabletMode
                    ? "max-w-[220px] translate-y-0 opacity-100"
                    : "pointer-events-none ml-0 max-w-0 translate-y-1 opacity-0"
                }`}
              >
                <LandingReveal delay={500}>
                  <LandingActionButton
                    href="/login"
                    variant="light"
                    className="h-[40px] px-4 text-[14px] sm:h-[46px] sm:px-6 sm:text-[16px]"
                  >
                    Sign Up
                  </LandingActionButton>
                </LandingReveal>

                <LandingReveal delay={570}>
                  <button
                    type="button"
                    onClick={toggleMenu}
                    aria-label={isMenuOpen ? "Fechar menu" : "Abrir menu"}
                    aria-expanded={isMenuOpen}
                    className="inline-flex h-[40px] w-[40px] items-center justify-center text-[#D1D1D1] transition-opacity duration-150 hover:opacity-85 active:opacity-70 sm:h-[46px] sm:w-[46px]"
                  >
                    {isMenuOpen ? <CloseIcon /> : <HamburgerIcon />}
                  </button>
                </LandingReveal>
              </div>
            </LandingReveal>
          </div>
        </div>

      </div>
      </div>
      </div>

      {isMenuMounted ? (
        <div
          className={`fixed inset-0 z-50 flex items-end justify-center bg-[rgba(4,4,4,0.64)] px-4 pb-4 pt-20 backdrop-blur-[18px] transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] sm:px-6 sm:pb-6 ${
            isMenuOpen ? "opacity-100" : "opacity-0"
          }`}
        >
          <div
            ref={menuRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu mobile"
            className={`w-full max-w-[560px] rounded-[32px] border border-[#111111] bg-[#040404] p-4 shadow-[0_34px_120px_rgba(0,0,0,0.62)] transition-[opacity,transform,filter] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] sm:p-5 ${
              isMenuOpen
                ? "translate-y-0 opacity-100 blur-0"
                : "translate-y-10 opacity-0 blur-[4px]"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <LandingReveal delay={90}>
                <div className="flex h-[56px] w-[56px] items-center justify-center rounded-[18px] bg-[#111111]">
                  <SparkleIcon />
                </div>
              </LandingReveal>

              <LandingReveal delay={130}>
                <button
                  type="button"
                  onClick={closeMenu}
                  aria-label="Fechar menu"
                  className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-full bg-[#111111] text-[#B7B7B7] transition-colors duration-200 hover:bg-[#161616] hover:text-white"
                >
                  <CloseIcon />
                </button>
              </LandingReveal>
            </div>

            <LandingReveal delay={170}>
              <div className="mt-5">
                <h2 className="bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[34px] leading-[1.05] font-semibold tracking-[-0.04em] text-transparent">
                  Explore o Flowdesk
                </h2>
                <p className="mt-3 max-w-[420px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[18px] leading-[1.35] font-normal text-transparent">
                  Acesse rapidamente as areas principais da plataforma com o
                  mesmo visual premium da landing.
                </p>
              </div>
            </LandingReveal>

            <div className="mt-6 flex flex-col gap-3">
              {MOBILE_MENU_ITEMS.map((item, index) => (
                <LandingReveal
                  key={item.label}
                  delay={230 + index * 70}
                >
                  <LandingActionButton
                    href={item.href}
                    onClick={closeMenu}
                    variant="dark"
                    className="h-[52px] w-full rounded-[12px] px-6 text-[18px]"
                  >
                    {item.label}
                  </LandingActionButton>
                </LandingReveal>
              ))}

              <LandingReveal delay={440}>
                <LandingActionButton
                  href="/login"
                  onClick={closeMenu}
                  variant="light"
                  className="h-[52px] w-full rounded-[12px] px-6 text-[18px]"
                >
                  Login
                </LandingActionButton>
              </LandingReveal>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
