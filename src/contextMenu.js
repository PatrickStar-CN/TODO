function createMenuItemContent(icon, label) {
  const iconSpan = document.createElement('span');
  iconSpan.className = 'menu-icon';
  iconSpan.textContent = icon || '';
  const textNode = document.createTextNode(label);
  const frag = document.createDocumentFragment();
  frag.appendChild(iconSpan);
  frag.appendChild(textNode);
  return frag;
}

export function closeContextMenu() {
  const existing = document.querySelector('.context-menu');
  if (existing) existing.remove();
}

export function showContextMenu(x, y, items) {
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.setAttribute('role', 'menu');
  items.forEach(item => {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'context-menu-separator';
      menu.appendChild(sep);
      return;
    }
    if (item.submenu) {
      const wrapper = document.createElement('div');
      wrapper.className = 'context-menu-item context-menu-submenu';
      wrapper.appendChild(createMenuItemContent(item.icon, item.label));
      const sub = document.createElement('div');
      sub.className = 'context-menu';
      item.submenu.forEach(subItem => {
        const subEl = document.createElement('div');
        subEl.className = 'context-menu-item';
        subEl.textContent = subItem.label;
        subEl.addEventListener('click', () => { closeContextMenu(); subItem.action(); });
        sub.appendChild(subEl);
      });
      wrapper.appendChild(sub);
      menu.appendChild(wrapper);
      return;
    }
    const el = document.createElement('div');
    el.className = 'context-menu-item' + (item.className ? ' ' + item.className : '');
    el.setAttribute('role', 'menuitem');
    el.tabIndex = 0;
    el.appendChild(createMenuItemContent(item.icon, item.label));
    el.addEventListener('click', () => { closeContextMenu(); item.action(); });
    menu.appendChild(el);
  });
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 4;
  if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 4;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  setTimeout(() => {
    document.addEventListener('click', closeContextMenu, { once: true });
    document.addEventListener('contextmenu', closeContextMenu, { once: true, capture: true });
  }, 0);

  menu.addEventListener('keydown', (e) => {
    const menuItems = [...menu.querySelectorAll('[role="menuitem"]')];
    const idx = menuItems.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      menuItems[(idx + 1) % menuItems.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      menuItems[(idx - 1 + menuItems.length) % menuItems.length]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      document.activeElement?.click();
    } else if (e.key === 'Escape') {
      closeContextMenu();
    }
  });

  const firstItem = menu.querySelector('[role="menuitem"]');
  if (firstItem) firstItem.focus();
}
