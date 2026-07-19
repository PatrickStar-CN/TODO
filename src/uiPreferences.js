export const DEFAULT_UI_STYLE = Object.freeze({
  radius: 12,
  glassOpacity: 72,
  borderStrength: 0,
  fontScale: 100,
  blur: 18,
  motionSpeed: 100
});

const LIMITS = Object.freeze({
  radius: [6, 20],
  glassOpacity: [35, 100],
  borderStrength: [0, 0],
  fontScale: [90, 115],
  blur: [8, 28],
  motionSpeed: [0, 200]
});

export function normalizeUiStyle(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};

  Object.entries(DEFAULT_UI_STYLE).forEach(([key, fallback]) => {
    const parsed = Number(source[key]);
    const [min, max] = LIMITS[key];
    if (!Number.isFinite(parsed)) {
      result[key] = fallback;
      return;
    }
    const rounded = key === 'motionSpeed'
      ? Math.round(parsed / 50) * 50
      : Math.round(parsed);
    result[key] = Math.min(max, Math.max(min, rounded));
  });

  return result;
}

export function applyUiStyle(value) {
  const style = normalizeUiStyle(value);
  const root = document.documentElement;

  root.style.setProperty('--ui-radius', `${style.radius}px`);
  root.style.setProperty('--ui-radius-sm', `${Math.max(5, Math.round(style.radius * 0.72))}px`);
  root.style.setProperty('--ui-radius-xs', `${Math.max(2, Math.round(style.radius * 0.42))}px`);
  root.style.setProperty('--ui-radius-lg', `${style.radius + 6}px`);
  root.style.setProperty('--ui-glass-opacity', `${style.glassOpacity}%`);
  root.style.setProperty('--ui-glass-strong-opacity', `${Math.min(100, style.glassOpacity + 18)}%`);
  root.style.setProperty('--ui-control-opacity', `${Math.min(100, Math.max(48, style.glassOpacity + 10))}%`);
  root.style.setProperty('--ui-overlay-opacity', `${Math.min(72, Math.max(28, Math.round(style.glassOpacity * 0.58)))}%`);
  root.style.setProperty('--ui-border-strength', `${style.borderStrength}%`);
  root.style.setProperty('--ui-font-scale', String(style.fontScale / 100));
  root.style.setProperty('--ui-glass-blur', `${style.blur}px`);
  root.style.setProperty('--ui-glass-blur-light', `${Math.max(6, Math.round(style.blur * 0.65))}px`);

  const motionFactor = style.motionSpeed === 0 ? 0 : 100 / style.motionSpeed;
  const fastDuration = style.motionSpeed === 0 ? 0.01 : Math.round(140 * motionFactor);
  const normalDuration = style.motionSpeed === 0 ? 0.01 : Math.round(220 * motionFactor);
  const panelDuration = style.motionSpeed === 0 ? 0.01 : Math.round(280 * motionFactor);
  root.dataset.motion = style.motionSpeed === 0 ? 'off' : 'on';
  root.style.setProperty('--duration-fast', `${fastDuration}ms`);
  root.style.setProperty('--duration-normal', `${normalDuration}ms`);
  root.style.setProperty('--duration-panel', `${panelDuration}ms`);
  root.style.setProperty('--motion-fast', `${fastDuration}ms cubic-bezier(0.2, 0, 0.2, 1)`);
  root.style.setProperty('--motion-normal', `${normalDuration}ms cubic-bezier(0.2, 0, 0.2, 1)`);
  root.style.setProperty('--motion-panel', `${panelDuration}ms cubic-bezier(0.16, 1, 0.3, 1)`);

  return style;
}

export function getUiMotionDuration(kind = 'panel') {
  const fallback = kind === 'fast' ? 140 : kind === 'normal' ? 220 : 280;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(`--duration-${kind}`)
    .trim();
  const duration = Number.parseFloat(raw);
  return Number.isFinite(duration) ? duration : fallback;
}
