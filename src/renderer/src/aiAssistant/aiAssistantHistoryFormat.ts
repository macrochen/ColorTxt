/** 本地日历日键，用于分组（YYYY-MM-DD） */
export function localDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isSameLocalDay(a: number, b: number): boolean {
  return localDayKey(a) === localDayKey(b);
}

/** 会话历史列表日期抬头：今天 / 昨天 / M月D日 / yyyy年… */
export function formatHistoryGroupLabel(dayKey: string): string {
  const todayKey = localDayKey(Date.now());
  if (dayKey === todayKey) return "今天";
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  if (dayKey === localDayKey(yest.getTime())) return "昨天";
  const [ys, ms, ds] = dayKey.split("-").map(Number);
  const nowY = new Date().getFullYear();
  if (ys === nowY) return `${ms}月${ds}日`;
  return `${ys}年${ms}月${ds}日`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 每条会话右侧时间：相对时间 + 非今日简短时钟 */
export function formatThreadListTime(updatedAt: number): string {
  const now = Date.now();
  const diff = Math.max(0, now - updatedAt);
  if (diff < 45_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (isSameLocalDay(updatedAt, now)) {
    const h = Math.floor(diff / 3600_000);
    return `${Math.max(1, h)}h`;
  }
  const d = new Date(updatedAt);
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  if (isSameLocalDay(updatedAt, yest.getTime()))
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const nowY = new Date().getFullYear();
  if (d.getFullYear() === nowY)
    return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
