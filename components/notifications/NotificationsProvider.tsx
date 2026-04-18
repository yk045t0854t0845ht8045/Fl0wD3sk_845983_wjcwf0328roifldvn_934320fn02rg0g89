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

const MAX_VISIBLE_NOTIFICATIONS = 3;
const DEFAULT_NOTIFICATION_DURATION_MS = 5200;
const MINIMUM_RESUME_DURATION_MS = 180;

const NotificationContext = createContext<NotificationApi | null>(null);

function createNotificationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `flowdesk-notification-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function resolveToneClasses(tone: NotificationTone) {
  if (tone === "success") {
    return {
      borderGlowClassName: "flowdesk-tag-border-glow-success",
      borderCoreClassName: "flowdesk-tag-border-core-success",
      iconWrapperClassName:
        "border-[rgba(106,226,90,0.18)] bg-[rgba(106,226,90,0.08)] text-[#B8F2AE]",
      titleClassName: "text-[#DDF8D8]",
      messageClassName: "text-[#A9D2A2]",
      closeButtonClassName:
        "text-[#87C67E] hover:border-[rgba(106,226,90,0.18)] hover:bg-[rgba(106,226,90,0.08)] hover:text-[#DDF8D8]",
      progressClassName: "from-[rgba(171,255,162,0.85)] via-[rgba(106,226,90,0.62)] to-[rgba(106,226,90,0)]",
    };
  }

  if (tone === "error") {
    return {
      borderGlowClassName: "flowdesk-tag-border-glow-danger",
      borderCoreClassName: "flowdesk-tag-border-core-danger",
      iconWrapperClassName:
        "border-[rgba(219,70,70,0.18)] bg-[rgba(219,70,70,0.08)] text-[#FFB4B4]",
      titleClassName: "text-[#FFD5D5]",
      messageClassName: "text-[#D4A5A5]",
      closeButtonClassName:
        "text-[#D18D8D] hover:border-[rgba(219,70,70,0.18)] hover:bg-[rgba(219,70,70,0.08)] hover:text-[#FFD5D5]",
      progressClassName: "from-[rgba(255,126,126,0.85)] via-[rgba(219,70,70,0.62)] to-[rgba(219,70,70,0)]",
    };
  }

  return {
    borderGlowClassName: "flowdesk-tag-border-glow",
    borderCoreClassName: "flowdesk-tag-border-core",
    iconWrapperClassName:
      "border-[rgba(255,255,255,0.11)] bg-[rgba(255,255,255,0.05)] text-[#F2F2F2]",
    titleClassName: "text-[#F2F2F2]",
    messageClassName: "text-[#B8B8B8]",
    closeButtonClassName:
      "text-[#8E8E8E] hover:border-[rgba(255,255,255,0.11)] hover:bg-[rgba(255,255,255,0.05)] hover:text-[#F2F2F2]",
    progressClassName: "from-[rgba(255,255,255,0.82)] via-[rgba(255,255,255,0.48)] to-[rgba(255,255,255,0)]",
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
  const compactScale = Math.max(0.9, 1 - stackDepth * 0.04);
  const compactOpacity = Math.max(0.52, 1 - stackDepth * 0.12);
  const compactTranslateY = stackDepth * 10;
  const compactBlur = stackDepth > 1 ? 0.8 : 0;

  return (
    <motion.div
      layout
      initial={{
        opacity: 0,
        y: 36,
        scale: 0.96,
        filter: "blur(10px)",
      }}
      animate={{
        opacity: expanded ? 1 : compactOpacity,
        y: expanded ? 0 : compactTranslateY,
        scale: expanded ? 1 : compactScale,
        filter: expanded ? "blur(0px)" : `blur(${compactBlur}px)`,
      }}
      exit={{
        opacity: 0,
        x: 84,
        y: 18,
        scale: 0.94,
        filter: "blur(10px)",
      }}
      transition={{
        layout: {
          duration: 0.28,
          ease: [0.22, 1, 0.36, 1],
        },
        opacity: {
          duration: 0.22,
          ease: [0.22, 1, 0.36, 1],
        },
        y: {
          duration: 0.26,
          ease: [0.22, 1, 0.36, 1],
        },
        scale: {
          duration: 0.24,
          ease: [0.22, 1, 0.36, 1],
        },
        filter: {
          duration: 0.22,
          ease: [0.22, 1, 0.36, 1],
        },
      }}
      style={{
        zIndex: 100 + stackDepth,
        marginTop: expanded || stackDepth === 0 ? 0 : -84,
        transformOrigin: "bottom right",
      }}
      className="w-full"
    >
      <div
        role={item.tone === "error" ? "alert" : "status"}
        aria-live={item.tone === "error" ? "assertive" : "polite"}
        className="relative overflow-hidden rounded-[24px] shadow-[0_28px_90px_rgba(0,0,0,0.56)]"
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
          className="pointer-events-none absolute inset-[1px] rounded-[23px] bg-[linear-gradient(180deg,rgba(8,8,8,0.985)_0%,rgba(4,4,4,0.985)_100%)]"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[1px] top-[1px] h-[88px] rounded-t-[23px] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0.015)_36%,transparent_78%)]"
        />
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-[18px] bottom-[1px] h-[2px] rounded-full bg-gradient-to-r ${toneClasses.progressClassName}`}
        />

        <div className="relative z-10 flex min-h-[92px] items-start gap-[14px] px-[16px] py-[16px] pr-[56px]">
          <span
            className={`mt-[1px] flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[13px] border ${toneClasses.iconWrapperClassName}`}
            aria-hidden="true"
          >
            <Icon className="h-[19px] w-[19px]" strokeWidth={2.1} />
          </span>

          <div className="min-w-0 flex-1">
            {item.title ? (
              <p className={`text-[14px] font-semibold tracking-[-0.02em] ${toneClasses.titleClassName}`}>
                {item.title}
              </p>
            ) : null}
            <p
              className={`${
                item.title ? "mt-[4px] text-[13px]" : "text-[14px]"
              } leading-[1.55] tracking-[-0.01em] ${toneClasses.messageClassName}`}
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
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [forceExpanded, setForceExpanded] = useState(false);
  const trayRef = useRef<HTMLDivElement | null>(null);
  const dismissTimerMapRef = useRef<Map<string, DismissTimerMeta>>(new Map());

  const clearDismissTimer = useCallback((id: string) => {
    const meta = dismissTimerMapRef.current.get(id);
    if (!meta) return;

    if (meta.timeoutId !== null) {
      window.clearTimeout(meta.timeoutId);
    }

    dismissTimerMapRef.current.delete(id);
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      clearDismissTimer(id);
      setItems((current) => current.filter((item) => item.id !== id));
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
        dismiss(id);
      }, nextDelayMs);

      dismissTimerMapRef.current.set(id, {
        timeoutId,
        startedAt,
        remainingMs: nextDelayMs,
      });
    },
    [clearDismissTimer, dismiss],
  );

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
    if (forceExpanded || isExpanded) {
      pauseAllDismissTimers();
      return;
    }

    resumeAllDismissTimers();
  }, [forceExpanded, isExpanded, pauseAllDismissTimers, resumeAllDismissTimers]);

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

      const item: NotificationItem = {
        id: createNotificationId(),
        tone: payload.tone || "default",
        title:
          typeof payload.title === "string" && payload.title.trim()
            ? payload.title.trim()
            : null,
        message,
        durationMs: Math.max(
          MINIMUM_RESUME_DURATION_MS,
          Math.trunc(payload.durationMs || DEFAULT_NOTIFICATION_DURATION_MS),
        ),
        createdAt: Date.now(),
      };

      let overflowId: string | null = null;

      setItems((current) => {
        const next = [...current, item];
        if (next.length > MAX_VISIBLE_NOTIFICATIONS) {
          overflowId = next[0]?.id || null;
          return next.slice(-MAX_VISIBLE_NOTIFICATIONS);
        }

        return next;
      });

      if (overflowId) {
        clearDismissTimer(overflowId);
      }

      if (forceExpanded || isExpanded) {
        dismissTimerMapRef.current.set(item.id, {
          timeoutId: null,
          startedAt: Date.now(),
          remainingMs: item.durationMs,
        });
      } else {
        scheduleDismiss(item.id, item.durationMs);
      }

      return item.id;
    },
    [clearDismissTimer, forceExpanded, isExpanded, scheduleDismiss],
  );

  const clear = useCallback(() => {
    dismissTimerMapRef.current.forEach((meta) => {
      if (meta.timeoutId !== null) {
        window.clearTimeout(meta.timeoutId);
      }
    });
    dismissTimerMapRef.current.clear();
    setItems([]);
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
          <div className="flex w-full flex-col">
            <AnimatePresence initial={false}>
              {items.map((item, index) => {
                const stackDepth = items.length - 1 - index;

                return (
                  <NotificationCard
                    key={item.id}
                    item={item}
                    stackDepth={stackDepth}
                    expanded={expanded}
                    onDismiss={dismiss}
                  />
                );
              })}
            </AnimatePresence>
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
  const previousMessageRef = useRef<string | null>(null);
  const tone = options?.tone || "default";
  const enabled = options?.enabled ?? true;

  useEffect(() => {
    const normalizedMessage =
      typeof message === "string" && message.trim() ? message.trim() : null;

    if (!normalizedMessage) {
      previousMessageRef.current = null;
      return;
    }

    if (!enabled || previousMessageRef.current === normalizedMessage) {
      return;
    }

    previousMessageRef.current = normalizedMessage;

    if (tone === "success") {
      notifications.success(normalizedMessage, {
        title: options?.title,
        durationMs: options?.durationMs,
      });
      return;
    }

    if (tone === "error") {
      notifications.error(normalizedMessage, {
        title: options?.title,
        durationMs: options?.durationMs,
      });
      return;
    }

    notifications.show(normalizedMessage, {
      tone,
      title: options?.title,
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
