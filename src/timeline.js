export const DEFAULT_TIMELINE_SETTINGS = Object.freeze({
  enabled: false,
  sortBy: 'created',
});

export function normalizeTimelineSettings(settings = {}) {
  return {
    enabled: settings?.enabled === true,
    sortBy: settings?.sortBy === 'completed' ? 'completed' : 'created',
  };
}

function toTimestamp(value) {
  if (value == null || value === '') return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function sortTimelineTodos(todos, sortBy = 'created') {
  const mode = sortBy === 'completed' ? 'completed' : 'created';
  return todos
    .filter(todo => mode !== 'completed' || toTimestamp(todo.doneAt) != null)
    .slice()
    .sort((a, b) => {
      const aTime = toTimestamp(mode === 'completed' ? a.doneAt : a.createdAt) ?? 0;
      const bTime = toTimestamp(mode === 'completed' ? b.doneAt : b.createdAt) ?? 0;
      return bTime - aTime;
    });
}

export function getTimelineDateParts(todo, sortBy = 'created') {
  const mode = sortBy === 'completed' ? 'completed' : 'created';
  const value = mode === 'completed' ? todo?.doneAt : todo?.createdAt;
  const timestamp = toTimestamp(value);
  if (timestamp == null) return null;
  const date = new Date(timestamp);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    time: formatTimelineTime(value),
  };
}

export function formatTimelineTime(value) {
  const timestamp = toTimestamp(value);
  if (timestamp == null) return '';
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
