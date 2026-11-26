/**
 * Re-encrypts every stored secret (API keys and sub2api login passwords) under a new
 * ENCRYPT_SECRET, in one transaction.
 *
 *   OLD_ENCRYPT_SECRET=<old> NEW_ENCRYPT_SECRET=<new> npm run secret:rotate
 *   (add DRY_RUN=1 first to verify without writing)
 *
 * OLD_ENCRYPT_SECRET may be omitted when the old secret was the built-in default.
 * Every secret is decrypted and re-encrypted before anything is written; if any row fails to
 * decrypt, nothing is changed. Afterwards set ENCRYPT_SECRET=<new> and restart the app.
 */
import './load-env';
import type { RowDataPacket } from 'mysql2/promise';
import pool from '../lib/db';
import { decryptWith, deriveKey, encryptSecretProblem, encryptWith, LEGACY_SECRET } from '../lib/crypto';

/** Every encrypted column in `sites`, with a label for messages. */
const COLUMNS = [
  { column: 'api_key_encrypted', label: 'API Key' },
  { column: 'login_password_encrypted', label: 'sub2api 登录密码' },
] as const;

type Column = (typeof COLUMNS)[number]['column'];

interface Row extends RowDataPacket {
  id: number;
  name: string;
  api_key_encrypted: string | null;
  login_password_encrypted: string | null;
}

async function main() {
  const oldSecret = process.env.OLD_ENCRYPT_SECRET || LEGACY_SECRET;
  const newSecret = process.env.NEW_ENCRYPT_SECRET;

  const problem = encryptSecretProblem(newSecret);
  if (problem) throw new Error(`NEW_ENCRYPT_SECRET 不合格：${problem.replace('ENCRYPT_SECRET ', '')}`);
  if (newSecret === oldSecret) throw new Error('新旧密钥相同');

  const oldKey = deriveKey(oldSecret);
  const newKey = deriveKey(newSecret!);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<Row[]>(
      'SELECT id, name, api_key_encrypted, login_password_encrypted FROM sites WHERE api_key_encrypted IS NOT NULL OR login_password_encrypted IS NOT NULL FOR UPDATE'
    );

    const updates: Array<{ id: number; column: Column; value: string }> = [];
    for (const r of rows) {
      for (const { column, label } of COLUMNS) {
        const cipher = r[column];
        if (!cipher) continue;
        let plain: string;
        try {
          plain = decryptWith(oldKey, cipher);
        } catch {
          throw new Error(`站点 #${r.id} (${r.name}) 的 ${label} 无法用旧密钥解密，已中止，未做任何修改`);
        }
        const reenc = encryptWith(newKey, plain);
        if (decryptWith(newKey, reenc) !== plain) throw new Error(`站点 #${r.id} 的 ${label} 重新加密校验失败，已中止`);
        updates.push({ id: r.id, column, value: reenc });
      }
    }

    if (process.env.DRY_RUN === '1') {
      await conn.rollback();
      console.log(`✔ 演练通过：${updates.length} 个密文（API Key / 登录密码）都能用旧密钥解密并用新密钥重新加密。未写入任何修改。`);
      return;
    }

    for (const { id, column, value } of updates) {
      // column comes from the fixed COLUMNS list above, never from input
      await conn.query(`UPDATE sites SET \`${column}\` = ? WHERE id = ?`, [value, id]);
    }
    await conn.commit();
    console.log(`✔ 已用新密钥重新加密 ${updates.length} 个密文（API Key / 登录密码）。现在把 ENCRYPT_SECRET 改成新值并重启服务。`);
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

main()
  .catch((err) => {
    console.error('✖', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
