import pool from '@/lib/db';

export type AuditEvent =
  | 'login_success'
  | 'login_failed'
  | 'login_blocked'
  | 'logout'
  | 'session_revoked'
  | 'user_created'
  | 'password_changed'
  | 'user_disabled'
  | 'user_enabled';

export interface AuditEntry {
  event: AuditEvent;
  userId?: number | null;
  username?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  detail?: string | null;
}

/** Append-only security audit log. Never throws: auditing must not break the request. */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO auth_audit_log (event, user_id, username_attempted, ip, user_agent, detail)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        entry.event,
        entry.userId ?? null,
        entry.username ? entry.username.slice(0, 64) : null,
        entry.ip ? entry.ip.slice(0, 64) : null,
        entry.userAgent ? entry.userAgent.slice(0, 255) : null,
        entry.detail ? entry.detail.slice(0, 255) : null,
      ]
    );
  } catch (err) {
    console.error('[audit] failed to write audit log:', err instanceof Error ? err.message : err);
  }
}
