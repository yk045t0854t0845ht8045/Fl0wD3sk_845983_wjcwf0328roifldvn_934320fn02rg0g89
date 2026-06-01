"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, Bell, CheckCircle2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

export type NotificationTone = "default" | "success" | "error";

type NotificationItem = {
  id: string;
  tone: NotificationTone;
  title: string | null;
  message: string;
  durationMs: number;
  createdAt: number;
  updatedAt: number;
  shouldAnimateEnter: boolean;
};

type NotificationPayload = {
  title?: string | null;
  message: string;
  tone?: NotificationTone;
  durationMs?: number;
};

type NotificationOptions = {
  title?: string | null;
  durationMs?: number;
};

type NotificationApi = {
  notify: (payload: NotificationPayload) => string;
  show: (message: string, options?: NotificationOptions & { tone?: NotificationTone }) => string;
  success: (message: string, options?: NotificationOptions) => string;
  error: (message: string, options?: NotificationOptions) => string;
  dismiss: (id: string) => void;
  clear: () => void;
};

type NotificationsProviderProps = {
  children: ReactNode;
};

type DismissTimerMeta = {
  timeoutId: number | null;
  startedAt: number;
  remainingMs: number;
};

type NotificationCollections = {
  visible: NotificationItem[];
  queued: NotificationItem[];
};

const MAX_VISIBLE_NOTIFICATIONS = 3;
const DEFAULT_NOTIFICATION_DURATION_MS = 5200;
const MINIMUM_RESUME_DURATION_MS = 180;
const INITIAL_NOTIFICATION_ANIMATION_DELAY_MS = 640;
const NOTIFICATION_EFFECT_DEDUPE_WINDOW_MS = 1400;
const EXPANDED_STACK_GAP_PX = 12;
const COLLAPSED_STACK_SCALE_STEP = 0.04;
const COLLAPSED_STACK_TOP_PADDING_PX = 38;
const COMPACT_STACK_CARD_HEIGHT_PX = 92;
const STACK_SPRING_TRANSITION = {
  type: "spring" as const,
  stiffness: 340,
  damping: 30,
  mass: 0.78,
};
const STACK_EASE = [0.22, 1, 0.36, 1] as const;

const NotificationContext = createContext<NotificationApi | null>(null);
const recentNotificationEffectFingerprints = new Map<string, number>();

function createNotificationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `flowdesk-notification-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeNotificationFingerprintPart(value: string | null | undefined) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").toLowerCase()
    : "";
}

function createNotificationFingerprint(input: {
  tone: NotificationTone;
  title: string | null;
  message: string;
}) {
  return [
    input.tone,
    normalizeNotificationFingerprintPart(input.title),
    normalizeNotificationFingerprintPart(input.message),
  ].join("::");
}

function pruneRecentNotificationEffectFingerprints(now: number) {
  recentNotificationEffectFingerprints.forEach((expiresAt, fingerprint) => {
    if (expiresAt <= now) {
      recentNotificationEffectFingerprints.delete(fingerprint);
    }
  });
}

function shouldSkipRecentNotificationEffectFingerprint(
  fingerprint: string,
  now: number,
) {
  pruneRecentNotificationEffectFingerprints(now);

  const expiresAt = recentNotificationEffectFingerprints.get(fingerprint) || 0;
  if (expiresAt > now) {
    return true;
  }

  recentNotificationEffectFingerprints.set(
    fingerprint,
    now + NOTIFICATION_EFFECT_DEDUPE_WINDOW_MS,
  );
  return false;
}

function getCollapsedStackLiftPx(stackDepth: number) {
  if (stackDepth <= 0) {
    return 0;
  }

  if (stackDepth === 1) {
    return 18;
  }

  if (stackDepth === 2) {
    return 36;
  }

  return 36 + (stackDepth - 2) * 18;
}

function resolveToneClasses(tone: NotificationTone) {
  if (tone === "success") {
    return {
      borderGlowClassName: "flowdesk-tag-border-glow-success",
      borderCoreClassName: "flowdesk-tag-border-core-success",
      iconWrapperClassName: "border-[#204225] bg-[#0D130E] text-[#B8F2AE]",
      titleClassName: "text-[#DDF8D8]",
      messageClassName: "text-[#A9D2A2]",
      closeButtonClassName:
        "text-[#87C67E] hover:border-[#204225] hover:bg-[#101610] hover:text-[#DDF8D8]",
      progressClassName:
        "from-[rgba(171,255,162,0.85)] via-[rgba(106,226,90,0.62)] to-[rgba(106,226,90,0)]",
    };
  }

  if (tone === "error") {
    return {
      borderGlowClassName: "flowdesk-tag-border-glow-danger",
      borderCoreClassName: "flowdesk-tag-border-core-danger",
      iconWrapperClassName: "border-[#412020] bg-[#130D0D] text-[#FFB4B4]",
      titleClassName: "text-[#FFD5D5]",
      messageClassName: "text-[#D4A5A5]",
      closeButtonClassName:
        "text-[#D18D8D] hover:border-[#412020] hover:bg-[#171010] hover:text-[#FFD5D5]",
      progressClassName:
        "from-[rgba(255,126,126,0.85)] via-[rgba(219,70,70,0.62)] to-[rgba(219,70,70,0)]",
    };
  }

  return {
    borderGlowClassName: "flowdesk-tag-border-glow",
    borderCoreClassName: "flowdesk-tag-border-core",
    iconWrapperClassName: "border-[#1F1F1F] bg-[#101010] text-[#F2F2F2]",
    titleClassName: "text-[#F2F2F2]",
    messageClassName: "text-[#B8B8B8]",
    closeButtonClassName:
      "text-[#8E8E8E] hover:border-[#232323] hover:bg-[#111111] hover:text-[#F2F2F2]",
    progressClassName:
      "from-[rgba(255,255,255,0.82)] via-[rgba(255,255,255,0.48)] to-[rgba(255,255,255,0)]",
  };
}

function NotificationCard({
  item,
  stackDepth,
  expanded,
  onDismiss,
}: {
  item: NotificationItem;
  stackDepth: number;
  expanded: boolean;
  onDismiss: (id: string) => void;
}) {
  const toneClasses = resolveToneClasses(item.tone);
  const Icon = item.tone === "success" ? CheckCircle2 : item.tone === "error" ? AlertCircle : Bell;
  const isCollapsedSecondary = !expanded && stackDepth > 0;
  const collapsedScale = Math.max(0.9, 1 - stackDepth * COLLAPSED_STACK_SCALE_STEP);
  const collapsedTopOffset = COLLAPSED_STACK_TOP_PADDING_PX - getCollapsedStackLiftPx(stackDepth);
  const compactLineClamp = item.title ? 2 : 3;
  const showCloseButton = expanded || stackDepth === 0;

  return (
    <motion.div
      layout="position"
      initial={
        item.shouldAnimateEnter
          ? {
              opacity: 0,
              y: 26,
              scale: 0.97,
            }
          : false
      }
      animate={{
        opacity: expanded ? 1 : Math.max(0.62, 1 - stackDepth * 0.13),
        y: 0,
        scale: expanded ? 1 : collapsedScale,
        top: isCollapsedSecondary ? collapsedTopOffset : 0,
        marginTop: expanded && stackDepth > 0 ? EXPANDED_STACK_GAP_PX : 0,
      }}
      exit={{
        opacity: 0,
        y: 34,
        scale: 0.92,
      }}
      transition={{
        layout: STACK_SPRING_TRANSITION,
        opacity: {
          duration: 0.22,
          ease: STACK_EASE,
        },
        y: STACK_SPRING_TRANSITION,
        scale: STACK_SPRING_TRANSITION,
        top: STACK_SPRING_TRANSITION,
        marginTop: STACK_SPRING_TRANSITION,
      }}
      style={{
        zIndex: 260 - stackDepth,
        position: isCollapsedSecondary ? "absolute" : "relative",
        insetInline: isCollapsedSecondary ? 0 : undefined,
        transformOrigin: "top right",
        pointerEvents: isCollapsedSecondary ? "none" : "auto",
      }}
      className="w-full"
    >
      <div
        role={item.tone === "error" ? "alert" : "status"}
        aria-live={item.tone === "error" ? "assertive" : "polite"}
        aria-atomic="true"
        className={`relative overflow-hidden rounded-[24px] shadow-[0_28px_90px_rgba(0,0,0,0.56)] ${
          isCollapsedSecondary ? "h-[92px]" : "min-h-[92px]"
        }`}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[24px] border border-[#0E0E0E]"
        />
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-[-2px] rounded-[24px] ${toneClasses.borderGlowClassName}`}
        />
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-[-1px] rounded-[24px] ${toneClasses.borderCoreClassName}`}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-[1px] rounded-[23px] bg-[linear-gradient(180deg,#0B0B0B_0%,#050505_100%)]"
        />
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-[18px] bottom-[1px] h-[2px] rounded-full bg-gradient-to-r ${toneClasses.progressClassName}`}
        />

        <div
          className={`relative z-10 flex h-full items-start gap-[14px] px-[16px] py-[16px] ${
            showCloseButton ? "pr-[56px]" : "pr-[18px]"
          }`}
        >
          <span
            className={`mt-[1px] flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[13px] border ${toneClasses.iconWrapperClassName}`}
            aria-hidden="true"
          >
            <Icon className="h-[19px] w-[19px]" strokeWidth={2.1} />
          </span>

          <div className="min-w-0 flex-1">
            {item.title ? (
              <div className="flex min-w-0 items-center gap-[8px] pr-[8px]">
                <p
                  className={`truncate text-[14px] font-semibold tracking-[-0.02em] ${toneClasses.titleClassName}`}
                >
                  {item.title}
                </p>
              </div>
            ) : null}

            <p
              className={`${item.title ? "mt-[4px] text-[13px]" : "text-[14px]"} leading-[1.55] tracking-[-0.01em] ${toneClasses.messageClassName}`}
              style={
                isCollapsedSecondary
                  ? {
                      display: "-webkit-box",
                      overflow: "hidden",
                      WebkitBoxOrient: "vertical",
                      WebkitLineClamp: compactLineClamp,
                    }
                  : undefined
              }
            >
              {item.message}
            </p>
          </div>

          {showCloseButton ? (
            <button
              type="button"
              onClick={() => onDismiss(item.id)}
              className={`absolute right-[14px] top-[14px] inline-flex h-[30px] w-[30px] items-center justify-center rounded-[10px] border border-transparent transition-colors ${toneClasses.closeButtonClassName}`}
              aria-label="Fechar notificacao"
            >
              <X className="h-[15px] w-[15px]" strokeWidth={2.1} />
            </button>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}

export function NotificationsProvider({ children }: NotificationsProviderProps) {
  const [visibleItems, setVisibleItems] = useState<NotificationItem[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [forceExpanded, setForceExpanded] = useState(false);
  const trayRef = useRef<HTMLDivElement | null>(null);
  const visibleItemsRef = useRef<NotificationItem[]>([]);
  const queuedItemsRef = useRef<NotificationItem[]>([]);
  const dismissTimerMapRef = useRef<Map<string, DismissTimerMeta>>(new Map());
  const dismissRef = useRef<(id: string) => void>(() => {});
  const forceExpandedRef = useRef(false);
  const expandedRef = useRef(false);
  const [providerMountedAt] = useState(() => Date.now());

  const syncCollections = useCallback((collections: NotificationCollections) => {
    visibleItemsRef.current = collections.visible;
    queuedItemsRef.current = collections.queued;
    setVisibleItems(collections.visible);
    return collections;
  }, []);

  const updateCollections = useCallback(
    (updater: (current: NotificationCollections) => NotificationCollections) =>
      syncCollections(
        updater({
          visible: visibleItemsRef.current,
          queued: queuedItemsRef.current,
        }),
      ),
    [syncCollections],
  );

  const clearDismissTimer = useCallback((id: string) => {
    const meta = dismissTimerMapRef.current.get(id);
    if (!meta) return;

    if (meta.timeoutId !== null) {
      window.clearTimeout(meta.timeoutId);
    }

    dismissTimerMapRef.current.delete(id);
  }, []);

  const resolveVisibleItemDuration = useCallback((id: string) => {
    return (
      visibleItemsRef.current.find((item) => item.id === id)?.durationMs ??
      DEFAULT_NOTIFICATION_DURATION_MS
    );
  }, []);

  const setPausedDismissTimer = useCallback(
    (id: string, delayMs: number) => {
      const nextDelayMs = Math.max(MINIMUM_RESUME_DURATION_MS, Math.trunc(delayMs));
      clearDismissTimer(id);

      dismissTimerMapRef.current.set(id, {
        timeoutId: null,
        startedAt: Date.now(),
        remainingMs: nextDelayMs,
      });
    },
    [clearDismissTimer],
  );

  const scheduleDismiss = useCallback(
    (id: string, delayMs: number) => {
      if (typeof window === "undefined") {
        return;
      }

      const nextDelayMs = Math.max(MINIMUM_RESUME_DURATION_MS, Math.trunc(delayMs));
      clearDismissTimer(id);

      const startedAt = Date.now();
      const timeoutId = window.setTimeout(() => {
        dismissRef.current(id);
      }, nextDelayMs);

      dismissTimerMapRef.current.set(id, {
        timeoutId,
        startedAt,
        remainingMs: nextDelayMs,
      });
    },
    [clearDismissTimer],
  );

  const dismiss = useCallback(
    (id: string) => {
      clearDismissTimer(id);

      updateCollections((current) => {
        const nextVisible = current.visible.filter((item) => item.id !== id);
        const nextQueued = current.queued.filter((item) => item.id !== id);

        return {
          visible: nextVisible,
          queued: nextQueued.slice(0, 0),
        };
      });
    },
    [
      clearDismissTimer,
      updateCollections,
    ],
  );

  useEffect(() => {
    dismissRef.current = dismiss;
  }, [dismiss]);

  useEffect(() => {
    forceExpandedRef.current = forceExpanded;
    expandedRef.current = forceExpanded || isExpanded;
  }, [forceExpanded, isExpanded]);

  const pauseAllDismissTimers = useCallback((resetToFullDuration = false) => {
    dismissTimerMapRef.current.forEach((meta, id) => {
      if (meta.timeoutId === null) {
        return;
      }

      window.clearTimeout(meta.timeoutId);
      const elapsedMs = Date.now() - meta.startedAt;
      const remainingMs = resetToFullDuration
        ? resolveVisibleItemDuration(id)
        : Math.max(MINIMUM_RESUME_DURATION_MS, meta.remainingMs - elapsedMs);

      dismissTimerMapRef.current.set(id, {
        timeoutId: null,
        startedAt: Date.now(),
        remainingMs,
      });
    });
  }, [resolveVisibleItemDuration]);

  const resumeAllDismissTimers = useCallback(() => {
    dismissTimerMapRef.current.forEach((meta, id) => {
      if (meta.timeoutId !== null) {
        return;
      }

      scheduleDismiss(id, meta.remainingMs);
    });
  }, [scheduleDismiss]);

  const expandTray = useCallback(() => {
    pauseAllDismissTimers(true);
    expandedRef.current = true;
    setIsExpanded(true);
  }, [pauseAllDismissTimers]);

  const collapseTray = useCallback(() => {
    if (forceExpandedRef.current) {
      expandedRef.current = true;
      setIsExpanded(false);
      return;
    }

    resumeAllDismissTimers();
    expandedRef.current = false;
    setIsExpanded(false);
  }, [resumeAllDismissTimers]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(hover: none)");
    const syncExpandedMode = () => {
      setForceExpanded(mediaQuery.matches);
    };

    syncExpandedMode();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncExpandedMode);
      return () => mediaQuery.removeEventListener("change", syncExpandedMode);
    }

    mediaQuery.addListener(syncExpandedMode);
    return () => mediaQuery.removeListener(syncExpandedMode);
  }, []);

  const expanded = forceExpanded || isExpanded;

  useEffect(() => {
    if (isExpanded) {
      pauseAllDismissTimers();
      return;
    }

    resumeAllDismissTimers();
  }, [isExpanded, pauseAllDismissTimers, resumeAllDismissTimers]);

  useEffect(() => {
    const dismissTimerMap = dismissTimerMapRef.current;

    return () => {
      dismissTimerMap.forEach((meta) => {
        if (meta.timeoutId !== null) {
          window.clearTimeout(meta.timeoutId);
        }
      });
      dismissTimerMap.clear();
    };
  }, []);

  const notify = useCallback(
    (payload: NotificationPayload) => {
      const message = typeof payload.message === "string" ? payload.message.trim() : "";
      if (!message) {
        return "";
      }

      const title =
        typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : null;
      const tone = payload.tone || "default";
      const durationMs = Math.max(
        MINIMUM_RESUME_DURATION_MS,
        Math.trunc(payload.durationMs || DEFAULT_NOTIFICATION_DURATION_MS),
      );
      const now = Date.now();

      let targetId = "";
      let targetDelayMs = durationMs;
      let shouldRunVisibleTimer = false;
      const droppedIds: string[] = [];

      updateCollections((current) => {
        const item: NotificationItem = {
          id: createNotificationId(),
          tone,
          title,
          message,
          durationMs,
          createdAt: now,
          updatedAt: now,
          shouldAnimateEnter: now - providerMountedAt > INITIAL_NOTIFICATION_ANIMATION_DELAY_MS,
        };

        targetId = item.id;
        targetDelayMs = item.durationMs;
        shouldRunVisibleTimer = true;
        const nextVisible = [item, ...current.visible].slice(0, MAX_VISIBLE_NOTIFICATIONS);
        const nextVisibleIds = new Set(nextVisible.map((visibleItem) => visibleItem.id));
        for (const visibleItem of current.visible) {
          if (!nextVisibleIds.has(visibleItem.id)) droppedIds.push(visibleItem.id);
        }
        for (const queuedItem of current.queued) {
          droppedIds.push(queuedItem.id);
        }

        return {
          visible: nextVisible,
          queued: [],
        };
      });

      droppedIds.forEach((id) => {
        clearDismissTimer(id);
      });

      if (!targetId || !shouldRunVisibleTimer) {
        return targetId;
      }

      if (expandedRef.current) {
        setPausedDismissTimer(targetId, targetDelayMs);
      } else {
        scheduleDismiss(targetId, targetDelayMs);
      }

      return targetId;
    },
    [
      clearDismissTimer,
      providerMountedAt,
      scheduleDismiss,
      setPausedDismissTimer,
      updateCollections,
    ],
  );

  const clear = useCallback(() => {
    dismissTimerMapRef.current.forEach((meta) => {
      if (meta.timeoutId !== null) {
        window.clearTimeout(meta.timeoutId);
      }
    });
    dismissTimerMapRef.current.clear();
    visibleItemsRef.current = [];
    queuedItemsRef.current = [];
    setVisibleItems([]);
  }, []);

  const api = useMemo<NotificationApi>(
    () => ({
      notify,
      show: (message, options) =>
        notify({
          message,
          tone: options?.tone || "default",
          title: options?.title,
          durationMs: options?.durationMs,
        }),
      success: (message, options) =>
        notify({
          message,
          tone: "success",
          title: options?.title,
          durationMs: options?.durationMs,
        }),
      error: (message, options) =>
        notify({
          message,
          tone: "error",
          title: options?.title,
          durationMs: options?.durationMs,
        }),
      dismiss,
      clear,
    }),
    [clear, dismiss, notify],
  );

  const renderedItems = visibleItems;
  const collapsedTrayHeight =
    renderedItems.length > 0
      ? COMPACT_STACK_CARD_HEIGHT_PX +
        (renderedItems.length > 1 ? COLLAPSED_STACK_TOP_PADDING_PX : 0)
      : 0;

  return (
    <NotificationContext.Provider value={api}>
      {children}

      <div className="pointer-events-none fixed bottom-[16px] right-[12px] z-[3200] w-[min(420px,calc(100vw-24px))] sm:bottom-[24px] sm:right-[24px]">
        <div
          ref={trayRef}
          className="pointer-events-auto flex w-full justify-end"
          onMouseEnter={expandTray}
          onMouseLeave={collapseTray}
          onFocusCapture={expandTray}
          onBlurCapture={(event) => {
            const nextTarget = event.relatedTarget as Node | null;
            if (!trayRef.current?.contains(nextTarget)) {
              collapseTray();
            }
          }}
        >
          <div className="w-full">
            <motion.div
              className="relative w-full"
              animate={{
                paddingTop: !expanded && renderedItems.length > 1 ? COLLAPSED_STACK_TOP_PADDING_PX : 0,
                minHeight: expanded ? 0 : collapsedTrayHeight,
              }}
              transition={{
                paddingTop: STACK_SPRING_TRANSITION,
                minHeight: STACK_SPRING_TRANSITION,
              }}
            >
              <AnimatePresence initial={false}>
                {renderedItems.map((item, index) => (
                  <NotificationCard
                    key={item.id}
                    item={item}
                    stackDepth={index}
                    expanded={expanded}
                    onDismiss={dismiss}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          </div>
        </div>
      </div>
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used within a NotificationsProvider.");
  }

  return context;
}

export function useNotificationEffect(
  message: string | null | undefined,
  options?: {
    tone?: NotificationTone;
    title?: string | null;
    durationMs?: number;
    enabled?: boolean;
    eventKey?: string | null;
  },
) {
  const notifications = useNotifications();
  const previousFingerprintRef = useRef<string | null>(null);
  const tone = options?.tone || "default";
  const enabled = options?.enabled ?? true;

  useEffect(() => {
    const normalizedMessage =
      typeof message === "string" && message.trim() ? message.trim() : null;
    const normalizedTitle =
      typeof options?.title === "string" && options.title.trim()
        ? options.title.trim()
        : null;

    if (!normalizedMessage) {
      previousFingerprintRef.current = null;
      return;
    }

    const fingerprint = createNotificationFingerprint({
      tone,
      title: normalizedTitle,
      message: options?.eventKey?.trim()
        ? `event:${options.eventKey.trim()}`
        : normalizedMessage,
    });

    if (!enabled || previousFingerprintRef.current === fingerprint) {
      return;
    }

    previousFingerprintRef.current = fingerprint;
    if (shouldSkipRecentNotificationEffectFingerprint(fingerprint, Date.now())) {
      return;
    }

    if (tone === "success") {
      notifications.success(normalizedMessage, {
        title: normalizedTitle,
        durationMs: options?.durationMs,
      });
      return;
    }

    if (tone === "error") {
      notifications.error(normalizedMessage, {
        title: normalizedTitle,
        durationMs: options?.durationMs,
      });
      return;
    }

    notifications.show(normalizedMessage, {
      tone,
      title: normalizedTitle,
      durationMs: options?.durationMs,
    });
  }, [
    enabled,
    message,
    notifications,
    options?.durationMs,
    options?.eventKey,
    options?.title,
    tone,
  ]);
}
