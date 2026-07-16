const ICONS = {
  settings: `
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V20.3h-3v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7.08 15a1.7 1.7 0 0 0-1.55-1H5.4v-3h.13a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06L8.8 5.94l.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1-1.55V4.7h3v.09a1.7 1.7 0 0 0 1 1.55A1.7 1.7 0 0 0 17.62 6l.06-.06 2.12 2.12-.06.06A1.7 1.7 0 0 0 19.4 10a1.7 1.7 0 0 0 1.55 1h.13v3h-.13a1.7 1.7 0 0 0-1.55 1Z"></path>`,
  sun: `
    <circle cx="12" cy="12" r="4"></circle>
    <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"></path>`,
  moon: `<path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"></path>`,
  monitor: `
    <rect x="3" y="4" width="18" height="12" rx="2"></rect>
    <path d="M8 20h8M12 16v4"></path>`,
  star: `<path d="m12 2.8 2.84 5.75 6.35.92-4.6 4.48 1.09 6.32L12 17.29l-5.68 2.98 1.09-6.32-4.6-4.48 6.35-.92L12 2.8Z"></path>`,
  'star-filled': `<path fill="currentColor" d="m12 2.8 2.84 5.75 6.35.92-4.6 4.48 1.09 6.32L12 17.29l-5.68 2.98 1.09-6.32-4.6-4.48 6.35-.92L12 2.8Z"></path>`,
  inbox: `
    <path d="M4 5h16l2 9v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5l2-9Z"></path>
    <path d="M2 14h5l2 3h6l2-3h5"></path>`,
  archive: `
    <rect x="3" y="5" width="18" height="4" rx="1"></rect>
    <path d="M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"></path>`,
  calendar: `
    <rect x="3" y="5" width="18" height="16" rx="2"></rect>
    <path d="M16 3v4M8 3v4M3 10h18"></path>`,
  'calendar-range': `
    <rect x="3" y="5" width="18" height="16" rx="2"></rect>
    <path d="M16 3v4M8 3v4M3 10h18M7 14h3M14 14h3M7 18h10"></path>`,
  today: `
    <circle cx="12" cy="12" r="8"></circle>
    <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"></circle>`,
  pin: `
    <path d="m15 4 5 5-3 1-4 4-1 5-2-5-5-2 5-1 4-4 1-3Z"></path>
    <path d="m9 15-5 5"></path>`,
  'chevron-left': `<path d="m15 18-6-6 6-6"></path>`,
  'chevron-right': `<path d="m9 18 6-6-6-6"></path>`,
  'chevron-up': `<path d="m18 15-6-6-6 6"></path>`,
  'chevron-down': `<path d="m6 9 6 6 6-6"></path>`,
  trash: `
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v5M14 11v5"></path>`,
  x: `<path d="m6 6 12 12M18 6 6 18"></path>`,
  plus: `<path d="M12 5v14M5 12h14"></path>`,
  flag: `
    <path d="M5 21V4"></path>
    <path d="M5 5h10l-1.5 3L15 11H5"></path>`,
  tag: `
    <path d="M20 13 13 20l-9-9V4h7l9 9Z"></path>
    <circle cx="8.5" cy="8.5" r="1"></circle>`,
  search: `
    <circle cx="11" cy="11" r="7"></circle>
    <path d="m20 20-4-4"></path>`,
  document: `
    <path d="M6 2h9l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"></path>
    <path d="M14 2v6h6M8 13h8M8 17h6"></path>`,
  window: `
    <rect x="3" y="4" width="18" height="16" rx="2"></rect>
    <path d="M3 9h18M8 9v11"></path>`,
  check: `<path d="m5 12 4 4L19 6"></path>`,
  undo: `
    <path d="M9 7 4 12l5 5"></path>
    <path d="M4 12h9a6 6 0 0 1 6 6"></path>`,
  upload: `
    <path d="M12 16V4M7 9l5-5 5 5"></path>
    <path d="M5 14v6h14v-6"></path>`,
  alarm: `
    <circle cx="12" cy="13" r="7"></circle>
    <path d="M12 10v4l3 2M5 3 2 6M19 3l3 3M7 21l2-2M17 21l-2-2"></path>`,
  edit: `
    <path d="M12 20h9"></path>
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z"></path>`,
  clipboard: `
    <rect x="5" y="4" width="14" height="18" rx="2"></rect>
    <path d="M9 4V2h6v2M9 10h6M9 14h6M9 18h4"></path>`,
  bell: `
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"></path>`,
  clock: `
    <circle cx="12" cy="12" r="9"></circle>
    <path d="M12 7v5l3 2"></path>`,
  circle: `<circle cx="12" cy="12" r="7" fill="currentColor" stroke="none"></circle>`,
};

export function iconSvg(name, className = '') {
  const content = ICONS[name];
  if (!content) return '';
  const classes = ['app-icon', className].filter(Boolean).join(' ');
  return `<svg class="${classes}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${content}</svg>`;
}

export function createIcon(name, className = '') {
  const template = document.createElement('template');
  template.innerHTML = iconSvg(name, className).trim();
  return template.content.firstElementChild;
}

export function setIcon(element, name, className = '') {
  if (!element) return;
  const icon = createIcon(name, className);
  element.replaceChildren(...(icon ? [icon] : []));
}

export function hydrateIcons(root = document) {
  const nodes = [];
  if (root instanceof Element && root.matches('[data-icon]')) nodes.push(root);
  nodes.push(...root.querySelectorAll('[data-icon]'));
  nodes.forEach((node) => setIcon(node, node.dataset.icon, node.dataset.iconClass || ''));
}
