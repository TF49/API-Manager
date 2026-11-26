import { syncAllSites, type SyncResult } from '@/lib/price-sync';

/**
 * 定时同步所有站点的分组倍率。
 * 间隔由 PRICE_REFRESH_MINUTES 控制（默认 30 分钟，设为 0 关闭，最长 7 天）。
 * 状态挂在 globalThis 上，供 /api/refresh 读取「上次 / 下次同步时间」。
 */

export interface SchedulerStatus {
  enabled: boolean;
  interval_minutes: number;
  running: boolean;
  /** 当前这一轮开始的时间（running 为 true 时有值） */
  run_started_at: string | null;
  last_run_at: string | null;
  last_run_ok: number | null;
  last_run_failed: number | null;
  last_run_changes: number | null;
  last_run_error: string | null;
  next_run_at: string | null;
}

interface SchedulerState {
  timer: ReturnType<typeof setTimeout> | null;
  status: SchedulerStatus;
}

const g = globalThis as typeof globalThis & { __priceScheduler?: SchedulerState };

const DEFAULT_MINUTES = 30;
/** setTimeout 超过 2^31-1 ms（约 24.8 天）会溢出成 1ms，这里限制在 7 天内 */
const MAX_MINUTES = 7 * 24 * 60;
const FIRST_RUN_DELAY_MS = 15_000;

export function refreshIntervalMinutes(raw = process.env.PRICE_REFRESH_MINUTES): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_MINUTES;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_MINUTES;
  if (n === 0) return 0;
  return Math.min(MAX_MINUTES, Math.max(1, n));
}

function state(): SchedulerState {
  return (g.__priceScheduler ??= {
    timer: null,
    status: {
      enabled: false,
      interval_minutes: refreshIntervalMinutes(),
      running: false,
      run_started_at: null,
      last_run_at: null,
      last_run_ok: null,
      last_run_failed: null,
      last_run_changes: null,
      last_run_error: null,
      next_run_at: null,
    },
  });
}

export function schedulerStatus(): SchedulerStatus {
  return { ...state().status };
}

function schedule(delayMs: number) {
  const s = state();
  if (s.timer) clearTimeout(s.timer);
  s.status.next_run_at = new Date(Date.now() + delayMs).toISOString();
  s.timer = setTimeout(() => void runNow(), delayMs);
  // 不阻止进程退出
  s.timer.unref?.();
}

export type RunResult = { status: 'busy' } | { status: 'error'; error: string } | { status: 'done'; results: SyncResult[] };

/** 立即同步全部站点。已在运行时返回 busy；定时任务开启时会顺延下一次 */
export async function runNow(): Promise<RunResult> {
  const s = state();
  if (s.status.running) return { status: 'busy' };
  s.status.running = true;
  s.status.run_started_at = new Date().toISOString();
  try {
    const results = await syncAllSites();
    const ok = results.filter((r) => r.ok);
    s.status.last_run_ok = ok.length;
    s.status.last_run_failed = results.length - ok.length;
    s.status.last_run_changes = ok.reduce((n, r) => n + (r.ok ? r.changes : 0), 0);
    s.status.last_run_error = null;
    return { status: 'done', results };
  } catch (err) {
    console.error('[price-scheduler] 同步失败', err);
    const error = err instanceof Error ? err.message : '同步失败';
    s.status.last_run_error = error;
    return { status: 'error', error };
  } finally {
    s.status.running = false;
    s.status.run_started_at = null;
    s.status.last_run_at = new Date().toISOString();
    if (s.status.enabled) schedule(s.status.interval_minutes * 60_000);
  }
}

/** 在后台开始同步，不等待结果。返回 false 表示已经在同步中 */
export function startRunInBackground(): boolean {
  if (state().status.running) return false;
  void runNow();
  return true;
}

export function startPriceScheduler() {
  const s = state();
  if (s.status.enabled) return; // dev 热更新时 register 可能被再次调用
  const minutes = refreshIntervalMinutes();
  s.status.interval_minutes = minutes;
  if (minutes === 0) {
    console.log('[price-scheduler] PRICE_REFRESH_MINUTES=0，已关闭定时同步');
    return;
  }
  s.status.enabled = true;
  console.log(`[price-scheduler] 每 ${minutes} 分钟同步一次所有站点的分组倍率`);
  schedule(FIRST_RUN_DELAY_MS);
}
