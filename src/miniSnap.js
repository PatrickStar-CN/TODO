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

/* ---- 模式切换窗口矩形插值（步进对齐 vsync，见下方显示器自适应采样） ----
 * Neutralino 原生 setSize/move 都是瞬时生效的 IPC，模式切换时直接调用会
 * 看到"闪—缩小—瞬移"三段跳变。这里按持续时间插值出中间矩形，调用方每 N 个
 * vsync 帧下发一次 setSize + move，实现尺寸与位置联动的平滑过渡。
 * 坐标与 setSize/move 使用同一单位（原生物理像素），内部不做 dpr 换算。 */

/** 纯函数：elapsed 时刻的插值矩形（四舍五入取整）与是否结束 */
export function rectAt(from, to, elapsed, duration) {
  const total = Math.max(1, duration);
  const p = Math.min(1, Math.max(0, elapsed / total));
  const eased = easeOutCubic(p);
  const rect = {};
  for (const key of ['x', 'y', 'width', 'height']) {
    rect[key] = Math.round(from[key] + (to[key] - from[key]) * eased);
  }
  return { rect, done: p >= 1 };
}

/** 纯函数：宽高为 w/h 的窗口在显示器内的居中矩形 */
export function centerRect(displayWidth, displayHeight, width, height) {
  return {
    x: Math.round((displayWidth - width) / 2),
    y: Math.round((displayHeight - height) / 2),
    width,
    height
  };
}

let rectAnimToken = 0;
let rectAnimRafId = null;

/** 取消进行中的窗口矩形动画（模式反复切换时防重叠） */
export function cancelWindowRectAnimation() {
  rectAnimToken += 1;
  if (rectAnimRafId != null) {
    cancelAnimationFrame(rectAnimRafId);
    rectAnimRafId = null;
  }
}

/* 从 from 插值到 to：每步调用 apply(rect, done) 下发 setSize + move。
 * duration <= 0 或 reduce-motion 时直接下发终态；resolve(true) 表示播完，
 * resolve(false) 表示中途被更新的动画取消。 */
export function animateWindowRect({ from, to, duration, apply }) {
  cancelWindowRectAnimation();
  const token = ++rectAnimToken;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion || duration <= 0) {
    apply(to, true);
    return Promise.resolve(true);
  }
  const startTime = performance.now();
  let frame = 0;
  /* 步进对齐 vsync：首帧立即下发保证跟手，之后每 N 帧一次（N 由实测刷新率决定） */
  const every = framesPerApply(cachedDisplayHz);
  return new Promise((resolve) => {
    const step = (now) => {
      if (token !== rectAnimToken) {
        resolve(false);
        return;
      }
      const elapsed = now - startTime;
      const { rect, done } = rectAt(from, to, elapsed, duration);
      frame += 1;
      if (done || frame === 1 || frame % every === 0) {
        try {
          apply(rect, done);
        } catch {}
      }
      if (done) {
        rectAnimRafId = null;
        resolve(true);
      } else {
        rectAnimRafId = requestAnimationFrame(step);
      }
    };
    rectAnimRafId = requestAnimationFrame(step);
  });
}

import { isNeutralinoEnv } from './shared.js';

const DRAG_POLL_MS = 100;// 拖拽轮询间隔（ms）
const DRAG_STABLE_POLLS = 2;// 拖拽结束轮询次数，判断是否稳定
const SLIDE_DURATION = 260;// 收起/展开动画时长（ms）

/* ---- 显示器自适应采样：动画步进对齐 vsync ----
 * 固定毫秒节流在高刷屏上看起来一顿一顿，还可能与 vsync 错相位产生抖动。
 * 这里用 rAF 实测显示器刷新率并缓存，动画每 N 个 vsync 帧下发一次 IPC：
 * 60Hz 屏逐帧下发，高刷屏跳帧下发，把 IPC 频率封顶在 WINDOW_ANIM_MAX_HZ 以内。
 * 缓动按流逝时间计算，与步进无关，因此跳帧不影响动画正确性，只影响密度。 */
export const WINDOW_ANIM_MAX_HZ = 72;

let cachedDisplayHz = 0;
let hzMeasureTask = null;

/* 实测显示器刷新率：取连续 rAF 间隔的中位数换算，调用时才碰 window，import 安全 */
export function measureDisplayHz(samples = 24) {
  return new Promise((resolve) => {
    const deltas = [];
    let last = 0;
    const tick = (now) => {
      if (last > 0) deltas.push(now - last);
      last = now;
      if (deltas.length >= samples) {
        deltas.sort((a, b) => a - b);
        const median = deltas[Math.floor(deltas.length / 2)] || 0;
        cachedDisplayHz = median > 0 ? Math.round(1000 / median) : 60;
        resolve(cachedDisplayHz);
      } else {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  });
}

/* 启动一次测量（fire-and-forget），已缓存或测量中则直接复用 */
export function ensureDisplayHz() {
  if (cachedDisplayHz > 0) return Promise.resolve(cachedDisplayHz);
  if (!hzMeasureTask) {
    hzMeasureTask = measureDisplayHz().finally(() => { hzMeasureTask = null; });
  }
  return hzMeasureTask;
}

/** 纯函数：按显示器刷新率，每多少个 vsync 帧下发一次（未知按 60Hz） */
export function framesPerApply(hz) {
  const rate = hz > 0 ? hz : 60;
  return Math.max(1, Math.ceil(rate / WINDOW_ANIM_MAX_HZ));
}

/* 收起/展开动画时长跟随全局外观动效速度（默认 260ms）；import 安全：
   只在浏览器运行时读取，node 回归测试仅导入纯函数不受影响 */
export function panelSlideDurationMs(fallback = SLIDE_DURATION) {
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0;
  } catch {}
  try {
    if (typeof document !== 'undefined' && document.documentElement.dataset.motion === 'off') return 0;
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--duration-panel');
    const value = Number.parseFloat(raw);
    if (Number.isFinite(value) && value >= 0) return value;
  } catch {}
  return fallback;
}

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

  /* 平滑滑动到 targetY：rAF 驱动 + easeOutCubic，按显示器 vsync 步进调用
     window.move（高刷屏跳帧，IPC 封顶；内容不重排）；reduce-motion 时直接瞬移。
     token 保证取消后的旧动画不再生效。 */
  function slideWindowTo(targetY) {
    cancelSlide();
    const token = ++slideToken;
    slideTarget = targetY < 0 ? 'collapse' : 'expand';
    Neutralino.window.getPosition().then(({ x, y }) => {
      if (token !== slideToken) return;
      const slideDuration = panelSlideDurationMs();
      if (slideDuration < 1) {
        Neutralino.window.move(x, targetY).catch(() => {});
        finishSlide(token, targetY);
        return;
      }
      const startY = y;
      const startTime = performance.now();
      const every = framesPerApply(cachedDisplayHz);
      let frame = 0;
      const step = (now) => {
        if (token !== slideToken) return;
        const elapsed = now - startTime;
        const p = Math.min(1, elapsed / slideDuration);
        frame += 1;
        if (p >= 1 || frame === 1 || frame % every === 0) {
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
    /* 后台实测显示器刷新率，供收起/展开与模式切换动画自适应步进 */
    ensureDisplayHz();
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
