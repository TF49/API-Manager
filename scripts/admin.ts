/**
 * Admin account management CLI. There is no sign-up page by design: accounts are created here,
 * on the server, by someone with shell + DB access.
 *
 *   npm run user:create  -- <username>
 *   npm run user:passwd  -- <username>     (also logs out all of that user's sessions)
 *   npm run user:disable -- <username>     (also logs out all of that user's sessions)
 *   npm run user:enable  -- <username>
 *   npm run user:list
 *   npm run sessions:revoke -- <username>
 *   npm run auth:unlock  -- [ip:<addr> | user:<name>]   (no argument = clear all login locks)
 *
 * Passwords are read from a hidden prompt (or stdin when piped), never from argv,
 * so they don't end up in shell history or the process list.
 */
import './load-env';
import readline from 'node:readline';
import type { RowDataPacket } from 'mysql2/promise';
import pool from '../lib/db';
import { audit } from '../lib/auth/audit';
import { USERNAME_PATTERN } from '../lib/auth/config';
import { hashPassword, passwordPolicyError } from '../lib/auth/password';
import { revokeAllSessionsForUser } from '../lib/auth/session';

function fail(msg: string): never {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

let pipedLines: string[] | null = null;

async function readPipedLine(): Promise<string> {
  if (!pipedLines) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    pipedLines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
  }
  return pipedLines.shift() ?? '';
}

function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) return readPipedLine();
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let muted = false;
    out._writeToOutput = (s: string) => {
      if (!muted) process.stdout.write(s);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function promptNewPassword(): Promise<string> {
  const pw = await readHidden('新密码: ');
  const problem = passwordPolicyError(pw);
  if (problem) fail(problem);
  if (process.stdin.isTTY) {
    const again = await readHidden('再次输入: ');
    if (again !== pw) fail('两次输入的密码不一致');
  }
  return pw;
}

interface UserRow extends RowDataPacket {
  id: number;
  username: string;
  is_active: number;
  last_login_at: number | null;
  last_login_ip: string | null;
  created_at: Date;
}

async function requireUser(username: string | undefined): Promise<UserRow> {
  if (!username) fail('请提供用户名');
  const [rows] = await pool.query<UserRow[]>(
    'SELECT id, username, is_active, last_login_at, last_login_ip, created_at FROM admin_users WHERE username = ?',
    [username]
  );
  if (!rows[0]) fail(`用户 ${username} 不存在`);
  return rows[0];
}

async function main() {
  const [command, arg] = process.argv.slice(2);

  switch (command) {
    case 'user:create': {
      if (!arg || !USERNAME_PATTERN.test(arg)) fail('用户名只能包含字母、数字、_ . -，长度 1-64');
      const [exists] = await pool.query<RowDataPacket[]>('SELECT id FROM admin_users WHERE username = ?', [arg]);
      if (exists.length) fail(`用户 ${arg} 已存在`);
      const hash = await hashPassword(await promptNewPassword());
      const [result] = (await pool.query(
        'INSERT INTO admin_users (username, password_hash, password_changed_at) VALUES (?, ?, ?)',
        [arg, hash, Date.now()]
      )) as unknown as [{ insertId: number }];
      await audit({ event: 'user_created', userId: result.insertId, username: arg, detail: 'cli' });
      console.log(`✔ 已创建管理员 ${arg}`);
      break;
    }

    case 'user:passwd': {
      const user = await requireUser(arg);
      const hash = await hashPassword(await promptNewPassword());
      await pool.query('UPDATE admin_users SET password_hash = ?, password_changed_at = ? WHERE id = ?', [
        hash,
        Date.now(),
        user.id,
      ]);
      const n = await revokeAllSessionsForUser(user.id);
      await audit({ event: 'password_changed', userId: user.id, username: user.username, detail: 'cli' });
      console.log(`✔ 已修改 ${user.username} 的密码，并注销了 ${n} 个会话`);
      break;
    }

    case 'user:disable':
    case 'user:enable': {
      const user = await requireUser(arg);
      const enable = command === 'user:enable';
      await pool.query('UPDATE admin_users SET is_active = ? WHERE id = ?', [enable ? 1 : 0, user.id]);
      const n = enable ? 0 : await revokeAllSessionsForUser(user.id);
      await audit({ event: enable ? 'user_enabled' : 'user_disabled', userId: user.id, username: user.username, detail: 'cli' });
      console.log(enable ? `✔ 已启用 ${user.username}` : `✔ 已禁用 ${user.username}，并注销了 ${n} 个会话`);
      break;
    }

    case 'user:list': {
      const [rows] = await pool.query<UserRow[]>(
        'SELECT id, username, is_active, last_login_at, last_login_ip, created_at FROM admin_users ORDER BY id'
      );
      if (!rows.length) console.log('（还没有管理员，用 npm run user:create -- <用户名> 创建）');
      for (const r of rows) {
        const last = r.last_login_at ? new Date(Number(r.last_login_at)).toLocaleString() : '从未登录';
        console.log(`${r.id}\t${r.username}\t${r.is_active ? '启用' : '禁用'}\t最后登录: ${last} ${r.last_login_ip ?? ''}`);
      }
      break;
    }

    case 'sessions:revoke': {
      const user = await requireUser(arg);
      const n = await revokeAllSessionsForUser(user.id);
      await audit({ event: 'session_revoked', userId: user.id, username: user.username, detail: `cli all (${n})` });
      console.log(`✔ 已注销 ${user.username} 的 ${n} 个会话`);
      break;
    }

    case 'auth:unlock': {
      const [result] = (arg
        ? await pool.query('DELETE FROM auth_rate_limits WHERE bucket_key = ?', [arg])
        : await pool.query('DELETE FROM auth_rate_limits')) as unknown as [{ affectedRows: number }];
      console.log(`✔ 已清除 ${result.affectedRows} 条登录限流记录`);
      break;
    }

    default:
      console.log(
        [
          '用法:',
          '  npm run user:create  -- <用户名>',
          '  npm run user:passwd  -- <用户名>',
          '  npm run user:disable -- <用户名>',
          '  npm run user:enable  -- <用户名>',
          '  npm run user:list',
          '  npm run sessions:revoke -- <用户名>',
          '  npm run auth:unlock  -- [ip:<地址> | user:<用户名>]',
        ].join('\n')
      );
      if (command) process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('✖', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
