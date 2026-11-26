/** 前端「同步全部站点」：后台开始同步后轮询状态，直到这一轮结束 */

export interface RefreshStatus {
  enabled: boolean;
  interval_minutes: number;
  running: boolean;
  run_started_at: string | null;
  last_run_at: string | null;
  last_run_ok: number | null;
  last_run_failed: number | null;
  last_run_changes: number | null;
  last_run_error: string | null;
  next_run_at: string | null;
}

const POLL_MS = 2000;
const MAX_WAIT_MS = 15 * 60_000;

async function getStatus(): Promise<RefreshStatus> {
  const json = await fetch('/api/refresh', { cache: 'no-store' }).then((r) => r.json());
  if (!json.success) throw new Error(json.error || '读取同步状态失败');
  return json.data;
}

/** 开始同步并等待结束；已有一轮在跑时等那一轮结束。返回结束后的状态 */
export async function syncAllAndWait(): Promise<RefreshStatus> {
  const res = await fetch('/api/refresh', { method: 'POST' });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || '同步失败');
  let status: RefreshStatus = json.data.status;
  const deadline = Date.now() + MAX_WAIT_MS;
  while (status.running) {
    if (Date.now() > deadline) throw new Error('同步时间过长，请稍后刷新页面查看结果');
    await new Promise((r) => setTimeout(r, POLL_MS));
    status = await getStatus();
  }
  return status;
}

/** 同步结果的提示文字和类型 */
export function describeRun(s: RefreshStatus): { text: string; kind: 'success' | 'info' | 'error' } {
  if (s.last_run_error) return { text: `同步失败：${s.last_run_error}`, kind: 'error' };
  const ok = s.last_run_ok ?? 0;
  const failed = s.last_run_failed ?? 0;
  const changes = s.last_run_changes ?? 0;
  return {
    text: `已同步 ${ok}/${ok + failed} 个站点${failed ? `，${failed} 个失败` : ''}${changes ? `，${changes} 处变动` : '，没有变动'}`,
    kind: failed ? 'info' : 'success',
  };
}
