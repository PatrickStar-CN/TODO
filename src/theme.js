let transitionTimer = null;

export function applyTheme(theme, { animate = false } = {}) {
  const preference = ['auto', 'light', 'dark'].includes(theme) ? theme : 'auto';
  const resolved = preference === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : preference;
  const root = document.documentElement;

  if (root.dataset.theme === resolved && root.dataset.themePreference === preference) {
    return resolved;
  }

  const canAnimate = animate
    && root.dataset.theme
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (transitionTimer) clearTimeout(transitionTimer);
  root.classList.toggle('theme-transitioning', Boolean(canAnimate));
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved;

  if (canAnimate) {
    transitionTimer = window.setTimeout(() => {
      root.classList.remove('theme-transitioning');
      transitionTimer = null;
    }, 320);
  }

  return resolved;
}
