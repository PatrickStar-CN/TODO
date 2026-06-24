export function applyTheme(theme) {
  const resolved = theme || 'auto';
  if (resolved === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', resolved);
  }
}
