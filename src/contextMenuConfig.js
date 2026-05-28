import { toLocalDatetime } from './utils/date.js';

export function buildTodoContextMenu(todo, { data, saveData, render, openDetail, deleteTodoById }) {
  const items = [];
  if (todo.done) {
    items.push({ icon: '↩️', label: '取消完成', action: () => { todo.done = false; todo.doneAt = null; saveData(); render(); } });
    if (todo.archived) {
      items.push({ icon: '📤', label: '取消归档', action: () => { todo.archived = false; todo.archivedAt = null; saveData(); render(); } });
    } else {
      items.push({ icon: '🗃️', label: '归档', action: () => { todo.archived = true; todo.archivedAt = new Date().toISOString(); saveData(); render(); } });
    }
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
