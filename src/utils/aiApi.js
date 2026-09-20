const CHAT_COMPLETIONS_PATH = '/chat/completions';

export function resolveAiApiUrl(value) {
  const url = String(value || '').trim();
  if (!url || /\/chat\/completions\/?(?=[?#]|$)/i.test(url)) {
    return url;
  }

  const suffixIndex = url.search(/[?#]/);
  const base = suffixIndex === -1 ? url : url.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? '' : url.slice(suffixIndex);
  const trimmedBase = base.replace(/\/+$/, '');

  if (!/\/v1$/i.test(trimmedBase)) {
    return url;
  }

  return `${trimmedBase}${CHAT_COMPLETIONS_PATH}${suffix}`;
}

/* SSE 单行解析（纯函数）：data: 前缀兼容有/无空格；[DONE] 结束；
 * 非 SSE 行返回空内容，由调用方忽略。 */
export function parseSseLine(line) {
  const text = String(line ?? '');
  if (!text.startsWith('data:')) return { done: false, content: '' };
  const payload = text.slice(5).trim();
  if (!payload) return { done: false, content: '' };
  if (payload === '[DONE]') return { done: true, content: '' };
  try {
    const json = JSON.parse(payload);
    const content = json.choices?.[0]?.delta?.content;
    return { done: false, content: typeof content === 'string' ? content : '' };
  } catch {
    return { done: false, content: '' };
  }
}

/* 非流式兜底：部分网关无视 stream:true 直接返回完整 JSON（200 + 整包），
 * 此时 SSE 循环产出为空，从累积缓冲里提取正文或服务端错误信息，避免空白输出。 */
export function extractCompleteContent(text) {
  const t = String(text ?? '').trim();
  if (!t) return '';
  try {
    const json = JSON.parse(t);
    const content = json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text ?? '';
    if (typeof content === 'string' && content) return content;
    const errMsg = json.error?.message || json.message;
    return typeof errMsg === 'string' && errMsg ? `请求失败：${errMsg}` : '';
  } catch {
    return '';
  }
}
