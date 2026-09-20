export const DONE_PANEL_MIN_HEIGHT = 120;
export const DONE_PANEL_KEY_STEP = 20;
export const DONE_PANEL_DEFAULT_HEIGHT = 280;

export function clampDonePanelHeight(value, min, max) {
  const height = Number(value);
  if (!Number.isFinite(height)) return DONE_PANEL_DEFAULT_HEIGHT;
  const lower = Number.isFinite(Number(min)) ? Number(min) : 0;
  let upper = Number(max);
  if (!Number.isFinite(upper) || upper < lower) upper = height;
  return Math.min(Math.max(height, lower), upper);
}

export function computeDonePanelHeightFromPointer(sectionBottom, clientY, headerHeight) {
  return Number(sectionBottom) - Number(clientY) - Number(headerHeight || 0);
}

/* 面板顶部不得越过新增任务栏底部：上限 = 容器底边 − 输入栏底边 − 面板自身铬高
   （头部 + 拖拽条 + 底部间隙 + 安全边距）。输入栏 sticky 且 z-index 高于面板，
   越过即会被盖住。 */
export function computeDonePanelMaxHeightFromRects({ containerBottom, addBarBottom, chromeHeight }) {
  const bottom = Number(containerBottom);
  const bar = Number(addBarBottom);
  const chrome = Number(chromeHeight);
  if (!Number.isFinite(bottom) || !Number.isFinite(bar) || !Number.isFinite(chrome)) return 600;
  return Math.max(DONE_PANEL_MIN_HEIGHT, bottom - bar - chrome);
}

function readCurrentHeight(section) {
  const raw = parseFloat(section.style.getPropertyValue('--done-list-height'));
  return Number.isFinite(raw) ? raw : DONE_PANEL_DEFAULT_HEIGHT;
}

export function initDonePanelResize({ section, header, handle, getMaxHeight, onHeightChange }) {
  if (!section || !handle) return () => {};
  const maxOf = () => {
    const max = typeof getMaxHeight === 'function' ? getMaxHeight() : 600;
    return Number.isFinite(Number(max)) ? Number(max) : 600;
  };
  const syncAria = (height, max) => {
    handle.setAttribute('aria-valuenow', String(Math.round(height)));
    handle.setAttribute('aria-valuemax', String(Math.round(max)));
  };

  const applyHeight = (height, notify = true) => {
    const max = maxOf();
    const clamped = clampDonePanelHeight(height, DONE_PANEL_MIN_HEIGHT, max);
    section.style.setProperty('--done-list-height', `${clamped}px`);
    syncAria(clamped, max);
    if (notify && typeof onHeightChange === 'function') onHeightChange();
    return clamped;
  };

  let dragging = false;

  const onPointerMove = (event) => {
    if (!dragging) return;
    event.preventDefault();
    const rect = section.getBoundingClientRect();
    const headerHeight = header ? header.offsetHeight : 0;
    applyHeight(computeDonePanelHeightFromPointer(rect.bottom, event.clientY, headerHeight));
  };

  const stopDrag = () => {
    if (!dragging) return;
    dragging = false;
    section.classList.remove('resizing');
    handle.classList.remove('dragging');
    if (typeof onHeightChange === 'function') onHeightChange();
  };

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    dragging = true;
    section.classList.add('resizing');
    handle.classList.add('dragging');
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {}
    event.preventDefault();
  });
  handle.addEventListener('pointermove', onPointerMove);
  handle.addEventListener('pointerup', stopDrag);
  handle.addEventListener('pointercancel', stopDrag);

  handle.addEventListener('keydown', (event) => {
    const current = readCurrentHeight(section);
    let next = null;
    if (event.key === 'ArrowUp') next = current + DONE_PANEL_KEY_STEP;
    else if (event.key === 'ArrowDown') next = current - DONE_PANEL_KEY_STEP;
    else if (event.key === 'Home') next = DONE_PANEL_MIN_HEIGHT;
    else if (event.key === 'End') next = maxOf();
    else return;
    event.preventDefault();
    applyHeight(next);
  });

  handle.addEventListener('dblclick', () => {
    section.style.removeProperty('--done-list-height');
    syncAria(DONE_PANEL_DEFAULT_HEIGHT, maxOf());
    if (typeof onHeightChange === 'function') onHeightChange();
  });

  return () => {
    section.style.removeProperty('--done-list-height');
  };
}
