const STORAGE_KEY = 'todo_app_data';
const DATA_FILE = 'todo_data.json';

function isNeutralinoEnv() {
  return typeof Neutralino !== 'undefined' && typeof NL_PORT !== 'undefined';
}

async function loadData() {
  if (isNeutralinoEnv()) {
    try {
      const content = await Neutralino.filesystem.readFile(`./${DATA_FILE}`);
      return JSON.parse(content);
    } catch {
      return { todos: [], tags: [] };
    }
  }
  try {
    const res = await fetch('/api/data');
    return await res.json();
  } catch {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { todos: [], tags: [] };
  }
}

function saveData() {
  const json = JSON.stringify(data, null, 2);
  if (isNeutralinoEnv()) {
    Neutralino.filesystem.writeFile(`./${DATA_FILE}`, json).catch(() => {
      localStorage.setItem(STORAGE_KEY, json);
    });
    return;
  }
  fetch('/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: json
  }).catch(() => {
    localStorage.setItem(STORAGE_KEY, json);
  });
}

let data = { todos: [], tags: ['计划内'] };
let currentList = 'myday';
let currentTag = null;
let selectedDate = null;
let currentMonth = new Date();
let doneCollapsed = false;

// --- Helpers ---
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str);
  const now = new Date();
  if (isSameDay(d, now)) return '今天';
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameDay(d, tomorrow)) return '明天';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatDateTime(str) {
  if (!str) return '';
  const d = new Date(str);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'toast-msg';
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => toast.remove());
  }, 1800);
}

function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

function isToday(dateStr) {
  if (!dateStr) return false;
  return isSameDay(new Date(dateStr), new Date());
}

function getWeekday(date) {
  return ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
}

function normalizeData() {
  if (!Array.isArray(data.tags)) {
    data.tags = [];
  }

  const normalizedTags = [];
  data.tags.forEach(tag => {
    const name = typeof tag === 'string' ? tag.trim() : '';
    if (name && !normalizedTags.includes(name)) {
      normalizedTags.push(name);
    }
  });

  data.todos.forEach(todo => {
    if (typeof todo.tag === 'string') {
      todo.tag = todo.tag.trim();
      if (todo.tag && !normalizedTags.includes(todo.tag)) {
        normalizedTags.push(todo.tag);
      }
    } else {
      todo.tag = '';
    }
  });

  data.tags = normalizedTags;
}

function getTagTaskCount(tag) {
  return data.todos.filter(t => t.tag === tag).length;
}

function createOverlay(title, content, actions) {
  const overlay = document.createElement('div');
  overlay.className = 'tag-input-overlay';
  overlay.innerHTML = `
    <div class="tag-input-box">
      <h4>${title}</h4>
      ${content}
      <div class="btn-row">${actions}</div>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function closeOverlay(overlay) {
  if (overlay) {
    overlay.classList.add('closing');
    overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
  }
}

function showConfirmDialog(message, onConfirm) {
  const overlay = createOverlay(
    '确认操作',
    `<p style="color:#cbd5e1;font-size:14px;margin-top:8px;">${escapeHtml(message)}</p>`,
    '<button class="btn-cancel">取消</button><button class="btn-danger">确定</button>'
  );

  const close = () => closeOverlay(overlay);
  const confirmBtn = overlay.querySelector('.btn-danger');

  overlay.querySelector('.btn-cancel').addEventListener('click', close);
  confirmBtn.addEventListener('click', () => {
    close();
    onConfirm();
  });
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) {
      close();
    }
  });
  overlay.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      ev.stopPropagation();
      close();
      onConfirm();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
    }
  });
  confirmBtn.focus();
}

function deleteTag(tag, onDeleted) {
  const count = getTagTaskCount(tag);
  const message = count > 0
    ? `标签“${tag}”下还有 ${count} 个任务，删除后这些任务会变成无标签，确定继续吗？`
    : `确定要删除标签“${tag}”吗？`;

  const overlay = createOverlay(
    '删除标签',
    `<p style="color:#cbd5e1;font-size:14px;margin-top:8px;">${escapeHtml(message)}</p>`,
    '<button class="btn-cancel">取消</button><button class="btn-danger">删除</button>'
  );

  const close = () => closeOverlay(overlay);
  const confirmBtn = overlay.querySelector('.btn-danger');

  overlay.querySelector('.btn-cancel').addEventListener('click', close);
  confirmBtn.addEventListener('click', () => {
    close();

    data.tags = data.tags.filter(item => item !== tag);
    data.todos.forEach(todo => {
      if (todo.tag === tag) {
        todo.tag = '';
      }
    });

    if (currentTag === tag) {
      currentTag = null;
      currentList = 'all';
    }

    saveData();
    render();
    if (onDeleted) {
      onDeleted();
    }
    showToast('标签已删除');
  });

  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) {
      close();
    }
  });
  overlay.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      ev.stopPropagation();
      confirmBtn.click();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
    }
  });
  confirmBtn.focus();
}

function openCreateTagDialog() {
  const overlay = createOverlay(
    '新建标签',
    '<input type="text" id="new-tag-input" placeholder="输入标签名称" autofocus>',
    '<button class="btn-cancel">取消</button><button class="btn-ok">确定</button>'
  );

  const input = overlay.querySelector('#new-tag-input');
  input.focus();

  const close = () => closeOverlay(overlay);
  const confirmCreate = () => {
    const name = input.value.trim();
    if (!name) {
      showToast('请输入标签名称');
      input.focus();
      return;
    }
    if (data.tags.includes(name)) {
      showToast('标签已存在');
      input.focus();
      return;
    }
    data.tags.push(name);
    saveData();
    render();
    close();
    showToast('标签创建成功');
  };

  overlay.querySelector('.btn-cancel').addEventListener('click', close);
  overlay.querySelector('.btn-ok').addEventListener('click', confirmCreate);
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) {
      close();
    }
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      confirmCreate();
    }
  });
}

function renderManageTagItems() {
  return data.tags.map(tag => `
    <div class="tag-manage-item" data-tag="${escapeHtml(tag)}">
      <span class="tag-dot"></span>
      <span class="tag-manage-name">${escapeHtml(tag)}</span>
      <span class="tag-manage-count">${getTagTaskCount(tag)}</span>
      <button class="tag-delete-btn" data-role="delete-tag" data-tag="${escapeHtml(tag)}" title="删除标签">✕</button>
    </div>
  `).join('');
}

function renderManageTagContent() {
  const items = renderManageTagItems();
  return items
    ? `<div class="tag-manage-list">${items}</div>`
    : '<div class="tag-manage-empty">暂无标签</div>';
}

function openManageTagsDialog() {
  const overlay = createOverlay(
    '管理标签',
    renderManageTagContent(),
    '<button class="btn-cancel">关闭</button>'
  );

  const close = () => closeOverlay(overlay);
  overlay.querySelector('.btn-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) {
      close();
      return;
    }
    const deleteBtn = ev.target.closest('[data-role="delete-tag"]');
    if (!deleteBtn) {
      return;
    }
    const tag = deleteBtn.dataset.tag;
    deleteTag(tag, () => {
      const content = overlay.querySelector('.tag-input-box > .tag-manage-list, .tag-input-box > .tag-manage-empty');
      if (content) {
        content.outerHTML = renderManageTagContent();
      }
    });
  });
  overlay.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
    }
  });
  overlay.querySelector('.btn-cancel').focus();
}

// --- Filtering ---
function getFilteredTodos() {
  if (currentTag) {
    return data.todos.filter(t => t.tag === currentTag);
  }
  switch (currentList) {
    case 'myday':
      return data.todos.filter(t => t.myday);
    case 'important':
      return data.todos.filter(t => t.important);
    case 'all':
      return data.todos;
    default:
      return data.todos;
  }
}

// --- Render ---
function render() {
  renderSidebar();
  renderTodoList();
  renderStatus();
}

function renderSidebar() {
  document.getElementById('count-myday').textContent = data.todos.filter(t => t.myday && !t.done).length;
  document.getElementById('count-important').textContent = data.todos.filter(t => t.important && !t.done).length;
  document.getElementById('count-all').textContent = data.todos.filter(t => !t.done).length;

  const tagListEl = document.getElementById('tag-list');
  tagListEl.innerHTML = data.tags.map(tag => `
    <a href="#" class="tag-item ${currentTag === tag ? 'active' : ''}" data-tag="${escapeHtml(tag)}">
      <span class="tag-dot"></span>
      <span class="tag-label">${escapeHtml(tag)}</span>
      <span class="nav-count">${data.todos.filter(t => t.tag === tag && !t.done).length}</span>
    </a>
  `).join('');

  document.querySelectorAll('.nav-item[data-list]').forEach(el => {
    el.classList.toggle('active', !currentTag && el.dataset.list === currentList);
  });

  const datalist = document.getElementById('tag-datalist');
  datalist.innerHTML = data.tags.map(t => `<option value="${escapeHtml(t)}">`).join('');
}

function renderTodoList() {
  const todoListEl = document.getElementById('todo-list');
  const doneListEl = document.getElementById('done-list');
  const doneCountEl = document.getElementById('done-count');
  const doneSection = document.getElementById('done-section');
  const taskSummary = document.getElementById('task-summary');
  const statusText = document.getElementById('status-text');

  const filtered = getFilteredTodos();
  const pending = filtered.filter(t => !t.done);
  const done = filtered.filter(t => t.done);

  const priorityOrder = { high: 0, medium: 1, low: 2, none: 3 };
  pending.sort((a, b) => {
    const pa = priorityOrder[a.priority || 'none'];
    const pb = priorityOrder[b.priority || 'none'];
    if (pa !== pb) return pa - pb;
    return b.createdAt - a.createdAt;
  });

  todoListEl.innerHTML = pending.length === 0
    ? '<div style="text-align:center;padding:40px;color:#64748b;font-size:14px;">暂无待办事项</div>'
    : pending.map(renderTodoItem).join('');

  doneCountEl.textContent = done.length;
  doneSection.style.display = done.length > 0 ? 'block' : 'none';
  doneListEl.innerHTML = doneCollapsed ? '' : done.map(renderTodoItem).join('');

  taskSummary.textContent = `${pending.length} 个任务`;
  statusText.textContent = `共 ${filtered.length} 项任务 · ${done.length} 已完成`;
}

function renderTodoItem(t) {
  const badges = [];
  if (t.startTime || t.endTime) {
    const dateText = t.endTime ? formatDate(t.endTime) : formatDate(t.startTime);
    badges.push(`<span class="badge badge-date">📅 ${dateText}</span>`);
  }
  if (t.tag) {
    badges.push(`<span class="badge badge-tag">${escapeHtml(t.tag)}</span>`);
  }
  if (t.priority && t.priority !== 'none') {
    const cls = `badge-priority-${t.priority}`;
    const label = { high: '🔴 高', medium: '🟡 中', low: '🟢 低' }[t.priority];
    badges.push(`<span class="badge ${cls}">${label}</span>`);
  }
  if (t.myday && currentList !== 'myday') {
    badges.push(`<span class="badge badge-myday">☀️ TODO</span>`);
  }

  return `
    <div class="todo-item ${t.done ? 'done' : ''}" data-id="${t.id}">
      <div class="todo-checkbox ${t.done ? 'checked' : ''}" data-action="toggle" data-id="${t.id}"></div>
      <div class="todo-body" data-action="edit" data-id="${t.id}">
        <div class="todo-title">${escapeHtml(t.title)}</div>
        ${badges.length ? `<div class="todo-meta">${badges.join('')}</div>` : ''}
      </div>
      <div class="todo-actions">
        <button data-action="star" data-id="${t.id}" title="重要">${t.important ? '⭐' : '☆'}</button>
        <button data-action="delete" data-id="${t.id}" title="删除">✕</button>
      </div>
    </div>
  `;
}

function renderStatus() {
  const listTitle = document.getElementById('list-title');
  if (currentTag) {
    listTitle.textContent = currentTag;
  } else {
    const titles = { myday: 'TODO', important: '重要', all: '所有' };
    listTitle.textContent = titles[currentList] || '所有';
  }
}

// --- Calendar ---
function renderCalendar() {
  const calendarTitle = document.getElementById('calendar-title');
  const calendarDays = document.getElementById('calendar-days');

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  calendarTitle.textContent = `${year}年${month + 1}月`;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();
  const todayDate = new Date();

  let html = '';

  for (let i = firstDay - 1; i >= 0; i--) {
    html += `<div class="calendar-day other-month">${daysInPrev - i}</div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const isToday = isSameDay(date, todayDate);
    const isSelected = selectedDate && isSameDay(date, selectedDate);
    const todosOnDay = getTodosForDate(date);
    const dots = todosOnDay.length > 0
      ? `<div class="dot-row">${todosOnDay.slice(0, 3).map(() => '<div class="dot"></div>').join('')}</div>`
      : '';

    html += `<div class="calendar-day${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}" data-date="${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}">${d}${dots}</div>`;
  }

  const totalCells = firstDay + daysInMonth;
  const remaining = (7 - totalCells % 7) % 7;
  for (let i = 1; i <= remaining; i++) {
    html += `<div class="calendar-day other-month">${i}</div>`;
  }

  calendarDays.innerHTML = html;
  renderCalendarDetail();
}

function getTodosForDate(date) {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  return data.todos.filter(t => {
    const start = t.startTime ? new Date(t.startTime) : null;
    const end = t.endTime ? new Date(t.endTime) : null;

    if (start && end) {
      return start < dayEnd && end >= dayStart;
    }
    if (start) return isSameDay(start, date);
    if (end) return isSameDay(end, date);
    return isSameDay(new Date(t.createdAt), date);
  });
}

function renderCalendarDetail() {
  const calendarDetail = document.getElementById('calendar-detail');
  if (!selectedDate) {
    calendarDetail.innerHTML = '<p style="color:#64748b;font-size:13px;">点击日期查看事项</p>';
    return;
  }
  const dayTodos = getTodosForDate(selectedDate);
  const dateStr = `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日`;
  if (dayTodos.length === 0) {
    calendarDetail.innerHTML = `<h3>${dateStr}</h3><p style="color:#64748b;font-size:13px;">当天无事项</p>`;
    return;
  }
  calendarDetail.innerHTML = `<h3>${dateStr} (${dayTodos.length}项)</h3>` +
    dayTodos.map(renderTodoItem).join('');
}

// --- Detail Panel ---
function openDetail(id) {
  const todo = data.todos.find(t => t.id === id);
  if (!todo) return;
  const detailPanel = document.getElementById('detail-panel');
  detailPanel.classList.remove('hidden', 'hiding');
  detailPanel.style.animation = 'none';
  detailPanel.offsetHeight;
  detailPanel.style.animation = '';
  document.getElementById('detail-id').value = todo.id;
  document.getElementById('detail-title').value = todo.title;
  document.getElementById('detail-desc').value = todo.desc || '';
  document.getElementById('detail-priority').value = todo.priority || 'none';
  document.getElementById('detail-tag').value = todo.tag || '';
  document.getElementById('detail-start').value = todo.startTime ? todo.startTime.slice(0, 16) : '';
  document.getElementById('detail-end').value = todo.endTime ? todo.endTime.slice(0, 16) : '';
  document.getElementById('detail-myday').checked = !!todo.myday;
  document.getElementById('detail-important').checked = !!todo.important;
}

function closeDetail() {
  const panel = document.getElementById('detail-panel');
  if (panel.classList.contains('hidden')) return;
  panel.classList.add('hiding');
  panel.addEventListener('animationend', () => {
    panel.classList.add('hidden');
    panel.classList.remove('hiding');
  }, { once: true });
}

// --- Main init ---
export async function initApp() {
  data = await loadData();
  normalizeData();

  const quickAdd = document.getElementById('quick-add');
  const doneToggle = document.getElementById('done-toggle');
  const detailForm = document.getElementById('detail-form');
  const calendarDays = document.getElementById('calendar-days');

  // Set today's date
  const today = new Date();
  document.getElementById('today-date').textContent =
    `${today.getMonth() + 1}月${today.getDate()}日星期${getWeekday(today)}`;

  // Nav clicks
  document.querySelector('.sidebar-nav').addEventListener('click', (e) => {
    const item = e.target.closest('.nav-item[data-list]');
    if (!item) return;
    e.preventDefault();
    currentTag = null;
    currentList = item.dataset.list;

    if (currentList === 'calendar') {
      document.getElementById('view-list').classList.remove('active');
      document.getElementById('view-calendar').classList.add('active');
      renderCalendar();
    } else {
      document.getElementById('view-calendar').classList.remove('active');
      document.getElementById('view-list').classList.add('active');
    }
    render();
  });

  // Tag clicks
  document.getElementById('tag-list').addEventListener('click', (e) => {
    const item = e.target.closest('.tag-item');
    if (!item) return;
    e.preventDefault();
    currentTag = item.dataset.tag;
    currentList = null;
    document.getElementById('view-calendar').classList.remove('active');
    document.getElementById('view-list').classList.add('active');
    render();
  });

  // Quick add presets
  let quickAddPreset = { endTime: null, priority: 'none', tag: '' };

  function resetQuickAddPreset() {
    quickAddPreset = { endTime: null, priority: 'none', tag: '' };
    updateQuickAddIndicators();
  }

  function updateQuickAddIndicators() {
    const dateBtn = document.getElementById('btn-set-date');
    const prioBtn = document.getElementById('btn-set-priority');
    const tagBtn = document.getElementById('btn-set-tag');
    dateBtn.classList.toggle('preset-active', !!quickAddPreset.endTime);
    prioBtn.classList.toggle('preset-active', quickAddPreset.priority !== 'none');
    tagBtn.classList.toggle('preset-active', !!quickAddPreset.tag);
  }

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

  // Date picker popup
  document.getElementById('btn-set-date').addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllPopups();
    const popup = document.createElement('div');
    popup.className = 'quick-popup';
    const todayStr = new Date().toISOString().slice(0, 10);
    const tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const nextWeekStr = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
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
    document.querySelector('.add-task-bar').appendChild(popup);
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

  // Priority picker popup
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
    document.querySelector('.add-task-bar').appendChild(popup);
    adjustPopupPosition(popup);

    popup.querySelectorAll('[data-priority]').forEach(opt => {
      opt.addEventListener('click', () => {
        quickAddPreset.priority = opt.dataset.priority;
        updateQuickAddIndicators();
        popup.remove();
      });
    });
  });

  // Tag picker popup
  document.getElementById('btn-set-tag').addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllPopups();
    const popup = document.createElement('div');
    popup.className = 'quick-popup';
    const tagOptions = data.tags.map(tag =>
      `<div class="popup-option ${quickAddPreset.tag === tag ? 'selected' : ''}" data-tag="${escapeHtml(tag)}"><span class="tag-dot"></span>${escapeHtml(tag)}</div>`
    ).join('');
    popup.innerHTML = `
      <div class="popup-title">标签</div>
      ${tagOptions || '<div class="popup-empty">暂无标签</div>'}
      ${quickAddPreset.tag ? '<div class="popup-option popup-clear" data-tag="">✕ 清除标签</div>' : ''}
    `;
    document.querySelector('.add-task-bar').appendChild(popup);
    adjustPopupPosition(popup);

    popup.querySelectorAll('[data-tag]').forEach(opt => {
      opt.addEventListener('click', () => {
        quickAddPreset.tag = opt.dataset.tag || '';
        updateQuickAddIndicators();
        popup.remove();
      });
    });
  });

  // Close popups on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.quick-popup') && !e.target.closest('.add-task-actions')) {
      closeAllPopups();
    }
  });

  // Quick add
  quickAdd.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && quickAdd.value.trim()) {
      const todo = {
        id: genId(),
        title: quickAdd.value.trim(),
        desc: '',
        priority: quickAddPreset.priority || 'none',
        tag: quickAddPreset.tag || currentTag || '',
        startTime: null,
        endTime: quickAddPreset.endTime ? quickAddPreset.endTime + 'T23:59' : null,
        myday: currentList === 'myday' || false,
        important: currentList === 'important' || false,
        done: false,
        doneAt: null,
        createdAt: Date.now()
      };
      data.todos.push(todo);
      saveData();
      quickAdd.value = '';
      resetQuickAddPreset();
      render();
      const newEl = document.querySelector(`.todo-item[data-id="${todo.id}"]`);
      if (newEl) {
        newEl.classList.add('entering');
        newEl.addEventListener('animationend', () => newEl.classList.remove('entering'), { once: true });
      }
      showToast('任务添加成功');
    }
  });

  // Todo actions (delegated)
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const id = target.dataset.id;

    if (action === 'toggle') {
      const todo = data.todos.find(t => t.id === id);
      if (todo) {
        const itemEl = target.closest('.todo-item');
        todo.done = !todo.done;
        todo.doneAt = todo.done ? new Date().toISOString() : null;
        saveData();
        if (itemEl) {
          itemEl.classList.add('checking');
          itemEl.addEventListener('animationend', () => {
            render();
            if (currentList === 'calendar') renderCalendarDetail();
          }, { once: true });
        } else {
          render();
          if (currentList === 'calendar') renderCalendarDetail();
        }
      }
    } else if (action === 'edit') {
      openDetail(id);
    } else if (action === 'star') {
      const todo = data.todos.find(t => t.id === id);
      if (todo) {
        todo.important = !todo.important;
        saveData();
        render();
      }
    } else if (action === 'delete') {
      showConfirmDialog('确定要删除这个任务吗？', () => {
        const itemEl = target.closest('.todo-item');
        if (itemEl) {
          itemEl.classList.add('removing');
          itemEl.addEventListener('animationend', () => {
            data.todos = data.todos.filter(t => t.id !== id);
            saveData();
            closeDetail();
            render();
          }, { once: true });
        } else {
          data.todos = data.todos.filter(t => t.id !== id);
          saveData();
          closeDetail();
          render();
        }
      });
    }
  });

  // Done toggle
  doneToggle.addEventListener('click', () => {
    doneCollapsed = !doneCollapsed;
    doneToggle.classList.toggle('collapsed', doneCollapsed);
    const wrapper = document.getElementById('done-list-wrapper');
    if (doneCollapsed) {
      wrapper.classList.remove('expanding');
      wrapper.classList.add('collapsing');
      wrapper.addEventListener('animationend', () => {
        renderTodoList();
        wrapper.classList.remove('collapsing');
      }, { once: true });
    } else {
      renderTodoList();
      wrapper.classList.remove('collapsing');
      wrapper.classList.add('expanding');
      wrapper.addEventListener('animationend', () => {
        wrapper.classList.remove('expanding');
      }, { once: true });
    }
  });

  // Detail form
  detailForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('detail-id').value;
    const todo = data.todos.find(t => t.id === id);
    if (!todo) return;

    todo.title = document.getElementById('detail-title').value.trim();
    todo.desc = document.getElementById('detail-desc').value.trim();
    todo.priority = document.getElementById('detail-priority').value;
    todo.tag = document.getElementById('detail-tag').value.trim();
    todo.startTime = document.getElementById('detail-start').value || null;
    todo.endTime = document.getElementById('detail-end').value || null;
    todo.myday = document.getElementById('detail-myday').checked;
    todo.important = document.getElementById('detail-important').checked;

    if (todo.tag && !data.tags.includes(todo.tag)) {
      data.tags.push(todo.tag);
    }

    saveData();
    closeDetail();
    render();
  });

  document.getElementById('close-detail').addEventListener('click', closeDetail);
  document.getElementById('btn-delete-task').addEventListener('click', () => {
    showConfirmDialog('确定要删除这个任务吗？', () => {
      const id = document.getElementById('detail-id').value;
      data.todos = data.todos.filter(t => t.id !== id);
      saveData();
      closeDetail();
      render();
    });
  });

  // Clear done
  document.getElementById('btn-clear-done').addEventListener('click', () => {
    const filtered = getFilteredTodos();
    const doneIds = new Set(filtered.filter(t => t.done).map(t => t.id));
    if (doneIds.size === 0) {
      showToast('没有已完成的任务');
      return;
    }
    showConfirmDialog(`确定要清空 ${doneIds.size} 个已完成的任务吗？`, () => {
      data.todos = data.todos.filter(t => !doneIds.has(t.id));
      saveData();
      render();
    });
  });

  // Add tag
  document.getElementById('btn-add-tag').addEventListener('click', (e) => {
    e.preventDefault();
    openCreateTagDialog();
  });

  document.getElementById('btn-manage-tags').addEventListener('click', (e) => {
    e.preventDefault();
    openManageTagsDialog();
  });

  // Calendar nav
  document.getElementById('prev-month').addEventListener('click', () => {
    currentMonth.setMonth(currentMonth.getMonth() - 1);
    selectedDate = null;
    renderCalendar();
  });

  document.getElementById('next-month').addEventListener('click', () => {
    currentMonth.setMonth(currentMonth.getMonth() + 1);
    selectedDate = null;
    renderCalendar();
  });

  calendarDays.addEventListener('click', (e) => {
    const dayEl = e.target.closest('.calendar-day');
    if (!dayEl || dayEl.classList.contains('other-month')) return;
    const dateStr = dayEl.dataset.date;
    if (!dateStr) return;
    selectedDate = new Date(dateStr);
    renderCalendar();
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDetail();
  });

  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  // --- Mini Mode ---
  let isMiniMode = false;
  const miniPanel = document.getElementById('mini-panel');
  const miniList = document.getElementById('mini-list');
  const miniTooltip = document.getElementById('mini-tooltip');
  const miniInputRow = document.getElementById('mini-input-row');
  const miniQuickAdd = document.getElementById('mini-quick-add');

  function renderMiniPanel() {
    const pending = data.todos.filter(t => !t.done);
    const done = data.todos.filter(t => t.done);
    document.getElementById('mini-pending-count').textContent = pending.length;
    document.getElementById('mini-done-count').textContent = done.length;

    const priorityOrder = { high: 0, medium: 1, low: 2, none: 3 };
    pending.sort((a, b) => {
      const pa = priorityOrder[a.priority || 'none'];
      const pb = priorityOrder[b.priority || 'none'];
      if (pa !== pb) return pa - pb;
      return b.createdAt - a.createdAt;
    });

    const items = pending.slice(0, 8);
    miniList.innerHTML = items.length === 0
      ? '<div style="text-align:center;padding:16px;color:#64748b;font-size:12px;">暂无待办</div>'
      : items.map(t => {
        const prioCls = t.priority && t.priority !== 'none' ? `p-${t.priority}` : '';
        return `<div class="mini-todo-item" data-id="${t.id}">
          <div class="mini-checkbox" data-mini-toggle="${t.id}"></div>
          ${prioCls ? `<div class="mini-priority-dot ${prioCls}"></div>` : ''}
          <span class="mini-todo-title">${escapeHtml(t.title)}</span>
        </div>`;
      }).join('');
  }

  function showMiniTooltip(todoId, anchorEl) {
    const todo = data.todos.find(t => t.id === todoId);
    if (!todo) return;
    const rect = anchorEl.getBoundingClientRect();
    let html = `<div class="mini-tooltip-title">${escapeHtml(todo.title)}</div>`;
    if (todo.desc) {
      html += `<div class="mini-tooltip-row">${escapeHtml(todo.desc)}</div>`;
    }
    if (todo.priority && todo.priority !== 'none') {
      const label = { high: '🔴 高优先级', medium: '🟡 中优先级', low: '🟢 低优先级' }[todo.priority];
      html += `<div class="mini-tooltip-row">${label}</div>`;
    }
    if (todo.tag) {
      html += `<div class="mini-tooltip-row">🏷️ ${escapeHtml(todo.tag)}</div>`;
    }
    if (todo.endTime) {
      html += `<div class="mini-tooltip-row">📅 ${formatDate(todo.endTime)}</div>`;
    }
    if (todo.startTime) {
      html += `<div class="mini-tooltip-row">🕐 开始: ${formatDate(todo.startTime)}</div>`;
    }
    miniTooltip.innerHTML = html;
    miniTooltip.classList.remove('hidden');
    miniTooltip.style.left = `${rect.left}px`;
    miniTooltip.style.top = `${rect.bottom + 4}px`;
    const tooltipRect = miniTooltip.getBoundingClientRect();
    if (tooltipRect.bottom > window.innerHeight) {
      miniTooltip.style.top = `${rect.top - tooltipRect.height - 4}px`;
    }
    if (tooltipRect.right > window.innerWidth) {
      miniTooltip.style.left = `${window.innerWidth - tooltipRect.width - 8}px`;
    }
  }

  function hideMiniTooltip() {
    miniTooltip.classList.add('hidden');
  }

  async function enterMiniMode() {
    isMiniMode = true;
    document.querySelector('.app').style.display = 'none';
    miniPanel.classList.remove('hidden');
    renderMiniPanel();
    if (typeof Neutralino !== 'undefined' && typeof NL_PORT !== 'undefined') {
      try {
        await Neutralino.window.setAlwaysOnTop(true);
        await Neutralino.window.setBorderless(true);
        await Neutralino.window.setSize({
          width: 280,
          height: 320,
          minWidth: 200,
          minHeight: 150
        });
        await Neutralino.window.setDraggableRegion('mini-drag-region');
      } catch (e) { console.warn('enterMiniMode error:', e); }
    }
  }

  async function exitMiniMode() {
    isMiniMode = false;
    miniPanel.classList.add('hidden');
    miniInputRow.classList.add('hidden');
    document.querySelector('.app').style.display = '';
    if (typeof Neutralino !== 'undefined' && typeof NL_PORT !== 'undefined') {
      try {
        await Neutralino.window.unsetDraggableRegion('mini-drag-region');
      } catch (e) {}
      try {
        await Neutralino.window.setAlwaysOnTop(false);
        await Neutralino.window.setBorderless(false);
      } catch (e) {}
      await new Promise(r => setTimeout(r, 100));
      try {
        await Neutralino.window.setSize({
          width: 1100,
          height: 700,
          minWidth: 800,
          minHeight: 500
        });
        await Neutralino.window.center();
      } catch (e) { console.warn('exitMiniMode resize error:', e); }
    }
    render();
  }

  document.getElementById('btn-mini-mode').addEventListener('click', enterMiniMode);
  document.getElementById('btn-exit-mini').addEventListener('click', (e) => {
    e.stopPropagation();
    exitMiniMode();
  });

  document.getElementById('btn-mini-add').addEventListener('click', (e) => {
    e.stopPropagation();
    miniInputRow.classList.toggle('hidden');
    if (!miniInputRow.classList.contains('hidden')) {
      setTimeout(() => miniQuickAdd.focus(), 50);
    }
  });

  miniQuickAdd.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && miniQuickAdd.value.trim()) {
      const todo = {
        id: genId(),
        title: miniQuickAdd.value.trim(),
        desc: '',
        priority: 'none',
        tag: '',
        startTime: null,
        endTime: null,
        myday: true,
        important: false,
        done: false,
        doneAt: null,
        createdAt: Date.now()
      };
      data.todos.push(todo);
      saveData();
      miniQuickAdd.value = '';
      renderMiniPanel();
    } else if (e.key === 'Escape') {
      miniInputRow.classList.add('hidden');
    }
  });

  miniList.addEventListener('click', (e) => {
    const checkbox = e.target.closest('[data-mini-toggle]');
    if (checkbox) {
      const id = checkbox.dataset.miniToggle;
      const todo = data.todos.find(t => t.id === id);
      if (todo) {
        todo.done = !todo.done;
        todo.doneAt = todo.done ? new Date().toISOString() : null;
        saveData();
        renderMiniPanel();
      }
    }
  });

  let miniTooltipTimer = null;
  miniList.addEventListener('mouseover', (e) => {
    const item = e.target.closest('.mini-todo-item');
    if (!item) return;
    clearTimeout(miniTooltipTimer);
    miniTooltipTimer = setTimeout(() => {
      showMiniTooltip(item.dataset.id, item);
    }, 400);
  });

  miniList.addEventListener('mouseout', (e) => {
    const item = e.target.closest('.mini-todo-item');
    if (!item || !item.contains(e.relatedTarget)) {
      clearTimeout(miniTooltipTimer);
      hideMiniTooltip();
    }
  });

  miniPanel.addEventListener('mouseleave', hideMiniTooltip);

  // Init render
  render();
}
