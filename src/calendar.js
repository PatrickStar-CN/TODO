import { isSameDay } from './utils/date.js';

export function renderCalendar({ currentMonth, selectedDate, data, getTodosForDate, onDetailRender }) {
  const calendarTitle = document.getElementById('calendar-title');
  const calendarDays = document.getElementById('calendar-days');

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  calendarTitle.textContent = `${year}年${month + 1}月`;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();
  const todayDate = new Date();

  let html = '';

  for (let i = firstDay - 1; i >= 0; i--) {
    html += `<div class="calendar-day other-month">${daysInPrev - i}</div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const today = isSameDay(date, todayDate);
    const selected = selectedDate && isSameDay(date, selectedDate);
    const todosOnDay = getTodosForDate(date, data);
    const dots = todosOnDay.length > 0
      ? `<div class="dot-row">${todosOnDay.slice(0, 3).map(() => '<div class="dot"></div>').join('')}</div>`
      : '';

    html += `<div class="calendar-day${today ? ' today' : ''}${selected ? ' selected' : ''}" data-date="${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}">${d}${dots}</div>`;
  }

  const totalCells = firstDay + daysInMonth;
  const remaining = (7 - totalCells % 7) % 7;
  for (let i = 1; i <= remaining; i++) {
    html += `<div class="calendar-day other-month">${i}</div>`;
  }

  calendarDays.innerHTML = html;
  if (onDetailRender) onDetailRender();
}

export function getTodosForDate(date, data) {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  return data.todos.filter(t => {
    const start = t.startTime ? new Date(t.startTime) : null;
    const end = t.endTime ? new Date(t.endTime) : null;
    const doneAt = t.doneAt ? new Date(t.doneAt) : null;

    if (start && end) {
      return start < dayEnd && end >= dayStart;
    }
    if (start) return isSameDay(start, date);
    if (end) return isSameDay(end, date);
    if (doneAt) return isSameDay(doneAt, date);
    return isSameDay(new Date(t.createdAt), date);
  });
}

export function renderCalendarDetail({ selectedDate, data, renderTodoItem }) {
  const calendarDetail = document.getElementById('calendar-detail');
  if (!selectedDate) {
    calendarDetail.innerHTML = '<p class="empty-state-hint">点击日期查看事项</p>';
    return;
  }
  const dayTodos = getTodosForDate(selectedDate, data);
  const dateStr = `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日`;
  if (dayTodos.length === 0) {
    calendarDetail.innerHTML = `<h3>${dateStr}</h3><p class="empty-state-hint">当天无事项</p>`;
    return;
  }
  calendarDetail.innerHTML = `<h3>${dateStr} (${dayTodos.length}项)</h3>`;
  dayTodos.forEach(t => calendarDetail.appendChild(renderTodoItem(t)));
}
