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

function computeSubmenuPosition(wrapper, submenu) {
  const wrapperRect = wrapper.getBoundingClientRect();
  const availableHeight = window.innerHeight - VIEWPORT_MARGIN * 2;
  const maxHeight = Math.max(120, Math.min(320, availableHeight));
  submenu.style.maxHeight = `${maxHeight}px`;
  submenu.style.overflowY = submenu.scrollHeight > maxHeight ? 'auto' : 'visible';

  const width = submenu.offsetWidth;
  const height = submenu.offsetHeight;
  const sideSpace = wrapperRect.right + 6;
  const fitsRight = sideSpace + width <= window.innerWidth - VIEWPORT_MARGIN;
  const left = fitsRight
    ? sideSpace
    : Math.max(VIEWPORT_MARGIN, wrapperRect.left - width - 6);

  const top = Math.min(
    Math.max(VIEWPORT_MARGIN, wrapperRect.top - 4),
    Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)
  );
  return { left, top, side: fitsRight ? 'right' : 'left' };
}

export function closeContextMenu() {
  document.querySelectorAll('.context-menu').forEach(existing => existing.remove());
}

export function showContextMenu(x, y, items, options = {}) {
  const menu = document.createElement('div');
  menu.className = 'context-menu context-menu-root' + (options.className ? ` ${options.className}` : '');
  menu.setAttribute('role', 'menu');
  menu.style.visibility = 'hidden';

  let submenuPanel = null;
  let activeWrapper = null;
  let submenuTimer = null;

  const cancelSubmenuTimer = () => {
    if (submenuTimer) {
      window.clearTimeout(submenuTimer);
      submenuTimer = null;
    }
  };
  const hideSubmenu = () => {
    cancelSubmenuTimer();
    if (submenuPanel) {
      submenuPanel.classList.remove('is-open');
      submenuPanel.style.visibility = 'hidden';
    }
    if (activeWrapper) {
      activeWrapper.setAttribute('aria-expanded', 'false');
      activeWrapper = null;
    }
  };
  const scheduleSubmenuClose = () => {
    cancelSubmenuTimer();
    submenuTimer = window.setTimeout(() => {
      submenuTimer = null;
      hideSubmenu();
    }, 140);
  };
  const getOrCreateSubmenuPanel = () => {
    if (!submenuPanel) {
      const panel = document.createElement('div');
      panel.className = 'context-menu context-menu-submenu-panel';
      panel.setAttribute('role', 'menu');
      panel.style.visibility = 'hidden';
      document.body.appendChild(panel);
      panel.addEventListener('mouseenter', cancelSubmenuTimer);
      panel.addEventListener('mouseleave', scheduleSubmenuClose);
      panel.addEventListener('focusout', (e) => {
        const next = e.relatedTarget;
        const owner = panel._ownerWrapper;
        if (next && (panel.contains(next) || (owner && (next === owner || owner.contains(next))))) return;
        hideSubmenu();
      });
      panel.addEventListener('keydown', (e) => {
        const submenuItems = [...panel.querySelectorAll('[role="menuitem"]')];
        const idx = submenuItems.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          submenuItems[(idx + 1) % submenuItems.length]?.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          submenuItems[(idx - 1 + submenuItems.length) % submenuItems.length]?.focus();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          e.stopPropagation();
          const wrapper = panel._ownerWrapper;
          if (wrapper) {
            wrapper._closeSubmenu?.();
            wrapper.focus();
          }
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          document.activeElement?.click();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          closeContextMenu();
        }
      });
      submenuPanel = panel;
    }
    return submenuPanel;
  };
  const openSubmenu = (wrapper, instant = false) => {
    cancelSubmenuTimer();
    if (activeWrapper && activeWrapper !== wrapper) {
      activeWrapper.setAttribute('aria-expanded', 'false');
    }
    const panel = getOrCreateSubmenuPanel();
    wrapper._submenu = panel;
    panel._ownerWrapper = wrapper;
    panel.replaceChildren(...wrapper._subItems);
    const pos = computeSubmenuPosition(wrapper, panel);
    const previousSide = panel.dataset.submenuSide || '';
    const panelReady = panel.hasAttribute('data-positioned');
    const sideChanged = previousSide && previousSide !== pos.side;
    const alreadyOpenSame = activeWrapper === wrapper && panel.classList.contains('is-open');
    const needsPlace = !alreadyOpenSame && (instant || !panelReady || sideChanged);
    panel.dataset.submenuSide = pos.side;
    wrapper.dataset.submenuSide = pos.side;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    if (needsPlace) {
      panel.classList.remove('is-open');
      panel.style.transition = 'none';
      panel.style.left = `${pos.left}px`;
      panel.style.top = `${pos.top}px`;
      void panel.offsetWidth;
      panel.style.transition = '';
      panel.setAttribute('data-positioned', '');
    } else {
      panel.style.left = `${pos.left}px`;
      panel.style.top = `${pos.top}px`;
    }
    panel.classList.add('is-open');
    panel.style.visibility = 'visible';
    wrapper.setAttribute('aria-expanded', 'true');
    activeWrapper = wrapper;
  };

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
      const subItems = [];
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
        subItems.push(subEl);
      });
      wrapper._subItems = subItems;
      wrapper._openSubmenu = () => openSubmenu(wrapper, true);
      wrapper._closeSubmenu = () => { if (activeWrapper === wrapper) hideSubmenu(); };
      wrapper.addEventListener('mouseenter', () => openSubmenu(wrapper, false));
      wrapper.addEventListener('focusin', (e) => {
        if (menu._justOpened) {
          e.stopPropagation();
          return;
        }
        openSubmenu(wrapper, true);
      });
      wrapper.addEventListener('mouseleave', scheduleSubmenuClose);
      /* 点击（触屏/鼠标）展开子菜单，而不是触发全局关闭 */
      wrapper.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSubmenu(wrapper, false);
        wrapper._submenu?.querySelector('[role="menuitem"]')?.focus();
      });
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
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.context-menu')) closeContextMenu();
    }, { once: true });
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
        document.activeElement._openSubmenu?.();
        document.activeElement._submenu?.querySelector('[role="menuitem"]')?.focus();
      } else {
        document.activeElement?.click();
      }
    } else if (e.key === 'ArrowRight' && document.activeElement?.classList.contains('context-menu-submenu')) {
      e.preventDefault();
      document.activeElement._openSubmenu?.();
      document.activeElement._submenu?.querySelector('[role="menuitem"]')?.focus();
    } else if (e.key === 'ArrowLeft') {
      const wrapper = document.activeElement?.closest('.context-menu-submenu');
      if (wrapper) {
        e.preventDefault();
        wrapper._closeSubmenu?.();
      }
    } else if (e.key === 'Escape') {
      closeContextMenu();
    }
  });

  const firstItem = menu.querySelector('[role="menuitem"]');
  if (firstItem) {
    menu._justOpened = true;
    firstItem.focus();
    setTimeout(() => { menu._justOpened = false; }, 0);
  }
}
