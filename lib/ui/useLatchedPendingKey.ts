"use client";

import { useEffect, useRef, useState } from "react";

type UseLatchedPendingKeyInput = {
  pendingKey: string | null;
  resolvedKey: string;
  minDurationMs?: number;
};

export function useLatchedPendingKey({
  pendingKey,
  resolvedKey,
  minDurationMs = 180,
}: UseLatchedPendingKeyInput) {
  const [latchedKey, setLatchedKey] = useState<string | null>(null);
  const startedAtRef = useRef(0);

  useEffect(() => {
    if (pendingKey && pendingKey !== resolvedKey) {
      startedAtRef.current = Date.now();
      const frameId = window.requestAnimationFrame(() => {
        setLatchedKey((current) => (current === pendingKey ? current : pendingKey));
      });

      return () => {
        window.cancelAnimationFrame(frameId);
      };
    }

    if (!latchedKey || latchedKey !== resolvedKey) {
      return;
    }

    const elapsed = Date.now() - startedAtRef.current;
    const remaining = Math.max(0, minDurationMs - elapsed);
    const timeoutId = window.setTimeout(() => {
      setLatchedKey(null);
    }, remaining);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [latchedKey, minDurationMs, pendingKey, resolvedKey]);

  return latchedKey;
}
