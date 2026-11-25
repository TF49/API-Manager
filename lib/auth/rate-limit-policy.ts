import type { RateLimitPolicy } from './config';

/**
 * Pure state machine for login rate limiting. No I/O, so it is unit-testable.
 *
 * Attempts are *reserved* before the password is checked: a burst of parallel requests
 * can't all slip through while the first ones are still being verified.
 */
export interface BucketState {
  attemptCount: number;
  windowStart: number; // epoch ms
  lockedUntil: number; // epoch ms, 0 = not locked
  lockLevel: number;
  lastAttemptAt: number; // epoch ms, 0 = never
}

export const EMPTY_BUCKET: BucketState = {
  attemptCount: 0,
  windowStart: 0,
  lockedUntil: 0,
  lockLevel: 0,
  lastAttemptAt: 0,
};

export function isLocked(state: BucketState, now: number): boolean {
  return state.lockedUntil > now;
}

export function retryAfterSeconds(state: BucketState, now: number): number {
  return Math.max(1, Math.ceil((state.lockedUntil - now) / 1000));
}

export function lockDurationMs(level: number, policy: RateLimitPolicy): number {
  if (level <= 0) return 0;
  const ms = policy.baseLockMs * 2 ** (level - 1);
  return Math.min(ms, policy.maxLockMs);
}

/**
 * Reserve one attempt. Returns the new state and whether the attempt is allowed.
 * The attempt that reaches `maxAttempts` is still allowed, but it locks the bucket
 * for everything that comes after it.
 */
export function reserveAttempt(
  state: BucketState,
  now: number,
  policy: RateLimitPolicy
): { allowed: boolean; state: BucketState } {
  if (isLocked(state, now)) {
    return { allowed: false, state };
  }

  let { attemptCount, windowStart, lockLevel } = state;

  if (state.lastAttemptAt && now - state.lastAttemptAt > policy.decayMs) {
    lockLevel = 0;
  }
  if (!windowStart || now - windowStart >= policy.windowMs) {
    attemptCount = 0;
    windowStart = now;
  }

  attemptCount += 1;
  let lockedUntil = 0;

  if (attemptCount >= policy.maxAttempts) {
    lockLevel += 1;
    lockedUntil = now + lockDurationMs(lockLevel, policy);
    attemptCount = 0;
    windowStart = now;
  }

  return {
    allowed: true,
    state: { attemptCount, windowStart, lockedUntil, lockLevel, lastAttemptAt: now },
  };
}

/** Successful login: clear counters and any lock this burst caused, keep nothing. */
export function resetOnSuccess(): BucketState {
  return { ...EMPTY_BUCKET };
}
