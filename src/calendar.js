import { isSameDay } from './utils/date.js';

/* 月视图日期索引：{ 'YYYY-MM-DD': [todo, ...] }
 * 一次构建后，月内所有格子的 getTodosForDate 查询为 O(1) */
function fmtYMD(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function buildMonthActivityIndex(year, month, data) {
  const index = new Map();
  const monthStart = new Date(year, month, 1).getTime();
  const monthEnd = new Date(year, month + 1, 1).getTime();

  const addActivity = (value, field) => {
    if (value === null || typeof value === 'undefined' || value === '') return;
    const date = new Date(value);
    const time = date.getTime();
    if (!Number.isFinite(time) || time < monthStart || time >= monthEnd) return;
    const key = fmtYMD(date);
    const activity = index.get(key) || { created: 0, done: 0 };
    activity[field] += 1;
    index.set(key, activity);
  };

  for (const todo of data.todos || []) {
    addActivity(todo.createdAt, 'created');
    addActivity(todo.doneAt, 'done');
  }

  return index;
}

export function buildYearTaskIndex(year, data) {
  const index = new Map();
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);
  const yearStartTime = yearStart.getTime();
  const yearEndTime = yearEnd.getTime();

  const addDate = (date) => {
    const time = date.getTime();
    if (!Number.isFinite(time) || time < yearStartTime || time >= yearEndTime) return;
    const key = fmtYMD(date);
    index.set(key, (index.get(key) || 0) + 1);
  };

  for (const todo of data.todos || []) {
    const start = todo.startTime ? new Date(todo.startTime) : null;
    const end = todo.endTime ? new Date(todo.endTime) : null;
    const doneAt = todo.doneAt ? new Date(todo.doneAt) : null;
    const createdAt = new Date(todo.createdAt);

    if (start && Number.isFinite(start.getTime()) && end && Number.isFinite(end.getTime())) {
      let date = new Date(Math.max(start.getTime(), yearStartTime));
      const rangeEnd = Math.min(end.getTime(), yearEndTime - 1);
      while (date.getTime() <= rangeEnd) {
        addDate(date);
        date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
      }
    } else if (start && Number.isFinite(start.getTime())) {
      addDate(start);
    } else if (end && Number.isFinite(end.getTime()) && Number.isFinite(createdAt.getTime())) {
      let date = new Date(Math.max(createdAt.getTime(), yearStartTime));
      const rangeEnd = Math.min(end.getTime(), yearEndTime - 1);
      while (date.getTime() <= rangeEnd) {
        addDate(date);
        date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
      }
    } else if (doneAt && Number.isFinite(doneAt.getTime())) {
      addDate(doneAt);
    } else if (Number.isFinite(createdAt.getTime())) {
      addDate(createdAt);
    }
  }

  return index;
}

export function buildYearCompletionIndex(year, data) {
  const index = new Map();
  const yearStart = new Date(year, 0, 1).getTime();
  const yearEnd = new Date(year + 1, 0, 1).getTime();

  for (const todo of data.todos || []) {
    if (!todo.doneAt) continue;
    const date = new Date(todo.doneAt);
    const time = date.getTime();
    if (!Number.isFinite(time) || time < yearStart || time >= yearEnd) continue;
    const key = fmtYMD(date);
    index.set(key, (index.get(key) || 0) + 1);
  }

  return index;
}

function getHeatAlpha(count, max) {
  if (!count || !max) return 0;
  return Number((0.12 + Math.sqrt(count / max) * 0.44).toFixed(3));
}

export function buildMonthIndex(year, month, data) {
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 1);
  const monthStartTime = monthStart.getTime();
  const monthEndTime = monthEnd.getTime();
  const index = new Map();
  const activityIndex = new Map();

  const addActivity = (value, field) => {
    if (value === null || typeof value === 'undefined' || value === '') return;
    const date = new Date(value);
    const time = date.getTime();
    if (!Number.isFinite(time) || time < monthStartTime || time >= monthEndTime) return;
    const key = fmtYMD(date);
    const activity = activityIndex.get(key) || { created: 0, done: 0 };
    activity[field] += 1;
    activityIndex.set(key, activity);
  };

  const addToIndex = (date, todo) => {
    if (date.getTime() < monthStartTime || date.getTime() >= monthEndTime) return;
    const ds = fmtYMD(date);
    let arr = index.get(ds);
    if (!arr) { arr = []; index.set(ds, arr); }
    arr.push(todo);
  };

  for (const todo of data.todos) {
    addActivity(todo.createdAt, 'created');
    addActivity(todo.doneAt, 'done');
    const start = todo.startTime ? new Date(todo.startTime) : null;
    const end = todo.endTime ? new Date(todo.endTime) : null;
    const doneAt = todo.doneAt ? new Date(todo.doneAt) : null;
    const createdAt = new Date(todo.createdAt);

    if (start && end) {
      let d = new Date(Math.max(start.getTime(), monthStartTime));
      const eTime = Math.min(end.getTime(), monthEndTime - 1);
      while (d.getTime() <= eTime) {
        addToIndex(d, todo);
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      }
    } else if (start) {
      addToIndex(start, todo);
    } else if (end) {
      let d = new Date(Math.max(createdAt.getTime(), monthStartTime));
      const eTime = Math.min(end.getTime(), monthEndTime - 1);
      while (d.getTime() <= eTime) {
        addToIndex(d, todo);
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      }
    } else if (doneAt) {
      addToIndex(doneAt, todo);
    } else {
      addToIndex(createdAt, todo);
    }
  }

  index.activityIndex = activityIndex;
  return index;
}

export function renderCalendar({ currentMonth, selectedDate, data, getTodosForDate, onDetailRender, mode = 'month' }, monthIndex) {
  const calendarTitle = document.getElementById('calendar-title');
  const calendarDays = document.getElementById('calendar-days');
  const calendarGrid = document.querySelector('.calendar-grid');
  const monthLabels = document.getElementById('calendar-month-labels');

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const idx = monthIndex || null;
  const todayDate = new Date();
  const monthMode = mode === 'month';

  calendarGrid?.classList.toggle('year-mode', !monthMode);
  calendarGrid?.classList.toggle('month-mode', monthMode);

  if (!monthMode) {
    calendarTitle.textContent = `${year}年`;
    renderYearHeatmap({ year, selectedDate, data, calendarDays, monthLabels, todayDate, metric: mode });
    if (onDetailRender) onDetailRender(idx);
    return;
  }

  calendarTitle.textContent = `${year}年${month + 1}月`;
  if (monthLabels) monthLabels.innerHTML = '';

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();

  /* 优先使用预构建的月索引；缺失时回退到原全量扫描（向后兼容） */
  const lookup = (date) => idx ? (idx.get(fmtYMD(date)) || []) : getTodosForDate(date, data);
  const activityIndex = idx?.activityIndex || buildMonthActivityIndex(year, month, data);

  let html = '';

  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrev - i;
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    html += `<div class="calendar-day other-month" data-date="${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}"><span class="calendar-day-number">${d}</span></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const today = isSameDay(date, todayDate);
    const selected = selectedDate && isSameDay(date, selectedDate);
    const todosOnDay = lookup(date);
    const activity = activityIndex.get(fmtYMD(date)) || { created: 0, done: 0 };
    const heatStyle = '--heat-alpha:0';
    const activityLabel = `${month + 1}月${d}日，${todosOnDay.length} 项任务`;
    const taskMarker = todosOnDay.length > 0
      ? '<span class="calendar-task-marker" aria-hidden="true"></span>'
      : '';

    html += `<div class="calendar-day${today ? ' today' : ''}${selected ? ' selected' : ''}${todosOnDay.length ? ' has-todos' : ''}" data-date="${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}" data-created="${activity.created}" data-done="${activity.done}" style="${heatStyle}" role="button" tabindex="0" aria-label="${activityLabel}" title="${activityLabel}"><span class="calendar-day-number">${d}</span>${taskMarker}</div>`;
  }

  const totalCells = firstDay + daysInMonth;
  const remaining = (7 - totalCells % 7) % 7;
  for (let i = 1; i <= remaining; i++) {
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    html += `<div class="calendar-day other-month" data-date="${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}"><span class="calendar-day-number">${i}</span></div>`;
  }

  calendarDays.innerHTML = html;
  if (onDetailRender) onDetailRender(idx);
}

function renderYearHeatmap({ year, selectedDate, data, calendarDays, monthLabels, todayDate, metric }) {
  const metricIndex = metric === 'completed'
    ? buildYearCompletionIndex(year, data)
    : buildYearTaskIndex(year, data);
  const maxCount = Math.max(0, ...metricIndex.values());
  const gridStart = new Date(year, 0, 1);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const gridEnd = new Date(year, 11, 31);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));
  const totalDays = Math.round(
    (Date.UTC(gridEnd.getFullYear(), gridEnd.getMonth(), gridEnd.getDate())
      - Date.UTC(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate())) / 86400000
  ) + 1;
  const weekCount = Math.ceil(totalDays / 7);

  if (monthLabels) {
    monthLabels.style.setProperty('--calendar-weeks', weekCount);
    monthLabels.innerHTML = Array.from({ length: 12 }, (_, month) => {
      const dayOffset = Math.round(
        (Date.UTC(year, month, 1)
          - Date.UTC(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate())) / 86400000
      );
      const week = Math.floor(dayOffset / 7) + 1;
      return `<span style="grid-column:${week}">${month + 1}月</span>`;
    }).join('');
  }

  let html = '';
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    if (cursor.getFullYear() !== year) {
      html += '<div class="calendar-day year-placeholder" aria-hidden="true"></div>';
    } else {
      const key = fmtYMD(cursor);
      const count = metricIndex.get(key) || 0;
      const heatAlpha = getHeatAlpha(count, maxCount);
      const today = isSameDay(cursor, todayDate);
      const selected = selectedDate && isSameDay(cursor, selectedDate);
      const metricLabel = metric === 'completed' ? '完成' : '任务';
      const label = `${cursor.getMonth() + 1}月${cursor.getDate()}日，${metricLabel} ${count} 项`;
      html += `<div class="calendar-day year-day${today ? ' today' : ''}${selected ? ' selected' : ''}${count ? ' has-activity' : ''}" data-date="${key}" data-count="${count}" style="--heat-alpha:${heatAlpha}" role="button" tabindex="0" aria-label="${label}" title="${label}"><span class="calendar-day-number">${cursor.getDate()}</span></div>`;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  calendarDays.style.setProperty('--calendar-weeks', weekCount);
  calendarDays.innerHTML = html;
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
    if (end) {
      const created = new Date(t.createdAt);
      return created <= dayEnd && end >= dayStart;
    }
    if (doneAt) return isSameDay(doneAt, date);
    return isSameDay(new Date(t.createdAt), date);
  });
}

export function renderCalendarDetail({ selectedDate, data, renderTodoItem }, monthIndex) {
  const calendarDetail = document.getElementById('calendar-detail');
  const previousDate = calendarDetail.dataset.renderedDate || '';
  if (!selectedDate) {
    calendarDetail.dataset.renderedDate = '';
    calendarDetail.innerHTML = '<div class="calendar-detail-scroll"><p class="empty-state-hint">点击日期查看事项</p></div>';
    return;
  }
  const dateKey = fmtYMD(selectedDate);
  const dateChanged = previousDate !== dateKey;
  calendarDetail.dataset.renderedDate = dateKey;
  const dayTodos = monthIndex
    ? (monthIndex.get(dateKey) || [])
    : getTodosForDate(selectedDate, data);
  const dateStr = `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日`;
  if (dayTodos.length === 0) {
    calendarDetail.innerHTML = `<h3>${dateStr}</h3><div class="calendar-detail-scroll"><p class="empty-state-hint">当天无事项</p></div>`;
    return;
  }
  calendarDetail.innerHTML = `<h3>${dateStr} (${dayTodos.length}项)</h3><div class="calendar-detail-scroll"><div id="calendar-todo-list" class="todo-list calendar-todo-list"></div></div>`;
  const calendarTodoList = calendarDetail.querySelector('#calendar-todo-list');
  dayTodos.forEach(t => calendarTodoList.appendChild(renderTodoItem(t)));
  if (dateChanged) {
    calendarTodoList.classList.add('date-entering');
    calendarTodoList.addEventListener('animationend', () => {
      calendarTodoList.classList.remove('date-entering');
    }, { once: true });
  }
}
