import { escapeHtml } from './utils/html.js';
import { getUiMotionDuration } from './uiPreferences.js';
import { createDismissal } from './utils/dismiss.js';
import { createFocusTrap } from './utils/focus.js';
import { t } from './i18n/index.js';

export function createOverlay(title, content, actions, triggerEl) {
  /* 通用遮罩同一时间只应存在一层：先收尾可能残留的旧遮罩，
   * 否则两层叠加时只会移除后创建的那层，旧的一层会永久挡住界面 */
  document.querySelectorAll('.tag-input-overlay').forEach(el => closeOverlay(el, { restoreFocus: false }));

  const previouslyFocused = triggerEl && document.contains(triggerEl)
    ? triggerEl
    : document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'tag-input-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', title);
  overlay.innerHTML = `
    <div class="tag-input-box">
      <h4>${title}</h4>
      ${content}
      <div class="btn-row">${actions}</div>
    </div>
  `;
  document.body.appendChild(overlay);

  // 设置弹窗从触发位置放大的起点坐标
  const box = overlay.querySelector('.tag-input-box');
  if (triggerEl) {
    const rect = triggerEl.getBoundingClientRect();
    box.style.setProperty('--origin-x', `${rect.left + rect.width / 2 - window.innerWidth / 2}px`);
    box.style.setProperty('--origin-y', `${rect.top + rect.height / 2 - window.innerHeight / 2}px`);
  }
  box.style.animation = 'modalExpandIn var(--motion-panel)';

  const firstBtn = overlay.querySelector('button');
  overlay._releaseFocusTrap = createFocusTrap(overlay, {
    previouslyFocused,
    initialFocus: firstBtn || undefined,
  });
  if (firstBtn) firstBtn.focus();
  return overlay;
}

export function closeOverlay(overlay, { restoreFocus = true } = {}) {
  if (!overlay) return;
  overlay._dismissal?.cancel();
  const dismissal = createDismissal();
  overlay._dismissal = dismissal;
  const duration = getUiMotionDuration('normal');
  const finish = () => {
    if (overlay._dismissal !== dismissal) return;
    overlay._dismissal = null;
    overlay.remove();
  };
  const release = typeof overlay._releaseFocusTrap === 'function' ? overlay._releaseFocusTrap : null;
  overlay._releaseFocusTrap = null;
  if (release) {
    /* 等关闭动画结束再归还焦点，避免焦点跳动；被新弹层顶替时立即归还 */
    if (restoreFocus) setTimeout(release, duration + 60);
    else release();
  }
  const box = overlay.querySelector('.tag-input-box');
  if (box) box.style.animation = 'modalShrinkOut var(--motion-normal) forwards';
  overlay.classList.add('closing');
  dismissal.onEnd(overlay, finish);
  /* 盒子与遮罩各自淡出，先结束的那个负责收尾 */
  if (box) dismissal.onEnd(box, finish);
  dismissal.after(finish, duration + 50);
}

export function createManagedOverlay(title, content, actions, triggerEl) {
  const overlay = createOverlay(title, content, actions, triggerEl);
  const close = () => closeOverlay(overlay);
  const cancelBtn = overlay.querySelector('.btn-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });
  overlay.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); close(); } });
  return { overlay, close };
}

export function showConfirmDialog(message, onConfirm, triggerEl) {
  const overlay = createOverlay(
    t('confirm.title'),
    `<p class="overlay-message">${escapeHtml(message)}</p>`,
    `<button class="btn-cancel">${t('common.cancel')}</button><button class="btn-danger">${t('common.confirm')}</button>`,
    triggerEl
  );

  const close = () => closeOverlay(overlay);
  const confirmBtn = overlay.querySelector('.btn-danger');

  overlay.querySelector('.btn-cancel').addEventListener('click', close);
  confirmBtn.addEventListener('click', () => {
    close();
    onConfirm();
  });
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) {
      close();
    }
  });
  overlay.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      ev.stopPropagation();
      close();
      onConfirm();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
    }
  });
  confirmBtn.focus();
}
