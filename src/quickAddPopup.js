import { toLocalDateInput } from './utils/date.js';
import { escapeHtml } from './utils/html.js';

function closeAllPopups() {
  document.querySelectorAll('.quick-popup').forEach(el => el.remove());
}

function adjustPopupPosition(popup) {
  requestAnimationFrame(() => {
    const rect = popup.getBoundingClientRect();
    if (rect.bottom > window.innerHeight) {
      popup.style.top = 'auto';
      popup.style.bottom = 'calc(100% + 8px)';
    }
  });
}

export function initQuickAddPopups({ quickAddPreset, updateQuickAddIndicators, data, getTagDotStyle }) {
  const container = document.querySelector('.add-task-bar');

  document.getElementById('btn-set-date').addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllPopups();
    const popup = document.createElement('div');
    popup.className = 'quick-popup';
    const todayStr = toLocalDateInput(new Date());
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const tomorrowStr = toLocalDateInput(tomorrow);
    const nextWeekStr = toLocalDateInput(nextWeek);
    popup.innerHTML = `
      <div class="popup-title">截止日期</div>
      <div class="popup-option" data-date="${todayStr}">☀️ 今天</div>
      <div class="popup-option" data-date="${tomorrowStr}">📅 明天</div>
      <div class="popup-option" data-date="${nextWeekStr}">📆 下周</div>
      <div class="popup-divider"></div>
      <div class="popup-option popup-custom-date">
        <input type="date" class="popup-date-input" value="${quickAddPreset.endTime || ''}">
      </div>
      ${quickAddPreset.endTime ? '<div class="popup-option popup-clear" data-date="">✕ 清除日期</div>' : ''}
    `;
    container.appendChild(popup);
    adjustPopupPosition(popup);

    popup.querySelectorAll('[data-date]').forEach(opt => {
      opt.addEventListener('click', () => {
        quickAddPreset.endTime = opt.dataset.date || null;
        updateQuickAddIndicators();
        popup.remove();
      });
    });
    popup.querySelector('.popup-date-input').addEventListener('change', (ev) => {
      quickAddPreset.endTime = ev.target.value || null;
      updateQuickAddIndicators();
      popup.remove();
    });
  });

  document.getElementById('btn-set-priority').addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllPopups();
    const popup = document.createElement('div');
    popup.className = 'quick-popup';
    popup.innerHTML = `
      <div class="popup-title">优先级</div>
      <div class="popup-option ${quickAddPreset.priority === 'high' ? 'selected' : ''}" data-priority="high"><span class="prio-dot prio-high"></span>高</div>
      <div class="popup-option ${quickAddPreset.priority === 'medium' ? 'selected' : ''}" data-priority="medium"><span class="prio-dot prio-medium"></span>中</div>
      <div class="popup-option ${quickAddPreset.priority === 'low' ? 'selected' : ''}" data-priority="low"><span class="prio-dot prio-low"></span>低</div>
      <div class="popup-option ${quickAddPreset.priority === 'none' ? 'selected' : ''}" data-priority="none"><span class="prio-dot prio-none"></span>无</div>
    `;
    container.appendChild(popup);
    adjustPopupPosition(popup);

    popup.querySelectorAll('[data-priority]').forEach(opt => {
      opt.addEventListener('click', () => {
        quickAddPreset.priority = opt.dataset.priority;
        updateQuickAddIndicators();
        popup.remove();
      });
    });
  });

  document.getElementById('btn-set-tag').addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllPopups();
    const popup = document.createElement('div');
    popup.className = 'quick-popup';
    const tagOptions = data.tags.map(tag =>
      `<div class="popup-option ${quickAddPreset.tag === tag ? 'selected' : ''}" data-tag="${escapeHtml(tag)}"><span class="tag-dot" ${getTagDotStyle(tag)}></span>${escapeHtml(tag)}</div>`
    ).join('');
    popup.innerHTML = `
      <div class="popup-title">标签</div>
      ${tagOptions || '<div class="popup-empty">暂无标签</div>'}
      ${quickAddPreset.tag ? '<div class="popup-option popup-clear" data-tag="">✕ 清除标签</div>' : ''}
    `;
    container.appendChild(popup);
    adjustPopupPosition(popup);

    popup.querySelectorAll('[data-tag]').forEach(opt => {
      opt.addEventListener('click', () => {
        quickAddPreset.tag = opt.dataset.tag || '';
        updateQuickAddIndicators();
        popup.remove();
      });
    });
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.quick-popup') && !e.target.closest('.add-task-actions')) {
      closeAllPopups();
    }
  });
}
