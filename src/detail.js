import { formatDateTime } from './utils/date.js';

export function openDetail(todo) {
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

export function closeDetail() {
  const panel = document.getElementById('detail-panel');
  if (panel.classList.contains('hidden')) return;
  panel.classList.add('hiding');
  panel.addEventListener('animationend', () => {
    panel.classList.add('hidden');
    panel.classList.remove('hiding');
  }, { once: true });
}
