import { createHash, randomBytes } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import pool from '@/lib/db';
import {
  MAX_SESSIONS_PER_USER,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  SESSION_TOUCH_INTERVAL_MS,
} from './config';

/**
 * Server-side sessions.
 *
 * The cookie holds a 256-bit random token; the DB stores only its SHA-256 hash, so a leaked
 * database (or backup) can't be replayed as live sessions. Every request is checked against the
 * DB, which makes logout, password change and user disable take effect immediately.
 */

export interface SessionInfo {
  /** SHA-256 of the token; the DB primary key. Safe to log. */
  id: string;
  userId: number;
  username: string;
  createdAt: number;
  expiresAt: number;
}

interface SessionRow extends RowDataPacket {
  token_hash: string;
  user_id: number;
  created_at: number | string;
  last_seen_at: number | string;
  expires_at: number | string;
  username: string;
  is_active: number;
  password_changed_at: number | string;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes base64url

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  userId: number,
  ip: string,
  userAgent: string | null,
  now = Date.now()
): Promise<{ token: string; expiresAt: number }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = now + SESSION_ABSOLUTE_MS;

  await pool.query(
    `INSERT INTO admin_sessions (token_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [hashToken(token), userId, now, now, expiresAt, ip.slice(0, 64), userAgent ? userAgent.slice(0, 255) : null]
  );

  // Keep only the newest N sessions for this user.
  await pool.query(
    `DELETE FROM admin_sessions
      WHERE user_id = ?
        AND token_hash NOT IN (
          SELECT token_hash FROM (
            SELECT token_hash FROM admin_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
          ) AS keep
        )`,
    [userId, userId, MAX_SESSIONS_PER_USER]
  );

  return { token, expiresAt };
}

/** Pure validity rule, exported for tests. */
export function isSessionValid(
  s: { createdAt: number; lastSeenAt: number; expiresAt: number; isActive: boolean; passwordChangedAt: number },
  now: number
): boolean {
  if (!s.isActive) return false;
  if (now >= s.expiresAt) return false;
  if (now - s.lastSeenAt >= SESSION_IDLE_MS) return false;
  // Sessions created before the last password change are dead.
  if (s.passwordChangedAt > s.createdAt) return false;
  return true;
}

/**
 * Validates a raw cookie token. Returns null for anything invalid and deletes dead sessions.
 * Slides the idle timeout forward (written at most once per SESSION_TOUCH_INTERVAL_MS).
 */
export async function validateSessionToken(token: string | undefined | null, now = Date.now()): Promise<SessionInfo | null> {
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  const id = hashToken(token);

  const [rows] = await pool.query<SessionRow[]>(
    `SELECT s.token_hash, s.user_id, s.created_at, s.last_seen_at, s.expires_at,
            u.username, u.is_active, u.password_changed_at
       FROM admin_sessions s
       JOIN admin_users u ON u.id = s.user_id
      WHERE s.token_hash = ?
      LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row) return null;

  const createdAt = Number(row.created_at);
  const lastSeenAt = Number(row.last_seen_at);
  const expiresAt = Number(row.expires_at);

  const valid = isSessionValid(
    {
      createdAt,
      lastSeenAt,
      expiresAt,
      isActive: Boolean(row.is_active),
      passwordChangedAt: Number(row.password_changed_at),
    },
    now
  );

  if (!valid) {
    await pool.query('DELETE FROM admin_sessions WHERE token_hash = ?', [id]);
    return null;
  }

  if (now - lastSeenAt >= SESSION_TOUCH_INTERVAL_MS) {
    await pool.query('UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ?', [now, id]);
  }

  return { id, userId: row.user_id, username: row.username, createdAt, expiresAt };
}

export async function revokeSessionByToken(token: string | undefined | null): Promise<void> {
  if (!token || !TOKEN_PATTERN.test(token)) return;
  await pool.query('DELETE FROM admin_sessions WHERE token_hash = ?', [hashToken(token)]);
}

export async function revokeAllSessionsForUser(userId: number): Promise<number> {
  const [result] = (await pool.query('DELETE FROM admin_sessions WHERE user_id = ?', [userId])) as unknown as [
    { affectedRows: number },
  ];
  return result.affectedRows;
}

/** Housekeeping: drop sessions that can no longer be valid. */
export async function pruneSessions(now = Date.now()): Promise<void> {
  await pool.query('DELETE FROM admin_sessions WHERE expires_at <= ? OR last_seen_at <= ?', [now, now - SESSION_IDLE_MS]);
}
