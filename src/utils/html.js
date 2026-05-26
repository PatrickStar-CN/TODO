const _escapeDiv = document.createElement('div');

export function escapeHtml(str) {
  _escapeDiv.textContent = str;
  return _escapeDiv.innerHTML;
}
