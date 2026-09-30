/* 弹层关闭动画的统一收尾句柄。
 *
 * 各弹层普遍用 animationend + 定时器双保险收尾，但有两个固有坑：
 * 1. animationend 会从子元素冒泡，按钮涟漪、下拉展开等无关动画结束
 *    都会误触发收尾，把面板或遮罩提前撤掉；
 * 2. 关闭动画途中重新打开时浏览器只发 animationcancel，旧监听与旧定时器
 *    会残留到新打开的界面上——展开动画一结束就把面板再次隐藏，
 *    或把刚创建的遮罩提前移除，界面因此卡在一层无法关闭的模糊遮罩上。
 *
 * 统一用本句柄登记回调，重新打开时 cancel() 整体撤销。 */
import { getUiMotionDuration } from '../uiPreferences.js';

export function createDismissal() {
  let timers = [];
  let listeners = [];

  function detach() {
    timers.forEach(id => clearTimeout(id));
    listeners.forEach(([el, handler]) => el.removeEventListener('animationend', handler));
    timers = [];
    listeners = [];
  }

  return {
    /* 只认目标元素自身的动画结束，忽略冒泡上来的子元素动画 */
    onEnd(el, handler) {
      const guarded = (event) => {
        if (event.target !== el) return;
        handler();
      };
      el.addEventListener('animationend', guarded, { once: true });
      listeners.push([el, guarded]);
    },
    /* 动画事件不触发时的兜底（零时长动效、快速连点、窗口隐藏时节流等） */
    after(fn, delay) {
      timers.push(setTimeout(fn, delay));
    },
    /* 重新打开/重复触发时撤销全部收尾，防止过期回调作用在新状态上 */
    cancel: detach
  };
}

/* 居中弹窗面板（.detail-panel / .summary-panel / .settings-modal）的收起收尾，
 * 由弹层各自复用：只认面板自身的动画事件，动画不触发时定时器兜底。
 * 每次收起会先撤销上一次未完成的收尾；面板重新打开前调用 cancelPanelDismiss。 */
const panelDismissals = new WeakMap();

export function cancelPanelDismiss(panel) {
  panelDismissals.get(panel)?.cancel();
  panelDismissals.delete(panel);
}

export function dismissPanel(panel) {
  if (!panel || panel.classList.contains('hidden')) return;
  cancelPanelDismiss(panel);
  const dismissal = createDismissal();
  panelDismissals.set(panel, dismissal);
  const finish = () => {
    panel.classList.add('hidden');
    panel.classList.remove('hiding');
    panel.style.animation = '';
    if (panelDismissals.get(panel) === dismissal) panelDismissals.delete(panel);
  };
  panel.classList.add('hiding');
  panel.style.animation = 'modalShrinkOut var(--motion-normal) forwards';
  dismissal.onEnd(panel, finish);
  dismissal.after(finish, getUiMotionDuration('normal') + 50);
}
