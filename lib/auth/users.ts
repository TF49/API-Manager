import type { RowDataPacket } from 'mysql2/promise';
import pool from '@/lib/db';

export interface AdminUser {
  id: number;
  username: string;
  passwordHash: string;
  isActive: boolean;
  passwordChangedAt: number;
}

interface UserRow extends RowDataPacket {
  id: number;
  username: string;
  password_hash: string;
  is_active: number;
  password_changed_at: number | string;
}

function toUser(r: UserRow): AdminUser {
  return {
    id: r.id,
    username: r.username,
    passwordHash: r.password_hash,
    isActive: Boolean(r.is_active),
    passwordChangedAt: Number(r.password_changed_at),
  };
}

/** Case-insensitive lookup (column uses a case-insensitive collation). */
export async function findUserByUsername(username: string): Promise<AdminUser | null> {
  const [rows] = await pool.query<UserRow[]>(
    'SELECT id, username, password_hash, is_active, password_changed_at FROM admin_users WHERE username = ? LIMIT 1',
    [username]
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export async function recordLogin(userId: number, ip: string): Promise<void> {
  await pool.query('UPDATE admin_users SET last_login_at = ?, last_login_ip = ? WHERE id = ?', [Date.now(), ip, userId]);
}
