import { formatDateTime, toLocalDatetime } from './utils/date.js';
import { initDatePicker, closeDatePicker } from './datePicker.js';
import { escapeHtml } from './utils/html.js';
import { getUiMotionDuration } from './uiPreferences.js';

let onDoneTimeChange = null;
let getDetailTagColor = () => '#6366f1';

/* 优先级选项配置 */
const PRIORITY_OPTIONS = [
  { value: 'none', label: '无', dotClass: '' },
  { value: 'low', label: '低', dotClass: 'prio-low' },
  { value: 'medium', label: '中', dotClass: 'prio-medium' },
  { value: 'high', label: '高', dotClass: 'prio-high' },
];

/* 重复提醒选项配置 */
const REPEAT_OPTIONS = [
  { value: 'none', label: '不重复' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
];

let activeDropdown = null;
let activeSelect = null;

/** 关闭所有详情下拉弹窗 */
function closeDetailDropdowns() {
  if (activeDropdown) {
    activeDropdown.remove();
    activeDropdown = null;
  }
  if (activeSelect) {
    activeSelect.classList.remove('is-open');
    activeSelect.setAttribute('aria-expanded', 'false');
    activeSelect = null;
  }
}

/** 创建下拉选项弹窗 */
function createDetailDropdown(selectEl, options, getOptionHtml) {
  closeDetailDropdowns();

  const rect = selectEl.getBoundingClientRect();
  const popup = document.createElement('div');
  popup.className = 'detail-dropdown';
  popup.setAttribute('role', 'listbox');

  const itemsHtml = options.map(opt => {
    const isSelected = selectEl.dataset.value === opt.value;
    return `<div class="detail-dropdown-item${isSelected ? ' selected' : ''}" data-value="${opt.value}" role="option" tabindex="-1" aria-selected="${isSelected}">${getOptionHtml(opt)}</div>`;
  }).join('');

  popup.innerHTML = itemsHtml;
  document.body.appendChild(popup);

  /* 定位：在触发器下方 */
  const top = rect.bottom + window.scrollY + 4;
  const left = rect.left + window.scrollX;
  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;
  popup.style.minWidth = `${rect.width}px`;

  /* 防止溢出视口底部 */
  const popupRect = popup.getBoundingClientRect();
  if (popupRect.bottom > window.innerHeight) {
    popup.style.top = `${rect.top + window.scrollY - popupRect.height - 4}px`;
  }

  activeDropdown = popup;
  activeSelect = selectEl;
  selectEl.classList.add('is-open');
  selectEl.setAttribute('aria-expanded', 'true');

  /* 点击选项 */
  const items = [...popup.querySelectorAll('.detail-dropdown-item')];
  items.forEach((item, index) => {
    item.addEventListener('click', () => {
      const val = item.dataset.value;
      selectEl.dataset.value = val;
      const trigger = selectEl.querySelector('.detail-select-trigger');
      if (trigger) {
        const opt = options.find(o => o.value === val);
        trigger.innerHTML = opt ? getOptionHtml(opt) : escapeHtml(val);
      }
      /* 更新选中态 */
      items.forEach(i => {
        i.classList.remove('selected');
        i.setAttribute('aria-selected', 'false');
      });
      item.classList.add('selected');
      item.setAttribute('aria-selected', 'true');
      closeDetailDropdowns();
      selectEl.focus();
    });
    item.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        const offset = event.key === 'ArrowDown' ? 1 : -1;
        items[(index + offset + items.length) % items.length].focus();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        item.click();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeDetailDropdowns();
        selectEl.focus();
      }
    });
  });

  const selectedItem = popup.querySelector('.detail-dropdown-item.selected') || items[0];
  selectedItem?.scrollIntoView({ block: 'nearest' });
  if (selectEl.dataset.keyboardOpen === 'true') {
    delete selectEl.dataset.keyboardOpen;
    requestAnimationFrame(() => selectedItem?.focus());
  }
}

export function initDetailEditor(callbacks) {
  onDoneTimeChange = callbacks.onDoneTimeChange || null;
  const { data, getTagColor: getColor } = callbacks;
  /* 与列表/侧边栏共用同一套标签取色规则（由 app.js 注入） */
  getDetailTagColor = getColor || (() => '#6366f1');

  document.querySelectorAll('.detail-select').forEach(select => {
    select.addEventListener('keydown', (event) => {
      if (!['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      select.dataset.keyboardOpen = 'true';
      select.click();
    });
  });

  /* 优先级下拉 */
  document.getElementById('detail-priority').addEventListener('click', function (e) {
    e.stopPropagation();
    createDetailDropdown(this, PRIORITY_OPTIONS, (opt) =>
      opt.dotClass ? `<span class="prio-dot ${opt.dotClass}"></span>${opt.label}` : opt.label
    );
  });

  /* 标签下拉 */
  document.getElementById('detail-tag').addEventListener('click', function (e) {
    e.stopPropagation();
    const tagOptions = (data.tags || []).map(tag => ({ value: tag, label: tag }));
    createDetailDropdown(this, tagOptions.length > 0 ? tagOptions : [{ value: '', label: '暂无标签' }], (opt) =>
      opt.value ? `<span class="tag-dot" style="background:${getDetailTagColor(opt.value)}"></span>${escapeHtml(opt.label)}` : opt.label
    );
  });

  /* 重复提醒下拉 */
  document.getElementById('detail-reminder-repeat').addEventListener('click', function (e) {
    e.stopPropagation();
    createDetailDropdown(this, REPEAT_OPTIONS, (opt) => opt.label);
  });

  /* 点击外部关闭 */
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.detail-select') && !e.target.closest('.detail-dropdown')) {
      closeDetailDropdowns();
    }
  });
}

/** 标签取色由 app.js 注入，保证详情与列表/侧边栏颜色一致 */

export function openDetail(todo, triggerEl) {
  if (!todo) return;

  const summaryPanel = document.getElementById('summary-panel');
  if (summaryPanel && !summaryPanel.classList.contains('hidden')) {
    summaryPanel.classList.add('hiding');
    summaryPanel.addEventListener('animationend', () => {
      summaryPanel.classList.add('hidden');
      summaryPanel.classList.remove('hiding');
    }, { once: true });
    setTimeout(() => {
      if (summaryPanel.classList.contains('hiding')) {
        summaryPanel.classList.add('hidden');
        summaryPanel.classList.remove('hiding');
      }
    }, 300);
  }

  const detailPanel = document.getElementById('detail-panel');

  // 记录触发位置，用于弹窗从点击处放大动画
  // 优先使用透传的触发元素，避免 querySelector 命中隐藏的重复元素（如日历视图下主列表的隐藏项）
  const el = triggerEl || document.querySelector(`.todo-item[data-id="${todo.id}"]`) || document.activeElement;
  if (el) {
    const rect = el.getBoundingClientRect();
    const originX = rect.left + rect.width / 2 - window.innerWidth / 2;
    const originY = rect.top + rect.height / 2 - window.innerHeight / 2;
    detailPanel.style.setProperty('--origin-x', `${originX}px`);
    detailPanel.style.setProperty('--origin-y', `${originY}px`);
  }

  let overlay = document.querySelector('.detail-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'detail-overlay';
    overlay.addEventListener('click', () => closeDetail());
    document.body.appendChild(overlay);
  } else {
    overlay.classList.remove('hiding');
  }

  detailPanel.classList.remove('hidden', 'hiding');
  detailPanel.style.animation = 'none';
  detailPanel.offsetHeight;
  detailPanel.style.animation = 'modalExpandIn var(--motion-panel)';
  closeDetailDropdowns();

  document.getElementById('detail-id').value = todo.id;
  document.getElementById('detail-title').value = todo.title;
  document.getElementById('detail-desc').value = todo.desc || '';
  document.getElementById('detail-start').value = todo.startTime ? todo.startTime.slice(0, 16) : '';
  document.getElementById('detail-end').value = todo.endTime ? todo.endTime.slice(0, 16) : '';
  document.getElementById('detail-reminder').value = todo.reminder ? todo.reminder.slice(0, 16) : '';
  document.getElementById('detail-todo').checked = !!todo.todo;
  document.getElementById('detail-important').checked = !!todo.important;

  /* 设置自定义下拉值 —— 优先级 */
  const priorityVal = todo.priority || 'none';
  const priorityEl = document.getElementById('detail-priority');
  priorityEl.dataset.value = priorityVal;
  const priorityOption = PRIORITY_OPTIONS.find(o => o.value === priorityVal) || PRIORITY_OPTIONS[0];
  priorityEl.querySelector('.detail-select-trigger').innerHTML = priorityOption.dotClass
    ? `<span class="prio-dot ${priorityOption.dotClass}"></span>${priorityOption.label}`
    : priorityOption.label;

  /* 设置自定义下拉值 —— 标签 */
  const tagVal = todo.tag || '';
  const tagEl = document.getElementById('detail-tag');
  tagEl.dataset.value = tagVal;
  tagEl.querySelector('.detail-select-trigger').innerHTML = tagVal
    ? `<span class="tag-dot" style="background:${getDetailTagColor(tagVal)}"></span>${escapeHtml(tagVal)}`
    : '未设置';

  /* 设置自定义下拉值 —— 重复提醒 */
  const repeatVal = todo.reminderRepeat || 'none';
  const repeatEl = document.getElementById('detail-reminder-repeat');
  repeatEl.dataset.value = repeatVal;
  repeatEl.querySelector('.detail-select-trigger').textContent =
    REPEAT_OPTIONS.find(o => o.value === repeatVal)?.label || '不重复';

  const doneRow = document.getElementById('detail-done-row');
  const doneTimeEl = document.getElementById('detail-done-time');
  if (todo.done && todo.doneAt) {
    doneRow.classList.remove('hidden');
    doneTimeEl.textContent = formatDateTime(todo.doneAt);
    doneTimeEl.style.cursor = 'pointer';
    doneTimeEl.title = '点击修改完成时间';
    doneTimeEl.onclick = () => enterDoneTimeEdit(todo);
  } else {
    doneRow.classList.add('hidden');
    doneTimeEl.textContent = '';
    doneTimeEl.style.cursor = '';
    doneTimeEl.title = '';
    doneTimeEl.onclick = null;
  }
  document.getElementById('detail-created-time').textContent = formatDateTime(new Date(todo.createdAt).toISOString());
}

export function closeDetail() {
  closeDetailDropdowns();
  const panel = document.getElementById('detail-panel');
  if (panel.classList.contains('hidden')) return;

  const overlay = document.querySelector('.detail-overlay');
  if (overlay) {
    overlay.classList.add('hiding');
    overlay.addEventListener('animationend', () => {
      overlay.remove();
    }, { once: true });
    setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, getUiMotionDuration('normal') + 50);
  }

  panel.classList.add('hiding');
  panel.style.animation = 'modalShrinkOut var(--motion-normal) forwards';
  panel.addEventListener('animationend', () => {
    panel.classList.add('hidden');
    panel.classList.remove('hiding');
    panel.style.animation = '';
  }, { once: true });
  setTimeout(() => {
    if (panel.classList.contains('hiding')) {
      panel.classList.add('hidden');
      panel.classList.remove('hiding');
      panel.style.animation = '';
    }
  }, getUiMotionDuration('normal') + 50);
}

function enterDoneTimeEdit(todo) {
  const doneTimeEl = document.getElementById('detail-done-time');
  if (!doneTimeEl || doneTimeEl.tagName === 'INPUT') return;
  if (!todo.done) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'detail-done-input';
  input.value = todo.doneAt ? toLocalDatetime(new Date(todo.doneAt)) : '';

  const wrapper = doneTimeEl.closest('.dp-wrapper') || doneTimeEl;
  wrapper.replaceWith(input);

  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    closeDatePicker();

    const span = document.createElement('span');
    span.id = 'detail-done-time';
    span.className = 'detail-done-value';
    const displayValue = save ? (input.value ? new Date(input.value).toISOString() : null) : todo.doneAt;
    span.textContent = displayValue ? formatDateTime(displayValue) : '';
    span.style.cursor = 'pointer';
    span.title = '点击修改完成时间';
    span.onclick = () => enterDoneTimeEdit(todo);
    const inputWrapper = input.closest('.dp-wrapper') || input;
    inputWrapper.replaceWith(span);

    if (save && onDoneTimeChange) {
      onDoneTimeChange(todo.id, input.value ? new Date(input.value).toISOString() : null);
    }
  };

  initDatePicker(input, { mode: 'datetime', onChange: () => finish(true) });
}
