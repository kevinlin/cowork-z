import { useEffect, useRef, useState } from 'react';

/**
 * Throttle a rapidly-changing value: re-emit at most once per `intervalMs`,
 * with a trailing update so the final value is always delivered after the
 * source stops changing. With `intervalMs <= 0` the value passes through
 * unthrottled.
 *
 * Used to bound expensive derived work (markdown parsing) during streaming,
 * where deltas can arrive far faster than a human can read
 * (2026-06-12 review #12).
 */
export function useThrottledValue<T>(value: T, intervalMs: number): T {
  const [throttled, setThrottled] = useState(value);
  const lastEmitRef = useRef(0);
  const trailingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestValueRef = useRef(value);
  latestValueRef.current = value;

  useEffect(() => {
    // Passthrough mode: the return below already yields `value` directly, so
    // `throttled` is never read here — skip the wasted state update/re-render.
    if (intervalMs <= 0) {
      return;
    }

    const elapsed = Date.now() - lastEmitRef.current;
    if (elapsed >= intervalMs) {
      lastEmitRef.current = Date.now();
      setThrottled(value);
      return;
    }

    // Within the throttle window — schedule a single trailing emit that
    // reads the latest value when it fires.
    if (trailingTimerRef.current !== null) return;
    trailingTimerRef.current = setTimeout(() => {
      trailingTimerRef.current = null;
      lastEmitRef.current = Date.now();
      setThrottled(latestValueRef.current);
    }, intervalMs - elapsed);
  }, [value, intervalMs]);

  useEffect(
    () => () => {
      if (trailingTimerRef.current !== null) {
        clearTimeout(trailingTimerRef.current);
      }
    },
    []
  );

  return intervalMs <= 0 ? value : throttled;
}
