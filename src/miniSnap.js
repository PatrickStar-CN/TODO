/* 迷你模式顶部贴边吸附 + 自动收起（对标桌面 QQ 经典贴边逻辑）
 *
 * 流程：
 *  1. 拖拽结束（原生拖动期间 webview 收不到 mouseup，用位置稳定轮询判定）后，
 *     若窗口顶边距屏幕顶部 <= 阈值，吸附到 y=0；
 *  2. 吸附后鼠标移出窗口 → 延迟 collapseDelay → 平滑上滑，仅保留 stripHeight 触发条；
 *  3. 鼠标移入触发条（条带仍在 webview 视口内，触发 document mouseenter）→ 平滑下拉展开。
 *
 * 约束：
 *  - 仅顶部单边贴边，无左右/底部；
 *  - 动画只移动原生窗口（内容不动 → 无重排/无布局开销）；
 *  - 拖拽期间暂停收起计时，拖拽结束重新判定吸附；
 *  - 所有定时器与监听均在 detach() 中清理，退出迷你模式时调用。
 *  - 本模块仅 Neutralino 桌面端生效，Web 端 attach() 为 no-op。
 */

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/** 窗口顶边是否已进入吸附阈值（物理像素判定，thresholdCss 按 dpr 换算） */
export function isNearScreenTop(y, thresholdCss, dpr) {
  return y <= Math.round((thresholdCss || 20) * (dpr || 1));
}

/** 收起后窗口目标 Y：整体上移，仅保留底部触发条在屏幕内（物理像素） */
export function computeCollapsedY(heightPhysical, stripCss, dpr) {
  const strip = Math.max(6, Math.round((stripCss || 8) * (dpr || 1)));
  return -(Math.max(strip, heightPhysical) - strip);
}

import { isNeutralinoEnv } from './shared.js';

const DRAG_POLL_MS = 100;// 拖拽轮询间隔（ms）
const DRAG_STABLE_POLLS = 2;// 拖拽结束轮询次数，判断是否稳定
const SLIDE_DURATION = 260;// 收起/展开动画时长（ms）
/* 动画采样间隔：每次 window.move 都是一次 IPC，260ms 内以 60fps 逐帧调用
   约 16 次；节流到 ~30fps 只发约 8 次，快速滑动的视觉差异几乎不可感知。 */
const SLIDE_STEP_MS = 33;

export function initMiniSnap({
  isMiniMode,
  getDragRegion = () => document.getElementById('mini-drag-region'),
  thresholdCss,
  stripCss,
  collapseDelay
}) {
  /* ---- 配置来源：显式传入参数优先，否则从 app.config.json 的 miniMode.snap
     （桌面端为 dist/ 下副本）独立读取，避免调用方拿不到配置时退回默认值。
     读取发生在初始化时，实际使用均在拖拽/移出等后续事件中，异步结果总能生效。 */
  const cfg = {
    thresholdCss: thresholdCss ?? 20,
    stripCss: stripCss ?? 8,
    collapseDelay: collapseDelay ?? 900
  };
  const loadSnapConfig = async () => {
    try {
      const res = await fetch('./app.config.json');
      if (!res.ok) return;
      const appCfg = await res.json();
      const snap = appCfg?.miniMode?.snap;
      if (thresholdCss == null && snap?.threshold != null) cfg.thresholdCss = snap.threshold;
      if (stripCss == null && snap?.strip != null) cfg.stripCss = snap.strip;
      if (collapseDelay == null && snap?.delay != null) cfg.collapseDelay = snap.delay;
    } catch { /* 保持现有配置（默认值或调用方传入值） */ }
  };
  loadSnapConfig();

  let attached = false;
  let collapsed = false;
  let snapped = false;
  let dragActive = false;
  let dragMoved = false;
  let pointerDownPos = null;
  let slideTarget = null;

  let collapseTimer = null;
  let dragPollTimer = null;
  let dragLastPos = null;
  let dragStableCount = 0;
  let slideRafId = null;
  let slideToken = 0;

  const dpr = () => window.devicePixelRatio || 1;

  const setCollapsed = (value) => {
    if (collapsed === value) return;
    collapsed = value;
    document.documentElement.classList.toggle('mini-snap-collapsed', value);
  };

  const cancelCollapseTimer = () => {
    if (collapseTimer) {
      clearTimeout(collapseTimer);
      collapseTimer = null;
    }
  };

  const cancelSlide = () => {
    if (slideRafId != null) {
      cancelAnimationFrame(slideRafId);
      slideRafId = null;
    }
    slideToken += 1;
  };

  /* 平滑滑动到 targetY：rAF 驱动 + easeOutCubic，按 SLIDE_STEP_MS 采样调用
     window.move（IPC 减半，内容不重排）；reduce-motion 时直接瞬移。
     token 保证取消后的旧动画不再生效。 */
  function slideWindowTo(targetY) {
    cancelSlide();
    const token = ++slideToken;
    slideTarget = targetY < 0 ? 'collapse' : 'expand';
    Neutralino.window.getPosition().then(({ x, y }) => {
      if (token !== slideToken) return;
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        Neutralino.window.move(x, targetY).catch(() => {});
        finishSlide(token, targetY);
        return;
      }
      const startY = y;
      const startTime = performance.now();
      let lastStep = 0;
      const step = (now) => {
        if (token !== slideToken) return;
        const elapsed = now - startTime;
        const p = Math.min(1, elapsed / SLIDE_DURATION);
        if (p >= 1 || elapsed - lastStep >= SLIDE_STEP_MS) {
          lastStep = elapsed;
          const nextY = Math.round(startY + (targetY - startY) * easeOutCubic(p));
          Neutralino.window.move(x, nextY).catch(() => {});
        }
        if (p < 1) {
          slideRafId = requestAnimationFrame(step);
        } else {
          slideRafId = null;
          finishSlide(token, targetY);
        }
      };
      slideRafId = requestAnimationFrame(step);
    }).catch(() => {});
  }

  function finishSlide(token, targetY) {
    if (token !== slideToken) return;
    slideTarget = null;
    setCollapsed(targetY < 0);
    checkMouseAfterSlide(targetY);
  }

  /* 鼠标是否在窗口视口外（物理坐标判定，IPC 失败时保守返回 false） */
  const isMouseOutsideWindow = async () => {
    try {
      const [mouse, pos, size] = await Promise.all([
        Neutralino.computer.getMousePosition(),
        Neutralino.window.getPosition(),
        Neutralino.window.getSize()
      ]);
      return !(mouse.x >= pos.x && mouse.x < pos.x + size.width
        && mouse.y >= pos.y && mouse.y < pos.y + size.height);
    } catch {
      return false;
    }
  };

  /* 动画结束后依据鼠标实际位置收尾：
     - 收起完成却仍停留在触发条内 → 立即展开；
     - 展开完成但鼠标已移出窗口 → 重新调度收起。 */
  async function checkMouseAfterSlide(targetY) {
    if (!attached) return;
    const inside = !(await isMouseOutsideWindow());
    if (targetY < 0) {
      if (inside) expandNow();
    } else if (!inside && snapped && !dragActive) {
      scheduleCollapse();
    }
  }

  const scheduleCollapse = () => {
    if (!attached || !snapped || collapsed || dragActive) return;
    cancelCollapseTimer();
    collapseTimer = setTimeout(() => {
      collapseTimer = null;
      collapseNow();
    }, cfg.collapseDelay);
  };

  const collapseNow = async () => {
    if (!attached || collapsed || !snapped || dragActive || slideTarget === 'collapse') return;
    try {
      const size = await Neutralino.window.getSize();
      slideWindowTo(computeCollapsedY(size.height, cfg.stripCss, dpr()));
    } catch {}
  };

  const expandNow = () => {
    if (!attached) return;
    if (!collapsed && slideTarget !== 'collapse') return;
    cancelCollapseTimer();
    slideWindowTo(0);
  };

  const onMouseLeaveDoc = () => {
    if (!attached || !snapped || collapsed || dragActive) return;
    scheduleCollapse();
  };

  const onMouseEnterDoc = () => {
    if (!attached) return;
    cancelCollapseTimer();
    if (collapsed || slideTarget === 'collapse') expandNow();
  };

  /* ---- 拖拽感知：pointerdown 进入拖拽态，位置稳定 N 次视为拖拽结束 ----
     仅当窗口确实移动过才判定吸附，避免点击拖拽区时误吸附。
     注意：stopDragWatch() 会重置 dragMoved，必须先保存再清理轮询。 */
  const finishDrag = () => {
    if (!dragActive) return;
    const moved = dragMoved;
    /* 轮询已持有最新位置，直接复用，避免 evaluateSnap 再发一次 getPosition */
    const lastPos = dragLastPos;
    dragActive = false;
    stopDragWatch();
    if (moved) evaluateSnap(lastPos);
  };

  const dragTick = () => {
    if (!dragActive) return;
    dragPollTimer = setTimeout(async () => {
      if (!dragActive) return;
      try {
        const pos = await Neutralino.window.getPosition();
        if (!dragLastPos) {
          dragLastPos = pos;
        } else if (pos.x === dragLastPos.x && pos.y === dragLastPos.y) {
          dragStableCount += 1;
          if (dragStableCount >= DRAG_STABLE_POLLS) {
            finishDrag();
            return;
          }
        } else {
          dragMoved = true;
          dragStableCount = 0;
        }
        dragLastPos = pos;
      } catch {}
      dragTick();
    }, DRAG_POLL_MS);
  };

  const startDragWatch = () => {
    stopDragWatch();
    dragActive = true;
    dragMoved = false;
    dragLastPos = null;
    dragStableCount = 0;
    cancelCollapseTimer();
    cancelSlide();
    dragTick();
  };

  const stopDragWatch = () => {
    if (dragPollTimer) {
      clearTimeout(dragPollTimer);
      dragPollTimer = null;
    }
    dragLastPos = null;
    dragStableCount = 0;
    dragMoved = false;
  };

  /* 拖拽结束判定：距离顶部 <= 阈值则吸附贴顶并进入可收起状态。
     吸附完成后若鼠标已不在窗口内（松手后立即移开的场景，mouseleave
     可能先于吸附完成触发而丢失），补一次调度，避免永不收起。 */
  const evaluateSnap = async (lastPos) => {
    if (!attached || !isMiniMode()) return;
    const pos = lastPos || await Neutralino.window.getPosition().catch(() => null);
    if (!pos || dragActive) return;
    if (isNearScreenTop(pos.y, cfg.thresholdCss, dpr())) {
      snapped = true;
      await Neutralino.window.move(pos.x, 0).catch(() => {});
      if (attached && !dragActive && (await isMouseOutsideWindow())) {
        scheduleCollapse();
      }
    } else {
      snapped = false;
    }
  };

  const onDragRegionPointerDown = (e) => {
    if (e.button !== 0 || !isMiniMode()) return;
    /* 记录按下时的鼠标屏幕坐标，pointerup 若到达则用位移区分点击与拖拽 */
    pointerDownPos = { x: e.screenX, y: e.screenY };
    startDragWatch();
  };

  const onPointerUp = (e) => {
    if (!dragActive) return;
    if (pointerDownPos
        && (Math.abs(e.screenX - pointerDownPos.x) > 2 || Math.abs(e.screenY - pointerDownPos.y) > 2)) {
      dragMoved = true;
    }
    pointerDownPos = null;
    finishDrag();
  };

  function attach() {
    if (attached || !isNeutralinoEnv()) return;
    attached = true;
    collapsed = false;
    snapped = false;
    document.documentElement.addEventListener('mouseleave', onMouseLeaveDoc);
    document.documentElement.addEventListener('mouseenter', onMouseEnterDoc);
    const region = getDragRegion();
    region?.addEventListener('pointerdown', onDragRegionPointerDown);
    document.addEventListener('pointerup', onPointerUp, true);
  }

  function detach() {
    if (!attached) return;
    attached = false;
    cancelCollapseTimer();
    stopDragWatch();
    dragActive = false;
    pointerDownPos = null;
    cancelSlide();
    document.documentElement.removeEventListener('mouseleave', onMouseLeaveDoc);
    document.documentElement.removeEventListener('mouseenter', onMouseEnterDoc);
    const region = getDragRegion();
    region?.removeEventListener('pointerdown', onDragRegionPointerDown);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.documentElement.classList.remove('mini-snap-collapsed');
    collapsed = false;
    snapped = false;
    slideTarget = null;
  }

  return {
    attach,
    detach,
    isCollapsed: () => collapsed,
    isSnapped: () => snapped
  };
}
