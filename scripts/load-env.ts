/**
 * Side-effect module: load .env files for CLI scripts the same way `next start` does
 * (.env.production.local, .env.local, .env.production, .env), without overriding variables
 * already set in the real environment.
 *
 * Must be the FIRST import of every CLI entry point, because lib/db.ts reads process.env
 * when it is imported.
 */
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });
