/**
 * Re-encrypts every stored API key under a new ENCRYPT_SECRET, in one transaction.
 *
 *   OLD_ENCRYPT_SECRET=<old> NEW_ENCRYPT_SECRET=<new> npm run secret:rotate
 *   (add DRY_RUN=1 first to verify without writing)
 *
 * OLD_ENCRYPT_SECRET may be omitted when the old secret was the built-in default.
 * Every key is decrypted and re-encrypted before anything is written; if any row fails to
 * decrypt, nothing is changed. Afterwards set ENCRYPT_SECRET=<new> and restart the app.
 */
import './load-env';
import type { RowDataPacket } from 'mysql2/promise';
import pool from '../lib/db';
import { decryptWith, deriveKey, encryptSecretProblem, encryptWith, LEGACY_SECRET } from '../lib/crypto';

interface Row extends RowDataPacket {
  id: number;
  name: string;
  api_key_encrypted: string;
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
    const [rows] = await conn.query<Row[]>('SELECT id, name, api_key_encrypted FROM sites FOR UPDATE');

    const updates: Array<[string, number]> = [];
    for (const r of rows) {
      let plain: string;
      try {
        plain = decryptWith(oldKey, r.api_key_encrypted);
      } catch {
        throw new Error(`站点 #${r.id} (${r.name}) 无法用旧密钥解密，已中止，未做任何修改`);
      }
      const reenc = encryptWith(newKey, plain);
      if (decryptWith(newKey, reenc) !== plain) throw new Error(`站点 #${r.id} 重新加密校验失败，已中止`);
      updates.push([reenc, r.id]);
    }

    if (process.env.DRY_RUN === '1') {
      await conn.rollback();
      console.log(`✔ 演练通过：${updates.length} 个 API Key 都能用旧密钥解密并用新密钥重新加密。未写入任何修改。`);
      return;
    }

    for (const [enc, id] of updates) {
      await conn.query('UPDATE sites SET api_key_encrypted = ? WHERE id = ?', [enc, id]);
    }
    await conn.commit();
    console.log(`✔ 已用新密钥重新加密 ${updates.length} 个 API Key。现在把 ENCRYPT_SECRET 改成新值并重启服务。`);
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
