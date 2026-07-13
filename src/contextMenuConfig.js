import { toLocalDatetime } from './utils/date.js';

export function buildTodoContextMenu(todo, { data, updateTodo, openDetail, deleteTodoById, toggleDone }) {
  const items = [];
  if (todo.done) {
    items.push({ icon: '↩️', label: '取消完成', action: () => toggleDone(todo, false) });
    if (todo.archived) {
      items.push({ icon: '📤', label: '取消归档', action: () => updateTodo(todo, { archived: false, archivedAt: null }) });
    } else {
      items.push({ icon: '🗄️', label: '归档', action: () => updateTodo(todo, { archived: true, archivedAt: new Date().toISOString() }) });
    }
  } else {
    items.push({ icon: '✓', label: '标记完成', action: () => toggleDone(todo, true) });
    items.push({ icon: todo.important ? '☆' : '⭐', label: todo.important ? '取消重要' : '标记重要', action: () => updateTodo(todo, { important: !todo.important }) });
    items.push({ icon: '☀️', label: todo.todo ? '从 TODO 移除' : '添加到 TODO', action: () => updateTodo(todo, { todo: !todo.todo }) });
    items.push({ separator: true });
    items.push({ icon: '🚩', label: '优先级', submenu: [
      { label: '🔴 高', action: () => updateTodo(todo, { priority: 'high' }) },
      { label: '🟡 中', action: () => updateTodo(todo, { priority: 'medium' }) },
      { label: '🔵 低', action: () => updateTodo(todo, { priority: 'low' }) },
      { label: '⚪ 无', action: () => updateTodo(todo, { priority: 'none' }) }
    ]});
    if (data.tags.length > 0) {
      items.push({ icon: '🏷️', label: '标签', submenu: data.tags.map(tag => ({
        label: (todo.tag === tag ? '✓ ' : '') + tag,
        action: () => updateTodo(todo, { tag: todo.tag === tag ? '' : tag })
      }))});
    }
    const reminderItems = [
      { label: '10 分钟后', action: () => updateTodo(todo, { reminder: toLocalDatetime(new Date(Date.now() + 10 * 60000)), reminderRepeat: 'none' }) },
      { label: '1 小时后', action: () => updateTodo(todo, { reminder: toLocalDatetime(new Date(Date.now() + 60 * 60000)), reminderRepeat: 'none' }) },
      { label: '明天 9:00', action: () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
        updateTodo(todo, { reminder: toLocalDatetime(d), reminderRepeat: 'none' });
      } },
      { label: '每天提醒', action: () => {
        const d = new Date();
        d.setHours(9, 0, 0, 0);
        if (d <= new Date()) d.setDate(d.getDate() + 1);
        updateTodo(todo, { reminder: toLocalDatetime(d), reminderRepeat: 'daily' });
      } }
    ];
    if (todo.reminder) {
      reminderItems.push({ label: '✕ 清除提醒', action: () => updateTodo(todo, { reminder: null, reminderRepeat: 'none' }) });
    }
    items.push({ icon: '⏰', label: '设置提醒', submenu: reminderItems });
    items.push({ separator: true });
    items.push({ icon: '✏️', label: '编辑详情', action: () => openDetail(todo.id) });
  }
  items.push({ separator: true });
  items.push({ icon: '🗑️', label: '删除', className: 'danger', action: () => deleteTodoById(todo.id) });
  return items;
}

export function buildTagContextMenu(tag, { setCurrentTag, render, deleteTagFromMenu }) {
  return [
    { icon: '📋', label: '查看该标签任务', action: () => { setCurrentTag(tag); render(); } },
    { separator: true },
    { icon: '🗑️', label: '删除标签', className: 'danger', action: () => deleteTagFromMenu(tag) }
  ];
}

export function buildNavContextMenu({ clearDoneTasks }) {
  return [
    { icon: '🗑️', label: '清空已完成', className: 'danger', action: () => clearDoneTasks() }
  ];
}

export function buildListAreaMenu({ clearDoneTasks }) {
  return [
    { icon: '➕', label: '新建任务', action: () => document.getElementById('quick-add').focus() },
    { separator: true },
    { icon: '🗑️', label: '清空已完成', className: 'danger', action: () => clearDoneTasks() }
  ];
}
