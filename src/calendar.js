import { isSameDay, formatMonthDay } from './utils/date.js';
import { iconSvg } from './icons.js';

/* 月视图日期索引：{ 'YYYY-MM-DD': [todo, ...] }
 * 一次构建后，月内所有格子的 getTodosForDate 查询为 O(1) */
export const MONTH_TODOS_PAGE_SIZE = 25;

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

function fmtYMD(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseValidDate(value) {
  if (value === null || typeof value === 'undefined' || value === '') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getTodoTaskDateRange(todo) {
  const start = parseValidDate(todo.startTime);
  const end = parseValidDate(todo.endTime);
  const doneAt = parseValidDate(todo.doneAt);
  const createdAt = parseValidDate(todo.createdAt);

  if (start && end) {
    return end >= start ? [startOfDay(start), startOfDay(end)] : null;
  }
  if (start) return [startOfDay(start), startOfDay(start)];
  if (end && createdAt) {
    return end >= createdAt ? [startOfDay(createdAt), startOfDay(end)] : null;
  }
  if (doneAt) return [startOfDay(doneAt), startOfDay(doneAt)];
  if (createdAt) return [startOfDay(createdAt), startOfDay(createdAt)];
  return null;
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

  for (const todo of data.todos || []) {
    const range = getTodoTaskDateRange(todo);
    if (!range) continue;
    let date = new Date(Math.max(range[0].getTime(), yearStart.getTime()));
    const rangeEnd = Math.min(range[1].getTime(), yearEnd.getTime() - 1);
    while (date.getTime() <= rangeEnd) {
      const key = fmtYMD(date);
      index.set(key, (index.get(key) || 0) + 1);
      date.setDate(date.getDate() + 1);
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
  /* 复用 buildMonthActivityIndex，避免同文件内 created/done 统计逻辑复制两份 */
  const activityIndex = buildMonthActivityIndex(year, month, data);

  const addToIndex = (date, todo) => {
    if (date.getTime() < monthStartTime || date.getTime() >= monthEndTime) return;
    const ds = fmtYMD(date);
    let arr = index.get(ds);
    if (!arr) { arr = []; index.set(ds, arr); }
    arr.push(todo);
  };

  for (const todo of data.todos || []) {
    const range = getTodoTaskDateRange(todo);
    if (!range) continue;
    let date = new Date(Math.max(range[0].getTime(), monthStartTime));
    const rangeEnd = Math.min(range[1].getTime(), monthEndTime - 1);
    while (date.getTime() <= rangeEnd) {
      addToIndex(date, todo);
      date.setDate(date.getDate() + 1);
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
    /* 任务量标识按数量分档：1 项短点、2-3 项中线、4 项以上长线，一眼分辨忙闲 */
    const countTier = todosOnDay.length <= 0 ? 0 : todosOnDay.length === 1 ? 1 : todosOnDay.length <= 3 ? 2 : 3;
    const taskMarker = countTier > 0
      ? `<span class="calendar-task-marker" data-count-tier="${countTier}" aria-hidden="true"></span>`
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
  /* 不用展开传参：大 Map 下 Math.max(...values) 有栈溢出/性能风险 */
  let maxCount = 0;
  for (const count of metricIndex.values()) {
    if (count > maxCount) maxCount = count;
  }
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

export function getTaskTodosForDate(date, data) {
  const targetTime = startOfDay(date).getTime();
  return (data.todos || []).filter(todo => {
    const range = getTodoTaskDateRange(todo);
    return range && range[0].getTime() <= targetTime && range[1].getTime() >= targetTime;
  });
}

export function getTodosForDate(date, data) {
  return getTaskTodosForDate(date, data);
}

export function getCompletedTodosForDate(date, data) {
  return (data.todos || []).filter(todo => {
    if (!todo.doneAt) return false;
    const doneAt = new Date(todo.doneAt);
    return Number.isFinite(doneAt.getTime()) && isSameDay(doneAt, date);
  });
}

/* 整月任务：复用与月历格子/任务量相同的覆盖规则去重聚合。
 * month/tasks 模式按任务覆盖范围与本月相交判定；completed 模式按 doneAt 落月判定。 */
export function getMonthTodos(year, month, data, mode = 'month') {
  const monthStart = new Date(year, month, 1).getTime();
  const monthEnd = new Date(year, month + 1, 1).getTime();
  const todos = data.todos || [];

  if (mode === 'completed') {
    return todos
      .filter(todo => {
        if (!todo.doneAt) return false;
        const time = new Date(todo.doneAt).getTime();
        return Number.isFinite(time) && time >= monthStart && time < monthEnd;
      })
      .sort((a, b) => new Date(a.doneAt).getTime() - new Date(b.doneAt).getTime());
  }

  return todos
    .map(todo => {
      const range = getTodoTaskDateRange(todo);
      if (!range) return null;
      if (range[1].getTime() < monthStart || range[0].getTime() >= monthEnd) return null;
      return { todo, overlapStart: Math.max(range[0].getTime(), monthStart) };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.overlapStart !== b.overlapStart) return a.overlapStart - b.overlapStart;
      return (a.todo.createdAt || 0) - (b.todo.createdAt || 0);
    })
    .map(entry => entry.todo);
}

/* 整月分组：按任务在本月内的最早覆盖日（完成模式按 doneAt 日）分组，
 * 切片分页时按可见项重建组头，避免切在组中间导致组头缺失。 */
export function groupMonthTodos(monthTodos, mode = 'month', anchorYear = null, anchorMonth = null) {
  const anchorStart = anchorYear !== null && anchorMonth !== null
    ? new Date(anchorYear, anchorMonth, 1).getTime()
    : null;
  const groups = [];
  const groupMap = new Map();
  for (const todo of monthTodos) {
    let key;
    if (mode === 'completed') {
      const doneAt = new Date(todo.doneAt);
      key = fmtYMD(doneAt);
    } else {
      const range = getTodoTaskDateRange(todo);
      /* 跨月任务按其落在本月内的最早一天分组，避免组头显示上月日期 */
      if (!range) {
        key = 'unknown';
      } else if (anchorStart !== null && range[0].getTime() < anchorStart) {
        key = fmtYMD(new Date(anchorStart));
      } else {
        key = fmtYMD(range[0]);
      }
    }
    let group = groupMap.get(key);
    if (!group) {
      const parts = key === 'unknown' ? null : key.split('-').map(Number);
      const date = parts ? new Date(parts[0], parts[1] - 1, parts[2]) : null;
      group = { key, date, todos: [] };
      groupMap.set(key, group);
      groups.push(group);
    }
    group.todos.push(todo);
  }
  return groups;
}

export function paginateList(list, visibleCount) {
  return (list || []).slice(0, Math.max(0, visibleCount));
}

function renderDetailSwitch(detailView) {
  const dayActive = detailView !== 'month';
  return `<div class="calendar-detail-switch" role="tablist" aria-label="日期详情范围">`
    + `<button type="button" role="tab" aria-selected="${dayActive}" class="calendar-detail-switch-btn${dayActive ? ' active' : ''}" data-detail-view="day" title="按天查看">${iconSvg('calendar', 'detail-switch-icon')}<span>按天</span></button>`
    + `<button type="button" role="tab" aria-selected="${!dayActive}" class="calendar-detail-switch-btn${!dayActive ? ' active' : ''}" data-detail-view="month" title="按月查看整月任务">${iconSvg('calendar-range', 'detail-switch-icon')}<span>按月</span></button>`
    + `</div>`;
}

function renderMonthGroupsInto(container, groups, renderTodoItem, mode = 'month') {
  const today = new Date();
  const showSpan = mode !== 'completed';
  groups.forEach(group => {
    const groupEl = document.createElement('div');
    groupEl.className = 'calendar-month-group';
    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'calendar-month-group-header';
    const doneInGroup = group.todos.filter(t => t.done).length;
    if (group.date) {
      const isToday = isSameDay(group.date, today);
      if (isToday) groupEl.classList.add('is-today');
      if (doneInGroup === group.todos.length && group.todos.length > 0) header.classList.add('is-complete');
      const dateLabel = `${group.date.getMonth() + 1}月${group.date.getDate()}日`;
      header.dataset.jumpDate = fmtYMD(group.date);
      header.title = `查看${dateLabel}事项`;
      header.setAttribute('aria-label', `查看${dateLabel}事项，共${group.todos.length}项，已完成${doneInGroup}项`);
      header.innerHTML = `<span class="month-group-date"><strong>${group.date.getDate()}日</strong>`
        + `<span>星期${WEEKDAY_NAMES[group.date.getDay()]}</span>`
        + (isToday ? '<span class="month-group-today">今天</span>' : '')
        + `</span><span class="month-group-count">${group.todos.length}项</span>`
        + iconSvg('chevron-right', 'month-group-jump-icon');
    } else {
      header.disabled = true;
      header.setAttribute('aria-label', `未知日期，共${group.todos.length}项`);
      header.innerHTML = `<span class="month-group-date"><strong>未知日期</strong></span>`
        + `<span class="month-group-count">${group.todos.length}项</span>`;
    }
    groupEl.appendChild(header);
    const listEl = document.createElement('div');
    listEl.className = 'todo-list calendar-todo-list';
    /* 跨天任务只出现在起始分组，加“持续至”徽章避免在后续日期中被遗漏 */
    const groupDay = group.date ? startOfDay(group.date).getTime() : null;
    group.todos.forEach(t => {
      let spanText = '';
      if (showSpan && groupDay !== null) {
        const range = getTodoTaskDateRange(t);
        if (range && range[1].getTime() > groupDay) {
          spanText = `持续至 ${formatMonthDay(range[1])}`;
        }
      }
      listEl.appendChild(renderTodoItem(t, { spanText }));
    });
    groupEl.appendChild(listEl);
    container.appendChild(groupEl);
  });
}

function renderMonthSentinel(total, rendered) {
  if (total <= 0) return '';
  const percent = Math.min(100, Math.round(rendered / total * 100));
  if (total <= rendered) {
    return `<div class="calendar-month-sentinel is-complete" role="status">${iconSvg('check', 'month-sentinel-icon')}<span>已显示全部 ${total} 项</span></div>`;
  }
  return `<div class="calendar-month-sentinel" role="status">`
    + `<div class="calendar-month-progress" aria-hidden="true"><i style="width:${percent}%"></i></div>`
    + `<span>已显示 ${rendered} 项，共 ${total} 项</span>`
    + `<button type="button" class="btn-glass calendar-month-more" data-action="load-more-month" aria-label="加载更多本月任务，已显示${rendered}项共${total}项">${iconSvg('chevron-down', 'month-more-icon')}<span>加载更多</span></button></div>`;
}

export function renderCalendarDetail({ selectedDate, data, renderTodoItem, mode = 'month', detailView = 'day', monthDate = null, visibleMonthCount = MONTH_TODOS_PAGE_SIZE }, monthIndex) {
  const calendarDetail = document.getElementById('calendar-detail');
  const previousSelection = calendarDetail.dataset.renderedSelection || '';
  const monthRef = monthDate || selectedDate || new Date();
  const viewYear = monthRef.getFullYear();
  const viewMonth = monthRef.getMonth();

  if (detailView === 'month') {
    const monthTodos = getMonthTodos(viewYear, viewMonth, data, mode);
    const total = monthTodos.length;
    const visible = paginateList(monthTodos, visibleMonthCount);
    /* 动画只跟随月份/模式变化，增量加载更多时不重播，避免整列表闪动 */
    const contentKey = `${mode}:month:${viewYear}-${viewMonth}`;
    const dateChanged = !previousSelection.startsWith(contentKey);
    calendarDetail.dataset.renderedSelection = `${contentKey}:${visible.length}`;
    calendarDetail.dataset.detailView = 'month';
    calendarDetail.dataset.monthTotal = String(total);
    calendarDetail.dataset.monthRendered = String(visible.length);
    const completedMode = mode === 'completed';
    const tasksMode = mode === 'tasks';
    const detailLabel = completedMode ? ' · 完成事项' : tasksMode ? ' · 任务事项' : '';
    const doneCount = completedMode ? total : monthTodos.filter(t => t.done).length;
    const doneSub = (!completedMode && doneCount > 0) ? ` <small class="calendar-detail-sub">已完成 ${doneCount}</small>` : '';
    const title = `${viewMonth + 1}月${detailLabel} (${total}项)${doneSub}`;
    calendarDetail.innerHTML = `<div class="calendar-detail-header"><h3>${title}</h3>${renderDetailSwitch('month')}</div>`
      + `<div class="calendar-detail-scroll"><div id="calendar-todo-list" class="calendar-month-list"></div>${renderMonthSentinel(total, visible.length)}</div>`;
    const monthList = calendarDetail.querySelector('#calendar-todo-list');
    if (total === 0) {
      const emptyText = completedMode ? '本月无完成事项' : tasksMode ? '本月无任务' : '本月无事项';
      monthList.innerHTML = `<div class="calendar-month-empty">${iconSvg('calendar', 'month-empty-icon')}<p class="empty-state-hint">${emptyText}</p></div>`;
    } else {
      renderMonthGroupsInto(monthList, groupMonthTodos(visible, mode, viewYear, viewMonth), renderTodoItem, mode);
    }
    if (dateChanged) {
      monthList.classList.add('date-entering');
      monthList.addEventListener('animationend', () => {
        monthList.classList.remove('date-entering');
      }, { once: true });
    }
    return;
  }

  calendarDetail.dataset.detailView = 'day';
  if (!selectedDate) {
    calendarDetail.dataset.renderedSelection = `${mode}:day:empty`;
    calendarDetail.dataset.monthTotal = '0';
    calendarDetail.dataset.monthRendered = '0';
    const monthTodos = getMonthTodos(viewYear, viewMonth, data, mode);
    calendarDetail.innerHTML = `<div class="calendar-detail-header"><h3>点击日期查看事项</h3>${renderDetailSwitch('day')}</div>`
      + `<div class="calendar-detail-scroll"><div class="calendar-detail-empty">${iconSvg('calendar-range', 'detail-empty-icon')}<p class="empty-state-hint">点击日期查看事项，或切换到按月查看本月 ${monthTodos.length} 项</p></div></div>`;
    return;
  }
  const dateKey = fmtYMD(selectedDate);
  const selectionKey = `${mode}:day:${dateKey}`;
  const dateChanged = previousSelection !== selectionKey;
  calendarDetail.dataset.renderedSelection = selectionKey;
  const completedMode = mode === 'completed';
  const tasksMode = mode === 'tasks';
  const dayTodos = completedMode
    ? getCompletedTodosForDate(selectedDate, data)
    : tasksMode
      ? getTaskTodosForDate(selectedDate, data)
      : monthIndex
        ? (monthIndex.get(dateKey) || [])
        : getTodosForDate(selectedDate, data);
  const dateStr = `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日 星期${WEEKDAY_NAMES[selectedDate.getDay()]}`;
  if (dayTodos.length === 0) {
    const emptyText = completedMode ? '当天无完成事项' : tasksMode ? '当天无任务' : '当天无事项';
    calendarDetail.innerHTML = `<div class="calendar-detail-header"><h3>${dateStr}</h3>${renderDetailSwitch('day')}</div><div class="calendar-detail-scroll"><div class="calendar-detail-empty">${iconSvg('calendar', 'detail-empty-icon')}<p class="empty-state-hint">${emptyText}</p></div></div>`;
    return;
  }
  const detailLabel = completedMode ? ' · 完成事项' : tasksMode ? ' · 任务事项' : '';
  calendarDetail.innerHTML = `<div class="calendar-detail-header"><h3>${dateStr}${detailLabel} (${dayTodos.length}项)</h3>${renderDetailSwitch('day')}</div><div class="calendar-detail-scroll"><div id="calendar-todo-list" class="todo-list calendar-todo-list"></div></div>`;
  const calendarTodoList = calendarDetail.querySelector('#calendar-todo-list');
  dayTodos.forEach(t => calendarTodoList.appendChild(renderTodoItem(t)));
  if (dateChanged) {
    calendarTodoList.classList.add('date-entering');
    calendarTodoList.addEventListener('animationend', () => {
      calendarTodoList.classList.remove('date-entering');
    }, { once: true });
  }
}
