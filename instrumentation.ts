/**
 * Runs once when the Next.js server starts.
 *  - In production, refuses to boot with an insecure configuration (see lib/startup-check.ts).
 *  - Starts the scheduled price-group sync (see lib/price-scheduler.ts).
 * Not run during `next build`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  if (process.env.NODE_ENV === 'production') {
    const { assertSecureProductionConfig } = await import('./lib/startup-check');
    assertSecureProductionConfig();
  }

  const { startPriceScheduler } = await import('./lib/price-scheduler');
  startPriceScheduler();
}
