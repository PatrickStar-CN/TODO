export const DEFAULT_UI_STYLE = Object.freeze({
  radius: 12,
  glassOpacity: 72,
  borderStrength: 100,
  fontScale: 100,
  blur: 18
});

const LIMITS = Object.freeze({
  radius: [6, 20],
  glassOpacity: [35, 100],
  borderStrength: [20, 100],
  fontScale: [90, 115],
  blur: [8, 28]
});

export function normalizeUiStyle(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};

  Object.entries(DEFAULT_UI_STYLE).forEach(([key, fallback]) => {
    const parsed = Number(source[key]);
    const [min, max] = LIMITS[key];
    result[key] = Number.isFinite(parsed)
      ? Math.min(max, Math.max(min, Math.round(parsed)))
      : fallback;
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

  return style;
}
