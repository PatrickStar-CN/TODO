import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';
import { countByList, countTagUndone, getFilteredTodos, sortByPriority, splitPendingDone } from '../src/selectors.js';
import { DEFAULT_UI_STYLE, normalizeUiStyle } from '../src/uiPreferences.js';
import { buildMonthActivityIndex, buildYearCompletionIndex, buildYearTaskIndex, getCompletedTodosForDate, getTaskTodosForDate } from '../src/calendar.js';
import { initReminders, computeNextMonthlyReminder } from '../src/reminder.js';
import { createRuntimeIndex } from '../src/runtimeIndex.js';
import { encrypt, initCrypto, tryDecrypt } from '../src/utils/crypto.js';
import { escapeAttr, escapeHtml } from '../src/utils/html.js';
import { parseLocalDateInput, toLocalDateInput, toLocalDatetime, isToday } from '../src/utils/date.js';
import { computeCollapsedY, easeOutCubic, isNearScreenTop } from '../src/miniSnap.js';
import { buildUpdateTaskRun, compareVersions, createUpdater, toEncodedCommand } from '../src/updater.js';
import { getNextTagDotStyle, getTagTaskCount } from '../src/shared.js';
import { resolveAiApiUrl } from '../src/utils/aiApi.js';
import { DEFAULT_TIMELINE_SETTINGS, formatTimelineTime, getTimelineDateParts, normalizeTimelineSettings, sortTimelineTodos } from '../src/timeline.js';
import { clampDonePanelHeight, computeDonePanelHeightFromPointer, computeDonePanelMaxHeightFromRects } from '../src/donePanelResize.js';

assert.equal(resolveAiApiUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1/chat/completions');
assert.equal(resolveAiApiUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1/chat/completions');
assert.equal(resolveAiApiUrl('https://api.openai.com/v1/chat/completions'), 'https://api.openai.com/v1/chat/completions');
assert.equal(resolveAiApiUrl('https://example.com/v1/chat/completions?key=test'), 'https://example.com/v1/chat/completions?key=test');
assert.equal(resolveAiApiUrl('https://example.com/custom-endpoint'), 'https://example.com/custom-endpoint');
assert.equal(resolveAiApiUrl(''), '');

/* HTML 转义：引号必须被转义，防止属性注入 */
assert.equal(escapeHtml('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
assert.equal(escapeAttr('a"b\'c<d>e&f'), 'a&quot;b&#39;c&lt;d&gt;e&amp;f');
assert.equal(escapeAttr(''), '');
assert.equal(escapeHtml(null), '');

/* 每月提醒：锚点日保留，月末自动收敛，不发生漂移 */
assert.equal(toLocalDatetime(computeNextMonthlyReminder(new Date(2026, 0, 31, 9, 0), new Date(2026, 0, 31, 9, 0))), '2026-02-28T09:00');
assert.equal(toLocalDatetime(computeNextMonthlyReminder(new Date(2026, 0, 31, 9, 0), new Date(2026, 1, 28, 23, 0))), '2026-03-31T09:00');
assert.equal(toLocalDatetime(computeNextMonthlyReminder(new Date(2026, 0, 15, 8, 30), new Date(2026, 2, 10, 12, 0))), '2026-03-15T08:30');
assert.equal(toLocalDatetime(computeNextMonthlyReminder(new Date(2024, 1, 29, 9, 0), new Date(2024, 1, 29, 9, 0))), '2024-03-29T09:00');

/* 日历日期选择：'YYYY-MM-DD' 必须按本地日期解析，避免 UTC 错天 */
const parsedLocal = parseLocalDateInput('2026-08-10');
assert.equal(parsedLocal.getFullYear(), 2026);
assert.equal(parsedLocal.getMonth(), 7);
assert.equal(parsedLocal.getDate(), 10);
assert.equal(toLocalDateInput(parsedLocal), '2026-08-10');
assert.equal(parseLocalDateInput('bad-date'), null);
/* 本地时区下，纯日期字符串 isToday 应正确判定（修复 UTC 陷阱） */
const todayLocal = new Date();
assert.equal(isToday(toLocalDateInput(todayLocal)), true);

/* 迷你模式贴边吸附：阈值判定按 dpr 换算物理像素 */
assert.equal(isNearScreenTop(20, 40, 1), true);
assert.equal(isNearScreenTop(41, 40, 1), false);
assert.equal(isNearScreenTop(80, 40, 2), true);
assert.equal(isNearScreenTop(81, 40, 2), false);

/* 版本比对：semver 逐段比较，忽略 v 前缀，文本段（如 beta）小于数字段；
   空版本视为最旧；非版本号形态（如 release-1.0.0）无法解析时保守返回 0，不误报更新 */
assert.equal(compareVersions('1.1.1', '1.1.0'), 1);
assert.equal(compareVersions('1.1.1', '1.1.1'), 0);
assert.equal(compareVersions('1.1.1', '1.2.0'), -1);
assert.equal(compareVersions('v1.1.1', '1.1.1'), 0);
assert.equal(compareVersions('1.1.1-beta', '1.1.1'), -1);
assert.equal(compareVersions('1.1.1', '1.1.1-beta'), 1);
assert.equal(compareVersions('1.0.0', '1.0.0.1'), -1);
assert.equal(compareVersions('', '1.0.0'), -1);
assert.equal(compareVersions('', ''), 0);
assert.equal(compareVersions('release-1.0.0', '1.0.0'), 0);
assert.equal(compareVersions('1.0.0', 'release-1'), 0);
assert.equal(compareVersions('alpha', '1.0.0'), 0);
assert.equal(compareVersions('1.0.0-beta.1', '1.0.0-beta.2'), -1);
assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.10'), -1);
/* semver 构建元数据（+ 后缀）不参与优先级比较 */
assert.equal(compareVersions('1.2.2+build', '1.2.2'), 0);
assert.equal(compareVersions('1.2.2', 'v1.2.2+b1'), 0);
assert.equal(compareVersions('1.2.3+exp', '1.2.2'), 1);

/* 标签工具（shared.js）：新标签色板按 tags.length 循环取色；计数优先走 _index 索引 */
assert.equal(getNextTagDotStyle([]), 'style="background:#4f46e5"');
assert.equal(getNextTagDotStyle(['a']), 'style="background:#06b6d4"');
assert.equal(getTagTaskCount({ _index: { tagTotal: { work: 3 } }, todos: [] }, 'work'), 3);
assert.equal(getTagTaskCount({ todos: [{ tag: 'x' }, { tag: 'x' }, { tag: 'y' }] }, 'x'), 2);
assert.equal(getTagTaskCount({ todos: [] }, 'gone'), 0);
assert.equal(isNearScreenTop(80, 40, 2), true);
assert.equal(isNearScreenTop(81, 40, 2), false);
/* 收起目标 Y：上移至仅保留触发条；触发条不低于 6 物理像素 */
assert.equal(computeCollapsedY(288, 8, 1), -280);
assert.equal(computeCollapsedY(288, 8, 1.25), -278);
assert.equal(computeCollapsedY(288, 8, 2), -272);
/* 缓动函数端点与单调性 */
assert.equal(easeOutCubic(0), 0);
assert.equal(easeOutCubic(1), 1);
assert.ok(easeOutCubic(0.5) > 0.5 && easeOutCubic(0.5) < 1);

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

/* 已完成面板拖拽调高：钳制、指针换算与上限推导均为纯函数 */
assert.equal(clampDonePanelHeight(200, 120, 600), 200);
assert.equal(clampDonePanelHeight(50, 120, 600), 120);
assert.equal(clampDonePanelHeight(900, 120, 600), 600);
assert.equal(clampDonePanelHeight('bad', 120, 600), 280);
assert.equal(computeDonePanelHeightFromPointer(700, 400, 50), 250);
/* 上限保证面板顶部停在新增任务栏下方：容器底边 − 输入栏底边 − 面板铬高 */
assert.equal(computeDonePanelMaxHeightFromRects({ containerBottom: 800, addBarBottom: 150, chromeHeight: 90 }), 560);
assert.equal(computeDonePanelMaxHeightFromRects({ containerBottom: 300, addBarBottom: 200, chromeHeight: 90 }), 120);
assert.equal(computeDonePanelMaxHeightFromRects({ containerBottom: NaN, addBarBottom: 150, chromeHeight: 90 }), 600);

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

assert.deepEqual(normalizeTimelineSettings(), DEFAULT_TIMELINE_SETTINGS);
assert.deepEqual(normalizeTimelineSettings({ enabled: true, sortBy: 'completed' }), {
  enabled: true,
  sortBy: 'completed'
});
assert.deepEqual(normalizeTimelineSettings({ enabled: 'yes', sortBy: 'unknown' }), {
  enabled: false,
  sortBy: 'created'
});
const timelineTodos = [
  { id: 'old-created', createdAt: '2026-01-01T08:00:00', doneAt: null },
  { id: 'new-created', createdAt: '2026-01-03T08:00:00', doneAt: '2026-01-04T08:00:00' },
  { id: 'old-completed', createdAt: '2026-01-02T08:00:00', doneAt: '2026-01-02T08:00:00' }
];
assert.deepEqual(sortTimelineTodos(timelineTodos, 'created').map(t => t.id), [
  'new-created',
  'old-completed',
  'old-created'
]);
assert.deepEqual(sortTimelineTodos(timelineTodos, 'completed').map(t => t.id), [
  'new-created',
  'old-completed'
]);
assert.equal(formatTimelineTime('2026-01-02T08:09:00'), '08:09');
assert.deepEqual(getTimelineDateParts(timelineTodos[1], 'created'), {
  year: 2026,
  month: 1,
  day: 3,
  time: '08:00'
});
assert.deepEqual(getTimelineDateParts(timelineTodos[1], 'completed'), {
  year: 2026,
  month: 1,
  day: 4,
  time: '08:00'
});
assert.equal(getTimelineDateParts(timelineTodos[0], 'completed'), null);

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
    { createdAt: '2026-01-10T08:00:00', startTime: '2026-01-11T18:00:00', endTime: '2026-01-12T10:00:00' },
    { createdAt: 'invalid', doneAt: null }
  ]
});
assert.equal(yearTaskActivity.get('2026-01-02'), 1);
assert.equal(yearTaskActivity.get('2026-01-04'), 1);
assert.equal(yearTaskActivity.get('2026-01-05'), 1);
assert.equal(yearTaskActivity.get('2026-01-07'), 1);
assert.equal(yearTaskActivity.get('2026-01-09'), 1);
assert.equal(yearTaskActivity.get('2026-01-10'), 1);
assert.equal(yearTaskActivity.get('2026-01-11'), 1);
assert.equal(yearTaskActivity.get('2026-01-12'), 1);
assert.equal(yearTaskActivity.has('2025-12-31'), false);

const tasksOnDateData = {
  todos: [
    { id: 'spans-date', createdAt: '2026-01-10T08:00:00', startTime: '2026-01-11T18:00:00', endTime: '2026-01-12T10:00:00' },
    { id: 'other-date', createdAt: '2026-01-13T08:00:00' },
    { id: 'invalid', createdAt: 'invalid' }
  ]
};
assert.deepEqual(getTaskTodosForDate(new Date(2026, 0, 12), tasksOnDateData).map(todo => todo.id), ['spans-date']);

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

const completedOnDate = getCompletedTodosForDate(new Date(2026, 1, 3), {
  todos: [
    { id: 'done-morning', doneAt: new Date(2026, 1, 3, 9, 0).toISOString() },
    { id: 'done-evening', doneAt: new Date(2026, 1, 3, 20, 0).toISOString() },
    { id: 'done-other-day', doneAt: new Date(2026, 1, 4, 9, 0).toISOString() },
    { id: 'pending', doneAt: null },
    { id: 'invalid', doneAt: 'invalid' }
  ]
});
assert.deepEqual(completedOnDate.map(todo => todo.id), ['done-morning', 'done-evening']);

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
globalThis.NL_PORT = 45678;
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

/* 回归：cdfc1c2 把 initDetailEditor 的 data 局部变量改成模块级 detailData 后，
   详情标签下拉处理器不得再引用裸 data 变量，否则打开任务标签编辑器会抛
   ReferenceError(data is not defined)，导致标签编辑界面卡死且改动无法保存 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const detailSource = readFileSync(path.join(__dirname, '../src/detail.js'), 'utf8');
assert.ok(!/\bdata\.tags\b/.test(detailSource), 'detail.js 不得再引用裸 data.tags（应使用 detailData?.tags）');
assert.ok(/\bdetailData\?\.tags\b/.test(detailSource), 'detail.js 应通过 detailData?.tags 取标签列表');
/* 保存时机：关闭详情面板（X/遮罩/Escape/提交）必须先持久化未保存改动，避免编辑后直接关闭丢失数据 */
assert.ok(/\bonBeforeDetailClose\b/.test(detailSource), 'detail.js 应在关闭详情面板前调用 onBeforeDetailClose 保存');
/* 回归：openDetail 打开详情时必须以 setDatePickerValue 同步日期选择触发器，
   否则设置过某任务的开始/截止/提醒时间后，其他无时间任务的触发器文本仍残留上次设置的时间 */
assert.ok(/setDatePickerValue/.test(detailSource), 'detail.js 应在 openDetail 中通过 setDatePickerValue 同步日期选择器触发器');
const datePickerSource = readFileSync(path.join(__dirname, '../src/datePicker.js'), 'utf8');
assert.ok(/syncValue\(value\)/.test(datePickerSource), 'datePicker.js 应提供 syncValue 同步触发器、输入值与清除按钮');
assert.ok(/export function setDatePickerValue/.test(datePickerSource), 'datePicker.js 应导出 setDatePickerValue');
const appSource = readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
assert.ok(/function saveDetailForm\s*\(\)\s*\{[\s\S]*?runtimeIndex\.update\(todo,\s*patch\)[\s\S]*?saveData\(\)/.test(appSource), 'app.js 应提供 saveDetailForm 统一保存详情改动');
assert.ok(/onBeforeDetailClose:\s*\(\)\s*=>\s*\{[\s\S]*?saveDetailForm\(\)/.test(appSource), 'app.js 应在 onBeforeDetailClose 中调用 saveDetailForm');
/* 侧栏标签：显示所有标签，计数只展示待完成数量 */
assert.ok(!/visibleTags/.test(appSource), 'app.js 侧栏不得再按 undone 过滤标签，应显示所有标签');
assert.ok(/countTagUndone\(data,\s*tag\)/.test(appSource), 'app.js 侧栏应使用 countTagUndone 计算待完成数量');
assert.ok(!/\$\{stats\.undone\}\/\$\{stats\.total\}/.test(appSource), 'app.js 侧栏标签计数不得再渲染 待完成/总数 双计数');
/* 已完成面板拖拽调高：分隔条语义、触摸独占与键盘支持 */
const doneResizeSource = readFileSync(path.join(__dirname, '../src/donePanelResize.js'), 'utf8');
assert.ok(/setPointerCapture/.test(doneResizeSource), 'donePanelResize.js 拖拽应捕获指针');
assert.ok(/ArrowUp/.test(doneResizeSource) && /ArrowDown/.test(doneResizeSource), 'donePanelResize.js 应支持方向键调整高度');
const styleSource = readFileSync(path.join(__dirname, '../src/style.css'), 'utf8');
assert.ok(/touch-action:\s*none/.test(styleSource), '拖拽条应禁用触摸默认滚动');
assert.ok(/done-resize-handle/.test(readFileSync(path.join(__dirname, '../index.html'), 'utf8')), 'index.html 应包含已完成面板拖拽条');
/* 展开/折叠走 transition（起止均为当前计算值，拖拽后不跳变）；拖拽期间关闭过渡避免滞后 */
assert.ok(/\.done-list-wrapper\s*\{[^}]*transition:\s*max-height/.test(styleSource), '已完成列表应用 transition 实现展开/折叠动画');
assert.ok(/\.done-section\.resizing\s+\.done-list-wrapper\s*\{[^}]*transition:\s*none/.test(styleSource), '拖拽期间应关闭列表过渡以保证跟手');
assert.ok(!/doneListExpand/.test(styleSource) && !/doneListCollapse/.test(styleSource), '写死默认高度的关键帧动画应已移除');
assert.ok(/expectCollapsed/.test(appSource), 'app.js 折叠切换应凭期望状态丢弃过期过渡回调');

/* 设置-系统-检测更新：仓库可配置、版本号解析与已是最新时的版本展示 */
assert.equal(createUpdater({}).getRepo(), 'PatrickStar-CN/TODO');
assert.equal(createUpdater({ appConfig: { update: { repo: 'owner/repo' } } }).getRepo(), 'owner/repo');
assert.equal(createUpdater({ appConfig: { version: 'v1.2.3' } }).getCurrentVersion(), '1.2.3');
globalThis.Neutralino = { app: { getConfig: async () => ({ version: '1.2.1' }) } };
const versionUpdater = createUpdater({});
assert.equal(await versionUpdater.resolveCurrentVersion(), '1.2.1');
assert.equal(versionUpdater.getCurrentVersion(), '1.2.1');
delete globalThis.Neutralino;
const updaterSource = readFileSync(path.join(__dirname, '../src/updater.js'), 'utf8');
assert.ok(/version:\s*cur\s*\|\|\s*latest/.test(updaterSource), 'updater.js 已是最新时应展示本地版本（cur || latest）');
const settingsSource = readFileSync(path.join(__dirname, '../src/settings.js'), 'utf8');
assert.ok(/resolveCurrentVersion/.test(settingsSource), 'settings.js 打开系统面板时应主动解析本地版本');
assert.ok(/aria-busy/.test(settingsSource), 'settings.js 更新按钮应提供 aria-busy 忙碌状态');
const appConfig = JSON.parse(readFileSync(path.join(__dirname, '../app.config.json'), 'utf-8'));
assert.equal(appConfig.update?.repo, 'PatrickStar-CN/TODO');

/* -EncodedCommand 必须按 UTF-16LE 编码：ASCII、CJK 与代理对（emoji）往返一致 */
assert.equal(Buffer.from(toEncodedCommand('schtasks /Run'), 'base64').toString('utf16le'), 'schtasks /Run');
assert.equal(Buffer.from(toEncodedCommand('C:\\Users\\中文\\Temp\\apply-update.ps1'), 'base64').toString('utf16le'), 'C:\\Users\\中文\\Temp\\apply-update.ps1');
assert.equal(Buffer.from(toEncodedCommand('done 🚀 ok'), 'base64').toString('utf16le'), 'done 🚀 ok');

/* /TR 构造：含空格路径加引号、单引号双写转义、中文原样透传 */
assert.equal(
  buildUpdateTaskRun('C:\\Users\\John Doe\\Temp\\todo-tools-update\\apply-update.ps1'),
  'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\\Users\\John Doe\\Temp\\todo-tools-update\\apply-update.ps1"'
);
assert.equal(
  buildUpdateTaskRun("C:\\Users\\O'Brien\\x.ps1"),
  'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\\Users\\O\'\'Brien\\x.ps1"'
);

assert.ok(/--max-time/.test(updaterSource), 'curl 兜底应带 --max-time 总超时');
assert.ok(/cancelDownload/.test(updaterSource), 'updater 应支持取消下载');
assert.ok(/if \(!expected\) throw/.test(updaterSource), 'SHA-256 取不到期望哈希时必须直接失败');
assert.ok(/r\.stdErr/.test(updaterSource) && !/r\.stderr/.test(updaterSource), '应使用 stdErr 字段取进程错误输出');
assert.ok(/\/TR '\$\{buildUpdateTaskRun\(scriptPath\)\}'/.test(updaterSource), '计划任务 /TR 应整体加引号');
assert.ok(/runResult\.exitCode/.test(updaterSource), 'schtasks /Run 结果必须检查');
assert.ok(/File\]::Open\(\$exePath/.test(updaterSource), '替换脚本应等待主进程退出');
assert.ok(/pending\.version/.test(updaterSource), '启动自检应用版本比对判定成败');
assert.ok(/btn-cancel-update/.test(settingsSource), '设置页应提供取消下载按钮');

/* 下载取消流程：check → available → downloading → cancel → available（版本与资产保留） */
{
  const fsMem = new Map();
  const dirSet = new Set();
  const JSON_KEY = 'C:\\Temp\\todo-tools-update\\latest-release.json';
  globalThis.NL_PORT = 45678;
  globalThis.Neutralino = {
    app: { getConfig: async () => ({ version: '1.2.2' }) },
    os: {
      getPath: async () => 'C:\\Temp',
      execCommand: async (cmd) => {
        if (cmd.includes('TODO-Tools-Updater')) {
          fsMem.set(JSON_KEY, JSON.stringify({
            tag_name: 'v9.9.9',
            body: 'notes',
            assets: [
              { name: 'todo-tools-win_x64.zip', size: 10, browser_download_url: 'https://example.com/pkg.zip' },
              { name: 'todo-tools-win_x64.zip.sha256', size: 65, browser_download_url: 'https://example.com/pkg.sha256' }
            ]
          }));
          return { exitCode: 0, stdOut: '', stdErr: '' };
        }
        if (cmd.includes('https://example.com')) {
          await new Promise(() => {});
        }
        return { exitCode: 0, stdOut: '', stdErr: '' };
      }
    },
    filesystem: {
      createDirectory: async (p) => {
        if (dirSet.has(p)) throw new Error('exists');
        dirSet.add(p);
      },
      getStats: async (p) => {
        if (fsMem.has(p)) return { size: String(fsMem.get(p)).length };
        if (dirSet.has(p)) return { size: 0 };
        throw new Error('missing');
      },
      readFile: async (p) => {
        if (fsMem.has(p)) return fsMem.get(p);
        throw new Error('missing');
      },
      writeFile: async (p, content) => { fsMem.set(p, content); },
      remove: async (p) => { fsMem.delete(p); }
    }
  };
  const cancelUpdater = createUpdater({ showToast: () => {} });
  await cancelUpdater.checkForUpdates();
  assert.equal(cancelUpdater.getState().phase, 'available');
  assert.equal(cancelUpdater.getState().version, '9.9.9');
  const downloading = cancelUpdater.downloadAndPrepare();
  downloading.then(() => {}, () => {});
  await new Promise(r => setTimeout(r, 900));
  assert.equal(cancelUpdater.getState().phase, 'downloading');
  assert.equal(cancelUpdater.cancelDownload(), true);
  assert.equal(cancelUpdater.getState().phase, 'available');
  assert.equal(cancelUpdater.getState().version, '9.9.9');
  assert.equal((cancelUpdater.getState().assets || []).length, 2);
  assert.equal(cancelUpdater.cancelDownload(), false);
  delete globalThis.Neutralino;
  delete globalThis.NL_PORT;
}

/* verifying 段取消竞态：sha 下载在取消后才完成 → 不得覆盖为 ready/failed，应保持 available */
{
  const fsMem = new Map();
  const dirSet = new Set();
  const base = 'C:\\Temp\\todo-tools-update';
  const JSON_KEY = `${base}\\latest-release.json`;
  const ZIP_KEY = `${base}\\todo-tools-win_x64.zip`;
  const SHA_KEY = `${base}\\todo-tools-win_x64.zip.sha256`;
  globalThis.NL_PORT = 45678;
  globalThis.Neutralino = {
    app: { getConfig: async () => ({ version: '1.2.2' }) },
    os: {
      getPath: async () => 'C:\\Temp',
      execCommand: async (cmd) => {
        if (cmd.includes('TODO-Tools-Updater')) {
          fsMem.set(JSON_KEY, JSON.stringify({
            tag_name: 'v9.9.9',
            body: 'notes',
            assets: [
              { name: 'todo-tools-win_x64.zip', size: 8, browser_download_url: 'https://example.com/pkg.zip' },
              { name: 'todo-tools-win_x64.zip.sha256', size: 65, browser_download_url: 'https://example.com/pkg.sha256' }
            ]
          }));
          return { exitCode: 0, stdOut: '', stdErr: '' };
        }
        if (cmd.includes('pkg.zip')) {
          await new Promise(r => setTimeout(r, 100));
          fsMem.set(ZIP_KEY, 'ZIPBYTES');
          return { exitCode: 0, stdOut: '', stdErr: '' };
        }
        if (cmd.includes('pkg.sha256')) {
          await new Promise(r => setTimeout(r, 1500));
          /* 真实哈希：若取消守卫缺失，流程会一路走到 ready（竞态复现） */
          fsMem.set(SHA_KEY, createHash('sha256').update('ZIPBYTES').digest('hex'));
          return { exitCode: 0, stdOut: '', stdErr: '' };
        }
        if (cmd.includes('Expand-Archive')) {
          fsMem.set(`${base}\\extracted\\todo-tools-win_x64.exe`, 'EXE');
          fsMem.set(`${base}\\extracted\\resources.neu`, 'RES');
        }
        return { exitCode: 0, stdOut: '', stdErr: '' };
      }
    },
    filesystem: {
      createDirectory: async (p) => {
        if (dirSet.has(p)) throw new Error('exists');
        dirSet.add(p);
      },
      getStats: async (p) => {
        if (fsMem.has(p)) return { size: String(fsMem.get(p)).length };
        if (dirSet.has(p)) return { size: 0 };
        throw new Error('missing');
      },
      readFile: async (p) => {
        if (fsMem.has(p)) return fsMem.get(p);
        throw new Error('missing');
      },
      readBinaryFile: async (p) => new TextEncoder().encode(fsMem.get(p) ?? ''),
      writeFile: async (p, content) => { fsMem.set(p, content); },
      remove: async (p) => { fsMem.delete(p); }
    }
  };
  const verifyUpdater = createUpdater({ showToast: () => {} });
  await verifyUpdater.checkForUpdates();
  assert.equal(verifyUpdater.getState().phase, 'available');
  const preparing = verifyUpdater.downloadAndPrepare();
  preparing.then(() => {}, () => {});
  await new Promise(r => setTimeout(r, 600));
  assert.equal(verifyUpdater.cancelDownload(), true);
  assert.equal(verifyUpdater.getState().phase, 'available');
  /* 等待后台 sha 下载完成 + 校验流程走完：取消不得被覆盖 */
  await new Promise(r => setTimeout(r, 2400));
  assert.equal(verifyUpdater.getState().phase, 'available');
  assert.equal(verifyUpdater.getState().version, '9.9.9');
  delete globalThis.Neutralino;
  delete globalThis.NL_PORT;
}

console.log('State checks passed');
