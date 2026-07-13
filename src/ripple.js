// 玻璃按钮涟漪动效模块
// 监听全局 pointerdown 事件，在按钮被点按时从点击位置触发圆形扩散光波

const PRESS_DURATION = 700; // 与 CSS 动画时长（0.65s / 0.7s）保持一致

// 触发涟漪动画的按钮选择器（与 style.css 中保持一致）
const BUTTON_SELECTOR = [
  '.btn-header-action',
  '.icon-btn',
  '.btn-ai-summary',
  '.btn-cancel',
  '.btn-ok',
  '.btn-danger',
  '.btn-archive-all',
  '.btn-primary',
  '.btn-copy',
  '.btn-theme-toggle',
  '.btn-row button',
  '.theme-opt',
  '.settings-tab',
  '.btn-ai-mode',
  '.btn-ai-range',
  '.month-opt',
  '.btn-glass'
].join(',');

function createRipple(button, x, y) {
  const rect = button.getBoundingClientRect();
  const rippleX = ((x - rect.left) / rect.width) * 100;
  const rippleY = ((y - rect.top) / rect.height) * 100;
  button.style.setProperty('--ripple-x', `${rippleX}%`);
  button.style.setProperty('--ripple-y', `${rippleY}%`);

  // 重启动画：移除 → 强制 reflow → 重新添加
  button.classList.remove('is-pressing');
  void button.offsetWidth;
  button.classList.add('is-pressing');

  // 动画结束后清理状态（用 animationend 更精确，但 setTimeout 更稳定）
  setTimeout(() => {
    button.classList.remove('is-pressing');
  }, PRESS_DURATION);
}

function handlePointerDown(e) {
  // 仅响应主按键（左键）或触屏
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const target = e.target.closest(BUTTON_SELECTOR);
  if (!target || target.disabled) return;
  createRipple(target, e.clientX, e.clientY);
}

function handleAnimationEnd(e) {
  // 监听 is-pressing 的动画结束，确保提前清理
  if (e.target.classList && e.target.classList.contains('is-pressing')) {
    e.target.classList.remove('is-pressing');
  }
}

export function initRipple() {
  document.addEventListener('pointerdown', handlePointerDown);
  // 动画结束后立即清理状态（让下一次点击的动画能立即重启动）
  document.addEventListener('animationend', handleAnimationEnd, true);
}
