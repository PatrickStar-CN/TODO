import { escapeHtml } from './utils/html.js';
import { toLocalDatetime, toLocalDateInput, parseLocalDateInput, formatMonthDay, isSameDay, isToday, getWeekday, formatDate, formatDateTime } from './utils/date.js';
import { genId } from './utils/id.js';
import { sortByPriority, getFilteredTodos as _getFilteredTodos, countByList, countTagUndone, splitPendingDone } from './selectors.js';
import { showContextMenu, closeContextMenu } from './contextMenu.js';
import { buildTodoContextMenu, buildTagContextMenu, buildNavContextMenu, buildListAreaMenu } from './contextMenuConfig.js';
import { createTodoItemEl } from './renderTodoItem.js';
import { renderCalendar as _renderCalendar, getTodosForDate as _getTodosForDate, renderCalendarDetail as _renderCalendarDetail } from './calendar.js';
import { openDetail as _openDetail, closeDetail, initDetailEditor } from './detail.js';
import { createOverlay, closeOverlay, createManagedOverlay, showConfirmDialog } from './overlay.js';
import { applyTheme, updateThemeButton } from './theme.js';
import { initAiSummary } from './aiSummary.js';
import { initReminders } from './reminder.js';
import { initMiniMode } from './miniMode.js';
import { initQuickAddPopups } from './quickAddPopup.js';

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

let saveTimer = null;

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data, null, 2));

  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const json = JSON.stringify(data, null, 2);
    if (isNeutralinoEnv()) {
      Neutralino.filesystem.writeFile(`./${DATA_FILE}`, json).catch(() => {
        showToast('保存失败，数据已暂存本地');
      });
      return;
    }
    fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json
    }).catch(() => {
      showToast('保存失败，数据已暂存本地');
    });
  }, 300);
}

let data = { todos: [], tags: ['计划内'], aiConfig: { apiUrl: '', apiKey: '', model: '', customPrompt: '' }, theme: 'auto', sidebarMini: false };
let currentList = 'todo';
let currentTag = null;
let selectedDate = null;
let currentMonth = new Date();
let doneCollapsed = true;
let searchKeyword = '';

function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'toast-msg';
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 500);
  }, 1800);
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
    if (typeof todo.archived === 'undefined') todo.archived = false;
    if (typeof todo.archivedAt === 'undefined') todo.archivedAt = null;
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

function deleteTag(tag, onDeleted) {
  const count = getTagTaskCount(tag);
  const message = count > 0
    ? `标签“${tag}”下还有 ${count} 个任务，删除后这些任务会变成无标签，确定继续吗？`
    : `确定要删除标签“${tag}”吗？`;

  const overlay = createOverlay(
    '删除标签',
    `<p class="overlay-message">${escapeHtml(message)}</p>`,
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
      <span class="tag-manage-name" data-role="rename-tag" title="双击重命名">${escapeHtml(tag)}</span>
      <span class="tag-manage-count">${getTagTaskCount(tag)} 个任务</span>
      <button class="tag-delete-btn" data-role="delete-tag" data-tag="${escapeHtml(tag)}" title="删除标签">✕</button>
    </div>
  `).join('');
}

function renderManageTagContent() {
  const items = renderManageTagItems();
  return items
    ? `<div class="tag-manage-list">${items}</div>`
    : '<div class="tag-manage-empty"><span class="empty-icon">🏷️</span><p>还没有标签</p><p class="empty-hint">点击侧边栏「新建标签」添加</p></div>';
}

function openManageTagsDialog() {
  const { overlay, close } = createManagedOverlay(
    '管理标签',
    renderManageTagContent(),
    '<button class="btn-cancel">关闭</button>'
  );

  const refreshContent = () => {
    const box = overlay.querySelector('.tag-input-box');
    const h4 = box.querySelector('h4');
    const btnRow = box.querySelector('.btn-row');
    box.innerHTML = '';
    box.appendChild(h4);
    box.insertAdjacentHTML('beforeend', renderManageTagContent());
    box.appendChild(btnRow);
  };

  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) { close(); return; }

    const deleteBtn = ev.target.closest('[data-role="delete-tag"]');
    if (deleteBtn) {
      const tag = deleteBtn.dataset.tag;
      const item = deleteBtn.closest('.tag-manage-item');
      item.classList.add('removing');
      item.addEventListener('animationend', () => {
        data.tags = data.tags.filter(t => t !== tag);
        data.todos.forEach(todo => { if (todo.tag === tag) todo.tag = ''; });
        if (currentTag === tag) { currentTag = null; currentList = 'all'; }
        saveData();
        render();
        refreshContent();
        showToast('标签已删除');
      }, { once: true });
      return;
    }
  });

  overlay.addEventListener('dblclick', (ev) => {
    const nameEl = ev.target.closest('[data-role="rename-tag"]');
    if (!nameEl) return;
    const item = nameEl.closest('.tag-manage-item');
    const oldTag = item.dataset.tag;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tag-rename-input';
    input.value = oldTag;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const doRename = () => {
      const newName = input.value.trim();
      if (!newName || newName === oldTag) {
        refreshContent();
        return;
      }
      if (data.tags.includes(newName)) {
        showToast('标签名已存在');
        input.focus();
        return;
      }
      const idx = data.tags.indexOf(oldTag);
      if (idx !== -1) data.tags[idx] = newName;
      data.todos.forEach(todo => { if (todo.tag === oldTag) todo.tag = newName; });
      if (currentTag === oldTag) currentTag = newName;
      saveData();
      render();
      refreshContent();
      showToast('标签已重命名');
    };

    input.addEventListener('blur', doRename);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { ev.preventDefault(); refreshContent(); }
    });
  });
}

// --- Filtering ---
function getFilteredTodos() {
  if (searchKeyword) {
    const kw = searchKeyword.toLowerCase();
    const onlyArchived = currentList === 'archived';
    return data.todos.filter(t => {
      if (onlyArchived ? !t.archived : t.archived) return false;
      return t.title.toLowerCase().includes(kw) ||
        (t.desc && t.desc.toLowerCase().includes(kw)) ||
        (t.tag && t.tag.toLowerCase().includes(kw));
    });
  }
  return _getFilteredTodos(data, currentList, currentTag);
}

// --- Render ---
function render() {
  renderSidebar();
  renderTodoList();
  renderStatus();
}

function renderSidebar() {
  const counts = countByList(data.todos);
  document.getElementById('count-todo').textContent = counts.todo;
  document.getElementById('count-important').textContent = counts.important;
  document.getElementById('count-all').textContent = counts.all;
  document.getElementById('count-archived').textContent = data.todos.filter(t => t.archived).length;

  const tagListEl = document.getElementById('tag-list');
  const visibleTags = data.tags.filter(tag => {
    const tagTodos = data.todos.filter(t => t.tag === tag);
    return tagTodos.length === 0 || tagTodos.some(t => !t.archived);
  });
  tagListEl.innerHTML = visibleTags.map(tag => `
    <a href="#" class="tag-item ${currentTag === tag ? 'active' : ''}" data-tag="${escapeHtml(tag)}">
      <span class="tag-dot" ${getTagDotStyle(tag)}></span>
      <span class="tag-label">${escapeHtml(tag)}</span>
      <span class="nav-count">${countTagUndone(data.todos, tag)}</span>
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
  const addTaskBar = document.querySelector('.add-task-bar');

  if (currentList === 'archived') {
    addTaskBar.style.display = 'none';
    const sorted = filtered.slice().sort((a, b) => {
      const ta = a.archivedAt ? new Date(a.archivedAt).getTime() : 0;
      const tb = b.archivedAt ? new Date(b.archivedAt).getTime() : 0;
      return tb - ta;
    });
    todoListEl.innerHTML = '';
    if (sorted.length === 0) {
      todoListEl.innerHTML = '<div class="empty-state">暂无归档任务</div>';
    } else {
      sorted.forEach(t => todoListEl.appendChild(renderTodoItem(t)));
    }
    doneSection.style.display = 'none';
    taskSummary.textContent = `${sorted.length} 个归档`;
    statusText.textContent = `共 ${sorted.length} 项归档任务`;
    return;
  }

  if (searchKeyword) {
    addTaskBar.style.display = 'none';
    const sorted = sortByPriority(filtered);
    todoListEl.innerHTML = '';
    if (sorted.length === 0) {
      todoListEl.innerHTML = '<div class="empty-state">未找到匹配的任务</div>';
    } else {
      sorted.forEach(t => todoListEl.appendChild(renderTodoItem(t)));
    }
    doneSection.style.display = 'none';
    taskSummary.textContent = `搜索到 ${sorted.length} 个任务`;
    statusText.textContent = `搜索: "${searchKeyword}"`;
    return;
  }

  addTaskBar.style.display = '';
  const { pending, done } = splitPendingDone(filtered);
  const sorted = sortByPriority(pending);

  todoListEl.innerHTML = '';
  if (sorted.length === 0) {
    todoListEl.innerHTML = '<div class="empty-state">暂无待办事项</div>';
  } else {
    sorted.forEach(t => todoListEl.appendChild(renderTodoItem(t)));
  }

  doneCountEl.textContent = done.length;
  doneSection.style.display = done.length > 0 ? 'block' : 'none';
  doneToggleEl.classList.toggle('collapsed', doneCollapsed);
  doneListEl.innerHTML = '';
  if (!doneCollapsed) {
    done.forEach(t => doneListEl.appendChild(renderTodoItem(t)));
  }

  taskSummary.textContent = `${sorted.length} 个任务`;
  statusText.textContent = `共 ${filtered.length} 项任务 · ${done.length} 已完成`;
}

function renderTodoItem(t) {
  return createTodoItemEl(t, { getTagBadgeStyle, currentList });
}

function renderStatus() {
  const listTitle = document.getElementById('list-title');
  if (currentTag) {
    listTitle.textContent = currentTag;
  } else {
    const titles = { todo: 'TODO', important: '重要', all: '所有', archived: '归档' };
    listTitle.textContent = titles[currentList] || '所有';
  }
}

// --- Calendar ---
function renderCalendar() {
  _renderCalendar({ currentMonth, selectedDate, data, getTodosForDate, onDetailRender: renderCalendarDetail });
}

function getTodosForDate(date) {
  return _getTodosForDate(date, data);
}

function renderCalendarDetail() {
  _renderCalendarDetail({ selectedDate, data, renderTodoItem });
}

function showMonthPicker(currentMonth, onConfirm) {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const nowYear = new Date().getFullYear();

  const yearOptions = [];
  for (let y = nowYear - 10; y <= nowYear + 10; y++) yearOptions.push(y);

  const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

  const contentHtml = `
    <div class="month-picker">
      <div class="month-picker-row">
        <select id="picker-year">${yearOptions.map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}年</option>`).join('')}</select>
        <select id="picker-month">${monthNames.map((n, i) => `<option value="${i}" ${i === month ? 'selected' : ''}>${n}</option>`).join('')}</select>
      </div>
    </div>`;

  const actionsHtml = '<button class="btn-cancel" id="picker-cancel">取消</button><button class="btn-primary" id="picker-confirm">确定</button>';

  const overlay = createOverlay('选择月份', contentHtml, actionsHtml);
  const close = () => closeOverlay(overlay);

  overlay.querySelector('#picker-cancel').addEventListener('click', close);
  overlay.querySelector('#picker-confirm').addEventListener('click', () => {
    const y = parseInt(document.getElementById('picker-year').value);
    const m = parseInt(document.getElementById('picker-month').value);
    close();
    onConfirm(y, m);
  });
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });
  overlay.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const y = parseInt(document.getElementById('picker-year').value);
      const m = parseInt(document.getElementById('picker-month').value);
      close();
      onConfirm(y, m);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
    }
  });
  overlay.querySelector('#picker-confirm').focus();
}

// --- Detail Panel ---
function openDetail(id) {
  const todo = data.todos.find(t => t.id === id);
  _openDetail(todo);
}

// --- Main init ---
export async function initApp() {
  data = await loadData();
  normalizeData();

  initDetailEditor({
    onDoneTimeChange: (id, newDoneAt) => {
      const todo = data.todos.find(t => t.id === id);
      if (!todo) return;
      todo.doneAt = newDoneAt;
      saveData();
      render();
      if (currentList === 'calendar') renderCalendar();
    }
  });

  let appConfig = {};
  try {
    const res = await fetch('./app.config.json');
    if (res.ok) appConfig = await res.json();
  } catch (e) { /* ignore */ }

  applyTheme(data.theme);

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (data.theme === 'auto') applyTheme(data.theme);
  });

  document.getElementById('btn-theme-toggle').addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    const idx = order.indexOf(data.theme);
    data.theme = order[(idx + 1) % 3];
    saveData();
    applyTheme(data.theme);
    updateThemeButton(data.theme);
  });
  updateThemeButton(data.theme);

  // --- Search ---
  const searchBar = document.getElementById('search-bar');
  const searchInput = document.getElementById('search-input');
  let searchTimer = null;

  document.getElementById('btn-search').addEventListener('click', () => {
    searchBar.classList.toggle('hidden');
    if (!searchBar.classList.contains('hidden')) {
      searchInput.focus();
    } else {
      searchInput.value = '';
      searchKeyword = '';
      renderTodoList();
    }
  });

  document.getElementById('btn-search-close').addEventListener('click', () => {
    searchBar.classList.add('hidden');
    searchInput.value = '';
    searchKeyword = '';
    renderTodoList();
  });

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchKeyword = searchInput.value.trim();
      renderTodoList();
    }, 200);
  });

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
    searchKeyword = '';
    searchInput.value = '';
    searchBar.classList.add('hidden');

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
    searchKeyword = '';
    searchInput.value = '';
    searchBar.classList.add('hidden');
    document.getElementById('view-calendar').classList.remove('active');
    document.getElementById('view-list').classList.add('active');
    render();
  });

  // Quick add presets
  let quickAddPreset = { endTime: null, priority: 'none', tag: '' };

  function resetQuickAddPreset() {
    quickAddPreset.endTime = null;
    quickAddPreset.priority = 'none';
    quickAddPreset.tag = '';
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

  initQuickAddPopups({ quickAddPreset, updateQuickAddIndicators, data, getTagDotStyle });

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
        archived: false,
        archivedAt: null,
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
  function handleTodoAction(target) {
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
      deleteTodoById(id, target.closest('.todo-item'), true);
    }
  }

  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    handleTodoAction(target);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target.closest('[data-action="toggle"]');
    if (!target) return;
    e.preventDefault();
    handleTodoAction(target);
  });

  // Done toggle
  doneToggle.addEventListener('click', (e) => {
    if (e.target.closest('.btn-archive-all')) return;
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

  document.getElementById('btn-archive-done').addEventListener('click', (e) => {
    e.stopPropagation();
    const filtered = getFilteredTodos();
    const doneTodos = filtered.filter(t => t.done && !t.archived);
    if (doneTodos.length === 0) { showToast('没有可归档的任务'); return; }
    const now = new Date().toISOString();
    doneTodos.forEach(t => { t.archived = true; t.archivedAt = now; });
    saveData();
    render();
    showToast(`已归档 ${doneTodos.length} 个任务`);
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
    deleteTodoById(document.getElementById('detail-id').value);
  });

  // Clear done
  document.getElementById('btn-clear-done').addEventListener('click', () => {
    clearDoneTasks();
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

  document.getElementById('btn-today').addEventListener('click', () => {
    const today = new Date();
    currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    selectedDate = today;
    renderCalendar();
  });

  document.getElementById('calendar-title').addEventListener('click', () => {
    showMonthPicker(currentMonth, (year, month) => {
      currentMonth = new Date(year, month, 1);
      selectedDate = null;
      renderCalendar();
    });
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

  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();

    if (mini.isMiniMode()) {
      return;
    }

    closeContextMenu();

    const todoItem = e.target.closest('.todo-item');
    const tagItem = e.target.closest('.tag-item[data-tag]');
    const navItem = e.target.closest('.nav-item[data-list]');
    const todoListArea = e.target.closest('.todo-list');

    if (todoItem) {
      const id = todoItem.dataset.id;
      const todo = data.todos.find(t => t.id === id);
      if (!todo) return;
      const items = buildTodoContextMenu(todo, { data, saveData, render, openDetail, deleteTodoById });
      showContextMenu(e.clientX, e.clientY, items);
    } else if (tagItem) {
      const tag = tagItem.dataset.tag;
      const setCurrentTag = (t) => { currentTag = t; currentList = null; };
      showContextMenu(e.clientX, e.clientY, buildTagContextMenu(tag, { setCurrentTag, render, deleteTagFromMenu }));
    } else if (navItem) {
      showContextMenu(e.clientX, e.clientY, buildNavContextMenu({ clearDoneTasks }));
    } else if (todoListArea) {
      showContextMenu(e.clientX, e.clientY, buildListAreaMenu({ clearDoneTasks }));
    }
  });

  function closeWindow() {
    if (isNeutralinoEnv()) {
      Neutralino.window.hide();
    } else {
      window.close();
    }
  }

  function deleteTodoById(id, itemEl = null, animated = false) {
    showConfirmDialog('确定要删除这个任务吗？', () => {
      const removeTodo = () => {
        data.todos = data.todos.filter(t => t.id !== id);
        saveData();
        closeDetail();
        render();
      };
      if (animated && itemEl) {
        itemEl.classList.add('removing');
        itemEl.addEventListener('animationend', removeTodo, { once: true });
      } else {
        removeTodo();
      }
    });
  }

  function deleteTagFromMenu(tag) {
    deleteTag(tag, () => {
      render();
    });
  }

  function clearDoneTasks() {
    const doneTodos = getFilteredTodos().filter(t => t.done);
    if (doneTodos.length === 0) { showToast('没有已完成的任务'); return; }
    const doneIds = new Set(doneTodos.map(t => t.id));
    showConfirmDialog(`确定要清空 ${doneTodos.length} 个已完成任务？`, () => {
      data.todos = data.todos.filter(t => !doneIds.has(t.id));
      saveData();
      render();
    });
  }

  // --- Reminder System ---
  const reminders = initReminders({ data, saveData, render, showToast, isNeutralinoEnv });

  // --- Mini Mode ---
  const mini = initMiniMode({ data, saveData, render, showToast, isNeutralinoEnv, getTagDotStyle, showContextMenu, closeWindow, reminders, appConfig });

  // --- Summary Panel ---
  initAiSummary({ data, saveData, showToast });

  // Init render
  render();
}
