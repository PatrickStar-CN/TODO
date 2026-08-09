import { createIcon } from './icons.js';

function createMenuItemContent(icon, label, iconClass = '', color = '') {
  const iconSpan = document.createElement('span');
  iconSpan.className = 'menu-icon';
  if (color) {
    const colorDot = document.createElement('span');
    colorDot.className = 'menu-color-dot';
    colorDot.style.setProperty('--menu-item-color', color);
    iconSpan.appendChild(colorDot);
  } else {
    const iconEl = icon ? createIcon(icon, iconClass) : null;
    if (iconEl) iconSpan.appendChild(iconEl);
  }
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

  const width = submenu.offsetWidth;
  const height = submenu.offsetHeight;
  const rightSide = wrapperRect.right + 6;
  if (rightSide + width <= window.innerWidth - VIEWPORT_MARGIN) {
    submenu.style.left = `${rightSide}px`;
    submenu.style.right = 'auto';
    wrapper.dataset.submenuSide = 'right';
  } else {
    submenu.style.left = 'auto';
    submenu.style.right = `${window.innerWidth - wrapperRect.left + 6}px`;
    wrapper.dataset.submenuSide = 'left';
  }

  const desiredViewportTop = Math.min(
    Math.max(VIEWPORT_MARGIN, wrapperRect.top - 4),
    Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)
  );
  submenu.style.top = `${desiredViewportTop}px`;
  submenu.style.bottom = 'auto';
}

export function closeContextMenu() {
  document.querySelectorAll('.context-menu').forEach(existing => existing.remove());
}

export function showContextMenu(x, y, items, options = {}) {
  const menu = document.createElement('div');
  menu.className = 'context-menu context-menu-root' + (options.className ? ` ${options.className}` : '');
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
      wrapper.appendChild(createMenuItemContent(item.icon, item.label, item.iconClass));
      const indicator = createIcon('chevron-right', 'submenu-indicator');
      if (indicator) wrapper.appendChild(indicator);
const sub = document.createElement('div');
      sub.className = 'context-menu context-menu-submenu-panel';
      sub.setAttribute('role', 'menu');
      sub.style.visibility = 'hidden';
      wrapper._submenu = sub;
      item.submenu.forEach(subItem => {
        const subEl = document.createElement('div');
        subEl.className = 'context-menu-item';
        subEl.setAttribute('role', 'menuitem');
        subEl.tabIndex = -1;
        subEl.appendChild(createMenuItemContent(subItem.icon, subItem.label, subItem.iconClass, subItem.color));
        if (subItem.selected) {
          subEl.classList.add('is-selected');
          subEl.setAttribute('aria-current', 'true');
          const selectedIcon = createIcon('check', 'menu-item-check');
          if (selectedIcon) subEl.appendChild(selectedIcon);
        }
        subEl.addEventListener('click', () => { closeContextMenu(); subItem.action(); });
        sub.appendChild(subEl);
      });
      document.body.appendChild(sub);
      let closeTimer = null;
      const cancelClose = () => {
        if (closeTimer) {
          window.clearTimeout(closeTimer);
          closeTimer = null;
        }
      };
      const setSubmenuVisible = (visible) => {
        wrapper.setAttribute('aria-expanded', String(visible));
        sub.classList.toggle('is-open', visible);
        sub.style.visibility = visible ? 'visible' : 'hidden';
      };
      const openSubmenu = () => {
        cancelClose();
        menu.querySelectorAll(':scope > .context-menu-submenu[aria-expanded="true"]').forEach(openItem => {
          if (openItem !== wrapper) {
            openItem.setAttribute('aria-expanded', 'false');
            openItem.classList.remove('is-open');
          }
        });
        positionSubmenu(wrapper, sub);
        setSubmenuVisible(true);
      };
      const scheduleClose = () => {
        cancelClose();
        closeTimer = window.setTimeout(() => {
          setSubmenuVisible(false);
          closeTimer = null;
        }, 140);
      };
      wrapper.addEventListener('mouseenter', openSubmenu);
      wrapper.addEventListener('focusin', openSubmenu);
      wrapper.addEventListener('mouseleave', scheduleClose);
      sub.addEventListener('mouseenter', cancelClose);
      sub.addEventListener('mouseleave', scheduleClose);
      menu.appendChild(wrapper);
      return;
    }
    const el = document.createElement('div');
    el.className = 'context-menu-item' + (item.className ? ' ' + item.className : '');
    el.setAttribute('role', 'menuitem');
    el.tabIndex = 0;
    el.appendChild(createMenuItemContent(item.icon, item.label, item.iconClass));
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
        const wrapperEl = document.activeElement;
        const submenu = wrapperEl._submenu;
        positionSubmenu(wrapperEl, submenu);
        wrapperEl.setAttribute('aria-expanded', 'true');
        submenu.classList.add('is-open');
        submenu.style.visibility = 'visible';
        submenu.querySelector('[role="menuitem"]')?.focus();
      } else {
        document.activeElement?.click();
      }
    } else if (e.key === 'ArrowRight' && document.activeElement?.classList.contains('context-menu-submenu')) {
      e.preventDefault();
      const submenu = document.activeElement._submenu;
      positionSubmenu(document.activeElement, submenu);
      document.activeElement.setAttribute('aria-expanded', 'true');
      submenu.classList.add('is-open');
      submenu.style.visibility = 'visible';
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
