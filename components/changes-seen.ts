/**
 * 「倍率变动」未读提示：浏览器里记住已看到的最新变动 ID。
 * 只是单个浏览器的便利功能，读写失败（隐私模式等）时当作没有记录。
 */

const KEY = 'am_changes_seen_id';
export const CHANGES_SEEN_EVENT = 'am-changes-seen';

export function readSeenChangeId(): number | null {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function markChangesSeen(latestId: number) {
  try {
    const cur = readSeenChangeId();
    if (cur === null || latestId > cur) window.localStorage.setItem(KEY, String(latestId));
  } catch {
    /* 存不了就算了 */
  }
  window.dispatchEvent(new Event(CHANGES_SEEN_EVENT));
}
