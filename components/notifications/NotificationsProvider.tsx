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
  fingerprint: string;
  occurrences: number;
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
const MAX_BUFFERED_NOTIFICATIONS = 36;
const DEFAULT_NOTIFICATION_DURATION_MS = 5200;
const MINIMUM_RESUME_DURATION_MS = 180;
const DUPLICATE_MERGE_WINDOW_MS = 2800;
const EXPANDED_STACK_GAP_PX = 12;
const COLLAPSED_STACK_SCALE_STEP = 0.04;
const COLLAPSED_STACK_TOP_PADDING_PX = 38;
const COMPACT_STACK_CARD_HEIGHT_PX = 92;

const NotificationContext = createContext<NotificationApi | null>(null);

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
      badgeClassName: "border-[#204225] bg-[#101610] text-[#B8F2AE]",
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
      badgeClassName: "border-[#412020] bg-[#171010] text-[#FFB4B4]",
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
    badgeClassName: "border-[#262626] bg-[#101010] text-[#E5E5E5]",
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
  const compactLineClamp = item.title || item.occurrences > 1 ? 2 : 3;

  return (
    <motion.div
      layout
      initial={{
        opacity: 0,
        y: 26,
        scale: 0.97,
      }}
      animate={{
        opacity: expanded ? 1 : Math.max(0.62, 1 - stackDepth * 0.13),
        y: 0,
        scale: expanded ? 1 : collapsedScale,
      }}
      exit={{
        opacity: 0,
        y: 34,
        scale: 0.92,
      }}
      transition={{
        layout: {
          duration: 0.28,
          ease: [0.22, 1, 0.36, 1],
        },
        opacity: {
          duration: 0.2,
          ease: [0.22, 1, 0.36, 1],
        },
        y: {
          duration: 0.24,
          ease: [0.22, 1, 0.36, 1],
        },
        scale: {
          duration: 0.24,
          ease: [0.22, 1, 0.36, 1],
        },
      }}
      style={{
        zIndex: 260 - stackDepth,
        position: isCollapsedSecondary ? "absolute" : "relative",
        insetInline: isCollapsedSecondary ? 0 : undefined,
        top: isCollapsedSecondary ? collapsedTopOffset : undefined,
        marginTop: expanded && stackDepth > 0 ? EXPANDED_STACK_GAP_PX : 0,
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

        <div className="relative z-10 flex h-full items-start gap-[14px] px-[16px] py-[16px] pr-[56px]">
          <span
            className={`mt-[1px] flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[13px] border ${toneClasses.iconWrapperClassName}`}
            aria-hidden="true"
          >
            <Icon className="h-[19px] w-[19px]" strokeWidth={2.1} />
          </span>

          <div className="min-w-0 flex-1">
            {item.title || item.occurrences > 1 ? (
              <div className="flex min-w-0 items-center gap-[8px] pr-[8px]">
                {item.title ? (
                  <p
                    className={`truncate text-[14px] font-semibold tracking-[-0.02em] ${toneClasses.titleClassName}`}
                  >
                    {item.title}
                  </p>
                ) : null}

                {item.occurrences > 1 ? (
                  <span
                    className={`inline-flex shrink-0 items-center rounded-full border px-[8px] py-[2px] text-[10px] font-semibold tracking-[0.04em] ${toneClasses.badgeClassName}`}
                  >
                    {item.occurrences}x
                  </span>
                ) : null}
              </div>
            ) : null}

            <p
              className={`${
                item.title || item.occurrences > 1 ? "mt-[4px] text-[13px]" : "text-[14px]"
              } leading-[1.55] tracking-[-0.01em] ${toneClasses.messageClassName}`}
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

          <button
            type="button"
            onClick={() => onDismiss(item.id)}
            className={`absolute right-[14px] top-[14px] inline-flex h-[30px] w-[30px] items-center justify-center rounded-[10px] border border-transparent transition-colors ${toneClasses.closeButtonClassName}`}
            aria-label="Fechar notificacao"
          >
            <X className="h-[15px] w-[15px]" strokeWidth={2.1} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export function NotificationsProvider({ children }: NotificationsProviderProps) {
  const [visibleItems, setVisibleItems] = useState<NotificationItem[]>([]);
  const [, setQueuedItems] = useState<NotificationItem[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [forceExpanded, setForceExpanded] = useState(false);
  const trayRef = useRef<HTMLDivElement | null>(null);
  const visibleItemsRef = useRef<NotificationItem[]>([]);
  const queuedItemsRef = useRef<NotificationItem[]>([]);
  const dismissTimerMapRef = useRef<Map<string, DismissTimerMeta>>(new Map());
  const recentFingerprintCooldownRef = useRef<Map<string, number>>(new Map());
  const dismissRef = useRef<(id: string) => void>(() => {});

  const syncCollections = useCallback((collections: NotificationCollections) => {
    visibleItemsRef.current = collections.visible;
    queuedItemsRef.current = collections.queued;
    setVisibleItems(collections.visible);
    setQueuedItems(collections.queued);
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

  const pruneRecentFingerprintCooldowns = useCallback((now: number) => {
    recentFingerprintCooldownRef.current.forEach((expiresAt, fingerprint) => {
      if (expiresAt <= now) {
        recentFingerprintCooldownRef.current.delete(fingerprint);
      }
    });
  }, []);

  const rememberRecentFingerprint = useCallback(
    (fingerprint: string) => {
      if (!fingerprint) {
        return;
      }

      const now = Date.now();
      pruneRecentFingerprintCooldowns(now);
      recentFingerprintCooldownRef.current.set(
        fingerprint,
        now + DUPLICATE_MERGE_WINDOW_MS,
      );
    },
    [pruneRecentFingerprintCooldowns],
  );

  const isFingerprintCoolingDown = useCallback(
    (fingerprint: string, now: number) => {
      if (!fingerprint) {
        return false;
      }

      pruneRecentFingerprintCooldowns(now);
      const expiresAt = recentFingerprintCooldownRef.current.get(fingerprint) || 0;
      return expiresAt > now;
    },
    [pruneRecentFingerprintCooldowns],
  );

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

      const promotedItems: NotificationItem[] = [];
      let dismissedFingerprint: string | null = null;
      updateCollections((current) => {
        dismissedFingerprint =
          current.visible.find((item) => item.id === id)?.fingerprint ||
          current.queued.find((item) => item.id === id)?.fingerprint ||
          null;
        const nextVisible = current.visible.filter((item) => item.id !== id);
        const removedVisibleItem = nextVisible.length !== current.visible.length;
        const nextQueued = current.queued.filter((item) => item.id !== id);

        if (removedVisibleItem) {
          while (
            nextVisible.length < MAX_VISIBLE_NOTIFICATIONS &&
            nextQueued.length > 0
          ) {
            const nextQueuedItem = nextQueued.shift();
            if (!nextQueuedItem) {
              break;
            }

            promotedItems.push(nextQueuedItem);
            nextVisible.push(nextQueuedItem);
          }
        }

        return {
          visible: nextVisible,
          queued: nextQueued,
        };
      });

      if (dismissedFingerprint) {
        rememberRecentFingerprint(dismissedFingerprint);
      }

      promotedItems.forEach((item) => {
        if (isExpanded) {
          setPausedDismissTimer(item.id, item.durationMs);
          return;
        }

        scheduleDismiss(item.id, item.durationMs);
      });
    },
    [
      clearDismissTimer,
      isExpanded,
      rememberRecentFingerprint,
      scheduleDismiss,
      setPausedDismissTimer,
      updateCollections,
    ],
  );

  useEffect(() => {
    dismissRef.current = dismiss;
  }, [dismiss]);

  const pauseAllDismissTimers = useCallback(() => {
    dismissTimerMapRef.current.forEach((meta, id) => {
      if (meta.timeoutId === null) {
        return;
      }

      window.clearTimeout(meta.timeoutId);
      const elapsedMs = Date.now() - meta.startedAt;
      dismissTimerMapRef.current.set(id, {
        timeoutId: null,
        startedAt: Date.now(),
        remainingMs: Math.max(MINIMUM_RESUME_DURATION_MS, meta.remainingMs - elapsedMs),
      });
    });
  }, []);

  const resumeAllDismissTimers = useCallback(() => {
    dismissTimerMapRef.current.forEach((meta, id) => {
      if (meta.timeoutId !== null) {
        return;
      }

      scheduleDismiss(id, meta.remainingMs);
    });
  }, [scheduleDismiss]);

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
      const fingerprint = createNotificationFingerprint({
        tone,
        title,
        message,
      });
      const now = Date.now();

      if (isFingerprintCoolingDown(fingerprint, now)) {
        return "";
      }

      let targetId = "";
      let targetDelayMs = durationMs;
      let shouldRunVisibleTimer = false;
      const droppedIds: string[] = [];
      const droppedFingerprints: string[] = [];

      updateCollections((current) => {
        const duplicateVisible = current.visible.find(
          (item) => item.fingerprint === fingerprint,
        );

        if (duplicateVisible) {
          const updatedItem: NotificationItem = {
            ...duplicateVisible,
            tone,
            title,
            message,
            durationMs: Math.max(duplicateVisible.durationMs, durationMs),
            updatedAt: now,
            occurrences: duplicateVisible.occurrences + 1,
          };

          targetId = updatedItem.id;
          targetDelayMs = updatedItem.durationMs;
          shouldRunVisibleTimer = true;

          return {
            visible: [
              updatedItem,
              ...current.visible.filter((item) => item.id !== duplicateVisible.id),
            ],
            queued: current.queued,
          };
        }

        const duplicateQueued = current.queued.find(
          (item) => item.fingerprint === fingerprint,
        );

        if (duplicateQueued) {
          const updatedItem: NotificationItem = {
            ...duplicateQueued,
            tone,
            title,
            message,
            durationMs: Math.max(duplicateQueued.durationMs, durationMs),
            updatedAt: now,
            occurrences: duplicateQueued.occurrences + 1,
          };

          targetId = updatedItem.id;
          targetDelayMs = updatedItem.durationMs;

          return {
            visible: current.visible,
            queued: current.queued.map((item) =>
              item.id === duplicateQueued.id ? updatedItem : item,
            ),
          };
        }

        const item: NotificationItem = {
          id: createNotificationId(),
          tone,
          title,
          message,
          durationMs,
          createdAt: now,
          updatedAt: now,
          fingerprint,
          occurrences: 1,
        };

        targetId = item.id;
        targetDelayMs = item.durationMs;

        if (current.visible.length < MAX_VISIBLE_NOTIFICATIONS) {
          shouldRunVisibleTimer = true;
          return {
            visible: [item, ...current.visible],
            queued: current.queued,
          };
        }

        const nextQueued = [...current.queued, item];
        while (
          current.visible.length + nextQueued.length >
          MAX_BUFFERED_NOTIFICATIONS
        ) {
          const droppedItem = nextQueued.shift();
          if (!droppedItem) {
            break;
          }

          droppedIds.push(droppedItem.id);
          droppedFingerprints.push(droppedItem.fingerprint);
        }

        return {
          visible: current.visible,
          queued: nextQueued,
        };
      });

      droppedIds.forEach((id) => {
        clearDismissTimer(id);
      });
      droppedFingerprints.forEach((itemFingerprint) => {
        rememberRecentFingerprint(itemFingerprint);
      });

      if (!targetId || !shouldRunVisibleTimer) {
        return targetId;
      }

      if (isExpanded) {
        setPausedDismissTimer(targetId, targetDelayMs);
      } else {
        scheduleDismiss(targetId, targetDelayMs);
      }

      return targetId;
    },
    [
      clearDismissTimer,
      isExpanded,
      isFingerprintCoolingDown,
      rememberRecentFingerprint,
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
    recentFingerprintCooldownRef.current.clear();
    visibleItemsRef.current = [];
    queuedItemsRef.current = [];
    setVisibleItems([]);
    setQueuedItems([]);
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

  const expanded = forceExpanded || isExpanded;
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
          onMouseEnter={() => setIsExpanded(true)}
          onMouseLeave={() => setIsExpanded(false)}
          onFocusCapture={() => setIsExpanded(true)}
          onBlurCapture={(event) => {
            const nextTarget = event.relatedTarget as Node | null;
            if (!trayRef.current?.contains(nextTarget)) {
              setIsExpanded(false);
            }
          }}
        >
          <div className="w-full">
            {expanded ? (
              <div className="flex w-full flex-col">
                <AnimatePresence initial={false}>
                  {renderedItems.map((item, index) => (
                    <NotificationCard
                      key={item.id}
                      item={item}
                      stackDepth={index}
                      expanded
                      onDismiss={dismiss}
                    />
                  ))}
                </AnimatePresence>
              </div>
            ) : (
              <div
                className="relative w-full"
                style={{
                  paddingTop: renderedItems.length > 1 ? COLLAPSED_STACK_TOP_PADDING_PX : 0,
                  minHeight: collapsedTrayHeight,
                }}
              >
                <AnimatePresence initial={false}>
                  {renderedItems.map((item, index) => (
                    <NotificationCard
                      key={item.id}
                      item={item}
                      stackDepth={index}
                      expanded={false}
                      onDismiss={dismiss}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
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
      message: normalizedMessage,
    });

    if (!enabled || previousFingerprintRef.current === fingerprint) {
      return;
    }

    previousFingerprintRef.current = fingerprint;

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
    options?.title,
    tone,
  ]);
}
