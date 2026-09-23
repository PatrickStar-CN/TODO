const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function getFocusableElements(container) {
  if (!container || typeof container.querySelectorAll !== 'function') return [];
  return [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter((el) => {
    if (el.hasAttribute('disabled')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
    if (rect && rect.width === 0 && rect.height === 0) return false;
    return el.offsetParent !== null || el === document.activeElement;
  });
}

export function trapTabKey(container, event) {
  if (event.key !== 'Tab' || !container) return;
  const focusable = getFocusableElements(container);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function createFocusTrap(container, options = {}) {
  if (!container) return () => {};
  const previouslyFocused = options.previouslyFocused || document.activeElement;
  const initialTarget = options.initialFocus
    || container.querySelector('[data-autofocus]')
    || getFocusableElements(container)[0];
  if (initialTarget && typeof initialTarget.focus === 'function') {
    requestAnimationFrame(() => {
      if (document.contains(initialTarget)) initialTarget.focus({ preventScroll: true });
    });
  }

  const onKeydown = (event) => {
    if (event.key === 'Tab') trapTabKey(container, event);
    if (event.key === 'Escape' && typeof options.onEscape === 'function') {
      event.preventDefault();
      options.onEscape(event);
    }
  };
  container.addEventListener('keydown', onKeydown);
  return () => {
    container.removeEventListener('keydown', onKeydown);
    if (previouslyFocused && document.contains(previouslyFocused) && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus({ preventScroll: true });
    }
  };
}

export function enableRovingTablist(container, selector = '[role="tab"]') {
  if (!container) return () => {};
  const getTabs = () => [...container.querySelectorAll(selector)];
  const onKeydown = (event) => {
    const tabs = getTabs();
    if (tabs.length === 0) return;
    const currentIndex = tabs.indexOf(document.activeElement);
    if (currentIndex === -1) return;
    let nextIndex = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === -1) return;
    event.preventDefault();
    const next = tabs[nextIndex];
    next.focus();
    if (typeof next.click === 'function') next.click();
  };
  container.addEventListener('keydown', onKeydown);
  return () => container.removeEventListener('keydown', onKeydown);
}
