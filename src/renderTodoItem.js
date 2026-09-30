import { formatDate } from './utils/date.js';
import { createIcon, setIcon } from './icons.js';
import { getTagBadgeStyle } from './shared.js';
import { t, getPriorityLabel } from './i18n/index.js';

function setIconLabel(element, iconName, label) {
  const icon = createIcon(iconName);
  if (icon) element.appendChild(icon);
  if (label) element.appendChild(document.createTextNode(label));
}

/* 参数名不能用 t：会遮蔽 i18n 的 t() 翻译函数，导致任务项渲染抛错 */
export function createTodoItemEl(todo, { currentList, tags, spanText = '' }) {
  const item = document.createElement('div');
  item.className = 'todo-item' + (todo.done ? ' done' : '') + (todo.archived ? ' archived' : '');
  item.dataset.id = todo.id;
  item.dataset.priority = todo.priority || 'none';
  item.dataset.important = String(Boolean(todo.important));

  const checkbox = document.createElement('div');
  checkbox.className = 'todo-checkbox' + (todo.done ? ' checked' : '');
  checkbox.dataset.action = 'toggle';
  checkbox.dataset.id = todo.id;
  checkbox.setAttribute('role', 'checkbox');
  checkbox.setAttribute('aria-checked', String(todo.done));
  checkbox.setAttribute('aria-label', t('todo.markDone'));
  checkbox.tabIndex = 0;
  item.appendChild(checkbox);

  const body = document.createElement('div');
  body.className = 'todo-body';
  body.dataset.action = 'edit';
  body.dataset.id = todo.id;
  body.setAttribute('role', 'button');
  body.tabIndex = 0;
  body.setAttribute('aria-label', t('todo.editTask', { title: todo.title }));

  const title = document.createElement('div');
  title.className = 'todo-title';
  title.textContent = todo.title;
  body.appendChild(title);

  const badges = buildBadges(todo, tags, currentList, spanText);
  if (badges) body.appendChild(badges);

  item.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'todo-actions';

  const starBtn = document.createElement('button');
  starBtn.dataset.action = 'star';
  starBtn.dataset.id = todo.id;
  starBtn.title = t('todo.important');
  starBtn.setAttribute('aria-label', todo.important ? t('todo.unImportant') : t('todo.markImportant'));
  setIcon(starBtn, todo.important ? 'star-filled' : 'star');
  actions.appendChild(starBtn);

  const delBtn = document.createElement('button');
  delBtn.dataset.action = 'delete';
  delBtn.dataset.id = todo.id;
  delBtn.title = t('todo.delete');
  delBtn.setAttribute('aria-label', t('todo.delete'));
  setIcon(delBtn, 'x');
  actions.appendChild(delBtn);

  item.appendChild(actions);
  return item;
}

function buildBadges(todo, tags, currentList, spanText = '') {
  const meta = document.createElement('div');
  meta.className = 'todo-meta';
  let count = 0;

  if (todo.startTime || todo.endTime) {
    if (todo.endTime) {
      const badge = document.createElement('span');
      badge.className = 'badge badge-date';
      setIconLabel(badge, 'calendar', formatDate(todo.endTime));
      meta.appendChild(badge);
      count++;
    }
    if (todo.startTime && todo.startTime !== todo.endTime) {
      const badge = document.createElement('span');
      badge.className = 'badge badge-date badge-start';
      setIconLabel(badge, 'flag', formatDate(todo.startTime));
      meta.appendChild(badge);
      count++;
    }
  }

  /* 跨天任务在整月分组中的“持续至”提示，由调用方按分组日期计算传入 */
  if (spanText) {
    const badge = document.createElement('span');
    badge.className = 'badge badge-span';
    setIconLabel(badge, 'calendar-range', spanText);
    meta.appendChild(badge);
    count++;
  }

  if (todo.tag) {
    const badge = document.createElement('span');
    badge.className = 'badge badge-tag';
    const styleAttr = getTagBadgeStyle(todo.tag, tags);
    if (styleAttr) {
      const match = styleAttr.match(/style="([^"]*)"/);
      if (match) badge.setAttribute('style', match[1]);
    }
    badge.textContent = todo.tag;
    meta.appendChild(badge);
    count++;
  }

  if (todo.priority && todo.priority !== 'none') {
    const badge = document.createElement('span');
    badge.className = `badge badge-priority-${todo.priority}`;
    setIconLabel(badge, 'circle', getPriorityLabel(todo.priority));
    meta.appendChild(badge);
    count++;
  }

  if (todo.todo && currentList !== 'todo') {
    const badge = document.createElement('span');
    badge.className = 'badge badge-todo';
    setIconLabel(badge, 'sun', 'TODO');
    meta.appendChild(badge);
    count++;
  }

  if (todo.reminder && !todo.done) {
    const badge = document.createElement('span');
    badge.className = 'badge badge-reminder';
    setIcon(badge, 'bell');
    badge.setAttribute('aria-label', t('todo.reminderSet'));
    meta.appendChild(badge);
    count++;
  }

  return count > 0 ? meta : null;
}
