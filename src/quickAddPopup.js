import { toLocalDateInput } from './utils/date.js';
import { escapeHtml } from './utils/html.js';
import { initDatePicker } from './datePicker.js';
import { iconSvg } from './icons.js';

function closeAllPopups() {
  document.querySelectorAll('.quick-popup').forEach(el => el.remove());
  document.querySelectorAll('.add-task-actions button[aria-expanded="true"]').forEach(button => {
    button.setAttribute('aria-expanded', 'false');
  });
}

function closePopup(popup, trigger) {
  popup.remove();
  trigger.setAttribute('aria-expanded', 'false');
}

function adjustPopupPosition(popup, trigger, container) {
  requestAnimationFrame(() => {
    const containerRect = container.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const desiredLeft = triggerRect.right - containerRect.left - popupRect.width;
    const maxLeft = Math.max(8, containerRect.width - popupRect.width - 8);

    const left = Math.min(Math.max(8, desiredLeft), maxLeft);
    popup.style.position = 'fixed';
    popup.style.left = `${containerRect.left + left}px`;
    popup.style.top = `${containerRect.bottom + 8}px`;
    popup.style.right = 'auto';
    popup.style.bottom = 'auto';

    const positionedRect = popup.getBoundingClientRect();
    if (positionedRect.bottom > window.innerHeight - 8) {
      popup.style.top = 'auto';
      popup.style.bottom = `${window.innerHeight - containerRect.top + 8}px`;
    }
  });
}

function enhancePopupOptions(popup, trigger, selector, optionsRoot = popup) {
  optionsRoot.setAttribute('role', 'listbox');
  const options = [...optionsRoot.querySelectorAll(selector)];
  if (!options.length) return;

  options.forEach((option, index) => {
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(option.classList.contains('selected')));
    option.tabIndex = -1;
    option.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const offset = event.key === 'ArrowDown' ? 1 : -1;
        options[(index + offset + options.length) % options.length].focus();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        option.click();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closePopup(popup, trigger);
        trigger.focus();
      }
    });
  });

  const initial = optionsRoot.querySelector(`${selector}.selected`) || options[0];
  initial.tabIndex = 0;
  requestAnimationFrame(() => initial.focus());
}

export function initQuickAddPopups({
  quickAddPreset,
  updateQuickAddIndicators,
  data,
  getTagDotStyle,
  getNextTagDotStyle,
  createTag
}) {
  const container = document.querySelector('.add-task-bar');
  const dateButton = document.getElementById('btn-set-date');
  const priorityButton = document.getElementById('btn-set-priority');
  const tagButton = document.getElementById('btn-set-tag');

  [dateButton, priorityButton, tagButton].forEach(button => {
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
  });

  dateButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllPopups();
    const popup = document.createElement('div');
    popup.className = 'quick-popup quick-popup-date';
    dateButton.setAttribute('aria-expanded', 'true');
    const todayStr = toLocalDateInput(new Date());
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const tomorrowStr = toLocalDateInput(tomorrow);
    const nextWeekStr = toLocalDateInput(nextWeek);
    popup.innerHTML = `
      <div class="popup-title">截止日期</div>
      <div class="popup-option ${quickAddPreset.endTime === todayStr ? 'selected' : ''}" data-date="${todayStr}">${iconSvg('sun')}<span>今天</span></div>
      <div class="popup-option ${quickAddPreset.endTime === tomorrowStr ? 'selected' : ''}" data-date="${tomorrowStr}">${iconSvg('calendar')}<span>明天</span></div>
      <div class="popup-option ${quickAddPreset.endTime === nextWeekStr ? 'selected' : ''}" data-date="${nextWeekStr}">${iconSvg('calendar-range')}<span>下周</span></div>
      <div class="popup-divider"></div>
      <div class="popup-custom-date">
        <input type="text" class="popup-date-input" value="${quickAddPreset.endTime || ''}">
      </div>
      ${quickAddPreset.endTime ? `<div class="popup-option popup-clear" data-date="">${iconSvg('x')}<span>清除日期</span></div>` : ''}
    `;
    document.body.appendChild(popup);
    adjustPopupPosition(popup, dateButton, container);
    initDatePicker(popup.querySelector('.popup-date-input'), { mode: 'date' });

    popup.querySelectorAll('[data-date]').forEach(opt => {
      opt.addEventListener('click', () => {
        quickAddPreset.endTime = opt.dataset.date || null;
        updateQuickAddIndicators();
        closePopup(popup, dateButton);
      });
    });
    popup.querySelector('.popup-date-input').addEventListener('change', (ev) => {
      quickAddPreset.endTime = ev.target.value || null;
      updateQuickAddIndicators();
      closePopup(popup, dateButton);
    });
    enhancePopupOptions(popup, dateButton, '[data-date]');
  });

  priorityButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllPopups();
    const popup = document.createElement('div');
    popup.className = 'quick-popup quick-popup-priority';
    priorityButton.setAttribute('aria-expanded', 'true');
    popup.innerHTML = `
      <div class="popup-title">优先级</div>
      <div class="popup-option ${quickAddPreset.priority === 'high' ? 'selected' : ''}" data-priority="high"><span class="prio-dot prio-high"></span>高</div>
      <div class="popup-option ${quickAddPreset.priority === 'medium' ? 'selected' : ''}" data-priority="medium"><span class="prio-dot prio-medium"></span>中</div>
      <div class="popup-option ${quickAddPreset.priority === 'low' ? 'selected' : ''}" data-priority="low"><span class="prio-dot prio-low"></span>低</div>
      <div class="popup-option ${quickAddPreset.priority === 'none' ? 'selected' : ''}" data-priority="none"><span class="prio-dot prio-none"></span>无</div>
    `;
    document.body.appendChild(popup);
    adjustPopupPosition(popup, priorityButton, container);

    popup.querySelectorAll('[data-priority]').forEach(opt => {
      opt.addEventListener('click', () => {
        quickAddPreset.priority = opt.dataset.priority;
        updateQuickAddIndicators();
        closePopup(popup, priorityButton);
      });
    });
    enhancePopupOptions(popup, priorityButton, '[data-priority]');
  });

  tagButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllPopups();
    const popup = document.createElement('div');
    popup.className = 'quick-popup quick-popup-tag';
    tagButton.setAttribute('aria-expanded', 'true');
    const tagOptions = data.tags.map(tag =>
      `<div class="popup-option ${quickAddPreset.tag === tag ? 'selected' : ''}" data-tag="${escapeHtml(tag)}"><span class="tag-dot" ${getTagDotStyle(tag)}></span>${escapeHtml(tag)}</div>`
    ).join('');
    popup.innerHTML = `
      <div class="popup-title">标签</div>
      <div class="quick-tag-options" aria-label="可用标签">
        ${tagOptions || '<div class="popup-empty">暂无标签</div>'}
      </div>
      ${quickAddPreset.tag ? `<button class="popup-option popup-clear quick-tag-clear" type="button" data-tag="">${iconSvg('x')}<span>清除标签</span></button>` : ''}
      <div class="quick-tag-create">
        <span class="tag-dot quick-tag-create-swatch" ${getNextTagDotStyle()} aria-hidden="true"></span>
        <input class="quick-tag-create-input" type="text" maxlength="20" autocomplete="off" spellcheck="false" aria-label="新标签名称" placeholder="新建标签">
        <button class="quick-tag-create-btn" type="button" aria-label="创建并选择标签" title="创建并选择标签">${iconSvg('plus')}<span>创建</span></button>
      </div>
<div class="quick-tag-feedback" role="status" aria-live="polite"></div>
    `;
    document.body.appendChild(popup);
    adjustPopupPosition(popup, tagButton, container);

    popup.querySelectorAll('[data-tag]').forEach(opt => {
      opt.addEventListener('click', () => {
        quickAddPreset.tag = opt.dataset.tag || '';
        updateQuickAddIndicators();
        closePopup(popup, tagButton);
      });
    });

    const input = popup.querySelector('.quick-tag-create-input');
    const feedback = popup.querySelector('.quick-tag-feedback');
    const submitTag = () => {
      const name = input.value.trim();
      if (!name) {
        input.setAttribute('aria-invalid', 'true');
        feedback.textContent = '请输入标签名称';
        input.focus();
        return;
      }

      const result = createTag(name);
      if (!result?.tag) {
        input.setAttribute('aria-invalid', 'true');
        feedback.textContent = result?.message || '无法创建标签';
        input.focus();
        return;
      }

      quickAddPreset.tag = result.tag;
      updateQuickAddIndicators();
      closePopup(popup, tagButton);
      tagButton.focus();
    };

    input.addEventListener('input', () => {
      input.removeAttribute('aria-invalid');
      feedback.textContent = '';
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submitTag();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closePopup(popup, tagButton);
        tagButton.focus();
      }
    });
    popup.querySelector('.quick-tag-create-btn').addEventListener('click', submitTag);
    enhancePopupOptions(popup, tagButton, '[data-tag]', popup.querySelector('.quick-tag-options'));
  });

  document.addEventListener('click', (e) => {
    const interactionSelector =
      '.quick-popup, .add-task-actions, .date-picker, .glass-select-menu, .month-picker-menu';
    const isQuickAddInteraction = e.composedPath().some(node => node?.matches?.(interactionSelector));
    if (!isQuickAddInteraction) {
      closeAllPopups();
    }
  });
}
