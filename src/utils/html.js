const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeStr(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}

export function escapeHtml(str) {
  return escapeStr(str);
}

/** 转义属性值：与文本转义共用同一套实体，保证放入引号包裹的属性时不会逃逸 */
export function escapeAttr(str) {
  return escapeStr(str);
}
