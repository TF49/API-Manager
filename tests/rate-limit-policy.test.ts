import { describe, expect, it } from 'vitest';
import type { RateLimitPolicy } from '@/lib/auth/config';
import {
  EMPTY_BUCKET,
  isLocked,
  lockDurationMs,
  reserveAttempt,
  retryAfterSeconds,
  type BucketState,
} from '@/lib/auth/rate-limit-policy';

const MIN = 60_000;
const policy: RateLimitPolicy = {
  maxAttempts: 5,
  windowMs: 15 * MIN,
  baseLockMs: 15 * MIN,
  maxLockMs: 60 * MIN,
  decayMs: 24 * 60 * MIN,
};

function attempts(n: number, start: BucketState, now: number) {
  let state = start;
  const allowed: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const r = reserveAttempt(state, now, policy);
    allowed.push(r.allowed);
    state = r.state;
  }
  return { state, allowed };
}

describe('rate limit policy', () => {
  it('allows exactly maxAttempts in a window, then locks', () => {
    const now = 1_000_000;
    const { state, allowed } = attempts(7, { ...EMPTY_BUCKET }, now);
    expect(allowed).toEqual([true, true, true, true, true, false, false]);
    expect(isLocked(state, now)).toBe(true);
    expect(state.lockedUntil).toBe(now + 15 * MIN);
    expect(retryAfterSeconds(state, now)).toBe(15 * 60);
  });

  it('unlocks after the lock expires', () => {
    const now = 1_000_000;
    const { state } = attempts(5, { ...EMPTY_BUCKET }, now);
    const later = now + 15 * MIN;
    expect(isLocked(state, later)).toBe(false);
    expect(reserveAttempt(state, later, policy).allowed).toBe(true);
  });

  it('doubles the lock on each consecutive lockout, capped at maxLockMs', () => {
    expect(lockDurationMs(1, policy)).toBe(15 * MIN);
    expect(lockDurationMs(2, policy)).toBe(30 * MIN);
    expect(lockDurationMs(3, policy)).toBe(60 * MIN);
    expect(lockDurationMs(10, policy)).toBe(60 * MIN);

    let now = 1_000_000;
    let { state } = attempts(5, { ...EMPTY_BUCKET }, now);
    now = state.lockedUntil;
    ({ state } = attempts(5, state, now));
    expect(state.lockLevel).toBe(2);
    expect(state.lockedUntil - now).toBe(30 * MIN);
  });

  it('resets the attempt counter when the window passes', () => {
    const now = 1_000_000;
    const { state } = attempts(4, { ...EMPTY_BUCKET }, now);
    const r = reserveAttempt(state, now + 16 * MIN, policy);
    expect(r.state.attemptCount).toBe(1);
    expect(isLocked(r.state, now + 16 * MIN)).toBe(false);
  });

  it('forgets lock escalation after the decay period', () => {
    const now = 1_000_000;
    const { state } = attempts(5, { ...EMPTY_BUCKET }, now);
    expect(state.lockLevel).toBe(1);
    const muchLater = now + 25 * 60 * MIN;
    const r = attempts(5, state, muchLater);
    expect(r.state.lockLevel).toBe(1);
  });
});
