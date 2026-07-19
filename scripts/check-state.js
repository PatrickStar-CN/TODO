import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { countByList, countTagUndone, getFilteredTodos, sortByPriority, splitPendingDone } from '../src/selectors.js';
import { DEFAULT_UI_STYLE, normalizeUiStyle } from '../src/uiPreferences.js';
import { buildMonthActivityIndex, buildYearCompletionIndex, buildYearTaskIndex } from '../src/calendar.js';
import { initReminders } from '../src/reminder.js';
import { createRuntimeIndex } from '../src/runtimeIndex.js';
import { encrypt, initCrypto, tryDecrypt } from '../src/utils/crypto.js';
import { resolveAiApiUrl } from '../src/utils/aiApi.js';

assert.equal(resolveAiApiUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1/chat/completions');
assert.equal(resolveAiApiUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1/chat/completions');
assert.equal(resolveAiApiUrl('https://api.openai.com/v1/chat/completions'), 'https://api.openai.com/v1/chat/completions');
assert.equal(resolveAiApiUrl('https://example.com/v1/chat/completions?key=test'), 'https://example.com/v1/chat/completions?key=test');
assert.equal(resolveAiApiUrl('https://example.com/custom-endpoint'), 'https://example.com/custom-endpoint');
assert.equal(resolveAiApiUrl(''), '');

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
  borderStrength: 0,
  fontScale: 105,
  blur: 18,
  motionSpeed: 100
});

const activity = buildMonthActivityIndex(2026, 0, {
  todos: [
    { createdAt: '2026-01-02T08:00:00', doneAt: '2026-01-03T10:00:00' },
    { createdAt: '2026-01-02T12:00:00', doneAt: null },
    { createdAt: '2025-12-31T12:00:00', doneAt: '2026-01-03T12:00:00' },
    { createdAt: 'invalid', doneAt: 'invalid' }
  ]
});
assert.deepEqual(activity.get('2026-01-02'), { created: 2, done: 0 });
assert.deepEqual(activity.get('2026-01-03'), { created: 0, done: 2 });

const yearTaskActivity = buildYearTaskIndex(2026, {
  todos: [
    { createdAt: '2026-01-01T08:00:00', startTime: '2026-01-02T08:00:00', endTime: '2026-01-04T10:00:00' },
    { createdAt: '2026-01-01T08:00:00', startTime: '2026-01-05T08:00:00' },
    { createdAt: '2026-01-06T08:00:00', endTime: '2026-01-08T10:00:00' },
    { createdAt: '2025-12-31T12:00:00', doneAt: '2026-01-09T10:00:00' },
    { createdAt: '2026-01-10T08:00:00' },
    { createdAt: 'invalid', doneAt: null }
  ]
});
assert.equal(yearTaskActivity.get('2026-01-02'), 1);
assert.equal(yearTaskActivity.get('2026-01-04'), 1);
assert.equal(yearTaskActivity.get('2026-01-05'), 1);
assert.equal(yearTaskActivity.get('2026-01-07'), 1);
assert.equal(yearTaskActivity.get('2026-01-09'), 1);
assert.equal(yearTaskActivity.get('2026-01-10'), 1);
assert.equal(yearTaskActivity.has('2025-12-31'), false);

const yearCompletionActivity = buildYearCompletionIndex(2026, {
  todos: [
    { doneAt: '2026-02-03T10:00:00' },
    { doneAt: '2026-02-03T12:00:00' },
    { doneAt: '2025-12-31T12:00:00' },
    { doneAt: null }
  ]
});
assert.equal(yearCompletionActivity.get('2026-02-03'), 2);
assert.equal(yearCompletionActivity.has('2025-12-31'), false);

const indexedData = {
  todos: [
    { id: 'a', title: 'Write report', desc: 'Quarterly', tag: 'work', todo: true, important: false, done: false, archived: false, createdAt: 1 },
    { id: 'b', title: 'Old note', desc: '', tag: 'home', todo: false, important: true, done: true, archived: true, createdAt: 2 }
  ]
};
const runtimeIndex = createRuntimeIndex(indexedData);
assert.equal(runtimeIndex.get('a').title, 'Write report');
assert.equal(runtimeIndex.matches(indexedData.todos[0], 'quarterly'), true);
assert.deepEqual(indexedData._index.counts, { todo: 1, important: 0, all: 1, archived: 1 });

runtimeIndex.update(runtimeIndex.get('a'), { done: true, tag: 'done' });
assert.deepEqual(indexedData._index.counts, { todo: 0, important: 0, all: 0, archived: 1 });
assert.equal(indexedData._index.tagUndone.work || 0, 0);
assert.equal(indexedData._index.tagTotal.done, 1);
assert.equal(runtimeIndex.matches(runtimeIndex.get('a'), 'quarterly'), true);

runtimeIndex.add({ id: 'c', title: 'New task', desc: '', tag: 'work', todo: true, important: true, done: false, archived: false, createdAt: 3 });
assert.deepEqual(indexedData._index.counts, { todo: 1, important: 1, all: 1, archived: 1 });
runtimeIndex.remove('b');
assert.deepEqual(indexedData._index.counts, { todo: 1, important: 1, all: 1, archived: 0 });
runtimeIndex.replaceTodos(indexedData.todos.filter(todo => todo.id !== 'a'));
assert.equal(runtimeIndex.get('a'), undefined);
assert.equal(runtimeIndex.get('c').title, 'New task');

const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value))
};
globalThis.window = { crypto: webcrypto };
Object.defineProperty(globalThis, 'navigator', {
  value: {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0',
    language: 'zh-CN'
  },
  configurable: true
});
Object.defineProperty(globalThis, 'screen', {
  value: { width: 1920, height: 1080 },
  configurable: true
});
await initCrypto();
const encryptedState = await encrypt('{"todos":[{"id":"secure"}]}');
assert.equal(await tryDecrypt(encryptedState), '{"todos":[{"id":"secure"}]}');

const legacySaltB64 = storage.get('todo_app_salt');
const legacySalt = Buffer.from(legacySaltB64, 'base64');
const legacyFingerprint = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0',
  'zh-CN',
  '1920x1080',
  String(new Date().getTimezoneOffset())
].join('|');
const legacyMaterial = new TextEncoder().encode(`todo-tools::v1::${legacyFingerprint}`);
const legacyBaseKey = await webcrypto.subtle.importKey('raw', legacyMaterial, 'PBKDF2', false, ['deriveKey']);
const legacyKey = await webcrypto.subtle.deriveKey(
  { name: 'PBKDF2', salt: legacySalt, iterations: 100000, hash: 'SHA-256' },
  legacyBaseKey,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt']
);
const legacyIv = webcrypto.getRandomValues(new Uint8Array(12));
const legacyCipher = new Uint8Array(await webcrypto.subtle.encrypt(
  { name: 'AES-GCM', iv: legacyIv },
  legacyKey,
  new TextEncoder().encode('{"todos":[{"id":"legacy"}]}')
));
const legacyPayload = new Uint8Array(legacyIv.length + legacyCipher.length);
legacyPayload.set(legacyIv);
legacyPayload.set(legacyCipher, legacyIv.length);
const legacyContent = `${legacySaltB64}\nENC:${Buffer.from(legacyPayload).toString('base64')}`;
assert.equal(await tryDecrypt(legacyContent), '{"todos":[{"id":"legacy"}]}');
delete globalThis.localStorage;
delete globalThis.navigator;
delete globalThis.screen;
delete globalThis.window;

const notificationCommands = [];
globalThis.NL_OS = 'Windows';
globalThis.window = { location: { href: 'http://localhost/' } };
globalThis.fetch = async () => ({
  ok: true,
  arrayBuffer: async () => new ArrayBuffer(8)
});
globalThis.Neutralino = {
  os: {
    getPath: async () => 'C:\\Temp',
    execCommand: async (command) => {
      notificationCommands.push(command);
      return { exitCode: 0, stdOut: '', stdErr: '' };
    }
  },
  filesystem: { writeBinaryFile: async () => {} }
};
const nativeSetInterval = globalThis.setInterval;
let reminderIntervalCalls = 0;
globalThis.setInterval = (...args) => {
  reminderIntervalCalls++;
  return nativeSetInterval(...args);
};
const reminderTest = initReminders({
  data: { todos: [] },
  saveData: () => {},
  render: () => {},
  showToast: () => {},
  isNeutralinoEnv: () => true
});
globalThis.setInterval = nativeSetInterval;
assert.equal(reminderIntervalCalls, 0);
assert.equal(await reminderTest.testNotification(), true);
assert.equal(notificationCommands.length, 2);
assert.ok(notificationCommands.every(command => command.includes('powershell.exe')));
assert.deepEqual(reminderTest.getNotificationStatus(), { state: 'ready', label: 'Windows 原生通知可用' });
reminderTest.pause();
delete globalThis.Neutralino;
delete globalThis.NL_OS;
delete globalThis.window;
delete globalThis.fetch;

console.log('State checks passed');
