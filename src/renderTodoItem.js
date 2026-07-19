import { formatDate } from './utils/date.js';
import { createIcon, setIcon } from './icons.js';

function setIconLabel(element, iconName, label) {
  const icon = createIcon(iconName);
  if (icon) element.appendChild(icon);
  if (label) element.appendChild(document.createTextNode(label));
}

export function createTodoItemEl(t, { getTagBadgeStyle, currentList }) {
  const item = document.createElement('div');
  item.className = 'todo-item' + (t.done ? ' done' : '') + (t.archived ? ' archived' : '');
  item.dataset.id = t.id;
  item.dataset.priority = t.priority || 'none';
  item.dataset.important = String(Boolean(t.important));

  const checkbox = document.createElement('div');
  checkbox.className = 'todo-checkbox' + (t.done ? ' checked' : '');
  checkbox.dataset.action = 'toggle';
  checkbox.dataset.id = t.id;
  checkbox.setAttribute('role', 'checkbox');
  checkbox.setAttribute('aria-checked', String(t.done));
  checkbox.setAttribute('aria-label', '标记完成');
  checkbox.tabIndex = 0;
  item.appendChild(checkbox);

  const body = document.createElement('div');
  body.className = 'todo-body';
  body.dataset.action = 'edit';
  body.dataset.id = t.id;

  const title = document.createElement('div');
  title.className = 'todo-title';
  title.textContent = t.title;
  body.appendChild(title);

  const badges = buildBadges(t, getTagBadgeStyle, currentList);
  if (badges) body.appendChild(badges);

  item.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'todo-actions';

  const starBtn = document.createElement('button');
  starBtn.dataset.action = 'star';
  starBtn.dataset.id = t.id;
  starBtn.title = '重要';
  starBtn.setAttribute('aria-label', t.important ? '取消重要' : '标记重要');
  setIcon(starBtn, t.important ? 'star-filled' : 'star');
  actions.appendChild(starBtn);

  const delBtn = document.createElement('button');
  delBtn.dataset.action = 'delete';
  delBtn.dataset.id = t.id;
  delBtn.title = '删除';
  delBtn.setAttribute('aria-label', '删除');
  setIcon(delBtn, 'x');
  actions.appendChild(delBtn);

  item.appendChild(actions);
  return item;
}

function buildBadges(t, getTagBadgeStyle, currentList) {
  const meta = document.createElement('div');
  meta.className = 'todo-meta';
  let count = 0;

  if (t.startTime || t.endTime) {
    if (t.endTime) {
      const badge = document.createElement('span');
      badge.className = 'badge badge-date';
      setIconLabel(badge, 'calendar', formatDate(t.endTime));
      meta.appendChild(badge);
      count++;
    }
    if (t.startTime && t.startTime !== t.endTime) {
      const badge = document.createElement('span');
      badge.className = 'badge badge-date badge-start';
      setIconLabel(badge, 'flag', formatDate(t.startTime));
      meta.appendChild(badge);
      count++;
    }
  }

  if (t.tag) {
    const badge = document.createElement('span');
    badge.className = 'badge badge-tag';
    const styleAttr = getTagBadgeStyle(t.tag);
    if (styleAttr) {
      const match = styleAttr.match(/style="([^"]*)"/);
      if (match) badge.setAttribute('style', match[1]);
    }
    badge.textContent = t.tag;
    meta.appendChild(badge);
    count++;
  }

  if (t.priority && t.priority !== 'none') {
    const badge = document.createElement('span');
    badge.className = `badge badge-priority-${t.priority}`;
    setIconLabel(badge, 'circle', { high: '高', medium: '中', low: '低' }[t.priority]);
    meta.appendChild(badge);
    count++;
  }

  if (t.todo && currentList !== 'todo') {
    const badge = document.createElement('span');
    badge.className = 'badge badge-todo';
    setIconLabel(badge, 'sun', 'TODO');
    meta.appendChild(badge);
    count++;
  }

  if (t.reminder && !t.done) {
    const badge = document.createElement('span');
    badge.className = 'badge badge-reminder';
    setIcon(badge, 'bell');
    badge.setAttribute('aria-label', '已设置提醒');
    meta.appendChild(badge);
    count++;
  }

  return count > 0 ? meta : null;
}
