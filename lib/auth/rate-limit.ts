import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import pool from '@/lib/db';
import type { RateLimitPolicy } from './config';
import {
  EMPTY_BUCKET,
  isLocked,
  reserveAttempt,
  retryAfterSeconds,
  type BucketState,
} from './rate-limit-policy';

/**
 * MySQL-backed storage for the rate-limit state machine in rate-limit-policy.ts.
 * Rows are locked with SELECT ... FOR UPDATE so concurrent requests can't race past the limit.
 */

interface BucketRow extends RowDataPacket {
  attempt_count: number;
  window_start: number | string;
  locked_until: number | string;
  lock_level: number;
  last_attempt_at: number | string;
}

export interface BucketSpec {
  key: string;
  policy: RateLimitPolicy;
}

export type ReserveResult = { allowed: true } | { allowed: false; retryAfter: number; key: string };

function rowToState(row: BucketRow | undefined): BucketState {
  if (!row) return { ...EMPTY_BUCKET };
  return {
    attemptCount: Number(row.attempt_count),
    windowStart: Number(row.window_start),
    lockedUntil: Number(row.locked_until),
    lockLevel: Number(row.lock_level),
    lastAttemptAt: Number(row.last_attempt_at),
  };
}

async function loadForUpdate(conn: PoolConnection, key: string): Promise<BucketState> {
  await conn.query('INSERT IGNORE INTO auth_rate_limits (bucket_key) VALUES (?)', [key]);
  const [rows] = await conn.query<BucketRow[]>(
    'SELECT attempt_count, window_start, locked_until, lock_level, last_attempt_at FROM auth_rate_limits WHERE bucket_key = ? FOR UPDATE',
    [key]
  );
  return rowToState(rows[0]);
}

async function save(conn: PoolConnection, key: string, s: BucketState): Promise<void> {
  await conn.query(
    `UPDATE auth_rate_limits
        SET attempt_count = ?, window_start = ?, locked_until = ?, lock_level = ?, last_attempt_at = ?
      WHERE bucket_key = ?`,
    [s.attemptCount, s.windowStart, s.lockedUntil, s.lockLevel, s.lastAttemptAt, key]
  );
}

/**
 * Atomically reserves one attempt in every bucket. If any bucket is locked nothing is consumed.
 * Buckets are locked in sorted key order to avoid deadlocks between concurrent requests.
 */
export async function reserveAttempts(buckets: BucketSpec[], now = Date.now()): Promise<ReserveResult> {
  const sorted = [...buckets].sort((a, b) => a.key.localeCompare(b.key));
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const states = [];
    for (const b of sorted) states.push(await loadForUpdate(conn, b.key));

    for (let i = 0; i < sorted.length; i++) {
      if (isLocked(states[i], now)) {
        await conn.commit();
        return { allowed: false, retryAfter: retryAfterSeconds(states[i], now), key: sorted[i].key };
      }
    }

    for (let i = 0; i < sorted.length; i++) {
      const { state } = reserveAttempt(states[i], now, sorted[i].policy);
      await save(conn, sorted[i].key, state);
    }
    await conn.commit();
    return { allowed: true };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Clears buckets after a successful login. */
export async function clearBuckets(keys: string[]): Promise<void> {
  if (!keys.length) return;
  await pool.query('DELETE FROM auth_rate_limits WHERE bucket_key IN (?)', [keys]);
}

/** Housekeeping: drop rows idle for more than 2 days and not locked. */
export async function pruneBuckets(now = Date.now()): Promise<void> {
  const cutoff = now - 2 * 24 * 60 * 60 * 1000;
  await pool.query('DELETE FROM auth_rate_limits WHERE last_attempt_at < ? AND locked_until < ?', [cutoff, now]);
}

export function ipBucketKey(ip: string): string {
  return `ip:${ip}`;
}

export function userBucketKey(username: string): string {
  return `user:${username.toLowerCase()}`;
}
