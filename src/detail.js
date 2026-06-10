import { formatDateTime, toLocalDatetime } from './utils/date.js';

let onDoneTimeChange = null;

export function initDetailEditor(callbacks) {
  onDoneTimeChange = callbacks.onDoneTimeChange || null;
}

export function openDetail(todo) {
  if (!todo) return;

  const summaryPanel = document.getElementById('summary-panel');
  if (summaryPanel && !summaryPanel.classList.contains('hidden')) {
    summaryPanel.classList.add('hiding');
    summaryPanel.addEventListener('animationend', () => {
      summaryPanel.classList.add('hidden');
      summaryPanel.classList.remove('hiding');
    }, { once: true });
    setTimeout(() => {
      if (summaryPanel.classList.contains('hiding')) {
        summaryPanel.classList.add('hidden');
        summaryPanel.classList.remove('hiding');
      }
    }, 300);
  }

  const detailPanel = document.getElementById('detail-panel');

  let overlay = document.querySelector('.detail-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'detail-overlay';
    overlay.addEventListener('click', () => closeDetail());
    document.body.appendChild(overlay);
  } else {
    overlay.classList.remove('hiding');
  }

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
    doneTimeEl.style.cursor = 'pointer';
    doneTimeEl.title = '点击修改完成时间';
    doneTimeEl.onclick = () => enterDoneTimeEdit(todo);
  } else {
    doneRow.classList.add('hidden');
    doneTimeEl.textContent = '';
    doneTimeEl.style.cursor = '';
    doneTimeEl.title = '';
    doneTimeEl.onclick = null;
  }
  document.getElementById('detail-created-time').textContent = formatDateTime(new Date(todo.createdAt).toISOString());
}

export function closeDetail() {
  const panel = document.getElementById('detail-panel');
  if (panel.classList.contains('hidden')) return;

  const overlay = document.querySelector('.detail-overlay');
  if (overlay) {
    overlay.classList.add('hiding');
    overlay.addEventListener('animationend', () => {
      overlay.remove();
    }, { once: true });
    setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 300);
  }

  panel.classList.add('hiding');
  panel.addEventListener('animationend', () => {
    panel.classList.add('hidden');
    panel.classList.remove('hiding');
  }, { once: true });
  setTimeout(() => {
    if (panel.classList.contains('hiding')) {
      panel.classList.add('hidden');
      panel.classList.remove('hiding');
    }
  }, 300);
}

function enterDoneTimeEdit(todo) {
  const doneTimeEl = document.getElementById('detail-done-time');
  if (!doneTimeEl || doneTimeEl.tagName === 'INPUT') return;
  if (!todo.done) return;

  const input = document.createElement('input');
  input.type = 'datetime-local';
  input.className = 'detail-done-input';
  input.value = todo.doneAt ? toLocalDatetime(new Date(todo.doneAt)) : '';

  doneTimeEl.replaceWith(input);
  input.focus();

  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;

    const span = document.createElement('span');
    span.id = 'detail-done-time';
    span.className = 'detail-done-value';
    const displayValue = save ? (input.value ? new Date(input.value).toISOString() : null) : todo.doneAt;
    span.textContent = displayValue ? formatDateTime(displayValue) : '';
    span.style.cursor = 'pointer';
    span.title = '点击修改完成时间';
    span.onclick = () => enterDoneTimeEdit(todo);
    input.replaceWith(span);

    if (save && onDoneTimeChange) {
      onDoneTimeChange(todo.id, input.value ? new Date(input.value).toISOString() : null);
    }
  };

  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
}
