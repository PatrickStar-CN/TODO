import { escapeHtml } from './utils/html.js';
import { toLocalDatetime, toLocalDateInput, parseLocalDateInput, formatMonthDay, isSameDay, isToday, getWeekday, formatDate, formatDateTime } from './utils/date.js';
import { genId } from './utils/id.js';
import { initCrypto, encrypt, tryDecrypt, isCryptoReady } from './utils/crypto.js';
import { sortByPriority, getFilteredTodos as _getFilteredTodos, countByList, countTagUndone, splitPendingDone } from './selectors.js';
import { showContextMenu, closeContextMenu } from './contextMenu.js';
import { buildTodoContextMenu, buildTagContextMenu, buildNavContextMenu, buildListAreaMenu } from './contextMenuConfig.js';
import { createTodoItemEl } from './renderTodoItem.js';
import { renderCalendar as _renderCalendar, getTodosForDate as _getTodosForDate, renderCalendarDetail as _renderCalendarDetail, buildMonthIndex } from './calendar.js';
import { openDetail as _openDetail, closeDetail, initDetailEditor } from './detail.js';
import { createOverlay, closeOverlay, showConfirmDialog } from './overlay.js';
import { applyTheme } from './theme.js';
import { applyUiStyle, normalizeUiStyle } from './uiPreferences.js';
import { initAiSummary } from './aiSummary.js';
import { initReminders } from './reminder.js';
import { initMiniMode } from './miniMode.js';
import { initQuickAddPopups } from './quickAddPopup.js';
import { initDatePicker } from './datePicker.js';
import { initSettings } from './settings.js';

const TAG_COLORS = ['#4f46e5', '#06b6d4', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];
const STORAGE_KEY = 'todo_app_data';
const DATA_FILE = 'todo_data.json';
let persistenceWriteBlocked = false;

function getTagColor(tag) {
  if (!tag) return TAG_COLORS[0];
  const index = data.tags.indexOf(tag);
  return TAG_COLORS[(index >= 0 ? index : 0) % TAG_COLORS.length];
}

/* hex → "r, g, b"，供 CSS rgba() 使用，兼容性优于 color-mix */
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

function getTagBadgeStyle(tag) {
  const color = getTagColor(tag);
  const rgb = hexToRgb(color);
  /* 颜色写入 --tag-color-rgb 变量；背景由 CSS .badge-tag 规则用 rgba() 控制，
     避免内联 background 与 hover 态冲突，无需 !important。 */
  return `style="--tag-color:${color};--tag-color-rgb:${rgb}"`;
}

function getTagDotStyle(tag) {
  return `style="background:${getTagColor(tag)}"`;
}

function isNeutralinoEnv() {
  return typeof Neutralino !== 'undefined' && typeof NL_PORT !== 'undefined';
}

function createEmptyData() {
  return { todos: [], tags: [] };
}

function safeLocalStorageData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[loadData] localStorage data is invalid:', err);
    return null;
  }
}

function createPersistenceSnapshot({ includeSecrets }) {
  const replacer = (key, value) => (key === '_index' ? undefined : value);
  const snapshot = JSON.parse(JSON.stringify(data, replacer));
  if (!includeSecrets && snapshot.aiConfig) {
    snapshot.aiConfig.apiKey = '';
  }
  return snapshot;
}

async function parseStoredData(content) {
  if (typeof content !== 'string' || !content.trim()) {
    return createEmptyData();
  }
  const plain = await tryDecrypt(content);
  return JSON.parse(plain);
}

async function backupCorruptDataFile(content) {
  if (!isNeutralinoEnv() || typeof content !== 'string') return;
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await Neutralino.filesystem.writeFile(`./${DATA_FILE}.corrupt-${stamp}.bak`, content);
  } catch (err) {
    console.warn('[loadData] failed to back up corrupt data file:', err);
  }
}

function handleCorruptData(err, content, source) {
  persistenceWriteBlocked = true;
  console.error(`[loadData] ${source} data is invalid; file writes are blocked to avoid overwriting it.`, err);
  backupCorruptDataFile(content);
  setTimeout(() => {
    showToast('数据文件异常，已暂停覆盖保存');
  }, 0);
  return safeLocalStorageData() || createEmptyData();
}

async function loadData() {
  if (isNeutralinoEnv()) {
    let content = '';
    try {
      content = await Neutralino.filesystem.readFile(`./${DATA_FILE}`);
    } catch {
      return safeLocalStorageData() || createEmptyData();
    }
    try {
      return await parseStoredData(content);
    } catch (err) {
      return handleCorruptData(err, content, DATA_FILE);
    }
  }
  try {
    const res = await fetch('/api/data');
    const content = await res.text();
    if (!content.trim()) {
      return safeLocalStorageData() || createEmptyData();
    }
    try {
      return await parseStoredData(content);
    } catch (err) {
      return handleCorruptData(err, content, 'development data.json');
    }
  } catch (err) {
    console.warn('[loadData] file data unavailable, falling back to localStorage:', err);
    return safeLocalStorageData() || createEmptyData();
  }
}

let saveTimer = null;

async function saveData() {
  const replacer = (key, value) => (key === '_index' ? undefined : value);
  const json = JSON.stringify(createPersistenceSnapshot({ includeSecrets: true }), replacer, 2);
  const localJson = JSON.stringify(createPersistenceSnapshot({ includeSecrets: false }), null, 2);
  /* localStorage 保持明文（用户选择的离线降级方式） */
  localStorage.setItem(STORAGE_KEY, localJson);

  if (persistenceWriteBlocked) {
    showToast('数据文件异常，已暂停覆盖保存');
    return;
  }

  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    /* 文件存储：加密 */
    let payload = json;
    if (isCryptoReady()) {
      try {
        payload = await encrypt(json);
      } catch (err) {
        console.warn('[saveData] 加密失败，使用明文:', err);
        payload = json;
      }
    }
    if (isNeutralinoEnv()) {
      Neutralino.filesystem.writeFile(`./${DATA_FILE}`, payload).catch(() => {
        showToast('保存失败，数据已暂存本地');
      });
      return;
    }
    fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    }).catch(() => {
      showToast('保存失败，数据已暂存本地');
    });
  }, 300);
}

let data = { todos: [], tags: ['计划内'], aiConfig: { apiUrl: '', apiKey: '', model: '', customPrompt: '' }, theme: 'auto', uiStyle: normalizeUiStyle(), sidebarMini: false };
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
  /* 防御：loadData 可能因文件为空/损坏返回非对象（如空字符串） */
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    data = { todos: [], tags: [], aiConfig: {}, theme: 'auto', uiStyle: normalizeUiStyle(), sidebarMini: false };
  }
  if (!Array.isArray(data.tags)) {
    data.tags = [];
  }

  const normalizedTags = [];
  if (Array.isArray(data.tags)) {
    data.tags.forEach(tag => {
      const name = typeof tag === 'string' ? tag.trim() : '';
      if (name && !normalizedTags.includes(name)) {
        normalizedTags.push(name);
      }
    });
  }

  if (!Array.isArray(data.todos)) {
    data.todos = [];
  }
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
  data.uiStyle = normalizeUiStyle(data.uiStyle);
  if (typeof data.sidebarMini !== 'boolean') {
    data.sidebarMini = false;
  }

  if (!data._index || typeof data._index !== 'object') {
    data._index = { tagUndone: {}, tagTotal: {}, counts: { todo: 0, important: 0, all: 0, archived: 0 } };
  }
}

/* --- 索引系统：避免每次 render 都重新计算标签/视图计数 --- */
function ensureIndex() {
  if (!data._index) {
    data._index = { tagUndone: {}, tagTotal: {}, counts: { todo: 0, important: 0, all: 0, archived: 0 } };
  }
}

function rebuildIndex() {
  ensureIndex();
  const idx = data._index;
  idx.tagUndone = {};
  idx.tagTotal = {};
  idx.counts = { todo: 0, important: 0, all: 0, archived: 0 };
  for (const t of data.todos) {
    if (t.tag) {
      idx.tagTotal[t.tag] = (idx.tagTotal[t.tag] || 0) + 1;
      if (!t.done && !t.archived) {
        idx.tagUndone[t.tag] = (idx.tagUndone[t.tag] || 0) + 1;
      }
    }
    if (t.archived) {
      idx.counts.archived++;
    } else if (!t.done) {
      idx.counts.all++;
      if (t.todo) idx.counts.todo++;
      if (t.important) idx.counts.important++;
    }
  }
}

function addTodoToIndex(todo) {
  ensureIndex();
  const idx = data._index;
  if (todo.tag) {
    idx.tagTotal[todo.tag] = (idx.tagTotal[todo.tag] || 0) + 1;
    if (!todo.done && !todo.archived) {
      idx.tagUndone[todo.tag] = (idx.tagUndone[todo.tag] || 0) + 1;
    }
  }
  if (todo.archived) {
    idx.counts.archived++;
  } else if (!todo.done) {
    idx.counts.all++;
    if (todo.todo) idx.counts.todo++;
    if (todo.important) idx.counts.important++;
  }
}

function removeTodoFromIndex(todo) {
  const idx = data._index;
  if (todo.tag && idx.tagTotal[todo.tag]) {
    idx.tagTotal[todo.tag]--;
    if (idx.tagTotal[todo.tag] <= 0) delete idx.tagTotal[todo.tag];
  }
  if (todo.tag && idx.tagUndone[todo.tag] != null && !todo.done && !todo.archived) {
    idx.tagUndone[todo.tag]--;
    if (idx.tagUndone[todo.tag] <= 0) delete idx.tagUndone[todo.tag];
  }
  if (todo.archived) {
    idx.counts.archived--;
  } else if (!todo.done) {
    idx.counts.all--;
    if (todo.todo) idx.counts.todo--;
    if (todo.important) idx.counts.important--;
  }
}

function applyDelta(todo, field, oldVal, newVal) {
  const idx = data._index;
  if (field === 'tag') {
    if (oldVal && idx.tagTotal[oldVal]) {
      idx.tagTotal[oldVal]--;
      if (idx.tagTotal[oldVal] <= 0) delete idx.tagTotal[oldVal];
    }
    if (oldVal && idx.tagUndone[oldVal] != null && !todo.done && !todo.archived) {
      idx.tagUndone[oldVal]--;
      if (idx.tagUndone[oldVal] <= 0) delete idx.tagUndone[oldVal];
    }
    if (newVal) {
      idx.tagTotal[newVal] = (idx.tagTotal[newVal] || 0) + 1;
      if (!todo.done && !todo.archived) {
        idx.tagUndone[newVal] = (idx.tagUndone[newVal] || 0) + 1;
      }
    }
  } else if (field === 'done') {
    const wasUndone = !oldVal && !todo.archived;
    const isUndone = !newVal && !todo.archived;
    if (wasUndone && !isUndone) {
      idx.counts.all--;
      if (todo.todo) idx.counts.todo--;
      if (todo.important) idx.counts.important--;
      if (todo.tag && idx.tagUndone[todo.tag] != null) {
        idx.tagUndone[todo.tag]--;
        if (idx.tagUndone[todo.tag] <= 0) delete idx.tagUndone[todo.tag];
      }
    } else if (!wasUndone && isUndone) {
      idx.counts.all++;
      if (todo.todo) idx.counts.todo++;
      if (todo.important) idx.counts.important++;
      if (todo.tag) {
        idx.tagUndone[todo.tag] = (idx.tagUndone[todo.tag] || 0) + 1;
      }
    }
  } else if (field === 'archived') {
    const wasUndone = !todo.done && !oldVal;
    const isUndone = !todo.done && !newVal;
    if (wasUndone && !isUndone) {
      idx.counts.all--;
      idx.counts.archived++;
      if (todo.todo) idx.counts.todo--;
      if (todo.important) idx.counts.important--;
      if (todo.tag && idx.tagUndone[todo.tag] != null) {
        idx.tagUndone[todo.tag]--;
        if (idx.tagUndone[todo.tag] <= 0) delete idx.tagUndone[todo.tag];
      }
    } else if (!wasUndone && isUndone) {
      idx.counts.all++;
      idx.counts.archived--;
      if (todo.todo) idx.counts.todo++;
      if (todo.important) idx.counts.important++;
      if (todo.tag) {
        idx.tagUndone[todo.tag] = (idx.tagUndone[todo.tag] || 0) + 1;
      }
    } else if (!wasUndone && newVal) {
      idx.counts.archived++;
    } else if (!isUndone && oldVal) {
      idx.counts.archived--;
    }
  } else if (field === 'important' || field === 'todo') {
    if (!todo.done && !todo.archived) {
      if (field === 'todo') {
        if (newVal) idx.counts.todo++;
        else idx.counts.todo--;
      } else {
        if (newVal) idx.counts.important++;
        else idx.counts.important--;
      }
    }
  }
}

function getTagTaskCount(tag) {
  /* 优先使用 _index 索引 */
  if (data._index && data._index.tagTotal) {
    return data._index.tagTotal[tag] || 0;
  }
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

    rebuildIndex();
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
const todoDoneTransitions = new Set();

function captureTodoPositions() {
  const positions = new Map();
  document.querySelectorAll('.todo-item[data-id]').forEach(el => {
    const listEl = el.closest('#todo-list, #done-list');
    const rect = el.getBoundingClientRect();
    if (!listEl || rect.width <= 0 || rect.height <= 0) return;
    positions.set(el.dataset.id, {
      rect,
      listId: listEl.id
    });
  });
  return positions;
}

function animateTodoReflow(previousPositions, changedId) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      typeof Element.prototype.animate !== 'function') return;

  document.querySelectorAll('.todo-item[data-id]').forEach(el => {
    if (el.dataset.id === changedId) {
      el.animate([
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ], {
        duration: 200,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
      });
      return;
    }

    const previousPosition = previousPositions.get(el.dataset.id);
    const listEl = el.closest('#todo-list, #done-list');
    if (!previousPosition || !listEl || previousPosition.listId !== listEl.id) return;

    const currentRect = el.getBoundingClientRect();
    if (currentRect.width <= 0 || currentRect.height <= 0) return;
    const deltaY = previousPosition.rect.top - currentRect.top;
    if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 0.5 ||
        Math.abs(deltaY) > window.innerHeight) return;

    el.animate([
      { transform: `translateY(${deltaY}px)` },
      { transform: 'translateY(0)' }
    ], {
      duration: 280,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
    });
  });
}

function setTodoDoneAnimated(todo, doneState, itemEl = null) {
  if (!todo || todo.done === doneState || todoDoneTransitions.has(todo.id)) return;
  todoDoneTransitions.add(todo.id);

  const sourceEl = itemEl?.isConnected
    ? itemEl
    : [...document.querySelectorAll('.todo-item[data-id]')]
      .find(el => el.dataset.id === todo.id);

  const commit = () => {
    const previousPositions = captureTodoPositions();
    const oldDone = todo.done;
    todo.done = doneState;
    todo.doneAt = doneState ? new Date().toISOString() : null;
    if (doneState && todo.reminderRepeat === 'none') {
      todo.reminder = null;
    }
    applyDelta(todo, 'done', oldDone, todo.done);
    saveData();
    render();
    animateTodoReflow(previousPositions, todo.id);
    todoDoneTransitions.delete(todo.id);
  };

  if (!sourceEl || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    commit();
    return;
  }

  sourceEl.classList.add('completion-exit');
  sourceEl.setAttribute('aria-busy', 'true');
  let committed = false;
  const commitOnce = () => {
    if (committed) return;
    committed = true;
    commit();
  };
  sourceEl.addEventListener('animationend', event => {
    if (event.target === sourceEl) commitOnce();
  });
  setTimeout(commitOnce, 260);
}

function render() {
  /* 索引被外部置空时（如 settings 标签重命名/删除）自动重建 */
  if (!data._index) rebuildIndex();
  renderSidebar();
  renderTodoList();
  renderStatus();
  /* 日历视图：统一在此分发，避免各 CRUD 点遗漏 */
  if (currentList === 'calendar') renderCalendar();
}

function renderSidebar() {
  const counts = countByList(data);
  document.getElementById('count-todo').textContent = counts.todo;
  document.getElementById('count-important').textContent = counts.important;
  document.getElementById('count-all').textContent = counts.all;
  document.getElementById('count-archived').textContent = counts.archived;

  const tagListEl = document.getElementById('tag-list');
  /* 使用 tagTotal 索引判断 tag 是否有关联任务（O(T)） */
  const tagTotalIdx = (data._index && data._index.tagTotal) || {};
  const visibleTags = data.tags.filter(tag => {
    const total = tagTotalIdx[tag] || 0;
    if (total === 0) return true;
    /* 有任务时，tagUndone > 0 即未全部归档 */
    const undone = (data._index && data._index.tagUndone && data._index.tagUndone[tag]) || 0;
    return undone > 0;
  });
  tagListEl.innerHTML = visibleTags.map(tag => `
    <a href="#" class="tag-item ${currentTag === tag ? 'active' : ''}" data-tag="${escapeHtml(tag)}">
      <span class="tag-dot" ${getTagDotStyle(tag)}></span>
      <span class="tag-label">${escapeHtml(tag)}</span>
      <span class="nav-count">${countTagUndone(data, tag)}</span>
    </a>
  `).join('');

  document.querySelectorAll('.nav-item[data-list]').forEach(el => {
    el.classList.toggle('active', !currentTag && el.dataset.list === currentList);
  });
}

function renderTodoList() {
  const todoListEl = document.getElementById('todo-list');
  const doneListEl = document.getElementById('done-list');
  const doneCountEl = document.getElementById('done-count');
  const doneSection = document.getElementById('done-section');
  const doneToggleEl = document.getElementById('done-toggle');
  const taskSummary = document.getElementById('task-summary');

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
  const monthIndex = buildMonthIndex(currentMonth.getFullYear(), currentMonth.getMonth(), data);
  _renderCalendar({ currentMonth, selectedDate, data, getTodosForDate, onDetailRender: renderCalendarDetail }, monthIndex);
}

function getTodosForDate(date) {
  return _getTodosForDate(date, data);
}

function renderCalendarDetail(monthIndex) {
  _renderCalendarDetail({ selectedDate, data, renderTodoItem }, monthIndex);
}

function showMonthPicker(currentMonth, onConfirm) {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const nowYear = new Date().getFullYear();

  const yearOptions = [];
  for (let y = nowYear - 10; y <= nowYear + 10; y++) yearOptions.push(y);

  const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

  const renderPickerSelect = (id, value, options, ariaLabel) => {
    const selected = options.find(option => option.value === value) || options[0];
    return `
      <div class="month-picker-select" id="${id}" data-value="${selected.value}">
        <button class="month-picker-trigger" type="button" aria-label="${ariaLabel}" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-menu">
          <span class="month-picker-value">${selected.label}</span>
          <svg class="detail-select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
        <div class="month-picker-menu hidden" id="${id}-menu" role="listbox">
          ${options.map(option => `
            <button class="month-picker-option${option.value === selected.value ? ' selected' : ''}" type="button" role="option" data-value="${option.value}" aria-selected="${option.value === selected.value}">${option.label}</button>
          `).join('')}
        </div>
      </div>`;
  };

  const yearPickerOptions = yearOptions.map(value => ({ value, label: `${value}年` }));
  const monthPickerOptions = monthNames.map((label, value) => ({ value, label }));

  const contentHtml = `
    <div class="month-picker">
      <div class="month-picker-row">
        <label class="month-picker-field">
          <span>年份</span>
          ${renderPickerSelect('picker-year', year, yearPickerOptions, '选择年份')}
        </label>
        <label class="month-picker-field">
          <span>月份</span>
          ${renderPickerSelect('picker-month', month, monthPickerOptions, '选择月份')}
        </label>
      </div>
    </div>`;

  const actionsHtml = '<button class="btn-cancel" id="picker-cancel">取消</button><button class="btn-primary" id="picker-confirm">确定</button>';

  const overlay = createOverlay('选择年月', contentHtml, actionsHtml, document.getElementById('calendar-title'));
  overlay.querySelector('.tag-input-box').classList.add('month-picker-dialog');
  const close = () => closeOverlay(overlay);
  const pickerSelects = [...overlay.querySelectorAll('.month-picker-select')];

  const closePickerMenus = (except = null) => {
    pickerSelects.forEach(select => {
      if (select === except) return;
      select.classList.remove('is-open');
      select.querySelector('.month-picker-trigger').setAttribute('aria-expanded', 'false');
      select.querySelector('.month-picker-menu').classList.add('hidden');
    });
  };

  const openPickerMenu = (select, focusSelected = false) => {
    closePickerMenus(select);
    select.classList.add('is-open');
    select.querySelector('.month-picker-trigger').setAttribute('aria-expanded', 'true');
    select.querySelector('.month-picker-menu').classList.remove('hidden');
    const selectedOption = select.querySelector('.month-picker-option.selected');
    selectedOption?.scrollIntoView({ block: 'nearest' });
    if (focusSelected) selectedOption?.focus();
  };

  const selectPickerOption = (select, option) => {
    select.dataset.value = option.dataset.value;
    select.querySelector('.month-picker-value').textContent = option.textContent;
    select.querySelectorAll('.month-picker-option').forEach(item => {
      const isSelected = item === option;
      item.classList.toggle('selected', isSelected);
      item.setAttribute('aria-selected', String(isSelected));
    });
    closePickerMenus();
    select.querySelector('.month-picker-trigger').focus();
  };

  pickerSelects.forEach(select => {
    const trigger = select.querySelector('.month-picker-trigger');
    const menu = select.querySelector('.month-picker-menu');
    const options = [...select.querySelectorAll('.month-picker-option')];

    trigger.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (select.classList.contains('is-open')) closePickerMenus();
      else openPickerMenu(select);
    });

    trigger.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
      ev.preventDefault();
      ev.stopPropagation();
      openPickerMenu(select, true);
    });

    options.forEach((option, index) => {
      option.addEventListener('click', (ev) => {
        ev.stopPropagation();
        selectPickerOption(select, option);
      });
      option.addEventListener('keydown', (ev) => {
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          ev.preventDefault();
          ev.stopPropagation();
          const offset = ev.key === 'ArrowDown' ? 1 : -1;
          options[(index + offset + options.length) % options.length].focus();
        } else if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          ev.stopPropagation();
          selectPickerOption(select, option);
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          ev.stopPropagation();
          closePickerMenus();
          trigger.focus();
        }
      });
    });

    menu.addEventListener('click', ev => ev.stopPropagation());
  });

  const confirmSelection = () => {
    const y = parseInt(document.getElementById('picker-year').dataset.value);
    const m = parseInt(document.getElementById('picker-month').dataset.value);
    close();
    onConfirm(y, m);
  };

  overlay.querySelector('#picker-cancel').addEventListener('click', close);
  overlay.querySelector('#picker-confirm').addEventListener('click', confirmSelection);
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) close();
    else if (!ev.target.closest('.month-picker-select')) closePickerMenus();
  });
  overlay.addEventListener('keydown', (ev) => {
    if (ev.target.closest('.month-picker-select')) return;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      confirmSelection();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
    }
  });
  overlay.querySelector('#picker-confirm').focus();
}

// --- Detail Panel ---
function openDetail(id, triggerEl) {
  const todo = data.todos.find(t => t.id === id);
  _openDetail(todo, triggerEl);
}

// --- Main init ---
export async function initApp() {
  await initCrypto();
  data = await loadData();
  normalizeData();
  rebuildIndex();

  initDetailEditor({
    data,
    getTagColor,
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
  applyUiStyle(data.uiStyle);

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (data.theme === 'auto') applyTheme(data.theme);
  });

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
    icon.textContent = data.sidebarMini ? '▶' : '◀';
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
  const listView = document.getElementById('view-list');
  const doneSection = document.getElementById('done-section');
  const taskScrollArea = document.querySelector('.task-scroll-area');
  const addTaskBar = document.querySelector('.add-task-bar');
  const detailForm = document.getElementById('detail-form');
  const calendarDays = document.getElementById('calendar-days');

  const syncDonePanelLayout = () => {
    const isVisible = getComputedStyle(doneSection).display !== 'none';
    const reservedSpace = isVisible ? doneSection.offsetHeight + 12 : 0;
    listView.style.setProperty('--done-panel-space', `${reservedSpace}px`);

    const listRect = listView.getBoundingClientRect();
    const addBarRect = addTaskBar.getBoundingClientRect();
    if (addBarRect.width > 0) {
      doneSection.style.left = `${addBarRect.left - listRect.left}px`;
      doneSection.style.right = `${listRect.right - addBarRect.right}px`;
    }
  };

  if (typeof ResizeObserver !== 'undefined') {
    const donePanelObserver = new ResizeObserver(syncDonePanelLayout);
    donePanelObserver.observe(doneSection);
    donePanelObserver.observe(taskScrollArea);
    donePanelObserver.observe(addTaskBar);
  }

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

  // Date pickers
  initDatePicker(document.getElementById('detail-start'), { mode: 'datetime' });
  initDatePicker(document.getElementById('detail-end'), { mode: 'datetime' });
  initDatePicker(document.getElementById('detail-reminder'), { mode: 'datetime' });
  initDatePicker(document.getElementById('summary-date'), { mode: 'date' });

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
      addTodoToIndex(todo);
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
        setTodoDoneAnimated(todo, !todo.done, itemEl);
      }
    } else if (action === 'edit') {
      openDetail(id, target.closest('.todo-item'));
    } else if (action === 'star') {
      const todo = data.todos.find(t => t.id === id);
      if (todo) {
        const oldImp = todo.important;
        todo.important = !todo.important;
        applyDelta(todo, 'important', oldImp, todo.important);
        saveData();
        render();
      }
    } else if (action === 'delete') {
      deleteTodoById(id, target.closest('.todo-item'));
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
    doneTodos.forEach(t => { t.archived = true; t.archivedAt = now; applyDelta(t, 'archived', false, true); });
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

    const oldTag = todo.tag;
    const oldTodo = todo.todo;
    const oldImp = todo.important;

    todo.title = document.getElementById('detail-title').value.trim();
    todo.desc = document.getElementById('detail-desc').value.trim();
    todo.priority = document.getElementById('detail-priority').dataset.value || 'none';
    todo.tag = document.getElementById('detail-tag').dataset.value.trim();
    todo.startTime = document.getElementById('detail-start').value || null;
    todo.endTime = document.getElementById('detail-end').value || null;
    todo.reminder = document.getElementById('detail-reminder').value || null;
    todo.reminderRepeat = document.getElementById('detail-reminder-repeat').dataset.value || 'none';
    todo.todo = document.getElementById('detail-todo').checked;
    todo.important = document.getElementById('detail-important').checked;

    /* 同步索引：tag / todo / important 变化 */
    if (oldTag !== todo.tag) applyDelta(todo, 'tag', oldTag, todo.tag);
    if (oldTodo !== todo.todo) applyDelta(todo, 'todo', oldTodo, todo.todo);
    if (oldImp !== todo.important) applyDelta(todo, 'important', oldImp, todo.important);

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
    if (!dayEl) return;
    const dateStr = dayEl.dataset.date;
    if (!dateStr) return;
    selectedDate = new Date(dateStr);
    /* 点击上/下月日期时，切换到对应月份 */
    if (dayEl.classList.contains('other-month')) {
      currentMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    }
    renderCalendar();
  });

  calendarDays.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const dayEl = e.target.closest('.calendar-day[role="button"]');
    if (!dayEl) return;
    e.preventDefault();
    dayEl.click();
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDetail();
    if (e.key === 'F5' || (e.ctrlKey && e.key === 'r') || (e.ctrlKey && e.shiftKey && e.key === 'R')) {
      e.preventDefault();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      const detailPanel = document.getElementById('detail-panel');
      if (detailPanel && !detailPanel.classList.contains('hidden')) {
        e.preventDefault();
        detailForm.requestSubmit();
      }
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
      const items = buildTodoContextMenu(todo, { data, updateTodo, openDetail, deleteTodoById, toggleDone });
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

  function deleteTodoById(id, itemEl = null) {
    showConfirmDialog('确定要删除这个任务吗？', () => {
      const sourceEl = itemEl?.isConnected
        ? itemEl
        : [...document.querySelectorAll('.todo-item[data-id]')]
          .find(el => el.dataset.id === id);

      const removeTodo = () => {
        const previousPositions = captureTodoPositions();
        const todo = data.todos.find(t => t.id === id);
        if (todo) removeTodoFromIndex(todo);
        data.todos = data.todos.filter(t => t.id !== id);
        saveData();
        closeDetail();
        render();
        animateTodoReflow(previousPositions, id);
      };

      if (!sourceEl || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        removeTodo();
        return;
      }

      sourceEl.classList.add('removing');
      sourceEl.setAttribute('aria-busy', 'true');
      let removed = false;
      const removeOnce = () => {
        if (removed) return;
        removed = true;
        removeTodo();
      };
      sourceEl.addEventListener('animationend', event => {
        if (event.target === sourceEl) removeOnce();
      });
      setTimeout(removeOnce, 260);
    });
  }

  function toggleDone(todo, doneState) {
    setTodoDoneAnimated(todo, doneState);
  }

  function updateTodo(todo, patchOrMutator) {
    if (!todo) return;
    if (typeof patchOrMutator === 'function') {
      patchOrMutator(todo);
    } else if (patchOrMutator && typeof patchOrMutator === 'object') {
      Object.assign(todo, patchOrMutator);
    }
    rebuildIndex();
    saveData();
    render();
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
      doneTodos.forEach(t => removeTodoFromIndex(t));
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

  // --- Settings Panel ---
  initSettings({
    data,
    saveData,
    showToast,
    render,
    testNotification: reminders.testNotification,
    getNotificationStatus: reminders.getNotificationStatus
  });

  // Init render
  render();
}
