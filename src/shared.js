export const TAG_COLORS = ['#4f46e5', '#06b6d4', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];

export function getTagColor(tag, tags) {
  if (!tag) return TAG_COLORS[0];
  const index = tags.indexOf(tag);
  return TAG_COLORS[(index >= 0 ? index : 0) % TAG_COLORS.length];
}

/* hex → "r, g, b"，供 CSS rgba() 使用，兼容性优于 color-mix */
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

export function getTagBadgeStyle(tag, tags) {
  const color = getTagColor(tag, tags);
  const rgb = hexToRgb(color);
  /* 颜色写入 --tag-color-rgb 变量；背景由 CSS .badge-tag 规则用 rgba() 控制，
     避免内联 background 与 hover 态冲突，无需 !important。 */
  return `style="--tag-color:${color};--tag-color-rgb:${rgb}"`;
}

export function getTagDotStyle(tag, tags) {
  return `style="background:${getTagColor(tag, tags)}"`;
}

export function getNextTagDotStyle(tags) {
  return `style="background:${TAG_COLORS[tags.length % TAG_COLORS.length]}"`;
}

export function getTagTaskCount(data, tag) {
  if (data._index && data._index.tagTotal) {
    return data._index.tagTotal[tag] || 0;
  }
  return data.todos.filter(t => t.tag === tag).length;
}

export function isNeutralinoEnv() {
  return typeof Neutralino !== 'undefined' && typeof NL_PORT !== 'undefined';
}
