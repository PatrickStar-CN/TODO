export function toLocalDatetime(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}`;
}

export function toLocalDateInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseLocalDateInput(value) {
  const parts = String(value || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

export function formatMonthDay(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

export function isToday(dateStr) {
  if (!dateStr) return false;
  /* 纯日期字符串（如 2026-08-10）按本地日期解析，避免 UTC 解析错天 */
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))
    ? parseLocalDateInput(dateStr)
    : new Date(dateStr);
  return date ? isSameDay(date, new Date()) : false;
}

export function getWeekday(date) {
  return ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
}

export function formatDate(str) {
  if (!str) return '';
  const d = new Date(str);
  const now = new Date();
  if (isSameDay(d, now)) return '今天';
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameDay(d, tomorrow)) return '明天';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatDateTime(str) {
  if (!str) return '';
  const d = new Date(str);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
