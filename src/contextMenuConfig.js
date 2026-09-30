import { toLocalDatetime } from './utils/date.js';
import { getTagColor } from './shared.js';
import { t, getPriorityLabel } from './i18n/index.js';

export function buildTodoContextMenu(todo, { data, updateTodo, openDetail, deleteTodoById, toggleDone }) {
  const items = [];
  if (todo.done) {
    items.push({ icon: 'undo', label: t('menu.unDone'), action: () => toggleDone(todo, false) });
    if (todo.archived) {
      items.push({ icon: 'upload', label: t('menu.unArchive'), action: () => updateTodo(todo, { archived: false, archivedAt: null }) });
    } else {
      items.push({ icon: 'archive', label: t('menu.archive'), action: () => updateTodo(todo, { archived: true, archivedAt: new Date().toISOString() }) });
    }
  } else {
    items.push({ icon: 'check', label: t('menu.markDone'), action: () => toggleDone(todo, true) });
    items.push({ icon: todo.important ? 'star' : 'star-filled', label: todo.important ? t('menu.unImportant') : t('menu.markImportant'), action: () => updateTodo(todo, { important: !todo.important }) });
    items.push({ icon: 'sun', label: todo.todo ? t('menu.removeFromTodo') : t('menu.addToTodo'), action: () => updateTodo(todo, { todo: !todo.todo }) });
    items.push({ separator: true });
    items.push({ icon: 'flag', label: t('menu.priority'), submenu: [
      { icon: 'circle', iconClass: 'icon-priority-high', label: getPriorityLabel('high'), action: () => updateTodo(todo, { priority: 'high' }) },
      { icon: 'circle', iconClass: 'icon-priority-medium', label: getPriorityLabel('medium'), action: () => updateTodo(todo, { priority: 'medium' }) },
      { icon: 'circle', iconClass: 'icon-priority-low', label: getPriorityLabel('low'), action: () => updateTodo(todo, { priority: 'low' }) },
      { icon: 'circle', iconClass: 'icon-priority-none', label: getPriorityLabel('none'), action: () => updateTodo(todo, { priority: 'none' }) }
    ]});
    if (data.tags.length > 0) {
      items.push({ icon: 'tag', label: t('menu.tag'), submenu: data.tags.map(tag => ({
        color: getTagColor(tag, data.tags) || '#6366f1',
        label: tag,
        selected: todo.tag === tag,
        action: () => updateTodo(todo, { tag: todo.tag === tag ? '' : tag })
      }))});
    }
    const reminderItems = [
      { label: t('menu.in10min'), action: () => updateTodo(todo, { reminder: toLocalDatetime(new Date(Date.now() + 10 * 60000)), reminderRepeat: 'none' }) },
      { label: t('menu.in1hour'), action: () => updateTodo(todo, { reminder: toLocalDatetime(new Date(Date.now() + 60 * 60000)), reminderRepeat: 'none' }) },
      { label: t('menu.tomorrow9'), action: () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
        updateTodo(todo, { reminder: toLocalDatetime(d), reminderRepeat: 'none' });
      } },
      { label: t('menu.dailyRemind'), action: () => {
        const d = new Date();
        d.setHours(9, 0, 0, 0);
        if (d <= new Date()) d.setDate(d.getDate() + 1);
        updateTodo(todo, { reminder: toLocalDatetime(d), reminderRepeat: 'daily' });
      } }
    ];
    if (todo.reminder) {
      reminderItems.push({ icon: 'x', label: t('menu.clearReminder'), action: () => updateTodo(todo, { reminder: null, reminderRepeat: 'none' }) });
    }
    items.push({ icon: 'alarm', label: t('menu.setReminder'), submenu: reminderItems });
    items.push({ separator: true });
    items.push({ icon: 'edit', label: t('menu.editDetail'), action: () => openDetail(todo.id) });
  }
  items.push({ separator: true });
  items.push({ icon: 'trash', label: t('menu.delete'), className: 'danger', action: () => deleteTodoById(todo.id) });
  return items;
}

export function buildTagContextMenu(tag, { setCurrentTag, render, deleteTagFromMenu }) {
  return [
    { icon: 'clipboard', label: t('menu.viewTagTasks'), action: () => { setCurrentTag(tag); render(); } },
    { separator: true },
    { icon: 'trash', label: t('menu.deleteTag'), className: 'danger', action: () => deleteTagFromMenu(tag) }
  ];
}

export function buildNavContextMenu({ clearDoneTasks }) {
  return [
    { icon: 'trash', label: t('menu.clearDone'), className: 'danger', action: () => clearDoneTasks() }
  ];
}

export function buildListAreaMenu({ clearDoneTasks }) {
  return [
    { icon: 'plus', label: t('menu.newTask'), action: () => document.getElementById('quick-add').focus() },
    { separator: true },
    { icon: 'trash', label: t('menu.clearDone'), className: 'danger', action: () => clearDoneTasks() }
  ];
}
