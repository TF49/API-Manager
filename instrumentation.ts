/**
 * Runs once when the Next.js server starts. In production, refuses to boot with an insecure
 * configuration (see lib/startup-check.ts). Not run during `next build`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const { assertSecureProductionConfig } = await import('./lib/startup-check');
  assertSecureProductionConfig();
}
