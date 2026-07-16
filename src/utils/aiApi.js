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
