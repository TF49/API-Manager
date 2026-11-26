import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const LEGACY_DEFAULT_SECRET = 'api-manager-secret-key-change-me';
export const MIN_SECRET_LENGTH = 32;

/** Returns a human-readable problem with ENCRYPT_SECRET, or null if it is acceptable. */
export function encryptSecretProblem(secret = process.env.ENCRYPT_SECRET): string | null {
  if (!secret) return 'ENCRYPT_SECRET 未设置';
  if (secret === LEGACY_DEFAULT_SECRET) return 'ENCRYPT_SECRET 仍是默认值，必须替换';
  if (secret.length < MIN_SECRET_LENGTH) return `ENCRYPT_SECRET 长度至少 ${MIN_SECRET_LENGTH} 位`;
  return null;
}

let cachedKey: Buffer | null = null;

/**
 * Derived lazily so `next build` can import this module without the secret.
 * In production a missing/weak secret throws instead of silently using a known default.
 * (Key derivation is unchanged, so existing ciphertexts keep decrypting.)
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const problem = encryptSecretProblem();
  if (problem && process.env.NODE_ENV === 'production') {
    throw new Error(`加密配置错误：${problem}`);
  }
  if (problem) {
    console.warn(`[crypto] ${problem}（开发环境暂时允许，生产环境会拒绝启动）`);
  }
  const secret = process.env.ENCRYPT_SECRET || LEGACY_DEFAULT_SECRET;
  cachedKey = crypto.scryptSync(secret, 'salt', 32);
  return cachedKey;
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decrypt(cipherText: string): string {
  const [ivHex, encHex] = cipherText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const enc = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/** Explicit-secret variants, used only by the key-rotation script. */
export function deriveKey(secret: string): Buffer {
  return crypto.scryptSync(secret, 'salt', 32);
}

export function encryptWith(key: Buffer, text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  return iv.toString('hex') + ':' + Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('hex');
}

export function decryptWith(key: Buffer, cipherText: string): string {
  const [ivHex, encHex] = cipherText.split(':');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
}

export const LEGACY_SECRET = LEGACY_DEFAULT_SECRET;
