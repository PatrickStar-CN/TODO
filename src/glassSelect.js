import { escapeHtml } from './utils/html.js';

export function renderGlassSelect({ id = '', className = '', value, options, ariaLabel }) {
  const normalized = options.map(option => ({
    value: String(option.value),
    label: String(option.label),
  }));
  const selectedValue = String(value);
  const selected = normalized.find(option => option.value === selectedValue) || normalized[0];
  const idAttr = id ? ` id="${escapeHtml(id)}"` : '';
  const menuId = id ? `${id}-menu` : `glass-select-${Math.random().toString(36).slice(2)}-menu`;

  return `
    <div class="glass-select${className ? ` ${escapeHtml(className)}` : ''}"${idAttr} data-value="${escapeHtml(selected.value)}">
      <button class="glass-select-trigger" type="button" aria-label="${escapeHtml(ariaLabel)}" aria-haspopup="listbox" aria-expanded="false" aria-controls="${escapeHtml(menuId)}">
        <span class="glass-select-value">${escapeHtml(selected.label)}</span>
        <svg class="detail-select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>
      </button>
      <div class="glass-select-menu hidden" id="${escapeHtml(menuId)}" role="listbox">
        ${normalized.map(option => `
          <button class="glass-select-option${option.value === selected.value ? ' selected' : ''}" type="button" role="option" data-value="${escapeHtml(option.value)}" aria-selected="${option.value === selected.value}">${escapeHtml(option.label)}</button>
        `).join('')}
      </div>
    </div>`;
}

export function initGlassSelectGroup(container, { onChange } = {}) {
  const selects = [...container.querySelectorAll('.glass-select')];

  const closeMenus = (except = null) => {
    selects.forEach(select => {
      if (select === except) return;
      select.classList.remove('is-open');
      select.querySelector('.glass-select-trigger').setAttribute('aria-expanded', 'false');
      select.querySelector('.glass-select-menu').classList.add('hidden');
    });
  };

  const openMenu = (select, focusSelected = false) => {
    closeMenus(select);
    select.classList.add('is-open');
    select.querySelector('.glass-select-trigger').setAttribute('aria-expanded', 'true');
    select.querySelector('.glass-select-menu').classList.remove('hidden');
    const selectedOption = select.querySelector('.glass-select-option.selected');
    selectedOption?.scrollIntoView({ block: 'nearest' });
    if (focusSelected) selectedOption?.focus();
  };

  const chooseOption = (select, option) => {
    select.dataset.value = option.dataset.value;
    select.querySelector('.glass-select-value').textContent = option.textContent;
    select.querySelectorAll('.glass-select-option').forEach(item => {
      const isSelected = item === option;
      item.classList.toggle('selected', isSelected);
      item.setAttribute('aria-selected', String(isSelected));
    });
    closeMenus();
    select.querySelector('.glass-select-trigger').focus();
    onChange?.(select, option.dataset.value, option);
  };

  selects.forEach(select => {
    const trigger = select.querySelector('.glass-select-trigger');
    const menu = select.querySelector('.glass-select-menu');
    const options = [...select.querySelectorAll('.glass-select-option')];

    trigger.addEventListener('click', event => {
      event.stopPropagation();
      if (select.classList.contains('is-open')) closeMenus();
      else openMenu(select);
    });

    trigger.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      event.stopPropagation();
      openMenu(select, true);
    });

    options.forEach((option, index) => {
      option.addEventListener('click', event => {
        event.stopPropagation();
        chooseOption(select, option);
      });
      option.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          const offset = event.key === 'ArrowDown' ? 1 : -1;
          options[(index + offset + options.length) % options.length].focus();
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          chooseOption(select, option);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeMenus();
          trigger.focus();
        }
      });
    });

    menu.addEventListener('click', event => event.stopPropagation());
  });

  return { closeMenus };
}
