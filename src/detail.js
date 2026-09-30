import { formatDateTime, toLocalDatetime } from './utils/date.js';
import { initDatePicker, closeDatePicker, setDatePickerValue } from './datePicker.js';
import { escapeAttr, escapeHtml } from './utils/html.js';
import { getUiMotionDuration } from './uiPreferences.js';
import { createDismissal, cancelPanelDismiss, dismissPanel } from './utils/dismiss.js';
import { createFocusTrap } from './utils/focus.js';
import { getTagDotStyle } from './shared.js';
import { t, getPriorityLabel, getRepeatLabel } from './i18n/index.js';

let onDoneTimeChange = null;
let onBeforeDetailClose = null;
let detailData = null;
let detailReleaseFocus = null;
let detailPreviouslyFocused = null;
let detailOverlay = null;
let detailCloseState = null;

/* 重新打开详情前必须撤销上一次关闭的收尾（动画事件与兜底定时器），
 * 否则展开动画结束时会触发上一次的收尾，把刚打开的面板再次隐藏，
 * 而遮罩仍显示——整层模糊遮罩就此永久挡住所有点击。 */
function cancelDetailClose() {
  detailCloseState?.cancel();
  detailCloseState = null;
  cancelPanelDismiss(document.getElementById('detail-panel'));
}

function startDetailClose(overlay, releaseFocus, previouslyFocused) {
  cancelDetailClose();
  const dismissal = createDismissal();
  detailCloseState = dismissal;
  const removeOverlay = () => {
    if (overlay?.parentNode) overlay.remove();
    if (detailCloseState === dismissal) detailCloseState = null;
  };

  if (overlay) {
    overlay.classList.add('hiding');
    dismissal.onEnd(overlay, removeOverlay);
  }
  /* 面板收起与遮罩移除同一套收尾：动画不触发时由定时器兜底 */
  dismissPanel(document.getElementById('detail-panel'));
  dismissal.after(removeOverlay, getUiMotionDuration('normal') + 50);
  dismissal.after(() => {
    if (typeof releaseFocus === 'function') releaseFocus();
    else if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus({ preventScroll: true });
  }, getUiMotionDuration('normal') + 60);
}

function getDetailOverlay() {
  if (detailOverlay?.isConnected) return detailOverlay;
  detailOverlay = document.querySelector('.detail-overlay');
  return detailOverlay;
}

/* 优先级选项配置 */
function getPriorityOptions() {
  return [
    { value: 'none', label: getPriorityLabel('none'), dotClass: '' },
    { value: 'low', label: getPriorityLabel('low'), dotClass: 'prio-low' },
    { value: 'medium', label: getPriorityLabel('medium'), dotClass: 'prio-medium' },
    { value: 'high', label: getPriorityLabel('high'), dotClass: 'prio-high' },
  ];
}

/* 重复提醒选项配置 */
function getRepeatOptions() {
  return [
    { value: 'none', label: getRepeatLabel('none') },
    { value: 'daily', label: getRepeatLabel('daily') },
    { value: 'weekly', label: getRepeatLabel('weekly') },
    { value: 'monthly', label: getRepeatLabel('monthly') },
  ];
}

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
    return `<div class="detail-dropdown-item${isSelected ? ' selected' : ''}" data-value="${escapeAttr(opt.value)}" role="option" tabindex="-1" aria-selected="${isSelected}">${getOptionHtml(opt)}</div>`;
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
  onBeforeDetailClose = callbacks.onBeforeDetailClose || null;
  detailData = callbacks.data;

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
    createDetailDropdown(this, getPriorityOptions(), (opt) =>
      opt.dotClass ? `<span class="prio-dot ${opt.dotClass}"></span>${opt.label}` : opt.label
    );
  });

  /* 标签下拉 */
  document.getElementById('detail-tag').addEventListener('click', function (e) {
    e.stopPropagation();
    const tagOptions = (detailData?.tags || []).map(tag => ({ value: tag, label: tag }));
    const clearOption = { value: '', label: t('detail.unsetTag') };
    const allOptions = tagOptions.length > 0 ? [clearOption, ...tagOptions] : [{ value: '', label: t('detail.noTag') }];
    createDetailDropdown(this, allOptions, (opt) =>
      opt.value ? `<span class="tag-dot" ${getTagDotStyle(opt.value, detailData?.tags || [])}></span>${escapeHtml(opt.label)}` : escapeHtml(opt.label)
    );
  });

  /* 重复提醒下拉 */
  document.getElementById('detail-reminder-repeat').addEventListener('click', function (e) {
    e.stopPropagation();
    createDetailDropdown(this, getRepeatOptions(), (opt) => opt.label);
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

  /* 打开详情时顺带收起 AI 面板：走统一收尾，动画事件只认面板自身 */
  dismissPanel(document.getElementById('summary-panel'));

  const detailPanel = document.getElementById('detail-panel');

  /* 重开前撤销上一次关闭的收尾，避免遗留的 animationend/定时器
   * 在展开动画结束后把面板再次隐藏，留下无法关闭的遮罩 */
  cancelDetailClose();

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

  let overlay = getDetailOverlay();
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'detail-overlay';
    overlay.addEventListener('click', () => closeDetail());
    document.body.appendChild(overlay);
  }
  overlay.classList.remove('hiding');
  detailOverlay = overlay;

  detailPanel.classList.remove('hidden', 'hiding');
  detailPanel.style.animation = 'none';
  detailPanel.offsetHeight;
  detailPanel.style.animation = 'modalExpandIn var(--motion-panel)';
  closeDetailDropdowns();
  if (typeof detailReleaseFocus === 'function') detailReleaseFocus();
  detailPreviouslyFocused = el && document.contains(el) ? el : document.activeElement;
  detailReleaseFocus = createFocusTrap(detailPanel, {
    previouslyFocused: detailPreviouslyFocused,
    initialFocus: document.getElementById('detail-title') || undefined,
  });

  document.getElementById('detail-id').value = todo.id;
  document.getElementById('detail-title').value = todo.title;
  document.getElementById('detail-desc').value = todo.desc || '';
  setDatePickerValue(document.getElementById('detail-start'), todo.startTime ? todo.startTime.slice(0, 16) : '');
  setDatePickerValue(document.getElementById('detail-end'), todo.endTime ? todo.endTime.slice(0, 16) : '');
  setDatePickerValue(document.getElementById('detail-reminder'), todo.reminder ? todo.reminder.slice(0, 16) : '');
  document.getElementById('detail-todo').checked = !!todo.todo;
  document.getElementById('detail-important').checked = !!todo.important;

  /* 设置自定义下拉值 —— 优先级 */
  const priorityVal = todo.priority || 'none';
  const priorityEl = document.getElementById('detail-priority');
  priorityEl.dataset.value = priorityVal;
  const priorityOptions = getPriorityOptions();
  const priorityOption = priorityOptions.find(o => o.value === priorityVal) || priorityOptions[0];
  priorityEl.querySelector('.detail-select-trigger').innerHTML = priorityOption.dotClass
    ? `<span class="prio-dot ${priorityOption.dotClass}"></span>${priorityOption.label}`
    : priorityOption.label;

  /* 设置自定义下拉值 —— 标签 */
  const tagVal = todo.tag || '';
  const tagEl = document.getElementById('detail-tag');
  tagEl.dataset.value = tagVal;
  tagEl.querySelector('.detail-select-trigger').innerHTML = tagVal
    ? `<span class="tag-dot" ${getTagDotStyle(tagVal, detailData?.tags || [])}></span>${escapeHtml(tagVal)}`
    : t('detail.unset');

  /* 设置自定义下拉值 —— 重复提醒 */
  const repeatVal = todo.reminderRepeat || 'none';
  const repeatEl = document.getElementById('detail-reminder-repeat');
  repeatEl.dataset.value = repeatVal;
  repeatEl.querySelector('.detail-select-trigger').textContent =
    getRepeatOptions().find(o => o.value === repeatVal)?.label || getRepeatLabel('none');

  const doneRow = document.getElementById('detail-done-row');
  const doneTimeEl = document.getElementById('detail-done-time');
  /* 编辑完成时间时该节点会被日期输入框取代，重开详情前先复位成展示节点，
   * 否则这里会抛错并中断 openDetail 后续赋值 */
  let doneTimeValue = doneTimeEl;
  if (doneTimeValue?.tagName === 'INPUT') {
    const span = document.createElement('span');
    span.id = 'detail-done-time';
    span.className = 'detail-done-value';
    (doneTimeValue.closest('.dp-wrapper') || doneTimeValue).replaceWith(span);
    doneTimeValue = span;
  }
  if (todo.done && todo.doneAt) {
    doneRow.classList.remove('hidden');
    doneTimeValue.textContent = formatDateTime(todo.doneAt);
    doneTimeValue.style.cursor = 'pointer';
    doneTimeValue.title = t('detail.clickEditDone');
    doneTimeValue.onclick = () => enterDoneTimeEdit(todo);
  } else {
    doneRow.classList.add('hidden');
    doneTimeValue.textContent = '';
    doneTimeValue.style.cursor = '';
    doneTimeValue.title = '';
    doneTimeValue.onclick = null;
  }
  document.getElementById('detail-created-time').textContent =
    (todo.createdAt && !Number.isNaN(new Date(todo.createdAt).getTime()))
      ? formatDateTime(new Date(todo.createdAt).toISOString())
      : '—';
}

export function closeDetailDropdownsPublic() {
  closeDetailDropdowns();
}

/* 语言切换时刷新已开详情面板：只重填下拉触发器与日期触发器文案，
 * 不触碰用户正在编辑的输入值/复选框，避免丢失未保存改动 */
export function refreshDetailLanguage() {
  closeDetailDropdowns();
  const panel = document.getElementById('detail-panel');
  if (!panel || panel.classList.contains('hidden')) return;
  const priorityEl = document.getElementById('detail-priority');
  if (priorityEl) {
    const val = priorityEl.dataset.value || 'none';
    const opts = getPriorityOptions();
    const opt = opts.find(o => o.value === val) || opts[0];
    priorityEl.querySelector('.detail-select-trigger').innerHTML = opt.dotClass
      ? `<span class="prio-dot ${opt.dotClass}"></span>${opt.label}`
      : opt.label;
  }
  const tagEl = document.getElementById('detail-tag');
  if (tagEl) {
    const tagVal = tagEl.dataset.value || '';
    tagEl.querySelector('.detail-select-trigger').innerHTML = tagVal
      ? `<span class="tag-dot" ${getTagDotStyle(tagVal, detailData?.tags || [])}></span>${escapeHtml(tagVal)}`
      : t('detail.unset');
  }
  const repeatEl = document.getElementById('detail-reminder-repeat');
  if (repeatEl) {
    const val = repeatEl.dataset.value || 'none';
    repeatEl.querySelector('.detail-select-trigger').textContent =
      getRepeatOptions().find(o => o.value === val)?.label || getRepeatLabel('none');
  }
  ['detail-start', 'detail-end', 'detail-reminder'].forEach((id) => {
    const input = document.getElementById(id);
    if (input) setDatePickerValue(input, input.value || '');
  });
  const doneTimeEl = document.getElementById('detail-done-time');
  if (doneTimeEl && doneTimeEl.tagName !== 'INPUT') {
    doneTimeEl.title = doneTimeEl.textContent ? t('detail.clickEditDone') : '';
  }
}

export function closeDetail() {
  if (typeof onBeforeDetailClose === 'function') {
    onBeforeDetailClose();
  }
  closeDetailDropdowns();
  closeDatePicker();
  const panel = document.getElementById('detail-panel');
  if (!panel || panel.classList.contains('hidden')) {
    /* 面板已隐藏但遮罩仍在时立即收尾：残留遮罩会永久拦截全部点击，
     * 而后续 closeDetail 都会走上面的提前返回，只能在这里兜底 */
    if (!detailCloseState) getDetailOverlay()?.remove();
    return;
  }
  const releaseFocus = detailReleaseFocus;
  const previouslyFocused = detailPreviouslyFocused;
  detailReleaseFocus = null;
  detailPreviouslyFocused = null;

  startDetailClose(getDetailOverlay(), releaseFocus, previouslyFocused);
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
    span.title = t('detail.clickEditDone');
    span.onclick = () => enterDoneTimeEdit(todo);
    const inputWrapper = input.closest('.dp-wrapper') || input;
    inputWrapper.replaceWith(span);

    if (save && onDoneTimeChange) {
      onDoneTimeChange(todo.id, input.value ? new Date(input.value).toISOString() : null);
    }
  };

  initDatePicker(input, { mode: 'datetime', onChange: () => finish(true) });
}
