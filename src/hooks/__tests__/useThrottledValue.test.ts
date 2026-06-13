import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThrottledValue } from '../useThrottledValue';

describe('useThrottledValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes the value through unthrottled when interval is 0', () => {
    const { result, rerender } = renderHook(({ value }) => useThrottledValue(value, 0), { initialProps: { value: 'a' } });
    expect(result.current).toBe('a');

    rerender({ value: 'b' });
    expect(result.current).toBe('b');
  });

  it('suppresses intermediate values within the throttle window', () => {
    const { result, rerender } = renderHook(({ value }) => useThrottledValue(value, 150), { initialProps: { value: 'v1' } });

    // First change inside the window is deferred
    act(() => {
      vi.advanceTimersByTime(50);
    });
    rerender({ value: 'v2' });
    expect(result.current).toBe('v1');

    rerender({ value: 'v3' });
    expect(result.current).toBe('v1');
  });

  it('emits the latest value on the trailing edge', () => {
    const { result, rerender } = renderHook(({ value }) => useThrottledValue(value, 150), { initialProps: { value: 'v1' } });

    rerender({ value: 'v2' });
    rerender({ value: 'v3' });
    expect(result.current).toBe('v1');

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe('v3');
  });

  it('emits immediately once the interval has elapsed since the last emit', () => {
    const { result, rerender } = renderHook(({ value }) => useThrottledValue(value, 150), { initialProps: { value: 'v1' } });

    act(() => {
      vi.advanceTimersByTime(300);
    });
    rerender({ value: 'v2' });
    expect(result.current).toBe('v2');
  });
});
