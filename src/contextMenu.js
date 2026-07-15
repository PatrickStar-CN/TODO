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

const VIEWPORT_MARGIN = 8;

function positionRootMenu(menu, x, y) {
  const maxHeight = Math.max(120, window.innerHeight - VIEWPORT_MARGIN * 2);
  menu.style.maxHeight = `${maxHeight}px`;
  menu.style.overflowY = menu.scrollHeight > maxHeight ? 'auto' : 'visible';

  /* offsetWidth/offsetHeight ignore the entry scale animation. */
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
  const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);

  menu.style.left = `${Math.min(Math.max(VIEWPORT_MARGIN, x), maxLeft)}px`;
  menu.style.top = `${Math.min(Math.max(VIEWPORT_MARGIN, y), maxTop)}px`;
  menu.style.visibility = 'visible';
}

function positionSubmenu(wrapper, submenu) {
  const wrapperRect = wrapper.getBoundingClientRect();
  const availableHeight = window.innerHeight - VIEWPORT_MARGIN * 2;
  const maxHeight = Math.max(120, Math.min(320, availableHeight));
  submenu.style.maxHeight = `${maxHeight}px`;
  submenu.style.overflowY = submenu.scrollHeight > maxHeight ? 'auto' : 'visible';
  submenu.style.left = '100%';
  submenu.style.right = 'auto';
  submenu.style.top = '-4px';

  const width = submenu.offsetWidth;
  const height = submenu.offsetHeight;
  if (wrapperRect.right + width > window.innerWidth - VIEWPORT_MARGIN) {
    submenu.style.left = 'auto';
    submenu.style.right = '100%';
  }

  const desiredViewportTop = Math.min(
    Math.max(VIEWPORT_MARGIN, wrapperRect.top - 4),
    Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)
  );
  submenu.style.top = `${desiredViewportTop - wrapperRect.top}px`;
}

export function closeContextMenu() {
  const existing = document.querySelector('.context-menu');
  if (existing) existing.remove();
}

export function showContextMenu(x, y, items) {
  const menu = document.createElement('div');
  menu.className = 'context-menu context-menu-root';
  menu.setAttribute('role', 'menu');
  menu.style.visibility = 'hidden';
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
      wrapper.setAttribute('role', 'menuitem');
      wrapper.setAttribute('aria-haspopup', 'menu');
      wrapper.setAttribute('aria-expanded', 'false');
      wrapper.tabIndex = 0;
      wrapper.appendChild(createMenuItemContent(item.icon, item.label));
      const sub = document.createElement('div');
      sub.className = 'context-menu context-menu-submenu-panel';
      sub.setAttribute('role', 'menu');
      item.submenu.forEach(subItem => {
        const subEl = document.createElement('div');
        subEl.className = 'context-menu-item';
        subEl.setAttribute('role', 'menuitem');
        subEl.tabIndex = -1;
        subEl.textContent = subItem.label;
        subEl.addEventListener('click', () => { closeContextMenu(); subItem.action(); });
        sub.appendChild(subEl);
      });
      wrapper.appendChild(sub);
      const openSubmenu = () => {
        positionSubmenu(wrapper, sub);
        wrapper.setAttribute('aria-expanded', 'true');
      };
      wrapper.addEventListener('mouseenter', openSubmenu);
      wrapper.addEventListener('focusin', openSubmenu);
      wrapper.addEventListener('mouseleave', () => wrapper.setAttribute('aria-expanded', 'false'));
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
  positionRootMenu(menu, x, y);
  setTimeout(() => {
    document.addEventListener('click', closeContextMenu, { once: true });
    document.addEventListener('contextmenu', closeContextMenu, { once: true, capture: true });
  }, 0);

  menu.addEventListener('keydown', (e) => {
    const menuItems = [...menu.querySelectorAll(':scope > [role="menuitem"]')];
    const idx = menuItems.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      menuItems[(idx + 1) % menuItems.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      menuItems[(idx - 1 + menuItems.length) % menuItems.length]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (document.activeElement?.classList.contains('context-menu-submenu')) {
        const submenu = document.activeElement.querySelector('.context-menu-submenu-panel');
        positionSubmenu(document.activeElement, submenu);
        document.activeElement.setAttribute('aria-expanded', 'true');
        submenu.querySelector('[role="menuitem"]')?.focus();
      } else {
        document.activeElement?.click();
      }
    } else if (e.key === 'ArrowRight' && document.activeElement?.classList.contains('context-menu-submenu')) {
      e.preventDefault();
      const submenu = document.activeElement.querySelector('.context-menu-submenu-panel');
      positionSubmenu(document.activeElement, submenu);
      document.activeElement.setAttribute('aria-expanded', 'true');
      submenu.querySelector('[role="menuitem"]')?.focus();
    } else if (e.key === 'ArrowLeft') {
      const wrapper = document.activeElement?.closest('.context-menu-submenu');
      if (wrapper && wrapper !== document.activeElement) {
        e.preventDefault();
        wrapper.focus();
      }
    } else if (e.key === 'Escape') {
      closeContextMenu();
    }
  });

  const firstItem = menu.querySelector('[role="menuitem"]');
  if (firstItem) firstItem.focus();
}
