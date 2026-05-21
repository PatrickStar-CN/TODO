const TAG_COLORS = ['#4f46e5', '#06b6d4', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];
const STORAGE_KEY = 'todo_app_data';
const DATA_FILE = 'todo_data.json';

function getTagColor(tag) {
  if (!tag) return TAG_COLORS[0];
  const index = data.tags.indexOf(tag);
  return TAG_COLORS[(index >= 0 ? index : 0) % TAG_COLORS.length];
}

function getTagBadgeStyle(tag) {
  const color = getTagColor(tag);
  return `style="background:${color}22;color:${color};"`;
}

function getTagDotStyle(tag) {
  return `style="background:${getTagColor(tag)}"`;
}

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

let data = { todos: [], tags: ['计划内'], aiConfig: { apiUrl: '', apiKey: '', model: '', customPrompt: '' }, theme: 'auto', sidebarMini: false };
let currentList = 'todo';
let currentTag = null;
let selectedDate = null;
let currentMonth = new Date();
let doneCollapsed = true;

// --- Helpers ---
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function toLocalDatetime(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}`;
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
    if ('myday' in todo) {
      todo.todo = todo.myday;
      delete todo.myday;
    }
    if (typeof todo.reminder === 'undefined') todo.reminder = null;
    if (typeof todo.reminderRepeat === 'undefined') todo.reminderRepeat = 'none';
  });

  data.tags = normalizedTags;

  if (!data.aiConfig || typeof data.aiConfig !== 'object') {
    data.aiConfig = { apiUrl: '', apiKey: '', model: '', customPrompt: '' };
  }
  if (typeof data.aiConfig.customPrompt !== 'string') {
    data.aiConfig.customPrompt = '';
  }
  if (!['auto', 'light', 'dark'].includes(data.theme)) {
    data.theme = 'auto';
  }
  if (typeof data.sidebarMini !== 'boolean') {
    data.sidebarMini = false;
  }
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
      <span class="tag-dot" ${getTagDotStyle(tag)}></span>
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
    case 'todo':
      return data.todos.filter(t => t.todo);
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
  document.getElementById('count-todo').textContent = data.todos.filter(t => t.todo && !t.done).length;
  document.getElementById('count-important').textContent = data.todos.filter(t => t.important && !t.done).length;
  document.getElementById('count-all').textContent = data.todos.filter(t => !t.done).length;

  const tagListEl = document.getElementById('tag-list');
  tagListEl.innerHTML = data.tags.map(tag => `
    <a href="#" class="tag-item ${currentTag === tag ? 'active' : ''}" data-tag="${escapeHtml(tag)}">
      <span class="tag-dot" ${getTagDotStyle(tag)}></span>
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
  const doneToggleEl = document.getElementById('done-toggle');
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
  doneToggleEl.classList.toggle('collapsed', doneCollapsed);
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
    badges.push(`<span class="badge badge-tag" ${getTagBadgeStyle(t.tag)}>${escapeHtml(t.tag)}</span>`);
  }
  if (t.priority && t.priority !== 'none') {
    const cls = `badge-priority-${t.priority}`;
    const label = { high: '🔴 高', medium: '🟡 中', low: '🟢 低' }[t.priority];
    badges.push(`<span class="badge ${cls}">${label}</span>`);
  }
  if (t.todo && currentList !== 'todo') {
    badges.push(`<span class="badge badge-todo">☀️ TODO</span>`);
  }
  if (t.reminder && !t.done) {
    badges.push(`<span class="badge badge-reminder">🔔</span>`);
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
    const titles = { todo: 'TODO', important: '重要', all: '所有' };
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
    const doneAt = t.doneAt ? new Date(t.doneAt) : null;

    if (start && end) {
      return start < dayEnd && end >= dayStart;
    }
    if (start) return isSameDay(start, date);
    if (end) return isSameDay(end, date);
    if (doneAt) return isSameDay(doneAt, date);
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
  document.getElementById('detail-reminder').value = todo.reminder ? todo.reminder.slice(0, 16) : '';
  document.getElementById('detail-reminder-repeat').value = todo.reminderRepeat || 'none';
  document.getElementById('detail-todo').checked = !!todo.todo;
  document.getElementById('detail-important').checked = !!todo.important;
  const doneRow = document.getElementById('detail-done-row');
  const doneTimeEl = document.getElementById('detail-done-time');
  if (todo.done && todo.doneAt) {
    doneRow.classList.remove('hidden');
    doneTimeEl.textContent = formatDateTime(todo.doneAt);
  } else {
    doneRow.classList.add('hidden');
    doneTimeEl.textContent = '';
  }
  document.getElementById('detail-created-time').textContent = formatDateTime(new Date(todo.createdAt).toISOString());
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

  function applyTheme() {
    const theme = data.theme || 'auto';
    if (theme === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }

  function updateThemeButton() {
    const icons = { auto: '🌗', light: '☀️', dark: '🌙' };
    const titles = { auto: '跟随系统', light: '白天模式', dark: '夜间模式' };
    const btn = document.getElementById('btn-theme-toggle');
    btn.textContent = icons[data.theme] || icons.auto;
    btn.title = titles[data.theme] || titles.auto;
  }

  applyTheme();

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (data.theme === 'auto') applyTheme();
  });

  document.getElementById('btn-theme-toggle').addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    const idx = order.indexOf(data.theme);
    data.theme = order[(idx + 1) % 3];
    saveData();
    applyTheme();
    updateThemeButton();
  });
  updateThemeButton();

  const sidebar = document.querySelector('.sidebar');
  const toggleSidebarBtn = document.getElementById('btn-toggle-sidebar');

  function applySidebarState() {
    sidebar.classList.toggle('mini', data.sidebarMini);
    const icon = toggleSidebarBtn.querySelector('.btn-icon');
    const text = toggleSidebarBtn.querySelector('.btn-text');
    icon.textContent = data.sidebarMini ? '▶️' : '◀️';
    text.textContent = data.sidebarMini ? ' 展开侧边栏' : ' 折叠侧边栏';
    toggleSidebarBtn.title = data.sidebarMini ? '展开侧边栏' : '折叠侧边栏';
  }

  toggleSidebarBtn.addEventListener('click', () => {
    data.sidebarMini = !data.sidebarMini;
    saveData();
    applySidebarState();
  });

  applySidebarState();

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
      `<div class="popup-option ${quickAddPreset.tag === tag ? 'selected' : ''}" data-tag="${escapeHtml(tag)}"><span class="tag-dot" ${getTagDotStyle(tag)}></span>${escapeHtml(tag)}</div>`
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
        todo: currentList === 'todo' || false,
        important: currentList === 'important' || false,
        done: false,
        doneAt: null,
        reminder: null,
        reminderRepeat: 'none',
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
        if (todo.done && todo.reminderRepeat === 'none') {
          todo.reminder = null;
        }
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
    todo.reminder = document.getElementById('detail-reminder').value || null;
    todo.reminderRepeat = document.getElementById('detail-reminder-repeat').value || 'none';
    todo.todo = document.getElementById('detail-todo').checked;
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
    if (e.key === 'F5' || (e.ctrlKey && e.key === 'r') || (e.ctrlKey && e.shiftKey && e.key === 'R')) {
      e.preventDefault();
    }
  });

  let isMiniMode = false;

  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    closeContextMenu();

    if (isMiniMode) {
      showContextMenu(e.clientX, e.clientY, [
        { icon: '🪟', label: '退出迷你模式', action: () => exitMiniMode() },
        { separator: true },
        { icon: '❌', label: '关闭窗口', className: 'danger', action: () => closeWindow() }
      ]);
      return;
    }

    const todoItem = e.target.closest('.todo-item');
    const tagItem = e.target.closest('.tag-item[data-tag]');
    const navItem = e.target.closest('.nav-item[data-list]');
    const todoListArea = e.target.closest('.todo-list');

    if (todoItem) {
      const id = todoItem.dataset.id;
      const todo = data.todos.find(t => t.id === id);
      if (!todo) return;
      const items = [];
      if (todo.done) {
        items.push({ icon: '↩️', label: '取消完成', action: () => { todo.done = false; todo.doneAt = null; saveData(); render(); } });
      } else {
        items.push({ icon: '✅', label: '标记完成', action: () => { todo.done = true; todo.doneAt = new Date().toISOString(); saveData(); render(); } });
        items.push({ icon: todo.important ? '☆' : '⭐', label: todo.important ? '取消重要' : '标记重要', action: () => { todo.important = !todo.important; saveData(); render(); } });
        items.push({ icon: todo.todo ? '☀️' : '☀️', label: todo.todo ? '从 TODO 移除' : '添加到 TODO', action: () => { todo.todo = !todo.todo; saveData(); render(); } });
        items.push({ separator: true });
        items.push({ icon: '🚩', label: '优先级', submenu: [
          { label: '🔴 高', action: () => { todo.priority = 'high'; saveData(); render(); } },
          { label: '🟡 中', action: () => { todo.priority = 'medium'; saveData(); render(); } },
          { label: '🔵 低', action: () => { todo.priority = 'low'; saveData(); render(); } },
          { label: '⚪ 无', action: () => { todo.priority = 'none'; saveData(); render(); } }
        ]});
        if (data.tags.length > 0) {
          items.push({ icon: '🏷️', label: '标签', submenu: data.tags.map(tag => ({
            label: (todo.tag === tag ? '✓ ' : '') + tag,
            action: () => { todo.tag = todo.tag === tag ? '' : tag; saveData(); render(); }
          }))});
        }
        const reminderItems = [
          { label: '10 分钟后', action: () => { todo.reminder = toLocalDatetime(new Date(Date.now() + 10 * 60000)); todo.reminderRepeat = 'none'; saveData(); render(); } },
          { label: '1 小时后', action: () => { todo.reminder = toLocalDatetime(new Date(Date.now() + 60 * 60000)); todo.reminderRepeat = 'none'; saveData(); render(); } },
          { label: '明天 9:00', action: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); todo.reminder = toLocalDatetime(d); todo.reminderRepeat = 'none'; saveData(); render(); } },
          { label: '每天提醒', action: () => { const d = new Date(); d.setHours(9, 0, 0, 0); if (d <= new Date()) d.setDate(d.getDate() + 1); todo.reminder = toLocalDatetime(d); todo.reminderRepeat = 'daily'; saveData(); render(); } }
        ];
        if (todo.reminder) {
          reminderItems.push({ label: '❌ 清除提醒', action: () => { todo.reminder = null; todo.reminderRepeat = 'none'; saveData(); render(); } });
        }
        items.push({ icon: '🔔', label: '设置提醒', submenu: reminderItems });
        items.push({ separator: true });
        items.push({ icon: '✏️', label: '编辑详情', action: () => openDetail(id) });
      }
      items.push({ separator: true });
      items.push({ icon: '🗑️', label: '删除', className: 'danger', action: () => deleteTodoById(id) });
      showContextMenu(e.clientX, e.clientY, items);
    } else if (tagItem) {
      const tag = tagItem.dataset.tag;
      showContextMenu(e.clientX, e.clientY, [
        { icon: '📋', label: '查看该标签任务', action: () => { currentTag = tag; currentList = null; render(); } },
        { separator: true },
        { icon: '🗑️', label: '删除标签', className: 'danger', action: () => deleteTag(tag) }
      ]);
    } else if (navItem) {
      showContextMenu(e.clientX, e.clientY, [
        { icon: '🗑️', label: '清空已完成', className: 'danger', action: () => clearDoneTasks() }
      ]);
    } else if (todoListArea) {
      showContextMenu(e.clientX, e.clientY, [
        { icon: '➕', label: '新建任务', action: () => document.getElementById('quick-add').focus() },
        { separator: true },
        { icon: '🗑️', label: '清空已完成', className: 'danger', action: () => clearDoneTasks() }
      ]);
    }
  });

  function showContextMenu(x, y, items) {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
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
        wrapper.innerHTML = `<span class="menu-icon">${item.icon || ''}</span>${item.label}`;
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
      el.innerHTML = `<span class="menu-icon">${item.icon || ''}</span>${item.label}`;
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
  }

  function closeContextMenu() {
    const existing = document.querySelector('.context-menu');
    if (existing) existing.remove();
  }

  function closeWindow() {
    if (typeof Neutralino !== 'undefined' && typeof NL_PORT !== 'undefined') {
      Neutralino.window.hide();
    } else {
      window.close();
    }
  }

  function deleteTodoById(id) {
    showConfirmDialog('确定要删除这个任务吗？', () => {
      const idx = data.todos.findIndex(t => t.id === id);
      if (idx !== -1) {
        data.todos.splice(idx, 1);
        saveData();
        render();
      }
    });
  }

  function deleteTag(tag) {
    const count = data.todos.filter(t => t.tag === tag).length;
    showConfirmDialog(`删除标签"${tag}"？（关联 ${count} 个任务的标签将被清除）`, () => {
      data.tags = data.tags.filter(t => t !== tag);
      data.todos.forEach(t => { if (t.tag === tag) t.tag = ''; });
      if (currentTag === tag) { currentTag = null; currentList = 'todo'; }
      saveData();
      render();
    });
  }

  function clearDoneTasks() {
    const doneTodos = getFilteredTodos().filter(t => t.done);
    if (doneTodos.length === 0) { showToast('没有已完成的任务'); return; }
    showConfirmDialog(`确定清空 ${doneTodos.length} 个已完成任务？`, () => {
      const ids = doneTodos.map(t => t.id);
      data.todos = data.todos.filter(t => !ids.includes(t.id));
      saveData();
      render();
    });
  }

  // --- Reminder System ---
  function checkReminders() {
    const now = new Date();
    let changed = false;
    data.todos.forEach(todo => {
      if (!todo.reminder || todo.done) return;
      const reminderTime = new Date(todo.reminder);
      if (reminderTime <= now) {
        triggerReminder(todo);
        if (todo.reminderRepeat === 'daily') {
          const next = new Date(reminderTime);
          next.setDate(next.getDate() + 1);
          todo.reminder = toLocalDatetime(next);
        } else if (todo.reminderRepeat === 'weekly') {
          const next = new Date(reminderTime);
          next.setDate(next.getDate() + 7);
          todo.reminder = toLocalDatetime(next);
        } else if (todo.reminderRepeat === 'monthly') {
          const next = new Date(reminderTime);
          next.setMonth(next.getMonth() + 1);
          todo.reminder = toLocalDatetime(next);
        } else {
          todo.reminder = null;
        }
        changed = true;
      }
    });
    if (changed) {
      saveData();
      render();
    }
  }

  async function triggerReminder(todo) {
    showToast(`🔔 提醒：${todo.title}`);
    if (typeof Neutralino !== 'undefined' && typeof NL_PORT !== 'undefined') {
      try {
        const title = todo.title.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
        const xml = `<toast duration="short"><visual><binding template="ToastGeneric"><text>TODO 提醒</text><text>${title}</text></binding></visual></toast>`;
        const psScript = [
          '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
          '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null',
          '$x = New-Object Windows.Data.Xml.Dom.XmlDocument',
          `$x.LoadXml('${xml}')`,
          '$t = [Windows.UI.Notifications.ToastNotification]::new($x)',
          '$t.ExpirationTime = [DateTimeOffset]::Now.AddSeconds(8)',
          "$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe')",
          '$notifier.Show($t)'
        ].join('\r\n');
        const scriptPath = NL_PATH + '/.tmp_notify.ps1';
        const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
        const content = new TextEncoder().encode(psScript);
        const buf = new Uint8Array(bom.length + content.length);
        buf.set(bom);
        buf.set(content, bom.length);
        await Neutralino.filesystem.writeBinaryFile(scriptPath, buf.buffer);
        await Neutralino.os.execCommand(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`);
        await Neutralino.filesystem.remove(scriptPath);
      } catch (e) {}
    }
  }

  setInterval(checkReminders, 30000);
  setTimeout(checkReminders, 2000);

  // --- Mini Mode ---
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
      html += `<div class="mini-tooltip-row"><span class="tag-dot" ${getTagDotStyle(todo.tag)}></span>${escapeHtml(todo.tag)}</div>`;
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
        const displays = await Neutralino.computer.getDisplays();
        const primary = displays[0];
        const x = primary.resolution.width - 280 - 20;
        const y = 20;
        await Neutralino.window.move(x, y);
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
        todo: true,
        important: false,
        done: false,
        doneAt: null,
        reminder: null,
        reminderRepeat: 'none',
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
        if (todo.done && todo.reminderRepeat === 'none') {
          todo.reminder = null;
        }
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

  // --- Summary Panel ---
  let summaryType = 'daily';
  const summaryPanel = document.getElementById('summary-panel');
  const summaryOutput = document.getElementById('summary-output');
  const summaryFooter = document.getElementById('summary-footer');
  const summaryDateInput = document.getElementById('summary-date');

  const nowDate = new Date();
  summaryDateInput.value = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(nowDate.getDate()).padStart(2, '0')}`;

  document.getElementById('btn-open-summary').addEventListener('click', () => {
    summaryPanel.classList.remove('hidden', 'hiding');
    summaryPanel.style.animation = 'none';
    summaryPanel.offsetHeight;
    summaryPanel.style.animation = '';
  });

  document.getElementById('close-summary').addEventListener('click', () => {
    summaryPanel.classList.add('hiding');
    summaryPanel.addEventListener('animationend', () => {
      summaryPanel.classList.add('hidden');
      summaryPanel.classList.remove('hiding');
    }, { once: true });
  });

  document.querySelectorAll('.summary-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.summary-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      summaryType = tab.dataset.type;
    });
  });

  document.getElementById('btn-ai-config').addEventListener('click', () => {
    const overlay = createOverlay(
      'API 配置',
      `<div class="detail-row"><label>API 地址</label><input type="text" id="cfg-api-url" value="${escapeHtml(data.aiConfig.apiUrl)}" placeholder="https://api.openai.com/v1/chat/completions"></div>
       <div class="detail-row"><label>API Key</label><input type="password" id="cfg-api-key" value="${escapeHtml(data.aiConfig.apiKey)}" placeholder="sk-..."></div>
       <div class="detail-row"><label>模型</label><input type="text" id="cfg-model" value="${escapeHtml(data.aiConfig.model)}" placeholder="gpt-4o-mini"></div>
       <div class="detail-row"><label>自定义提示词</label><textarea id="cfg-prompt" rows="6" placeholder="可用变量：{type}=日报/周报, {range}=日期范围, {doneList}=已完成任务, {pendingList}=进行中任务, {plan}=明日计划/下周计划&#10;&#10;留空则使用默认提示词">${escapeHtml(data.aiConfig.customPrompt)}</textarea></div>`,
      '<button class="btn-primary" id="cfg-save">保存</button><button class="btn-cancel" style="margin-left:8px;">取消</button>'
    );
    const close = () => closeOverlay(overlay);
    overlay.querySelector('.btn-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });
    overlay.querySelector('#cfg-save').addEventListener('click', () => {
      data.aiConfig.apiUrl = overlay.querySelector('#cfg-api-url').value.trim();
      data.aiConfig.apiKey = overlay.querySelector('#cfg-api-key').value.trim();
      data.aiConfig.model = overlay.querySelector('#cfg-model').value.trim();
      data.aiConfig.customPrompt = overlay.querySelector('#cfg-prompt').value.trim();
      saveData();
      showToast('API 配置已保存');
      close();
    });
    overlay.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') close();
    });
  });

  document.getElementById('btn-generate-report').addEventListener('click', async () => {
    if (!data.aiConfig.apiUrl || !data.aiConfig.apiKey || !data.aiConfig.model) {
      showToast('请先配置 API');
      return;
    }
    const dateStr = summaryDateInput.value;
    if (!dateStr) {
      showToast('请选择日期');
      return;
    }

    const baseDate = new Date(dateStr);
    let startDate, endDate, rangeLabel;

    if (summaryType === 'daily') {
      startDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 1);
      rangeLabel = `${startDate.getMonth() + 1}/${startDate.getDate()}`;
    } else {
      const day = baseDate.getDay();
      startDate = new Date(baseDate);
      startDate.setDate(startDate.getDate() - (day === 0 ? 6 : day - 1));
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 7);
      rangeLabel = `${startDate.getMonth() + 1}/${startDate.getDate()} ~ ${endDate.getMonth() + 1}/${endDate.getDate() - 1}`;
    }

    const doneTodos = data.todos.filter(t => {
      if (!t.done || !t.doneAt) return false;
      const d = new Date(t.doneAt);
      return d >= startDate && d < endDate;
    });
    const pendingTodos = data.todos.filter(t => {
      if (t.done) return false;
      const created = new Date(t.createdAt);
      const end = t.endTime ? new Date(t.endTime) : null;
      return created < endDate && (!end || end >= startDate);
    });

    const typeLabel = summaryType === 'daily' ? '日报' : '周报';
    const planLabel = summaryType === 'daily' ? '明日计划' : '下周计划';
    const doneList = doneTodos.length > 0
      ? doneTodos.map(t => `- ${t.title}${t.priority !== 'none' ? `（优先级：${{high:'高',medium:'中',low:'低'}[t.priority]}）` : ''}${t.tag ? `（标签：${t.tag}）` : ''}`).join('\n')
      : '- 无';
    const pendingList = pendingTodos.length > 0
      ? pendingTodos.map(t => `- ${t.title}${t.priority !== 'none' ? `（优先级：${{high:'高',medium:'中',low:'低'}[t.priority]}）` : ''}${t.tag ? `（标签：${t.tag}）` : ''}`).join('\n')
      : '- 无';

    let prompt;
    if (data.aiConfig.customPrompt) {
      prompt = data.aiConfig.customPrompt
        .replace(/\{type\}/g, typeLabel)
        .replace(/\{range\}/g, rangeLabel)
        .replace(/\{doneList\}/g, doneList)
        .replace(/\{pendingList\}/g, pendingList)
        .replace(/\{plan\}/g, planLabel);
    } else {
      prompt = `请根据以下任务列表生成一份${typeLabel}：
日期范围：${rangeLabel}

已完成任务：
${doneList}

进行中任务：
${pendingList}

请用简洁的中文输出，包含：工作总结、完成情况、${planLabel}。`;
    }

    summaryOutput.textContent = '';
    summaryFooter.classList.add('hidden');
    summaryOutput.innerHTML = '<div class="summary-loading">正在生成...</div>';

    try {
      const response = await fetch(data.aiConfig.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${data.aiConfig.apiKey}`
        },
        body: JSON.stringify({
          model: data.aiConfig.model,
          messages: [{ role: 'user', content: prompt }],
          stream: true
        })
      });

      if (!response.ok) {
        const err = await response.text();
        summaryOutput.textContent = `请求失败: ${response.status}\n${err}`;
        return;
      }

      summaryOutput.textContent = '';
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') break;
          try {
            const json = JSON.parse(payload);
            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              summaryOutput.textContent += content;
            }
          } catch {}
        }
      }
      summaryFooter.classList.remove('hidden');
    } catch (err) {
      summaryOutput.textContent = `请求出错: ${err.message}`;
    }
  });

  document.getElementById('btn-copy-report').addEventListener('click', () => {
    const text = summaryOutput.textContent;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      showToast('已复制到剪贴板');
    }).catch(() => {
      showToast('复制失败');
    });
  });

  // Init render
  render();
}
