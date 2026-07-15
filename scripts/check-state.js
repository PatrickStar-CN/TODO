import assert from 'node:assert/strict';
import { countByList, countTagUndone, getFilteredTodos, sortByPriority, splitPendingDone } from '../src/selectors.js';
import { DEFAULT_UI_STYLE, normalizeUiStyle } from '../src/uiPreferences.js';

const todos = [
  { id: '1', title: 'High todo', priority: 'high', tag: 'work', todo: true, important: true, done: false, archived: false, createdAt: 1 },
  { id: '2', title: 'Done todo', priority: 'low', tag: 'work', todo: true, important: false, done: true, archived: false, doneAt: '2026-01-02T00:00:00.000Z', createdAt: 2 },
  { id: '3', title: 'Archived', priority: 'medium', tag: 'home', todo: false, important: true, done: true, archived: true, doneAt: '2026-01-01T00:00:00.000Z', createdAt: 3 },
  { id: '4', title: 'Low all', priority: 'low', tag: 'home', todo: false, important: false, done: false, archived: false, createdAt: 4 }
];

const data = { todos };

assert.deepEqual(countByList(data), { todo: 1, important: 1, all: 2, archived: 1 });
assert.equal(countTagUndone(data, 'work'), 1);
assert.equal(countTagUndone(data, 'home'), 1);

data._index = {
  counts: { todo: 9, important: 8, all: 7, archived: 6 },
  tagUndone: { work: 5 },
  tagTotal: { work: 2 }
};
assert.deepEqual(countByList(data), { todo: 9, important: 8, all: 7, archived: 6 });
assert.equal(countTagUndone(data, 'work'), 5);

delete data._index;
assert.deepEqual(getFilteredTodos(data, 'todo', null).map(t => t.id), ['1', '2']);
assert.deepEqual(getFilteredTodos(data, 'archived', null).map(t => t.id), ['3']);
assert.deepEqual(getFilteredTodos(data, null, 'home').map(t => t.id), ['4']);
assert.deepEqual(sortByPriority(todos.filter(t => !t.archived)).map(t => t.id), ['1', '4', '2']);

const split = splitPendingDone(todos.filter(t => !t.archived));
assert.deepEqual(split.pending.map(t => t.id), ['1', '4']);
assert.deepEqual(split.done.map(t => t.id), ['2']);

assert.deepEqual(normalizeUiStyle(), DEFAULT_UI_STYLE);
assert.deepEqual(normalizeUiStyle({ radius: 99, glassOpacity: 10, borderStrength: '60', fontScale: 104.6, blur: 'bad' }), {
  radius: 20,
  glassOpacity: 35,
  borderStrength: 60,
  fontScale: 105,
  blur: 18
});

console.log('State checks passed');
