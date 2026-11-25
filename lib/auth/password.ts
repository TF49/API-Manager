import { hash, verify } from '@node-rs/argon2';
import {
  ARGON2_OPTIONS,
  MAX_CONCURRENT_PASSWORD_CHECKS,
  MAX_QUEUED_PASSWORD_CHECKS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from './config';

export class PasswordCheckBusyError extends Error {
  constructor() {
    super('服务繁忙，请稍后再试');
    this.name = 'PasswordCheckBusyError';
  }
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** Returns a reason string if the password is too weak for a new admin password, else null. */
export function passwordPolicyError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `密码至少 ${PASSWORD_MIN_LENGTH} 位`;
  if (password.length > PASSWORD_MAX_LENGTH) return `密码最多 ${PASSWORD_MAX_LENGTH} 位`;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) return '密码需包含大写字母、小写字母、数字、符号中的至少三类';
  return null;
}

// --- Concurrency gate: Argon2 is deliberately expensive; cap parallel work. ---

let active = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENT_PASSWORD_CHECKS) {
    active += 1;
    return;
  }
  if (waiters.length >= MAX_QUEUED_PASSWORD_CHECKS) throw new PasswordCheckBusyError();
  await new Promise<void>((resolve) => waiters.push(resolve));
}

function releaseSlot(): void {
  const next = waiters.shift();
  if (next) next();
  else active -= 1;
}

let dummyHashPromise: Promise<string> | null = null;

/**
 * Hash used when the username does not exist, so a miss costs the same time as a hit
 * and response timing doesn't reveal which usernames are real.
 */
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('dummy-password-for-timing-equalization');
  return dummyHashPromise;
}

/**
 * Verifies a password. Pass `storedHash = null` for unknown users: it still runs a full
 * verification against a dummy hash and returns false.
 */
export async function verifyPassword(storedHash: string | null, password: string): Promise<boolean> {
  const target = storedHash ?? (await dummyHash());
  await acquireSlot();
  try {
    const ok = await verify(target, password).catch(() => false);
    return storedHash !== null && ok;
  } finally {
    releaseSlot();
  }
}
