const MIN_THUMB_SIZE = 28;
const EDGE_INSET = 5;
const IDLE_HIDE_DELAY = 760;
const LEAVE_HIDE_DELAY = 140;

function isScrollable(element) {
  if (!(element instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(element);
  const canScrollY = /(auto|scroll|overlay)/.test(style.overflowY)
    && element.scrollHeight > element.clientHeight + 1;
  const canScrollX = /(auto|scroll|overlay)/.test(style.overflowX)
    && element.scrollWidth > element.clientWidth + 1;
  return canScrollX || canScrollY;
}

function findScrollable(start) {
  let element = start instanceof Element ? start : start?.parentElement;
  while (element && element !== document.body) {
    if (isScrollable(element)) return element;
    element = element.parentElement;
  }
  return isScrollable(document.documentElement) ? document.documentElement : null;
}

export function initOverlayScrollbars() {
  const layer = document.createElement('div');
  layer.className = 'overlay-scrollbar-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = `
    <i class="overlay-scrollbar overlay-scrollbar-y"></i>
    <i class="overlay-scrollbar overlay-scrollbar-x"></i>
  `;
  document.body.appendChild(layer);

  const vertical = layer.querySelector('.overlay-scrollbar-y');
  const horizontal = layer.querySelector('.overlay-scrollbar-x');
  let activeScroller = null;
  let hideTimer = null;
  let frame = null;

  function hide(delay = IDLE_HIDE_DELAY) {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      layer.classList.remove('visible');
      layer.classList.remove('elevated');
      activeScroller = null;
    }, delay);
  }

  function render() {
    frame = null;
    const scroller = activeScroller;
    if (!scroller || !scroller.isConnected || !isScrollable(scroller)) {
      layer.classList.remove('visible');
      return;
    }

    const rect = scroller === document.documentElement
      ? { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight }
      : scroller.getBoundingClientRect();
    const visibleTop = Math.max(0, rect.top);
    const visibleLeft = Math.max(0, rect.left);
    const visibleRight = Math.min(window.innerWidth, rect.right);
    const visibleBottom = Math.min(window.innerHeight, rect.bottom);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    const visibleWidth = Math.max(0, visibleRight - visibleLeft);

    const showY = scroller.scrollHeight > scroller.clientHeight + 1 && visibleHeight > MIN_THUMB_SIZE;
    const showX = scroller.scrollWidth > scroller.clientWidth + 1 && visibleWidth > MIN_THUMB_SIZE;
    vertical.classList.toggle('active', showY);
    horizontal.classList.toggle('active', showX);

    if (showY) {
      const track = Math.max(MIN_THUMB_SIZE, visibleHeight - EDGE_INSET * 2);
      const thumb = Math.max(MIN_THUMB_SIZE, track * scroller.clientHeight / scroller.scrollHeight);
      const maxScroll = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
      const offset = (track - thumb) * scroller.scrollTop / maxScroll;
      vertical.style.height = `${thumb}px`;
      vertical.style.transform = `translate3d(${Math.max(visibleLeft, visibleRight - 7)}px, ${visibleTop + EDGE_INSET + offset}px, 0)`;
    }

    if (showX) {
      const track = Math.max(MIN_THUMB_SIZE, visibleWidth - EDGE_INSET * 2);
      const thumb = Math.max(MIN_THUMB_SIZE, track * scroller.clientWidth / scroller.scrollWidth);
      const maxScroll = Math.max(1, scroller.scrollWidth - scroller.clientWidth);
      const offset = (track - thumb) * scroller.scrollLeft / maxScroll;
      horizontal.style.width = `${thumb}px`;
      horizontal.style.transform = `translate3d(${visibleLeft + EDGE_INSET + offset}px, ${Math.max(visibleTop, visibleBottom - 7)}px, 0)`;
    }

    layer.classList.toggle('visible', showX || showY);
  }

  function queueRender() {
    if (frame === null) frame = window.requestAnimationFrame(render);
  }

  function activate(scroller, autoHide = false) {
    if (!scroller) return;
    activeScroller = scroller;
    layer.classList.toggle('elevated', Boolean(scroller.closest?.(
      '.date-picker, .context-menu, .quick-popup, .glass-select-menu, .detail-dropdown, .month-picker-menu'
    )));
    window.clearTimeout(hideTimer);
    queueRender();
    if (autoHide) hide();
  }

  document.addEventListener('pointerover', (event) => activate(findScrollable(event.target)), true);
  document.addEventListener('pointerout', (event) => {
    if (!activeScroller || activeScroller.contains(event.relatedTarget)) return;
    hide(LEAVE_HIDE_DELAY);
  }, true);
  document.addEventListener('scroll', (event) => activate(event.target, true), true);
  window.addEventListener('resize', () => {
    if (activeScroller) activate(activeScroller, true);
  });
  document.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return;
    const scroller = findScrollable(document.activeElement);
    if (scroller) activate(scroller, true);
  });
}
