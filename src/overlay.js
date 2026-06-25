import { escapeHtml } from './utils/html.js';

export function createOverlay(title, content, actions, triggerEl) {
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
  box.style.animation = 'modalExpandIn 0.28s cubic-bezier(0.16, 1, 0.3, 1)';

  const firstBtn = overlay.querySelector('button');
  if (firstBtn) firstBtn.focus();
  return overlay;
}

export function closeOverlay(overlay) {
  if (overlay) {
    const box = overlay.querySelector('.tag-input-box');
    if (box) box.style.animation = 'modalShrinkOut 0.2s cubic-bezier(0.4, 0, 1, 1) forwards';
    overlay.classList.add('closing');
    overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
    setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 300);
  }
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
    '确认操作',
    `<p class="overlay-message">${escapeHtml(message)}</p>`,
    '<button class="btn-cancel">取消</button><button class="btn-danger">确定</button>',
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
