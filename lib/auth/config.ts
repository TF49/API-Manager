/**
 * Central auth / security configuration.
 * Everything that tunes the login security posture lives here so it can be reviewed in one place.
 */

export const IS_PROD = process.env.NODE_ENV === 'production';

/** Session lifetime: expires after 30 min of inactivity, or 12 h after login, whichever comes first. */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
/** Only write last_seen_at back to the DB at most once per minute per session. */
export const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;
/** Oldest sessions beyond this count are evicted on login. */
export const MAX_SESSIONS_PER_USER = 5;

/**
 * `__Host-` prefix forces Secure + Path=/ + no Domain in the browser, so the cookie
 * can't be set or shadowed by a sibling subdomain. It requires HTTPS, so dev uses a plain name.
 */
export const SESSION_COOKIE_NAME = IS_PROD ? '__Host-am_session' : 'am_session';

export interface RateLimitPolicy {
  /** Attempts allowed inside one window before the bucket locks. */
  maxAttempts: number;
  windowMs: number;
  /** First lock duration; doubles with each consecutive lock. */
  baseLockMs: number;
  maxLockMs: number;
  /** Lock escalation level is forgotten after this long without attempts. */
  decayMs: number;
}

/** Per client IP: blunts single-source brute force. */
export const IP_POLICY: RateLimitPolicy = {
  maxAttempts: 10,
  windowMs: 15 * 60 * 1000,
  baseLockMs: 15 * 60 * 1000,
  maxLockMs: 24 * 60 * 60 * 1000,
  decayMs: 24 * 60 * 60 * 1000,
};

/** Per attempted username (whether or not it exists): blunts distributed brute force on one account. */
export const USER_POLICY: RateLimitPolicy = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  baseLockMs: 15 * 60 * 1000,
  maxLockMs: 60 * 60 * 1000,
  decayMs: 24 * 60 * 60 * 1000,
};

/** Concurrent Argon2 verifications allowed; protects CPU/RAM from login floods. */
export const MAX_CONCURRENT_PASSWORD_CHECKS = 4;
/** Requests waiting for a verification slot beyond this are rejected with 503. */
export const MAX_QUEUED_PASSWORD_CHECKS = 32;

/** Argon2id parameters (OWASP: >= 19 MiB / t=2). We use 64 MiB / t=3. */
export const ARGON2_OPTIONS = {
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 1,
} as const;

export const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

/** Max accepted size of the login request body. */
export const LOGIN_BODY_LIMIT_BYTES = 4 * 1024;
