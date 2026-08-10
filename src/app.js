import { escapeHtml } from './utils/html.js';
import { toLocalDatetime, toLocalDateInput, parseLocalDateInput, formatMonthDay, isSameDay, isToday, getWeekday, formatDate, formatDateTime } from './utils/date.js';
import { genId } from './utils/id.js';
import { initCrypto, encrypt, tryDecrypt, tryDecryptSync, isCryptoReady } from './utils/crypto.js';
import { sortByPriority, getFilteredTodos as _getFilteredTodos, countByList, countTagUndone, splitPendingDone } from './selectors.js';
import { showContextMenu, closeContextMenu } from './contextMenu.js';
import { buildTodoContextMenu, buildTagContextMenu, buildNavContextMenu, buildListAreaMenu } from './contextMenuConfig.js';
import { createTodoItemEl } from './renderTodoItem.js';
import { formatTimelineTime, getTimelineDateParts, normalizeTimelineSettings, sortTimelineTodos } from './timeline.js';
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
import { createRuntimeIndex } from './runtimeIndex.js';
import { iconSvg, setIcon } from './icons.js';

const TAG_COLORS = ['#4f46e5', '#06b6d4', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];
const STORAGE_KEY = 'todo_app_data';
const DATA_FILE = 'todo_data.json';
let persistenceWriteBlocked = false;
let persistenceBlockedNotified = false;
let runtimeIndex = null;
let desktopDataPath = null;
const dataChangeListeners = new Set();

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

function getNextTagDotStyle() {
  return `style="background:${TAG_COLORS[data.tags.length % TAG_COLORS.length]}"`;
}

function isNeutralinoEnv() {
  return typeof Neutralino !== 'undefined' && typeof NL_PORT !== 'undefined';
}

async function getDesktopDataPath() {
  if (!isNeutralinoEnv()) return DATA_FILE;
  if (desktopDataPath) return desktopDataPath;
  const isBundled = typeof NL_RESMODE === 'string' && NL_RESMODE === 'bundle';
  const basePath = isBundled && typeof NL_PATH === 'string'
    ? NL_PATH
    : (typeof NL_CWD === 'string' ? NL_CWD : '.');
  try {
    desktopDataPath = await Neutralino.filesystem.getJoinedPath(basePath, DATA_FILE);
  } catch {
    desktopDataPath = `${basePath.replace(/[\\/]$/, '')}/${DATA_FILE}`;
  }
  return desktopDataPath;
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

function createPersistenceSnapshots() {
  const { _index, ...base } = data;
  const aiConfig = { ...(base.aiConfig || {}) };
  return {
    file: { ...base, aiConfig },
    local: { ...base, aiConfig: { ...aiConfig, apiKey: '' } }
  };
}

function persistLocalSnapshot() {
  try {
    const snapshots = createPersistenceSnapshots();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots.local, null, 2));
  } catch (err) {
    console.warn('[loadData] failed to persist localStorage snapshot:', err);
  }
}

async function parseStoredData(content) {
  if (typeof content !== 'string' || !content.trim()) {
    return createEmptyData();
  }
  const plain = await tryDecrypt(content);
  return JSON.parse(plain);
}

async function loadDevelopmentRecoveryData() {
  try {
    const response = await fetch('/api/recovery-data');
    if (!response.ok) return null;
    const content = await response.text();
    if (!content.trim()) return null;
    return await parseStoredData(content);
  } catch (err) {
    console.warn('[loadData] development recovery data unavailable:', err);
    return null;
  }
}

async function backupCorruptDataFile(content) {
  if (typeof content !== 'string') return;
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (isNeutralinoEnv()) {
      const dataPath = await getDesktopDataPath();
      await Neutralino.filesystem.writeFile(`${dataPath}.corrupt-${stamp}.bak`, content);
      /* 只清理与数据文件同目录的损坏备份，保留最近 5 份 */
      try {
        const dir = dataPath.replace(/[\\/][^\\/]*$/, '');
        const prefix = `${DATA_FILE}.corrupt-`;
        const entries = await Neutralino.filesystem.readDirectory(dir);
        const stale = entries
          .map(e => e.entry || e.name || e)
          .filter(f => typeof f === 'string' && f.startsWith(prefix) && f.endsWith('.bak'))
          .sort()
          .slice(0, -5);
        for (const f of stale) {
          await Neutralino.filesystem.removeFile(`${dir}/${f}`);
        }
      } catch {}
    } else {
      /* Web 端通过 /api/backup-data 备份，避免覆盖前丢失损坏原文件 */
      await fetch('/api/backup-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
    }
  } catch (err) {
    console.warn('[loadData] failed to back up corrupt data file:', err);
  }
}

function handleCorruptData(err, content, source) {
  const fallback = safeLocalStorageData();
  if (fallback) {
    console.warn(`[loadData] ${source} could not be decoded; recovered from localStorage.`, err);
    backupCorruptDataFile(content);
    return fallback;
  }
  if (tryDecryptSync(content)) {
    console.warn(`[loadData] ${source} uses an incompatible encryption key; preserving a backup and blocking overwrites.`, err);
    backupCorruptDataFile(content);
    persistenceWriteBlocked = true;
    persistenceBlockedNotified = true;
    setTimeout(() => {
      showToast('数据文件加密密钥不匹配，已暂停覆盖保存');
    }, 0);
    return createEmptyData();
  }
  persistenceWriteBlocked = true;
  console.error(`[loadData] ${source} data is invalid; file writes are blocked to avoid overwriting it.`, err);
  backupCorruptDataFile(content);
  persistenceBlockedNotified = true;
  setTimeout(() => {
    showToast('数据文件异常，已暂停覆盖保存');
  }, 0);
  return createEmptyData();
}

async function loadData() {
  if (isNeutralinoEnv()) {
    let content = '';
    try {
      content = await Neutralino.filesystem.readFile(await getDesktopDataPath());
    } catch {
      return safeLocalStorageData() || createEmptyData();
    }
    try {
      const storedData = await parseStoredData(content);
      return storedData;
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
      const recovered = await loadDevelopmentRecoveryData();
      if (recovered) {
        console.warn('[loadData] development data.json could not be decoded; using todo_data.json recovery data.', err);
        return recovered;
      }
      return handleCorruptData(err, content, 'development data.json');
    }
  } catch (err) {
    console.warn('[loadData] file data unavailable, falling back to localStorage:', err);
    return safeLocalStorageData() || createEmptyData();
  }
}

let saveTimer = null;
let saveVersion = 0;
let persistedVersion = 0;
let writeChain = Promise.resolve();

function persistVersion(version) {
  if (version <= persistedVersion) return writeChain;
  writeChain = writeChain.then(async () => {
    if (version <= persistedVersion) return;

    const snapshots = createPersistenceSnapshots();
    const json = JSON.stringify(snapshots.file, null, 2);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots.local, null, 2));
    } catch (err) {
      console.warn('[saveData] localStorage snapshot failed:', err);
    }
    persistedVersion = version;

    if (persistenceWriteBlocked) return;

    let payload = json;
    if (isCryptoReady()) {
      try {
        payload = await encrypt(json);
      } catch (err) {
        console.warn('[saveData] encryption failed, using plain JSON:', err);
      }
    }

    if (isNeutralinoEnv()) {
      await Neutralino.filesystem.writeFile(await getDesktopDataPath(), payload).catch(() => {
        showToast('保存失败，数据已暂存本地');
      });
      return;
    }

    await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    }).catch(() => {
      showToast('保存失败，数据已暂存本地');
    });
  }).catch((err) => {
    /* 单次保存失败不应冻结后续保存链 */
    console.warn('[saveData] persistence chain failed:', err);
  });
  return writeChain;
}

function saveData() {
  const version = ++saveVersion;
  dataChangeListeners.forEach(listener => listener());
  if (persistenceWriteBlocked && !persistenceBlockedNotified) {
    persistenceBlockedNotified = true;
    showToast('数据文件异常，已暂停覆盖保存');
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistVersion(version);
  }, 300);
}

export function flushAppData() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  return persistVersion(saveVersion);
}

function subscribeDataChanges(listener) {
  dataChangeListeners.add(listener);
  return () => dataChangeListeners.delete(listener);
}

let data = { todos: [], tags: ['计划内'], aiConfig: { apiUrl: '', apiKey: '', model: '', customPrompt: '' }, theme: 'auto', uiStyle: normalizeUiStyle(), timeline: normalizeTimelineSettings(), sidebarMini: false };
let currentList = 'todo';
let currentTag = null;
let selectedDate = null;
let calendarMode = 'month';
let chartCollapsed = false;
let currentMonth = new Date();
let doneCollapsed = true;
let searchKeyword = '';
const DONE_PAGE_SIZE = 25;
const DONE_LOAD_AHEAD_PX = 96;
const TASK_PAGE_SIZE = DONE_PAGE_SIZE;
let visibleDoneCount = DONE_PAGE_SIZE;
let visibleTaskCount = TASK_PAGE_SIZE;
let doneLoadFrame = null;
let taskLoadFrame = null;

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
    data = { todos: [], tags: [], aiConfig: {}, theme: 'auto', uiStyle: normalizeUiStyle(), timeline: normalizeTimelineSettings(), sidebarMini: false };
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
  data.timeline = normalizeTimelineSettings(data.timeline);
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
  if (runtimeIndex) return runtimeIndex.rebuild();
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

function getTodoById(id) {
  return runtimeIndex ? runtimeIndex.get(id) : data.todos.find(todo => todo.id === id);
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
      return runtimeIndex
        ? runtimeIndex.matches(t, kw)
        : `${t.title || ''}\n${t.desc || ''}\n${t.tag || ''}`.toLowerCase().includes(kw);
    });
  }
  return _getFilteredTodos(data, currentList, currentTag);
}

function resetDoneIncrementalLoad({ resetScroll = false } = {}) {
  visibleDoneCount = DONE_PAGE_SIZE;
  if (resetScroll) resetDoneListScroll();
}

function resetTaskIncrementalLoad() {
  visibleTaskCount = TASK_PAGE_SIZE;
}

function resetListIncrementalLoad() {
  resetTaskIncrementalLoad();
  resetDoneIncrementalLoad({ resetScroll: true });
}

function isNearScrollBottom(el) {
  if (!el) return false;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= DONE_LOAD_AHEAD_PX;
}

function resetDoneListScroll() {
  const wrapper = document.getElementById('done-list-wrapper');
  if (!wrapper) return;

  wrapper.scrollTop = 0;
  wrapper.scrollLeft = 0;
  requestAnimationFrame(() => {
    if (!wrapper.isConnected) return;
    wrapper.scrollTop = 0;
    wrapper.scrollLeft = 0;
  });
}

function loadMoreTasksIfNeeded(scrollEl = null) {
  if (currentList === 'calendar') return;
  if (scrollEl && !isNearScrollBottom(scrollEl)) return;

  const todoListEl = document.getElementById('todo-list');
  const total = Number(todoListEl?.dataset.total || 0);
  const rendered = Number(todoListEl?.dataset.rendered || 0);
  if (!total || rendered >= total) return;

  visibleTaskCount = Math.min(total, visibleTaskCount + TASK_PAGE_SIZE);
  renderTodoList();
}

function loadMoreDoneIfNeeded(scrollEl = null) {
  if (doneCollapsed || searchKeyword || currentList === 'archived') return;
  if (scrollEl && !isNearScrollBottom(scrollEl)) return;

  const doneListEl = document.getElementById('done-list');
  const total = Number(doneListEl?.dataset.total || 0);
  const rendered = Number(doneListEl?.dataset.rendered || 0);
  if (!total || rendered >= total) return;

  visibleDoneCount = Math.min(total, visibleDoneCount + DONE_PAGE_SIZE);
  renderTodoList();
}

function scheduleTaskIncrementalLoad(scrollEl) {
  if (taskLoadFrame) return;
  taskLoadFrame = requestAnimationFrame(() => {
    taskLoadFrame = null;
    loadMoreTasksIfNeeded(scrollEl);
  });
}

function scheduleDoneIncrementalLoad(scrollEl) {
  if (doneLoadFrame) return;
  doneLoadFrame = requestAnimationFrame(() => {
    doneLoadFrame = null;
    loadMoreDoneIfNeeded(scrollEl);
  });
}

// --- Render ---
const todoDoneTransitions = new Set();

function reflowMotionEnabled() {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
         typeof Element.prototype.animate === 'function';
}

function captureTodoPositions() {
  if (!reflowMotionEnabled()) return null;
  const positions = new Map();
  document.querySelectorAll('.todo-item[data-id]').forEach(el => {
    const listEl = el.closest('#todo-list, #done-list, #calendar-todo-list');
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
  if (!previousPositions || previousPositions.size === 0 || !reflowMotionEnabled()) return;

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
    const listEl = el.closest('#todo-list, #done-list, #calendar-todo-list');
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
    runtimeIndex.update(todo, target => {
      target.done = doneState;
      target.doneAt = doneState ? new Date().toISOString() : null;
      if (doneState && target.reminderRepeat === 'none') target.reminder = null;
    });
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

function render(scopes = null) {
  /* 索引被外部置空时（如 settings 标签重命名/删除）自动重建 */
  if (!data._index) rebuildIndex();
  const all = scopes == null;
  if (all || scopes.sidebar) renderSidebar();
  if (all || scopes.list) renderTodoList();
  if (all || scopes.status) renderStatus();
  /* 日历视图：统一在此分发，避免各 CRUD 点遗漏 */
  if (currentList === 'calendar' && (all || scopes.calendar)) renderCalendar();
}

let scheduledRenderFrame = null;
let scheduledRenderScopes = {};

function scheduleRender(scopes = { sidebar: true, list: true, status: true, calendar: true }) {
  Object.assign(scheduledRenderScopes, scopes);
  if (scheduledRenderFrame) return;
  scheduledRenderFrame = requestAnimationFrame(() => {
    const nextScopes = scheduledRenderScopes;
    scheduledRenderScopes = {};
    scheduledRenderFrame = null;
    render(nextScopes);
  });
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
    <a href="#" class="tag-item ${currentTag === tag ? 'active' : ''}" data-tag="${escapeHtml(tag)}" draggable="false">
      <span class="tag-dot" ${getTagDotStyle(tag)}></span>
      <span class="tag-label">${escapeHtml(tag)}</span>
      <span class="nav-count">${countTagUndone(data, tag)}</span>
    </a>
  `).join('');

  document.querySelectorAll('.nav-item[data-list]').forEach(el => {
    el.classList.toggle('active', !currentTag && el.dataset.list === currentList);
  });
}

let listViewCache = { key: '', filtered: null, taskSorted: null, done: null };

/* 视图管线缓存：按 (saveVersion + 视图状态) 缓存过滤/分组/排序结果。
   滚动增量加载、done 折叠切换等不改变数据的 re-render 直接复用，
   避免每次对全量 data.todos 重扫 + 重排。saveVersion 只在提交变更时递增。 */
function getListView() {
  const timelineEnabled = data.timeline.enabled;
  const key = [
    saveVersion,
    currentList,
    currentTag,
    searchKeyword,
    timelineEnabled,
    data.timeline.sortBy
  ].join('|');
  if (listViewCache.key === key && listViewCache.filtered) return listViewCache;

  const filtered = getFilteredTodos();
  let taskSorted;
  let done = [];

  if (timelineEnabled) {
    taskSorted = sortTimelineTodos(filtered, data.timeline.sortBy);
  } else if (currentList === 'archived') {
    taskSorted = filtered.slice().sort((a, b) => {
      const ta = a.archivedAt ? new Date(a.archivedAt).getTime() : 0;
      const tb = b.archivedAt ? new Date(b.archivedAt).getTime() : 0;
      return tb - ta;
    });
  } else if (searchKeyword) {
    taskSorted = sortByPriority(filtered);
  } else {
    const { pending, done: doneArr } = splitPendingDone(filtered);
    taskSorted = sortByPriority(pending);
    done = doneArr;
  }

  listViewCache = { key, filtered, taskSorted, done };
  return listViewCache;
}

function renderTodoList() {
  const todoListEl = document.getElementById('todo-list');
  const doneListEl = document.getElementById('done-list');
  const doneCountEl = document.getElementById('done-count');
  const doneSection = document.getElementById('done-section');
  const doneToggleEl = document.getElementById('done-toggle');
  const taskSummary = document.getElementById('task-summary');

  const view = getListView();
  const filtered = view.filtered;
  const sorted = view.taskSorted;
  const done = view.done;
  const addTaskBar = document.querySelector('.add-task-bar');
  const timelineEnabled = data.timeline.enabled;
  const mode = timelineEnabled ? 'timeline' : currentList === 'archived' ? 'archived' : searchKeyword ? 'search' : 'normal';

  const renderTaskItems = (items, emptyHtml) => {
    todoListEl.innerHTML = '';
    todoListEl.classList.toggle('timeline-enabled', timelineEnabled);
    todoListEl.dataset.total = String(items.length);
    if (items.length === 0) {
      todoListEl.dataset.rendered = '0';
      todoListEl.innerHTML = emptyHtml;
      return;
    }

    const visibleItems = items.slice(0, visibleTaskCount);
    todoListEl.dataset.rendered = String(visibleItems.length);
    appendTodoItems(todoListEl, visibleItems);
    requestAnimationFrame(() => {
      scheduleTaskIncrementalLoad(document.querySelector('.task-scroll-area'));
    });
  };

  if (mode === 'timeline') {
    addTaskBar.style.display = currentList === 'archived' || searchKeyword ? 'none' : '';
    renderTaskItems(sorted, data.timeline.sortBy === 'completed'
      ? '<div class="empty-state">暂无已完成任务</div>'
      : '<div class="empty-state">暂无任务</div>');
    doneSection.style.display = 'none';
    doneListEl.innerHTML = '';
    doneListEl.dataset.total = '0';
    doneListEl.dataset.rendered = '0';
    taskSummary.textContent = `${sorted.length} 个任务`;
    return;
  }

  if (mode === 'archived') {
    addTaskBar.style.display = 'none';
    renderTaskItems(sorted, '<div class="empty-state">暂无归档任务</div>');
    doneSection.style.display = 'none';
    taskSummary.textContent = `${sorted.length} 个归档`;
    return;
  }

  if (mode === 'search') {
    addTaskBar.style.display = 'none';
    renderTaskItems(sorted, '<div class="empty-state">未找到匹配的任务</div>');
    doneSection.style.display = 'none';
    taskSummary.textContent = `搜索到 ${sorted.length} 个任务`;
    return;
  }

  addTaskBar.style.display = '';
  renderTaskItems(sorted, '<div class="empty-state">暂无待办事项</div>');

  doneCountEl.textContent = done.length;
  doneSection.style.display = done.length > 0 ? 'block' : 'none';
  doneToggleEl.classList.toggle('collapsed', doneCollapsed);
  doneListEl.innerHTML = '';
  doneListEl.dataset.total = String(done.length);
  if (!doneCollapsed) {
    const visibleDone = done.slice(0, visibleDoneCount);
    doneListEl.dataset.rendered = String(visibleDone.length);
    appendTodoItems(doneListEl, visibleDone);
    requestAnimationFrame(() => {
      scheduleDoneIncrementalLoad(document.getElementById('done-list-wrapper'));
    });
  } else {
    doneListEl.dataset.rendered = '0';
  }

  taskSummary.textContent = `${sorted.length} 个任务`;
}

function appendTodoItems(container, todos) {
  const fragment = document.createDocumentFragment();
  let previousTimelineDate = null;
  let hasPreviousTimelineDate = false;
  todos.forEach(todo => {
    if (!data.timeline.enabled || container.id !== 'todo-list') {
      fragment.appendChild(renderTodoItem(todo));
      return;
    }
    const timelineDate = getTimelineDateParts(todo, data.timeline.sortBy);
    if (!hasPreviousTimelineDate || timelineDate?.year !== previousTimelineDate?.year) {
      fragment.appendChild(createTimelineGroupRow('year', timelineDate ? `${timelineDate.year}年` : '时间未知'));
    }
    if (!hasPreviousTimelineDate ||
        timelineDate?.year !== previousTimelineDate?.year ||
        timelineDate?.month !== previousTimelineDate?.month) {
      fragment.appendChild(createTimelineGroupRow('month', timelineDate ? `${timelineDate.month}月` : '未知月份'));
    }
    if (!hasPreviousTimelineDate ||
        timelineDate?.year !== previousTimelineDate?.year ||
        timelineDate?.month !== previousTimelineDate?.month ||
        timelineDate?.day !== previousTimelineDate?.day) {
      fragment.appendChild(createTimelineGroupRow('day', timelineDate ? `${timelineDate.day}号` : '未知日期'));
    }
    const row = document.createElement('div');
    row.className = 'timeline-row';
    row.appendChild(renderTodoItem(todo));
    row.appendChild(createTimelineEntry(todo));
    fragment.appendChild(row);
    previousTimelineDate = timelineDate;
    hasPreviousTimelineDate = true;
  });
  container.appendChild(fragment);
}

function renderTodoItem(t) {
  return createTodoItemEl(t, { getTagBadgeStyle, currentList });
}

function createTimelineGroupRow(level, label) {
  const row = document.createElement('div');
  row.className = `timeline-group-row timeline-group-${level}`;

  const spacer = document.createElement('span');
  spacer.setAttribute('aria-hidden', 'true');
  row.appendChild(spacer);

  const heading = document.createElement('div');
  heading.className = 'timeline-group-label';
  heading.textContent = label;
  heading.setAttribute('role', 'heading');
  heading.setAttribute('aria-level', String({ year: 2, month: 3, day: 4 }[level] || 4));
  row.appendChild(heading);
  return row;
}

function createTimelineEntry(todo) {
  const entry = document.createElement('div');
  entry.className = 'timeline-entry';

  const marker = document.createElement('span');
  marker.className = 'timeline-marker';
  marker.setAttribute('aria-hidden', 'true');
  entry.appendChild(marker);

  const times = document.createElement('div');
  times.className = 'timeline-times';

  const primary = document.createElement('span');
  primary.className = 'timeline-time timeline-time-primary';
  primary.textContent = data.timeline.sortBy === 'completed'
    ? formatTimelineTime(todo.doneAt) || '时间未知'
    : formatTimelineTime(todo.createdAt) || '时间未知';
  times.appendChild(primary);

  const secondary = document.createElement('span');
  secondary.className = 'timeline-time timeline-time-secondary';
  secondary.textContent = data.timeline.sortBy === 'completed'
    ? `创建 ${formatTimelineTime(todo.createdAt) || '时间未知'}`
    : (todo.doneAt ? `完成 ${formatTimelineTime(todo.doneAt) || '时间未知'}` : '完成 未完成');
  times.appendChild(secondary);

  entry.setAttribute('aria-label', `${primary.textContent}，${secondary.textContent}`);
  times.setAttribute('aria-hidden', 'true');
  entry.appendChild(times);
  return entry;
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
let monthIndexCache = { key: '', version: -1, index: null };

function renderCalendar() {
  const key = `${currentMonth.getFullYear()}-${currentMonth.getMonth()}`;
  const version = saveVersion;
  if (monthIndexCache.key !== key || monthIndexCache.version !== version) {
    monthIndexCache = {
      key,
      version,
      index: buildMonthIndex(currentMonth.getFullYear(), currentMonth.getMonth(), data)
    };
  }
  const monthIndex = monthIndexCache.index;
  _renderCalendar({ currentMonth, selectedDate, data, getTodosForDate, onDetailRender: renderCalendarDetail, mode: calendarMode }, monthIndex);
  syncCalendarViewState();
}

function syncCalendarViewState() {
  const container = document.querySelector('.calendar-container');
  const toggleButton = document.getElementById('toggle-calendar-chart');
  const toggleLabel = toggleButton?.querySelector('.calendar-collapse-label');
  const todayButton = document.getElementById('btn-today');
  const legend = document.querySelector('.calendar-heat-legend');
  const legendLabel = document.getElementById('calendar-legend-label');

  if (container) {
    container.dataset.calendarMode = calendarMode;
    container.classList.toggle('chart-collapsed', chartCollapsed);
  }

  document.querySelectorAll('.calendar-mode-btn').forEach(button => {
    const active = button.dataset.calendarMode === calendarMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });

  todayButton?.classList.toggle('hidden', calendarMode !== 'month');
  legend?.classList.toggle('hidden', calendarMode === 'month');
  if (legendLabel) {
    legendLabel.textContent = calendarMode === 'completed' ? '完成量' : '任务量';
  }

  if (toggleButton) {
    toggleButton.setAttribute('aria-expanded', String(!chartCollapsed));
    if (toggleLabel) toggleLabel.textContent = chartCollapsed ? '展开图表' : '收起图表';
  }
}

function setCalendarMode(mode) {
  if (!['month', 'tasks', 'completed'].includes(mode)) return;
  calendarMode = mode;
  syncCalendarViewState();
}

function setChartCollapsed(collapsed) {
  chartCollapsed = Boolean(collapsed);
  syncCalendarViewState();
}

function getTodosForDate(date) {
  return _getTodosForDate(date, data);
}

function renderCalendarDetail(monthIndex) {
  _renderCalendarDetail({ selectedDate, data, renderTodoItem, mode: calendarMode }, monthIndex);
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
      <div class="month-picker-preview">
        <span class="month-picker-preview-icon">${iconSvg('calendar')}</span>
        <span class="month-picker-preview-copy">
          <small>当前选择</small>
          <strong id="month-picker-preview-value">${year}年${month + 1}月</strong>
        </span>
      </div>
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
  const pickerPreview = overlay.querySelector('#month-picker-preview-value');

  const updatePickerPreview = () => {
    if (!pickerPreview) return;
    const selectedYear = overlay.querySelector('#picker-year .month-picker-value')?.textContent || '';
    const selectedMonth = overlay.querySelector('#picker-month .month-picker-value')?.textContent || '';
    pickerPreview.textContent = `${selectedYear}${selectedMonth}`;
  };

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
    updatePickerPreview();
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
  const todo = getTodoById(id);
  _openDetail(todo, triggerEl);
}

// --- Main init ---
export async function initApp() {
  await initCrypto();
  data = await loadData();
  normalizeData();
  runtimeIndex = createRuntimeIndex(data);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAppData();
  });
  window.addEventListener('beforeunload', persistLocalSnapshot);

  initDetailEditor({
    data,
    getTagColor,
    onDoneTimeChange: (id, newDoneAt) => {
      const todo = getTodoById(id);
      if (!todo) return;
      runtimeIndex.update(todo, { doneAt: newDoneAt });
      saveData();
      scheduleRender({ list: true, sidebar: true, status: true, calendar: true });
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
    if (data.theme === 'auto') applyTheme(data.theme, { animate: true });
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
      resetListIncrementalLoad();
      renderTodoList();
    }
  });

  document.getElementById('btn-search-close').addEventListener('click', () => {
    searchBar.classList.add('hidden');
    searchInput.value = '';
    searchKeyword = '';
    resetListIncrementalLoad();
    renderTodoList();
  });

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchKeyword = searchInput.value.trim();
      resetListIncrementalLoad();
      scheduleRender({ list: true });
    }, 200);
  });

  const sidebar = document.querySelector('.sidebar');
  const toggleSidebarBtn = document.getElementById('btn-toggle-sidebar');

  // Sidebar entries behave like in-app controls, not draggable browser links.
  sidebar.addEventListener('dragstart', (event) => event.preventDefault());

  function applySidebarState() {
    sidebar.classList.toggle('mini', data.sidebarMini);
    const icon = toggleSidebarBtn.querySelector('.btn-icon');
    const text = toggleSidebarBtn.querySelector('.btn-text');
    setIcon(icon, data.sidebarMini ? 'chevron-right' : 'chevron-left');
    const label = data.sidebarMini ? '展开侧栏' : '折叠侧栏';
    text.textContent = label;
    toggleSidebarBtn.title = label;
    toggleSidebarBtn.setAttribute('aria-label', label);
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
  const doneListWrapper = document.getElementById('done-list-wrapper');
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

  const scheduleDonePanelLayoutSync = () => {
    syncDonePanelLayout();
    requestAnimationFrame(syncDonePanelLayout);
  };

  /* ResizeObserver 高频触发时只在同一帧内合并且延迟到 rAF，避免渲染期间
     同步读取布局（offsetHeight / getBoundingClientRect）造成强制回流。 */
  let panelLayoutFrame = null;
  const schedulePanelLayoutFromObserver = () => {
    if (panelLayoutFrame) return;
    panelLayoutFrame = requestAnimationFrame(() => {
      panelLayoutFrame = null;
      syncDonePanelLayout();
    });
  };

  if (typeof ResizeObserver !== 'undefined') {
    const donePanelObserver = new ResizeObserver(schedulePanelLayoutFromObserver);
    donePanelObserver.observe(doneSection);
    donePanelObserver.observe(taskScrollArea);
    donePanelObserver.observe(addTaskBar);
  }

  doneListWrapper.addEventListener('scroll', () => {
    scheduleDoneIncrementalLoad(doneListWrapper);
  }, { passive: true });

  taskScrollArea.addEventListener('scroll', () => {
    scheduleTaskIncrementalLoad(taskScrollArea);
    scheduleDoneIncrementalLoad(taskScrollArea);
  }, { passive: true });

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
    resetListIncrementalLoad();

    if (currentList === 'calendar') {
      document.getElementById('view-list').classList.remove('active');
      document.getElementById('view-calendar').classList.add('active');
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
    resetListIncrementalLoad();
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

  function createQuickAddTag(rawName) {
    const name = rawName.trim();
    if (!name) return { tag: '', message: '请输入标签名称' };

    const existing = data.tags.find(tag => tag === name);
    if (existing) {
      showToast('标签已存在，已直接选中');
      return { tag: existing, created: false };
    }

    data.tags.push(name);
    saveData();
    renderSidebar();
    showToast('标签创建成功');
    return { tag: name, created: true };
  }

  initQuickAddPopups({
    quickAddPreset,
    updateQuickAddIndicators,
    data,
    getTagDotStyle,
    getNextTagDotStyle,
    createTag: createQuickAddTag
  });

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
      runtimeIndex.add(todo);
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
      const todo = getTodoById(id);
      if (todo) {
        const itemEl = target.closest('.todo-item');
        setTodoDoneAnimated(todo, !todo.done, itemEl);
      }
    } else if (action === 'edit') {
      openDetail(id, target.closest('.todo-item'));
    } else if (action === 'star') {
      const todo = getTodoById(id);
      if (todo) {
        runtimeIndex.update(todo, { important: !todo.important }, { calendar: false });
        saveData();
        scheduleRender();
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
    resetDoneIncrementalLoad();
    doneToggle.classList.toggle('collapsed', doneCollapsed);
    const wrapper = document.getElementById('done-list-wrapper');
    if (doneCollapsed) {
      wrapper.classList.remove('expanding');
      wrapper.classList.add('collapsing');
      scheduleDonePanelLayoutSync();
      wrapper.addEventListener('animationend', () => {
        renderTodoList();
        wrapper.classList.remove('collapsing');
        scheduleDonePanelLayoutSync();
      }, { once: true });
    } else {
      renderTodoList();
      wrapper.classList.remove('collapsing');
      wrapper.classList.add('expanding');
      scheduleDonePanelLayoutSync();
      wrapper.addEventListener('animationend', () => {
        wrapper.classList.remove('expanding');
        scheduleDonePanelLayoutSync();
      }, { once: true });
    }
  });

  document.getElementById('btn-archive-done').addEventListener('click', (e) => {
    e.stopPropagation();
    const filtered = getFilteredTodos();
    const doneTodos = filtered.filter(t => t.done && !t.archived);
    if (doneTodos.length === 0) { showToast('没有可归档的任务'); return; }
    const now = new Date().toISOString();
    doneTodos.forEach(todo => runtimeIndex.update(todo, { archived: true, archivedAt: now }));
    saveData();
    scheduleRender();
    showToast(`已归档 ${doneTodos.length} 个任务`);
  });

  // Detail form
  detailForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('detail-id').value;
    const todo = getTodoById(id);
    if (!todo) return;

    const patch = {
      title: document.getElementById('detail-title').value.trim(),
      desc: document.getElementById('detail-desc').value.trim(),
      priority: document.getElementById('detail-priority').dataset.value || 'none',
      tag: document.getElementById('detail-tag').dataset.value.trim(),
      startTime: document.getElementById('detail-start').value || null,
      endTime: document.getElementById('detail-end').value || null,
      reminder: document.getElementById('detail-reminder').value || null,
      reminderRepeat: document.getElementById('detail-reminder-repeat').dataset.value || 'none',
      todo: document.getElementById('detail-todo').checked,
      important: document.getElementById('detail-important').checked
    };

    if (patch.tag && !data.tags.includes(patch.tag)) {
      data.tags.push(patch.tag);
    }

    runtimeIndex.update(todo, patch);
    saveData();
    closeDetail();
    scheduleRender();
  });

  document.getElementById('close-detail').addEventListener('click', closeDetail);
  document.getElementById('btn-delete-task').addEventListener('click', () => {
    deleteTodoById(document.getElementById('detail-id').value);
  });

  // Clear done
  document.getElementById('btn-clear-done').addEventListener('click', (e) => {
    e.stopPropagation();
    clearDoneTasks();
  });

  // Calendar nav
  document.querySelector('.calendar-mode-switch').addEventListener('click', (event) => {
    const button = event.target.closest('.calendar-mode-btn');
    if (!button || button.dataset.calendarMode === calendarMode) return;
    setCalendarMode(button.dataset.calendarMode);
    renderCalendar();
  });

  document.getElementById('toggle-calendar-chart').addEventListener('click', () => {
    setChartCollapsed(!chartCollapsed);
  });

  document.getElementById('prev-month').addEventListener('click', () => {
    if (calendarMode === 'month') {
      currentMonth.setMonth(currentMonth.getMonth() - 1);
    } else {
      currentMonth.setFullYear(currentMonth.getFullYear() - 1);
    }
    selectedDate = null;
    renderCalendar();
  });

  document.getElementById('next-month').addEventListener('click', () => {
    if (calendarMode === 'month') {
      currentMonth.setMonth(currentMonth.getMonth() + 1);
    } else {
      currentMonth.setFullYear(currentMonth.getFullYear() + 1);
    }
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
    const parsedDate = parseLocalDateInput(dateStr);
    if (!parsedDate) return;
    selectedDate = parsedDate;
    if (dayEl.classList.contains('year-day')) {
      currentMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    }
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
      const todo = getTodoById(id);
      if (!todo) return;
      const items = buildTodoContextMenu(todo, { data, getTagColor, updateTodo, openDetail, deleteTodoById, toggleDone });
      showContextMenu(e.clientX, e.clientY, items);
    } else if (tagItem) {
      const tag = tagItem.dataset.tag;
      const setCurrentTag = (t) => { currentTag = t; currentList = null; resetListIncrementalLoad(); };
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
        runtimeIndex.remove(id);
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
    runtimeIndex.update(todo, patchOrMutator);
    saveData();
    scheduleRender();
  }

  function deleteTagFromMenu(tag) {
    deleteTag(tag, () => {
      scheduleRender();
    });
  }

  function clearDoneTasks() {
    const doneTodos = getFilteredTodos().filter(t => t.done);
    if (doneTodos.length === 0) { showToast('没有已完成的任务'); return; }
    const doneIds = new Set(doneTodos.map(todo => todo.id));
    showConfirmDialog(`确定要清空 ${doneTodos.length} 个已完成任务？`, () => {
      runtimeIndex.replaceTodos(data.todos.filter(t => !doneIds.has(t.id)));
      saveData();
      scheduleRender();
    });
  }

  // --- Reminder System ---
  const reminders = initReminders({
    data,
    saveData,
    render: () => scheduleRender({ list: true, status: true, calendar: true }),
    showToast,
    isNeutralinoEnv,
    subscribeDataChanges
  });

  // --- Mini Mode ---
  const mini = initMiniMode({ data, saveData, render, showToast, isNeutralinoEnv, getTagDotStyle, getTagBadgeStyle, showContextMenu, closeWindow, reminders, appConfig, todoStore: runtimeIndex });
  /* 窗口仍是隐藏状态时预先设置 DWM 圆角（EnumWindows 可枚举隐藏窗口），
     避免进入迷你模式时先闪现直角外框再变圆角 */
  mini.applyRoundedCorners();
  document.addEventListener('todo-tools:restore-main-window', () => {
    if (mini.isMiniMode()) {
      mini.exitMiniMode();
    }
  });

  // --- Summary Panel ---
  initAiSummary({ data, saveData, showToast });

  // --- Settings Panel ---
  initSettings({
    data,
    saveData,
    showToast,
    render,
    testNotification: reminders.testNotification,
    getNotificationStatus: reminders.getNotificationStatus,
    onTagRenamed: (oldTag, newTag) => {
      if (currentTag === oldTag) currentTag = newTag;
    },
    onTagDeleted: (tag) => {
      if (currentTag === tag) {
        currentTag = null;
        currentList = 'all';
        resetListIncrementalLoad();
      }
    }
  });

  // Init render
  render();
}
