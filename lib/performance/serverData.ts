type DeadlineResult<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; timedOut: true };

export function withServerDeadline<TValue>(
  promise: Promise<TValue>,
  timeoutMs: number,
): Promise<DeadlineResult<TValue>> {
  let timeout: NodeJS.Timeout | null = null;

  return Promise.race([
    promise
      .then((value) => ({ ok: true as const, value }))
      .catch(() => ({ ok: false as const, timedOut: true as const })),
    new Promise<DeadlineResult<TValue>>((resolve) => {
      timeout = setTimeout(
        () => resolve({ ok: false, timedOut: true }),
        Math.max(1, timeoutMs),
      );
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}
