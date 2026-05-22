export function applyTheme(theme) {
  const resolved = theme || 'auto';
  if (resolved === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', resolved);
  }
}

export function updateThemeButton(theme) {
  const icons = { auto: '🌗', light: '☀️', dark: '🌙' };
  const titles = { auto: '跟随系统', light: '白天模式', dark: '夜间模式' };
  const btn = document.getElementById('btn-theme-toggle');
  btn.textContent = icons[theme] || icons.auto;
  btn.title = titles[theme] || titles.auto;
}
