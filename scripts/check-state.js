import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';
import { countByList, countTagUndone, getFilteredTodos, sortByPriority, splitPendingDone } from '../src/selectors.js';
import { DEFAULT_UI_STYLE, normalizeUiStyle } from '../src/uiPreferences.js';
import { buildMonthActivityIndex, buildMonthIndex, buildYearCompletionIndex, buildYearTaskIndex, getCompletedTodosForDate, getMonthTodos, getTaskTodosForDate, groupMonthTodos, paginateList, MONTH_TODOS_PAGE_SIZE } from '../src/calendar.js';
import { initReminders, computeNextMonthlyReminder } from '../src/reminder.js';
import { createRuntimeIndex } from '../src/runtimeIndex.js';
import { encrypt, initCrypto, tryDecrypt } from '../src/utils/crypto.js';
import { escapeAttr, escapeHtml } from '../src/utils/html.js';
import { parseLocalDateInput, toLocalDateInput, toLocalDatetime, isToday, getMonthRange } from '../src/utils/date.js';
import { animateWindowRect, cancelWindowRectAnimation, centerRect, computeCollapsedY, easeOutCubic, ensureDisplayHz, framesPerApply, isNearScreenTop, rectAt, WINDOW_ANIM_MAX_HZ } from '../src/miniSnap.js';
import { buildCurlProxyPs, buildDownloadCurlPs, buildDownloadWebRequestPs, buildFetchCurlPs, buildFetchWebRequestPs, buildProxyAssignPs, buildTlsPs, buildUpdateLauncherVbs, buildUpdateTaskRun, buildUpdateTaskRunVbs, compareVersions, createUpdater, normalizeTargetDir, psQuote, sanitizeNetDetail, toEncodedCommand } from '../src/updater.js';
import { getNextTagDotStyle, getTagTaskCount } from '../src/shared.js';
import { HOLDER_LOST_EXIT_CODE, SINGLE_INSTANCE_MUTEX, acquireSingleInstance, buildHolderPs, buildMutexName, buildProbePs, decideProbe, releaseSingleInstance } from '../src/singleInstance.js';
import { extractCompleteContent, normalizeStreamText, parseSseLine, resolveAiApiUrl } from '../src/utils/aiApi.js';
import { DEFAULT_TIMELINE_SETTINGS, formatTimelineTime, getTimelineDateParts, normalizeTimelineSettings, sortTimelineTodos } from '../src/timeline.js';
import { clampDonePanelHeight, computeDonePanelHeightFromPointer, computeDonePanelMaxHeightFromRects } from '../src/donePanelResize.js';
import { EXPORT_FORMATS, EXPORT_SCHEMA_VERSION, buildExportFileName, buildExportPayload, buildMarkdownExport, exportData } from '../src/dataExport.js';
import { t as translate, setLanguage as setI18nLanguage } from '../src/i18n/index.js';

/* updater 的失败/提示文案以 i18n key + 参数记录，由界面在渲染时翻译（切换语言后文案跟随）。
 * 断言时统一走这里解析，等价于设置系统页签 renderUpdateStatus 的行为。 */
function resolveUpdaterStateText(state) {
  if (state.errorKey) return translate(state.errorKey, state.errorParams || {});
  if (state.noticeKey) return translate(state.noticeKey, state.noticeParams || {});
  return state.error || state.notice || '';
}

assert.equal(resolveAiApiUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1/chat/completions');
assert.equal(resolveAiApiUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1/chat/completions');
assert.equal(resolveAiApiUrl('https://api.openai.com/v1/chat/completions'), 'https://api.openai.com/v1/chat/completions');
assert.equal(resolveAiApiUrl('https://example.com/v1/chat/completions?key=test'), 'https://example.com/v1/chat/completions?key=test');
assert.equal(resolveAiApiUrl('https://example.com/custom-endpoint'), 'https://example.com/custom-endpoint');
assert.equal(resolveAiApiUrl(''), '');

/* SSE 单行解析：data 前缀兼容有/无空格；[DONE] 结束；非 SSE 行忽略 */
assert.deepEqual(parseSseLine('data: {"choices":[{"delta":{"content":"你好"}}]}'), { done: false, content: '你好' });
assert.deepEqual(parseSseLine('data:{"choices":[{"delta":{"content":"hi"}}]}'), { done: false, content: 'hi' });
assert.deepEqual(parseSseLine('data: [DONE]'), { done: true, content: '' });
assert.deepEqual(parseSseLine(': ping'), { done: false, content: '' });
assert.deepEqual(parseSseLine(''), { done: false, content: '' });
assert.deepEqual(parseSseLine('data: not-json'), { done: false, content: '' });
assert.deepEqual(parseSseLine('data: {"choices":[{}]}'), { done: false, content: '' });
assert.deepEqual(parseSseLine('  data: {"choices":[{"delta":{"content":"X"}}]}'), { done: false, content: 'X' });
assert.deepEqual(parseSseLine('data: {"choices":[{"delta":{"reasoning_content":"思考","content":"正文"}}]}'), { done: false, content: '正文' });
/* 流式纯文本归一化：推理模型句中杂散空白收敛，不引入 Markdown 渲染 */
assert.equal(normalizeStreamText('森兰：退料自动  \n   \n\n    回传；'), '森兰：退料自动\n\n回传；');
assert.equal(normalizeStreamText('设备\n\n\n管理'), '设备\n\n管理');
assert.equal(normalizeStreamText('A\r\nB\rC'), 'A\nB\nC');
assert.equal(normalizeStreamText('\n\n标题\n正文'), '标题\n正文');
assert.equal(normalizeStreamText('<think>思考过程</think>正文'), '正文');
assert.equal(normalizeStreamText('行  尾\n下一行  '), '行 尾\n下一行');
assert.equal(normalizeStreamText(''), '');
/* 整包兜底：网关无视 stream 时从完整 JSON 提正文或服务端错误 */
assert.equal(extractCompleteContent('{"choices":[{"message":{"content":"月报正文"}}]}'), '月报正文');
assert.equal(extractCompleteContent('{"choices":[{"text":"abc"}]}'), 'abc');
assert.equal(extractCompleteContent('{"error":{"message":"overloaded"}}'), '请求失败：overloaded');
assert.equal(extractCompleteContent(''), '');
assert.equal(extractCompleteContent('not json'), '');

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

/* 性能回归：buildMonthIndex 内联统计已收敛到 buildMonthActivityIndex，两者必须一致 */
{
  const monthFixture = {
    todos: [
      { id: 'a', createdAt: '2026-01-02T08:00:00', doneAt: '2026-01-03T10:00:00' },
      { id: 'b', createdAt: '2026-01-02T12:00:00', doneAt: null }
    ]
  };
  const monthIdx = buildMonthIndex(2026, 0, monthFixture);
  const monthActivity = buildMonthActivityIndex(2026, 0, monthFixture);
  assert.deepEqual(monthIdx.activityIndex.get('2026-01-02'), monthActivity.get('2026-01-02'));
  assert.deepEqual(monthIdx.activityIndex.get('2026-01-03'), monthActivity.get('2026-01-03'));
  assert.deepEqual((monthIdx.get('2026-01-02') || []).map(t => t.id), ['b']);
}

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

/* 整月任务：复用日历覆盖规则去重聚合；完成模式按 doneAt 落月 */
{
  const monthData = {
    todos: [
      { id: 'span', createdAt: '2026-09-01T08:00:00', startTime: '2026-08-28T08:00:00', endTime: '2026-09-02T10:00:00' },
      { id: 'single', createdAt: '2026-09-10T08:00:00', startTime: '2026-09-10T08:00:00' },
      { id: 'other-month', createdAt: '2026-10-01T08:00:00' },
      { id: 'done-sep', createdAt: '2026-09-01T08:00:00', doneAt: '2026-09-15T10:00:00' },
      { id: 'done-oct', createdAt: '2026-09-01T08:00:00', doneAt: '2026-10-01T10:00:00' },
      { id: 'invalid', createdAt: 'invalid', doneAt: null }
    ]
  };
  /* 跨月覆盖任务计入 9 月一次，且按落在本月首日分组，不显示上月组头 */
  const sept = getMonthTodos(2026, 8, monthData, 'month');
  assert.deepEqual(sept.map(t => t.id), ['span', 'single', 'done-sep']);
  const groups = groupMonthTodos(sept, 'month', 2026, 8);
  assert.ok(groups.every(g => g.key >= '2026-09-01' && g.key < '2026-10-01'), '整月分组键必须落在当月');
  assert.equal(groups[0].key, '2026-09-01');
  /* 完成模式只收 doneAt 落月 */
  assert.deepEqual(getMonthTodos(2026, 8, monthData, 'completed').map(t => t.id), ['done-sep']);
  assert.deepEqual(getMonthTodos(2026, 9, monthData, 'completed').map(t => t.id), ['done-oct']);
  /* 与单日规则一致：整月集合 = 各单日并集（去重） */
  const union = new Set();
  for (let d = 1; d <= 30; d++) {
    getTaskTodosForDate(new Date(2026, 8, d), monthData).forEach(t => union.add(t.id));
  }
  assert.deepEqual([...union].sort(), ['done-sep', 'single', 'span']);
}

/* 整月增量加载：按任务项切片，边界安全 */
{
  assert.equal(MONTH_TODOS_PAGE_SIZE, 25);
  const list = Array.from({ length: 60 }, (_, i) => ({ id: `t${i}` }));
  assert.equal(paginateList(list, 25).length, 25);
  assert.equal(paginateList(list, 25)[24].id, 't24');
  assert.equal(paginateList(list, 200).length, 60);
  assert.deepEqual(paginateList(list, 0), []);
  assert.deepEqual(paginateList(null, 25), []);
}

/* AI 月报：自然月范围（月中任一天归属本月、12 月跨年、闰年 2 月） */
{
  const sept = getMonthRange(new Date(2026, 8, 15));
  assert.equal(sept.startDate.getFullYear(), 2026);
  assert.equal(sept.startDate.getMonth(), 8);
  assert.equal(sept.startDate.getDate(), 1);
  assert.equal(sept.endDate.getFullYear(), 2026);
  assert.equal(sept.endDate.getMonth(), 9);
  assert.equal(sept.endDate.getDate(), 1);
  assert.equal(sept.rangeLabel, '9/1 ~ 9/30');
  const dec = getMonthRange(new Date(2026, 11, 5));
  assert.equal(dec.endDate.getFullYear(), 2027);
  assert.equal(dec.endDate.getMonth(), 0);
  assert.equal(dec.rangeLabel, '12/1 ~ 12/31');
  const feb = getMonthRange(new Date(2024, 1, 10));
  assert.equal(feb.rangeLabel, '2/1 ~ 2/29');
}

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

/* 性能回归：列表缓存键依赖 runtimeIndex 版本语义（add/update/remove 必 bump；
   { calendar: false } 只 bump 列表版本，不碰日历版本） */
{
  const versioned = createRuntimeIndex({ todos: [{ id: 'v1', title: 'V', tag: '', todo: true, important: false, done: false, archived: false, createdAt: 1 }] });
  const v0 = versioned.getVersion();
  const c0 = versioned.getCalendarVersion();
  versioned.update(versioned.get('v1'), { important: true }, { calendar: false });
  assert.equal(versioned.getVersion(), v0 + 1);
  assert.equal(versioned.getCalendarVersion(), c0);
  versioned.update(versioned.get('v1'), { important: false });
  assert.equal(versioned.getVersion(), v0 + 2);
  assert.equal(versioned.getCalendarVersion(), c0 + 1);
  versioned.add({ id: 'v2', title: 'W', tag: '', todo: true, important: false, done: false, archived: false, createdAt: 2 });
  assert.equal(versioned.getVersion(), v0 + 3);
  versioned.remove('v2');
  assert.equal(versioned.getVersion(), v0 + 4);
}

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
import { readdirSync, readFileSync } from 'node:fs';
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

/* 回归：弹层收尾句柄必须只认元素自身的 animationend，且能在重新打开时整体撤销。
 * 否则子元素动画冒泡会提前收尾，关闭动画途中重开又会被过期回调把面板/遮罩
 * 撤掉，界面卡在一层无法关闭的模糊遮罩上（点击任何位置都无响应）。 */
{
  const { createDismissal } = await import('../src/utils/dismiss.js');
  const createFakeElement = () => {
    const handlers = new Map();
    return {
      handlers,
      addEventListener(type, handler) {
        if (!handlers.has(type)) handlers.set(type, []);
        handlers.get(type).push(handler);
      },
      removeEventListener(type, handler) {
        const list = handlers.get(type) || [];
        const index = list.indexOf(handler);
        if (index !== -1) list.splice(index, 1);
      },
      fire(target, type = 'animationend') {
        [...(handlers.get(type) || [])].forEach(handler => handler({ type, target }));
      }
    };
  };

  const el = createFakeElement();
  const child = createFakeElement();
  let ended = 0;
  createDismissal().onEnd(el, () => { ended += 1; });
  el.fire(child);
  assert.equal(ended, 0, 'animationend 从子元素冒泡时不得触发收尾');
  el.fire(el);
  assert.equal(ended, 1, '元素自身动画结束应触发一次收尾');

  const reopened = createFakeElement();
  const dismissal = createDismissal();
  let stale = 0;
  dismissal.onEnd(reopened, () => { stale += 1; });
  dismissal.after(() => { stale += 1; }, 0);
  dismissal.cancel();
  reopened.fire(reopened);
  assert.equal(stale, 0, '重新打开时应撤销 animationend 收尾');
  assert.equal(reopened.handlers.get('animationend').length, 0, 'cancel 应移除已登记的 animationend 监听');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(stale, 0, 'cancel 应清掉兜底定时器');

  const fallback = createFakeElement();
  const timed = createDismissal();
  let byTimer = 0;
  timed.onEnd(fallback, () => { byTimer += 1; });
  timed.after(() => { byTimer += 1; }, 0);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(byTimer, 1, '动画事件不触发时应由兜底定时器收尾');
}

/* 各弹层关闭流程统一走收尾句柄：重开前撤销，收尾只认自身动画事件 */
for (const [file, label] of [
  ['../src/detail.js', 'detail.js'],
  ['../src/overlay.js', 'overlay.js'],
  ['../src/settings.js', 'settings.js'],
  ['../src/aiSummary.js', 'aiSummary.js']
]) {
  const source = readFileSync(path.join(__dirname, file), 'utf8');
  assert.ok(/createDismissal/.test(source), `${label} 应使用 createDismissal 统一弹层收尾`);
  assert.ok(!/addEventListener\('animationend',\s*\(\)\s*=>/.test(source), `${label} 不应再使用无 target 校验的 animationend 收尾`);
}
const overlaySource = readFileSync(path.join(__dirname, '../src/overlay.js'), 'utf8');
assert.ok(/querySelectorAll\('\.tag-input-overlay'\)/.test(overlaySource), 'createOverlay 应先收尾可能残留的旧通用遮罩，避免两层叠加时旧遮罩永久挡住界面');
assert.ok(/closeDatePicker\(\)/.test(detailSource), '关闭任务详情应收尾日期选择浮层，避免浮层残留在界面上');
/* 报告流式链路：flush 尾行、DONE 终结外层、整包兜底、自动滚动、流式态清理 */
{
  const aiSource = readFileSync(path.join(__dirname, '../src/aiSummary.js'), 'utf8');
  assert.ok(/parseSseLine/.test(aiSource), 'aiSummary 应复用 SSE 单行解析');
  assert.ok(/decoder\.decode\(\)/.test(aiSource), '流结束应 flush 解码器，避免丢弃尾行');
  assert.ok(/while \(!streamDone\)/.test(aiSource), '[DONE] 应终结外层读取循环');
  assert.ok(/extractCompleteContent/.test(aiSource), '零流式输出时应尝试整包兜底');
  assert.ok(/scrollTop = .*scrollHeight/.test(aiSource), '流式追加应自动滚到底部');
  assert.ok(/is-streaming/.test(aiSource), '生成中应标记流式态并在各出口清理');
  assert.ok(/normalizeStreamText/.test(aiSource), '流式屏显应走纯文本归一化，收敛推理模型杂散空白');
  assert.ok(/requestAnimationFrame/.test(aiSource), '流式渲染应节流，避免逐 delta 高频回流');
  assert.ok(/split\(\/\\r\\n\|\\r\|\\n\/\)/.test(aiSource), 'SSE 切行应兼容孤立回车，避免整行 JSON 解析失败丢 delta');
  assert.ok(!/ai-debug|aiDebug/.test(aiSource), '临时定界诊断不得残留正式代码');
}
const appSource = readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
assert.ok(/function saveDetailForm\s*\(\)\s*\{[\s\S]*?runtimeIndex\.update\(todo,\s*patch\)[\s\S]*?saveData\(\)/.test(appSource), 'app.js 应提供 saveDetailForm 统一保存详情改动');
assert.ok(/onBeforeDetailClose:\s*\(\)\s*=>\s*\{[\s\S]*?saveDetailForm\(\)/.test(appSource), 'app.js 应在 onBeforeDetailClose 中调用 saveDetailForm');
/* 侧栏标签：显示所有标签，计数只展示待完成数量 */
assert.ok(!/visibleTags/.test(appSource), 'app.js 侧栏不得再按 undone 过滤标签，应显示所有标签');
assert.ok(/countTagUndone\(data,\s*tag\)/.test(appSource), 'app.js 侧栏应使用 countTagUndone 计算待完成数量');
assert.ok(!/\$\{stats\.undone\}\/\$\{stats\.total\}/.test(appSource), 'app.js 侧栏标签计数不得再渲染 待完成/总数 双计数');
/* 日历整月入口：详情区日/月切换、按月增量加载、组头跳天 */
{
  const calendarSource = readFileSync(path.join(__dirname, '../src/calendar.js'), 'utf8');
  assert.ok(/data-detail-view/.test(calendarSource), 'calendar.js 详情区应提供 按天/按月 切换入口');
  assert.ok(/getMonthTodos/.test(calendarSource), 'calendar.js 应提供整月聚合 getMonthTodos');
  assert.ok(/data-action="load-more-month"/.test(calendarSource), 'calendar.js 整月列表应提供加载更多入口');
  assert.ok(/jumpDate/.test(calendarSource), 'calendar.js 整月分组头应支持跳回单日');
  assert.ok(/month-group-date/.test(calendarSource), 'calendar.js 整月分组头应包含日期与计数展示结构');
  assert.ok(/calendar-month-progress/.test(calendarSource), 'calendar.js 整月底部应展示加载进度');
  assert.ok(/month-group-today/.test(calendarSource), 'calendar.js 当天分组应有今天标记');
  assert.ok(/is-complete/.test(calendarSource), 'calendar.js 整组完成时应有完成态样式');
  assert.ok(/calendar-range/.test(calendarSource), 'calendar.js 按月切换应使用图标库图标');
  assert.ok(/data-count-tier/.test(calendarSource), 'calendar.js 月历格子任务量标识应按数量分档');
  assert.ok(/continueTo/.test(calendarSource), 'calendar.js 跨天任务应经 i18n continueTo 提示持续日期');
  const zhDict = readFileSync(path.join(__dirname, '../src/i18n/zh.js'), 'utf8');
  assert.ok(/持续至/.test(zhDict), '中文包应包含“持续至”文案');
  const renderSource = readFileSync(path.join(__dirname, '../src/renderTodoItem.js'), 'utf8');
  assert.ok(/badge-span/.test(renderSource), 'renderTodoItem.js 应支持持续至徽章（opt-in，不影响其他视图）');
  assert.ok(/calendar-detail-sub/.test(calendarSource), 'calendar.js 整月标题应展示已完成统计');
  const monthStyleSource = readFileSync(path.join(__dirname, '../src/style.css'), 'utf8');
  assert.ok(/\.calendar-month-group-header\s*\{[^}]*position:\s*sticky/.test(monthStyleSource), '整月分组头应粘性悬停，长列表导航不迷路');
  assert.ok(/\.calendar-task-marker\[data-count-tier/.test(monthStyleSource), '任务量标识分档应有对应样式');
  assert.ok(/calendarDetailMode/.test(appSource), 'app.js 应维护日历详情 日/月 运行时状态');
  assert.ok(/visibleMonthCount/.test(appSource), 'app.js 整月列表应按任务项增量加载');
  assert.ok(/loadMoreMonthIfNeeded/.test(appSource), 'app.js 应提供整月增量加载逻辑');
}
/* AI 月报：日报/周报/月报三页签与自然月范围 */
{
  const aiSource = readFileSync(path.join(__dirname, '../src/aiSummary.js'), 'utf8');
  assert.ok(/monthly/.test(aiSource), 'aiSummary.js 应支持 monthly 月报类型');
  assert.ok(/getMonthRange|getMonthlyReportRange/.test(aiSource), 'aiSummary.js 月报范围应收敛到自然月范围函数');
  assert.ok(/planMonthly|getAiTypeLabels/.test(aiSource), 'aiSummary.js 月报计划标签应经 i18n 获取');
  assert.ok(/下月计划/.test(readFileSync(path.join(__dirname, '../src/i18n/zh.js'), 'utf8')), '中文包月报计划标签应为 下月计划');
  const htmlSourceMonthly = readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.ok(/data-type="monthly"/.test(htmlSourceMonthly), 'index.html AI 总结应包含月报页签');
}
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

/* /TR 构造：含空格路径加引号、单引号双写转义、中文原样透传；必须隐藏窗口避免重启更新弹出黑框 */
assert.equal(
  buildUpdateTaskRun('C:\\Users\\John Doe\\Temp\\todo-tools-update\\apply-update.ps1'),
  'powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\\Users\\John Doe\\Temp\\todo-tools-update\\apply-update.ps1"'
);
assert.equal(
  buildUpdateTaskRun("C:\\Users\\O'Brien\\x.ps1"),
  'powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\\Users\\O\'\'Brien\\x.ps1"'
);
assert.ok(
  buildUpdateTaskRun('C:\\Temp\\x.ps1').includes('-WindowStyle Hidden'),
  '计划任务更新命令必须隐藏控制台窗口'
);
/* 重启无闪现：计划任务必须经 wscript VBS 中转（GUI 无控制台），不得直启 powershell；
 * VBS 仅 ASCII 且按自身位置推导 ps1，中文用户名也不存在编码问题 */
assert.equal(
  buildUpdateTaskRunVbs('C:\\Temp\\todo-tools-update\\apply-update.vbs'),
  'wscript.exe //B //Nologo "C:\\Temp\\todo-tools-update\\apply-update.vbs"'
);
assert.equal(
  buildUpdateTaskRunVbs('C:\\Users\\John Doe\\Temp\\todo-tools-update\\apply-update.vbs'),
  'wscript.exe //B //Nologo "C:\\Users\\John Doe\\Temp\\todo-tools-update\\apply-update.vbs"'
);
{
  const launcher = buildUpdateLauncherVbs();
  assert.ok(/WScript\.Shell/.test(launcher), 'VBS 启动器应经 WScript.Shell 拉起');
  assert.ok(/sh\.Run cmd, 0, False/.test(launcher), 'VBS 必须以隐藏方式拉起 powershell（Run ...,0,False）');
  assert.ok(/apply-update\.ps1/.test(launcher), 'VBS 应推导同目录 apply-update.ps1');
  assert.ok(!/[^\x00-\x7F]/.test(launcher), 'VBS 应仅含 ASCII，避免中文路径编码问题');
}
/* 替换脚本自删任务不得裸调 schtasks.exe（控制台子进程会闪黑框），必须隐藏拉起 */
assert.ok(/Start-Process.*schtasks\.exe.*-WindowStyle Hidden/.test(updaterSource), '替换脚本自删任务必须隐藏启动 schtasks，避免二次闪窗');
assert.ok(!/^\s*schtasks \/Delete/m.test(updaterSource), '替换脚本不得再裸调 schtasks /Delete');
assert.ok(/apply-update\.vbs/.test(updaterSource), 'applyUpdate 应落盘 VBS 无窗口启动器');
assert.ok(/buildUpdateTaskRunVbs/.test(updaterSource), '计划任务 /TR 应走 VBS 无闪现链路');

assert.ok(/--max-time/.test(updaterSource), 'curl 兜底应带 --max-time 总超时');
assert.ok(/setTimeout\(r, 150\)/.test(updaterSource), '下载进度轮询应 150ms 采样，快网小包才有中间态');
assert.ok(!/progress: 0\.99/.test(updaterSource), 'zip 完成后不得回退到 0.99');
assert.ok(/data-progress-pct/.test(settingsSource), '进度文案应可原地更新');
assert.ok(/existingFill\.style\.width/.test(settingsSource), '进度条应原地改宽度以复用 CSS 过渡，而非 innerHTML 重建');
assert.ok(/cancelDownload/.test(updaterSource), 'updater 应支持取消下载');
assert.ok(/if \(!expected\) throw/.test(updaterSource), 'SHA-256 取不到期望哈希时必须直接失败');
assert.ok(/r\.stdErr/.test(updaterSource) && !/r\.stderr/.test(updaterSource), '应使用 stdErr 字段取进程错误输出');
assert.ok(/\/TR '\$\{buildUpdateTaskRunVbs\(launcherPath\)\}'/.test(updaterSource), '计划任务 /TR 应整体加引号并走 VBS 无闪现链路');
assert.ok(/runResult\.exitCode/.test(updaterSource), 'schtasks /Run 结果必须检查');
assert.ok(/DefaultCredentials/.test(updaterSource), '更新请求应携带系统代理默认凭证，避免 407');
assert.ok(/IsBypassed/.test(updaterSource), '更新请求应判断代理旁路，直连地址不走代理');
assert.ok(/GetProxy/.test(updaterSource), 'curl 兜底应解析系统代理地址后显式传入');
assert.ok(/--proxy/.test(updaterSource), 'curl 兜底应带 --proxy 参数');
assert.ok(/Tls13/.test(updaterSource), 'TLS 应兼容 Tls13，避免写死 Tls12');
assert.ok(/buildFetchCurlPs/.test(updaterSource), '检查阶段应有 curl 兜底（fetchJson 双路）');
assert.ok(/407/.test(updaterSource), '代理 407 应有独立提示分支');
assert.ok(/check-web\.ps1/.test(updaterSource), '检查脚本应落盘后 -File 执行，避免内联 -Command 被 cmd 改写');
assert.ok(/update-check\.log/.test(updaterSource), '检查/下载各阶段应写诊断日志');
assert.ok(/-WindowStyle Hidden/.test(updaterSource), '更新链路 PowerShell 启动必须隐藏窗口，避免弹出黑框');
assert.ok(/execThrow/.test(updaterSource), 'exec 启动失败应转为可诊断错误');
assert.ok(/File\]::Open\(\$exePath/.test(updaterSource), '替换脚本应等待主进程退出');
assert.ok(/pending\.version/.test(updaterSource), '启动自检应用版本比对判定成败');
assert.ok(/btn-cancel-update/.test(settingsSource), '设置页应提供取消下载按钮');

/* 系统代理构造器：单引号转义、TLS 兼容、代理装配、curl 显式代理、诊断截断 */
{
  assert.equal(psQuote("C:\\Temp\\O'Brien\\x"), "'C:\\Temp\\O''Brien\\x'");
  assert.ok(buildTlsPs().includes('Tls12') && buildTlsPs().includes('Tls13'), 'TLS 片段应同时覆盖 Tls12 与 Tls13');
  const assign = buildProxyAssignPs('$target', '$req');
  assert.ok(assign.includes('IsBypassed($target)') && assign.includes('DefaultCredentials'), '代理装配应先判旁路再挂默认凭证');
  const curlProxy = buildCurlProxyPs('$target');
  assert.ok(curlProxy.includes('--proxy') && curlProxy.includes('--noproxy'), 'curl 代理片段应同时处理走代理与旁路直连');
  const webPs = buildFetchWebRequestPs('https://api.github.com/x', 'C:\\Temp\\a.json', 'C:\\Temp\\a.err.txt');
  assert.ok(webPs.includes('TODO-Tools-Updater') && webPs.includes('IsBypassed'), '检查第一路应带 UA 并走系统代理');
  const curlPs = buildFetchCurlPs('https://api.github.com/x', 'C:\\Temp\\a.json', 'C:\\Temp\\a.code', 'C:\\Temp\\a.log');
  assert.ok(curlPs.includes('--proxy') && curlPs.includes('--max-time 30') && curlPs.includes('TODO-Tools-Updater'), '检查第二路 curl 应显式代理、带总超时与 UA');
  const dlCurl = buildDownloadCurlPs('https://example.com/p.zip', 'C:\\Temp\\p.zip', 'C:\\Temp\\p.log');
  assert.ok(dlCurl.includes('--proxy') && dlCurl.includes('--max-time 300'), '下载 curl 兜底应显式代理并带总超时');
  const dlWeb = buildDownloadWebRequestPs('https://example.com/p.zip', 'C:\\Temp\\p.zip');
  assert.ok(dlWeb.includes('IsBypassed') && dlWeb.includes('DefaultCredentials'), '下载第一路应走系统代理');
  assert.equal(sanitizeNetDetail('  a\n b  '), 'a b');
  assert.equal(sanitizeNetDetail(''), '');
  assert.ok(sanitizeNetDetail('x'.repeat(200)).length <= 161, '诊断摘要应截断');
}

/* 检查阶段 curl 兜底：第一路 exit 1（网络失败）→ 第二路成功应回到 available */
{
  const fsMem = new Map();
  const dirSet = new Set();
  const base = 'C:\\Temp\\todo-tools-update';
  const JSON_KEY = `${base}\\latest-release.json`;
  let calls = 0;
  globalThis.NL_PORT = 45678;
  globalThis.Neutralino = {
    app: { getConfig: async () => ({ version: '1.2.2' }) },
    os: {
      getPath: async () => 'C:\\Temp',
      execCommand: async (cmd) => {
        calls += 1;
        /* 第二路为 check-curl.ps1，第一路为 check-web.ps1（-File 模式下命令中不再含 URL/UA） */
        if (cmd.includes('check-curl.ps1')) {
          fsMem.set(JSON_KEY, JSON.stringify({ tag_name: 'v9.9.9', body: 'notes', assets: [] }));
          return { exitCode: 0, stdOut: '', stdErr: '' };
        }
        if (cmd.includes('check-web.ps1')) {
          fsMem.set(`${base}\\latest-release.err.txt`, 'connection timed out');
        }
        return { exitCode: 1, stdOut: '', stdErr: '' };
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
  const fallbackUpdater = createUpdater({ showToast: () => {} });
  await fallbackUpdater.checkForUpdates();
  assert.equal(fallbackUpdater.getState().phase, 'available');
  assert.equal(fallbackUpdater.getState().version, '9.9.9');
  assert.ok(calls >= 3, '第一路应重试一次后才走 curl 兜底');
  const checkLog = fsMem.get(`${base}\\update-check.log`) || '';
  assert.ok(/check-web exit=1/.test(checkLog) && /check-curl exit=0/.test(checkLog), '诊断日志应记录两路阶段结果');

/* .NET WriteAllText 默认带 BOM：JSON 解析前必须剥离，否则 exit=0 也会报解析失败 */
{
  const fsMem = new Map();
  const dirSet = new Set();
  const base = 'C:\\Temp\\todo-tools-update';
  const JSON_KEY = `${base}\\latest-release.json`;
  globalThis.NL_PORT = 45678;
  globalThis.Neutralino = {
    app: { getConfig: async () => ({ version: '1.2.2' }) },
    os: {
      getPath: async () => 'C:\\Temp',
      execCommand: async () => {
        fsMem.set(JSON_KEY, '\uFEFF' + JSON.stringify({ tag_name: 'v9.9.9', body: 'notes', assets: [] }));
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
  const bomUpdater = createUpdater({ showToast: () => {} });
  await bomUpdater.checkForUpdates();
  assert.equal(bomUpdater.getState().phase, 'available');
  assert.equal(bomUpdater.getState().version, '9.9.9');
  delete globalThis.Neutralino;
  delete globalThis.NL_PORT;
}

/* exit=0 但 JSON 不可读：应记 Wjson 并降级走 curl，而不是抛秃错 */
{
  const fsMem = new Map();
  const dirSet = new Set();
  const base = 'C:\\Temp\\todo-tools-update';
  const JSON_KEY = `${base}\\latest-release.json`;
  globalThis.NL_PORT = 45678;
  globalThis.Neutralino = {
    app: { getConfig: async () => ({ version: '1.2.2' }) },
    os: {
      getPath: async () => 'C:\\Temp',
      execCommand: async (cmd) => {
        if (cmd.includes('check-curl.ps1')) {
          fsMem.set(JSON_KEY, JSON.stringify({ tag_name: 'v9.9.9', body: 'notes', assets: [] }));
          return { exitCode: 0, stdOut: '', stdErr: '' };
        }
        fsMem.set(JSON_KEY, 'not-json{{{');
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
  const jsonFallbackUpdater = createUpdater({ showToast: () => {} });
  await jsonFallbackUpdater.checkForUpdates();
  assert.equal(jsonFallbackUpdater.getState().phase, 'available');
  const jsonLog = fsMem.get(`${base}\\update-check.log`) || '';
  assert.ok(/json bad/.test(jsonLog), '坏 JSON 应记入诊断日志');
  delete globalThis.Neutralino;
  delete globalThis.NL_PORT;
}
  delete globalThis.Neutralino;
  delete globalThis.NL_PORT;
}

/* 检查失败分支：407 独立提示、纯网络失败携带诊断细节 */
{
  const dirSet = new Set();
  const mkFs = (mem) => ({
    createDirectory: async (p) => {
      if (dirSet.has(p)) throw new Error('exists');
      dirSet.add(p);
    },
    getStats: async (p) => {
      if (mem.has(p)) return { size: String(mem.get(p)).length };
      if (dirSet.has(p)) return { size: 0 };
      throw new Error('missing');
    },
    readFile: async (p) => {
      if (mem.has(p)) return mem.get(p);
      throw new Error('missing');
    },
    writeFile: async (p, content) => { mem.set(p, content); },
    remove: async (p) => { mem.delete(p); }
  });
  globalThis.NL_PORT = 45678;
  globalThis.Neutralino = {
    app: { getConfig: async () => ({ version: '1.2.2' }) },
    os: {
      getPath: async () => 'C:\\Temp',
      execCommand: async () => ({ exitCode: 407, stdOut: '', stdErr: '' })
    },
    filesystem: mkFs(new Map())
  };
  const authUpdater = createUpdater({ showToast: () => {} });
  await authUpdater.checkForUpdates();
  assert.equal(authUpdater.getState().phase, 'failed');
  assert.ok(/407/.test(resolveUpdaterStateText(authUpdater.getState())), '407 应提示代理认证');
  const errMem = new Map();
  globalThis.Neutralino.os.execCommand = async (cmd) => {
    /* 模拟 PowerShell 首错落盘：fetchJson 启动时会先清临时文件，此处在失败时写回 */
    if (cmd.includes('check-web.ps1')) {
      errMem.set('C:\\Temp\\todo-tools-update\\latest-release.err.txt', 'proxy connect failed');
    }
    return { exitCode: 1, stdOut: '', stdErr: '' };
  };
  globalThis.Neutralino.filesystem = mkFs(errMem);
  const netUpdater = createUpdater({ showToast: () => {} });
  await netUpdater.checkForUpdates();
  assert.equal(netUpdater.getState().phase, 'failed');
  assert.ok(/网络连接异常/.test(resolveUpdaterStateText(netUpdater.getState())), '纯网络失败应报网络连接异常');
  assert.ok(/proxy connect failed/.test(resolveUpdaterStateText(netUpdater.getState())), '网络失败文案应携带诊断细节');
  /* 同一失败状态在切换语言后应能渲染出另一种语言，而不是缓存发射时的旧文案 */
  setI18nLanguage('en');
  assert.ok(/network error/i.test(resolveUpdaterStateText(netUpdater.getState())), '更新失败文案应随语言切换重新翻译');
  setI18nLanguage('zh');
  assert.ok(/网络连接异常/.test(resolveUpdaterStateText(netUpdater.getState())), '切回中文后文案应恢复');
  delete globalThis.Neutralino;
  delete globalThis.NL_PORT;
}

/* 替换前自保：目标目录归一化、写权限预检、pending 往返校验、脚本内路径日志与新文件预检 */
{
  assert.equal(normalizeTargetDir('E:/all/Tools/todo-tools'), 'E:\\all\\Tools\\todo-tools');
  assert.equal(normalizeTargetDir('E:\\all\\Tools\\todo-tools\\'), 'E:\\all\\Tools\\todo-tools');
  assert.equal(normalizeTargetDir('E:\\'), 'E:\\');
  assert.equal(normalizeTargetDir(''), '');
  assert.ok(/normalizeTargetDir/.test(updaterSource), 'applyUpdate 应归一化 NL_PATH 再使用');
  assert.ok(/无写入权限/.test(updaterSource), '目标目录不可写应提前明确报错');
  assert.ok(/路径校验失败/.test(updaterSource), 'pending 往返不一致必须拦截调度');
  assert.ok(/Log \('targetDir='/.test(updaterSource), '替换脚本应记录解析后的目标目录');
  assert.ok(/更新包缺失/.test(updaterSource), '替换脚本应预检新文件存在');
  /* OS 命名 Mutex 单实例：Local\ 会话命名空间，名称消毒收敛；
   * 探测三态映射、持有者原子仲裁（createdNew 输家 exit 42）均为纯函数 */
  assert.equal(SINGLE_INSTANCE_MUTEX, 'Local\\TODO-Tools-SingleInstance-app.todotools');
  assert.equal(buildMutexName('app.todotools'), SINGLE_INSTANCE_MUTEX);
  assert.equal(buildMutexName(''), SINGLE_INSTANCE_MUTEX);
  assert.ok(/^Local\\TODO-Tools-SingleInstance-[A-Za-z0-9._-]+$/.test(buildMutexName('a/b c中文')), 'Mutex 名非法字符应收敛');
  assert.ok(buildMutexName('x'.repeat(100)).length <= 'Local\\TODO-Tools-SingleInstance-'.length + 64, 'Mutex 名超长应截断');
  assert.equal(HOLDER_LOST_EXIT_CODE, 42);
  assert.equal(decideProbe(0), 'exists');
  assert.equal(decideProbe(10), 'absent');
  assert.equal(decideProbe(1), 'unknown');
  assert.equal(decideProbe(undefined), 'unknown');
  const probePs = buildProbePs(SINGLE_INSTANCE_MUTEX);
  assert.ok(/OpenExisting/.test(probePs) && /exit 10/.test(probePs), '探测脚本应区分存在/不存在退出码');
  const holderPs = buildHolderPs(SINGLE_INSTANCE_MUTEX);
  assert.ok(/createdNew/.test(holderPs) && /exit 42/.test(holderPs), '持有者脚本应以 createdNew 原子仲裁，输家 exit 42');
  const mainSource = readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  assert.ok(/from '\.\/singleInstance\.js'/.test(mainSource) && /acquireSingleInstance/.test(mainSource), '单实例仲裁应由 singleInstance.js 统一提供，main.js 不得自立副本');
  assert.ok(!/INSTANCE_LOCK_DIR|createLockDirectory|LOCK_HEARTBEAT_MS|LOCK_STALE_MS/.test(mainSource), '文件锁心跳逻辑应已彻底删除');
  assert.ok(/releaseSingleInstance/.test(updaterSource), 'applyUpdate 退出前应释放单实例 Mutex，避免新版本误判重复实例静默退出');
}

/* applyUpdate 全链路：就绪态 → 写 pending/脚本 → 注册任务 → 退出；
 * 写坏 pending（模拟分隔符损坏）或目录不可写时，必须在调度任务前失败 */
{
  const base = 'C:\\Temp\\todo-tools-update';
  const JSON_KEY = `${base}\\latest-release.json`;
  const ZIP_KEY = `${base}\\todo-tools-win_x64.zip`;
  const SHA_KEY = `${base}\\todo-tools-win_x64.zip.sha256`;
  const APP_EXE = 'C:\\App\\todo-tools-win_x64.exe';
  const setup = (fsMem, { corruptPending = false, denyAppWrite = false } = {}) => {
    const dirSet = new Set();
    const cmds = [];
    const releasedIds = [];
    let exited = false;
    globalThis.NL_PORT = 45678;
    globalThis.window = { NL_PATH: 'C:\\App' };
    globalThis.Neutralino = {
      app: {
        getConfig: async () => ({ version: '1.2.2' }),
        exit: async () => { exited = true; }
      },
      os: {
        getPath: async () => 'C:\\Temp',
        execCommand: async (cmd) => {
          cmds.push(cmd);
          if (cmd.includes('-EncodedCommand')) {
            /* 单实例探测走 -EncodedCommand：解码后含 OpenExisting 即按 absent（exit 10）
             * 处理，走原子抢占分支；更新器自身的 schtasks 命令不含该标记，不受影响 */
            let decoded = '';
            try { decoded = Buffer.from(cmd.trim().split(' ').pop(), 'base64').toString('utf16le'); } catch {}
            if (decoded.includes('OpenExisting')) return { exitCode: 10, stdOut: '', stdErr: '' };
          }
          if (cmd.includes('check-web.ps1')) {
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
          if (cmd.includes('dl-zip-web.ps1')) {
            fsMem.set(ZIP_KEY, 'ZIPBYTES');
            return { exitCode: 0, stdOut: '', stdErr: '' };
          }
          if (cmd.includes('dl-sha-web.ps1')) {
            fsMem.set(SHA_KEY, createHash('sha256').update('ZIPBYTES').digest('hex'));
            return { exitCode: 0, stdOut: '', stdErr: '' };
          }
          if (cmd.includes('Expand-Archive')) {
            fsMem.set(`${base}\\extracted\\todo-tools-win_x64.exe`, 'EXE');
            fsMem.set(`${base}\\extracted\\resources.neu`, 'RES');
          }
          return { exitCode: 0, stdOut: '', stdErr: '' };
        },
        spawnProcess: async (cmd) => {
          cmds.push(cmd);
          return { id: 7, pid: 1234 };
        },
        updateSpawnedProcess: async (id, action) => {
          releasedIds.push({ id, action });
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
          if (p === APP_EXE || p.indexOf('C:\\App\\') === 0) return { size: 1 };
          throw new Error('missing');
        },
        readFile: async (p) => {
          if (fsMem.has(p)) return fsMem.get(p);
          throw new Error('missing');
        },
        readBinaryFile: async (p) => new TextEncoder().encode(fsMem.get(p) ?? ''),
        writeFile: async (p, content) => {
          if (denyAppWrite && p.indexOf('C:\\App\\') === 0) throw new Error('Access is denied');
          if (corruptPending && p === `${base}\\pending.json`) {
            fsMem.set(p, String(content).replace(/\\/g, ''));
            return;
          }
          fsMem.set(p, content);
        },
        remove: async (p) => { fsMem.delete(p); }
      }
    };
    return { cmds, wasExited: () => exited, releasedIds };
  };
  const teardown = () => {
    delete globalThis.Neutralino;
    delete globalThis.NL_PORT;
    delete globalThis.window;
  };
  /* 注册任务走 -EncodedCommand（base64），解码后断言，避免明文匹配误判 */
  const createdTasks = (cmds) => cmds
    .filter((c) => c.includes('-EncodedCommand'))
    .map((c) => Buffer.from(c.trim().split(' ').pop(), 'base64').toString('utf16le'))
    .filter((s) => s.includes('TODO-Tools-Update') && s.includes('/Create')).length;
  /* 正常路径：抢占 Mutex → 任务注册 → 释放 Mutex 持有者 → 退出，无失败 */
  {
    const fsMem = new Map();
    const { cmds, wasExited, releasedIds } = setup(fsMem);
    assert.equal((await acquireSingleInstance()).primary, true, '无实例占用时应抢占 Mutex 成功');
    const u = createUpdater({ showToast: () => {} });
    await u.checkForUpdates();
    assert.equal(u.getState().phase, 'available');
    await u.downloadAndPrepare();
    assert.equal(u.getState().phase, 'ready');
    await u.applyUpdate();
    assert.equal(createdTasks(cmds), 1, '应注册一次性计划任务');
    assert.deepEqual(releasedIds, [{ id: 7, action: 'exit' }], '退出前应释放单实例 Mutex 持有者，否则新版本误判重复实例静默退出');
    assert.equal(wasExited(), true);
    assert.equal(u.getState().phase, 'ready');
    assert.equal(u.getState().error || null, null);
    await releaseSingleInstance();
    teardown();
  }
  /* pending 被写坏：路径校验失败，不得调度任务、不得退出 */
  {
    const fsMem = new Map();
    const { cmds, wasExited } = setup(fsMem, { corruptPending: true });
    const u = createUpdater({ showToast: () => {} });
    await u.checkForUpdates();
    await u.downloadAndPrepare();
    await u.applyUpdate();
    assert.equal(u.getState().phase, 'failed');
    assert.ok(/路径校验失败/.test(resolveUpdaterStateText(u.getState())), '写坏 pending 应报路径校验失败');
    assert.equal(createdTasks(cmds), 0, '校验失败不得注册计划任务');
    assert.equal(wasExited(), false);
    teardown();
  }
  /* 目标目录不可写：明确提示提权，不得调度任务 */
  {
    const fsMem = new Map();
    const { cmds, wasExited } = setup(fsMem, { denyAppWrite: true });
    const u = createUpdater({ showToast: () => {} });
    await u.checkForUpdates();
    await u.downloadAndPrepare();
    await u.applyUpdate();
    assert.equal(u.getState().phase, 'failed');
    assert.ok(/无写入权限/.test(resolveUpdaterStateText(u.getState())), '不可写目录应提示提权');
    assert.equal(createdTasks(cmds), 0, '无权限不得注册计划任务');
    assert.equal(wasExited(), false);
    teardown();
  }
}

/* 下载进度：慢速下载中应采到 0<p<1 的中间值，而非 0→100 直跳 */
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
        if (cmd.includes('check-web.ps1')) {
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
        if (cmd.includes('dl-zip-web.ps1')) {
          /* 先写一半停 500ms，模拟慢速下载，给 150ms 轮询留采样窗口 */
          fsMem.set(ZIP_KEY, '1234');
          await new Promise(r => setTimeout(r, 500));
          fsMem.set(ZIP_KEY, 'ZIPBYTES');
          return { exitCode: 0, stdOut: '', stdErr: '' };
        }
        if (cmd.includes('dl-sha-web.ps1')) {
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
  const seen = [];
  const progressUpdater = createUpdater({ showToast: () => {} });
  const unsub = progressUpdater.onStatus((s) => {
    if (s.phase === 'downloading' && typeof s.progress === 'number') seen.push(s.progress);
  });
  await progressUpdater.checkForUpdates();
  await progressUpdater.downloadAndPrepare();
  unsub();
  assert.equal(progressUpdater.getState().phase, 'ready');
  assert.ok(seen.some((p) => p > 0 && p < 1), `应采到中间进度，实际序列: ${seen.join(',')}`);
  delete globalThis.Neutralino;
  delete globalThis.NL_PORT;
}

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
        if (cmd.includes('check-web.ps1')) {
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
        if (cmd.includes('.ps1')) {
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
        if (cmd.includes('check-web.ps1')) {
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
        if (cmd.includes('dl-zip-web.ps1')) {
          await new Promise(r => setTimeout(r, 100));
          fsMem.set(ZIP_KEY, 'ZIPBYTES');
          return { exitCode: 0, stdOut: '', stdErr: '' };
        }
        if (cmd.includes('dl-sha-web.ps1')) {
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

/* UI 一致性回归：CSS 变量、焦点、图标与主题硬编码 */
{
  const css = styleSource;
  const defs = new Set([...css.matchAll(/--([\w-]+)\s*:/g)].map(m => m[1]));
  // 无 fallback 的 var(--x) 必须在 CSS 内有定义；JS 内联写入的变量列入白名单（类级默认值兜底）
  const JS_SET_VARS = new Set(['tag-color', 'tag-color-rgb']);
  const bareUses = [...css.matchAll(/var\(--([\w-]+)\)/g)].map(m => m[1]);
  const undefinedBare = [...new Set(bareUses)].filter(v => !defs.has(v) && !JS_SET_VARS.has(v));
  assert.deepEqual(undefinedBare, [], `存在未定义的无 fallback CSS 变量: ${undefinedBare.join(', ')}`);
  // 已修复的错别字变量不得回退
  assert.ok(!/var\(--warning\)/.test(css), '应使用 var(--warning-text)，不得引用不存在的 var(--warning)');
  assert.ok(defs.has('text-disabled'), '应定义 --text-disabled');
  assert.ok(defs.has('glass-surface-soft'), '应定义 --glass-surface-soft');
  // 焦点：不使用紫色亮边框；日历日期必须保留可见焦点
  assert.ok(!/outline:\s*2px solid var\(--accent\)/.test(css), '焦点不得使用紫色亮边框 outline');
  assert.ok(/\.calendar-day:focus-visible\s*\{[^}]*border-color/.test(css), 'calendar-day:focus-visible 应通过边框表达焦点，不加外圈');
  assert.ok(!/^\s*:focus-visible\s*\{[^}]*box-shadow/m.test(css), '全局焦点不得加外圈显示');
  // 头部操作图标统一走图标库
  const htmlSource = readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.ok(!/<svg class="view-header-action-icon"/.test(htmlSource), '头部操作图标应使用 data-icon统一渲染，不得内联 SVG');
  assert.ok(/data-icon="search"/.test(htmlSource) && /data-icon="document"/.test(htmlSource), '搜索/AI总结按钮应使用 data-icon');
  // 标签徽章与菜单色点在无内联 style 时仍有默认值
  assert.ok(/\.todo-meta \.badge-tag[\s\S]*?--tag-color:\s*#6366f1/.test(css), 'badge-tag 应提供 --tag-color 默认值');
  assert.ok(/--menu-item-color,\s*var\(--accent\)/.test(css), 'menu-color-dot 应提供 --menu-item-color 回退');
  assert.ok(/repeat\(var\(--calendar-weeks,\s*53\)/.test(css), '年度热力图应提供 --calendar-weeks 回退');
  // 亮色主题：设置标签项与提醒徽章不得硬编码浅色/暖色
  assert.ok(!/\.settings-pane\[data-pane="tags"\][\s\S]{0,400}?rgba\(255,\s*255,\s*255,\s*0\.0[48]\)/.test(css), '设置标签项不得硬编码白色半透明背景');
  assert.ok(/\.badge-reminder\s*\{[^}]*var\(--warning-bg\)[^}]*var\(--warning-text\)/.test(css), 'badge-reminder 应使用 warning 主题变量');
  // 任务行操作按钮应为 flex 居中，保证图标对齐与触控尺寸
  assert.ok(/\.todo-actions button\s*\{[^}]*display:\s*inline-flex/.test(css), 'todo-actions button 应为 flex 居中');
  assert.ok(/\.summary-output\.is-streaming::after/.test(css), '流式光标应有样式定义');
  assert.ok(/@keyframes summaryCaret/.test(css), '流式光标应有闪烁关键帧');
  // 输入类聚焦：只允许背景 tint，不得出现 accent 边框或外圈（所有同名规则块逐一检查）
  const eachBlock = (sel) => {
    const bodies = [];
    let i = -1;
    while ((i = css.indexOf(sel, i + 1)) !== -1) {
      const open = css.indexOf('{', i);
      bodies.push(css.slice(open, css.indexOf('}', open)));
    }
    assert.ok(bodies.length > 0, `应存在规则 ${sel}`);
    return bodies;
  };
  [
    '.search-bar input:focus,',
    '.add-task-bar:focus-within',
    '.settings-tag-add-bar:focus-within',
    '.detail-select:focus-visible',
    '.glass-select .glass-select-trigger:focus-visible',
    '.dp-time-row select:focus,',
    '.settings-content-card .settings-row input:focus,',
  ].forEach((sel) => {
    eachBlock(sel).forEach((body) => {
      assert.ok(!body.includes('var(--accent)'), `${sel} 聚焦不得使用 accent 边框`);
      assert.ok(!body.includes('0 0 0 3px'), `${sel} 聚焦不得加外圈显示`);
    });
  });
}

/* 模式切换窗口矩形插值：端点、四舍五入、单调收缩、居中与 IPC 步数预算 */
{
  const from = { x: 390, y: 190, width: 1100, height: 700 };
  const to = { x: 1660, y: 20, width: 240, height: 288 };
  const start = rectAt(from, to, 0, 280);
  assert.deepEqual(start.rect, from);
  assert.equal(start.done, false);
  const end = rectAt(from, to, 280, 280);
  assert.deepEqual(end.rect, to);
  assert.equal(end.done, true);
  const over = rectAt(from, to, 9999, 280);
  assert.deepEqual(over.rect, to);
  assert.equal(over.done, true);
  /* 收缩过程宽高单调非增、坐标取整 */
  let prev = null;
  for (const t of [0, 40, 80, 120, 160, 200, 240]) {
    const cur = rectAt(from, to, t, 280).rect;
    assert.ok(Number.isInteger(cur.x) && Number.isInteger(cur.y));
    assert.ok(Number.isInteger(cur.width) && Number.isInteger(cur.height));
    if (prev) {
      assert.ok(cur.width <= prev.width && cur.height <= prev.height);
    }
    prev = cur;
  }
  assert.deepEqual(centerRect(1920, 1080, 1100, 700), { x: 410, y: 190, width: 1100, height: 700 });
  /* 采样间隔有界：60Hz 屏逐帧下发，高刷屏跳帧，IPC 频率封顶 */
  assert.equal(WINDOW_ANIM_MAX_HZ, 72);
  assert.equal(framesPerApply(60), 1);
  assert.equal(framesPerApply(120), 2);
  assert.equal(framesPerApply(144), 2);
  assert.equal(framesPerApply(0), 1);
  /* 280ms 动画下发次数：60Hz 屏约 18 次、144Hz 屏约 22 次 */
  const appliesAt = (hz) => Math.ceil((280 / (1000 / hz)) / framesPerApply(hz)) + 1;
  assert.ok(appliesAt(60) <= 20);
  assert.ok(appliesAt(144) <= 24);
  assert.equal(typeof animateWindowRect, 'function');
  assert.equal(typeof cancelWindowRectAnimation, 'function');
  assert.equal(typeof ensureDisplayHz, 'function');
  /* 内容交叉淡入淡出：过渡跟随全局动效，隐藏态用 opacity 表达 */
  assert.ok(/\.app\.mode-swap-out,\s*\.mini-panel\.mode-swap-out\s*\{[^}]*opacity:\s*0/.test(styleSource), '模式切换应提供 mode-swap-out 淡出态');
  assert.ok(/\.app,\s*\.mini-panel\s*\{[^}]*var\(--motion-panel\)/.test(styleSource), '模式切换过渡应跟随全局动效');
  /* 切换编排：窗口插值联动、显示器缓存、无硬等待 */
  const miniSource = readFileSync(path.join(__dirname, '../src/miniMode.js'), 'utf8');
  assert.ok(/animateWindowRect/.test(miniSource), 'miniMode.js 切换应使用窗口矩形插值动画');
  assert.ok(!/setTimeout\(r,\s*100\)/.test(miniSource), '退出切换不得再硬等待 100ms');
  assert.ok(/getPrimaryDisplay|cachedDisplay/.test(miniSource), '显示器几何应缓存复用而非每次串行获取');
  /* 切换编排：窗口动画期间内容保持隐藏（落定后淡入），避免边动画边淡入加重绘制 */
  assert.ok(!/const unveil = fadeInEl/.test(miniSource), '窗口动画期间内容应保持隐藏（落定后淡入），不得并发淡入');
  assert.ok(/await animateWindowRect\(\{[\s\S]{0,3000}?await fadeInEl/.test(miniSource), '应窗口动画完成后再淡入内容');
  /* 隐藏态必须带 visibility 跳过绘制，否则尺寸动画每帧重绘玻璃界面导致卡顿 */
  assert.ok(/\.app\.mode-swap-out,\s*\.mini-panel\.mode-swap-out\s*\{[^}]*visibility:\s*hidden/.test(styleSource), 'mode-swap-out 应含 visibility 跳过绘制');
  /* 退出迷你模式后标题栏按钮：改扩展样式必须带 SWP_FRAMECHANGED 强制窗框重绘，
     否则残留 TOOLWINDOW 形态（最小化/最大化按钮缺失）；恢复调用应先于尺寸动画 */
  assert.ok(/SetWindowPos/.test(miniSource), '任务栏样式切换后必须用 SetWindowPos 刷新窗框');
  assert.ok(/0x27/.test(miniSource), '窗框刷新必须带 SWP_FRAMECHANGED（0x27 = NOSIZE|NOMOVE|NOZORDER|FRAMECHANGED）');
}

/* 可访问性回归：焦点陷阱、键盘、读屏与窄窗口 */
{
  const focusSource = readFileSync(path.join(__dirname, '../src/utils/focus.js'), 'utf8');
  const aiSummarySource = readFileSync(path.join(__dirname, '../src/aiSummary.js'), 'utf8');
  const renderItemSource = readFileSync(path.join(__dirname, '../src/renderTodoItem.js'), 'utf8');
  assert.ok(/createFocusTrap/.test(focusSource), '应提供 createFocusTrap 通用焦点陷阱');
  assert.ok(/enableRovingTablist/.test(focusSource), '应提供 enableRovingTablist 页签方向键导航');
  assert.ok(/createFocusTrap/.test(detailSource), 'detail.js 应使用焦点陷阱');
  assert.ok(/createFocusTrap/.test(aiSummarySource), 'aiSummary.js 应使用焦点陷阱');
  assert.ok(/createFocusTrap/.test(settingsSource), 'settings.js 应使用焦点陷阱');
  assert.ok(/createFocusTrap|_releaseFocusTrap/.test(readFileSync(path.join(__dirname, '../src/overlay.js'), 'utf8')), 'overlay.js 应使用焦点陷阱并归还焦点');
  assert.ok(/dataset\.action = 'edit'/.test(renderItemSource) && /setAttribute\('role', 'button'\)/.test(renderItemSource) && /tabIndex = 0/.test(renderItemSource), '任务正文应可键盘聚焦并打开详情');
  assert.ok(/data-action="toggle".*data-action="edit"|data-action="edit"/.test(appSource), 'app.js 键盘处理应覆盖正文编辑行为');
  assert.ok(/aria-current/.test(appSource), '侧栏导航应同步 aria-current');
  assert.ok(/setAttribute\('role', 'status'\)/.test(appSource), 'toast 应带 role=status 供读屏播报');
  const htmlA11y = readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.ok(/aria-label="搜索任务"/.test(htmlA11y), '搜索框应有可访问名称');
  assert.ok(/role="dialog".*detail-panel|detail-panel.*role="dialog"/s.test(htmlA11y), '详情面板应为 dialog 语义');
  assert.ok(/aria-controls="settings-pane-/.test(settingsSource), '设置页签应有关联 aria-controls');
  assert.ok(/tabindex="-1"/.test(htmlA11y) || /tabIndex = -1/.test(appSource), '页签应使用 roving tabindex');
  assert.ok(/aria-busy/.test(aiSummarySource), 'AI 输出区应标记 aria-busy，播报走独立状态区');
  assert.ok(/summary-live-status|summaryLiveStatus/.test(aiSummarySource), 'AI 应有独立 polite 状态区，避免流式刷屏');
  assert.ok(/\.sr-only\s*\{/.test(styleSource), '应提供 .sr-only 供读屏专用文本');
  assert.ok(/\.settings-tabs\s*\{[^}]*overflow-x:\s*auto/.test(styleSource), '设置页签窄窗下应可横向滚动');
  assert.ok(/max-height:\s*560px/.test(styleSource), '矮屏应有日历图表让空间规则');
  assert.ok(/prefers-reduced-motion:\s*reduce[\s\S]{0,500}?\*\s*,/.test(styleSource), '应有系统级减少动态全局兜底');
}

/* 其余动效收敛：transition/animation 声明不得含硬编码时长（涟漪按压物理时长、
   loading 无限循环、visibility 延迟除外），全部跟随全局动效设置 */
{
  const decls = [...styleSource.matchAll(/(?:transition|animation)\s*:[^;]+;/g)].map(m => m[0]);
  const hardcoded = decls.filter(d => {
    if (/glassRipple/.test(d) || /infinite/.test(d)) return false;
    const t = d.replace(/var\([^)]*\)/g, '').replace(/\b0s\b/g, '').replace(/\b0\.01ms\b/g, '');
    return /\d+(\.\d+)?(ms|s)\b/.test(t);
  }).map(d => d.replace(/\s+/g, ' ').slice(0, 100));
  assert.deepEqual(hardcoded, [], `存在硬编码动效时长: ${hardcoded.join(' | ')}`);
  /* JS 侧兜底超时与 WAAPI 时长必须跟随全局动效，不得写死 */
  assert.ok(!/setTimeout\((commitOnce|removeOnce),\s*260\)/.test(appSource), '完成/删除动画兜底超时应跟随全局动效');
  const snapSource = readFileSync(path.join(__dirname, '../src/miniSnap.js'), 'utf8');
  assert.ok(/panelSlideDurationMs/.test(snapSource), '贴边收起动画时长应跟随全局动效');
}

/* 数据导出：快照形状（剔除 _index / apiKey 策略）、Markdown 清单、双运行时落盘 */
{
  const { zh: dictZh } = await import('../src/i18n/zh.js');
  const { en: dictEn } = await import('../src/i18n/en.js');
  assert.deepEqual(EXPORT_FORMATS, ['json', 'markdown'], '导出格式应固定为 JSON 与 Markdown');
  assert.equal(EXPORT_SCHEMA_VERSION, 1, '导出快照应带版本标记');

  const sampleData = {
    todos: [
      { id: 'a', title: '写周报', desc: '多行\n备注', priority: 'high', tag: '计划内', startTime: '2026-09-30T09:00', endTime: null, done: false, archived: false, doneAt: null, createdAt: 1750000000000 },
      { id: 'b', title: '修 bug', desc: '', priority: 'none', tag: '', startTime: null, endTime: null, done: true, archived: false, doneAt: '2026-09-29T18:00:00.000Z', createdAt: 1750000000000 },
      { id: 'c', title: '旧任务', desc: '', priority: 'low', tag: '归档', startTime: null, endTime: null, done: false, archived: true, archivedAt: '2026-08-01T10:00:00.000Z', createdAt: 1750000000000 }
    ],
    tags: ['计划内', '归档'],
    aiConfig: { apiUrl: 'https://api.example.com/v1', apiKey: 'sk-secret-value', model: 'gpt-4o-mini', customPrompt: '' },
    theme: 'auto',
    language: 'zh',
    _index: { counts: { todo: 9 }, tagTotal: { 计划内: 9 } }
  };

  /* 默认剔除 apiKey：导出文件会明文落盘，密钥不应被顺手带出 */
  const payload = buildExportPayload(sampleData);
  assert.ok(!('_index' in payload), '_index 是纯运行时数据，不得出现在导出文件');
  assert.equal(payload.aiConfig.apiKey, '', '默认导出应剔除 apiKey');
  assert.equal(payload.aiConfig.apiUrl, 'https://api.example.com/v1', 'AI 其余字段应保留');
  assert.equal(payload.aiConfig.model, 'gpt-4o-mini', 'AI 模型应保留');
  assert.deepEqual(payload.todos, sampleData.todos, '任务列表应原样导出');
  assert.deepEqual(payload.tags, sampleData.tags, '标签应原样导出');
  assert.equal(payload.theme, 'auto', '界面偏好应一并导出');
  assert.ok('_index' in sampleData && sampleData._index, 'buildExportPayload 不得就地删除源数据的 _index');
  assert.equal(sampleData.aiConfig.apiKey, 'sk-secret-value', 'buildExportPayload 不得就地清空源数据的 apiKey');
  assert.notEqual(payload.aiConfig, sampleData.aiConfig, 'aiConfig 应深拷贝，避免导出污染运行态');

  const withKey = buildExportPayload(sampleData, { includeApiKey: true });
  assert.equal(withKey.aiConfig.apiKey, 'sk-secret-value', '显式勾选后应包含 apiKey');
  assert.ok(!('_index' in withKey), '勾选 apiKey 时同样不得带出 _index');

  /* 损坏/异常数据不得抛裸错，也不得产出非法结构 */
  const sparse = buildExportPayload({ todos: 'not-an-array', tags: null, aiConfig: null });
  assert.deepEqual(sparse.todos, [], 'todos 非数组时应回落为空数组');
  assert.deepEqual(sparse.tags, [], 'tags 非数组时应回落为空数组');
  assert.deepEqual(sparse.aiConfig, { apiKey: '' }, 'aiConfig 缺失时应补默认并剔除密钥');
  assert.throws(() => buildExportPayload(null), TypeError, 'buildExportPayload 应对非对象抛错');
  assert.throws(() => buildExportPayload('nope'), TypeError, 'buildExportPayload 应对字符串抛错');
  assert.throws(() => buildMarkdownExport(undefined), TypeError, 'buildMarkdownExport 应对非对象抛错');

  /* 文件名用本地时间戳，避免 UTC 偏移串到别的一天 */
  const stampNow = new Date(2026, 8, 30, 15, 4);
  assert.equal(buildExportFileName('json', stampNow), 'todo-backup-20260930-1504.json', 'JSON 备份文件名应带本地时间戳');
  assert.equal(buildExportFileName('markdown', stampNow), 'todo-20260930-1504.md', 'Markdown 文件名应带本地时间戳');
  assert.throws(() => buildExportFileName('csv', stampNow), TypeError, '未知格式应抛错');

  /* Markdown 清单：本地化标题 + 三段分组 + 转义 */
  const md = buildMarkdownExport(sampleData, { now: stampNow });
  assert.ok(md.startsWith(`# ${dictZh['export.mdTitle']}`), 'Markdown 应以本地化标题开头');
  assert.ok(md.includes(`- ${dictZh['export.mdExportedAt']}: 2026-09-30T15:04`), 'Markdown 应记录本地导出时间');
  assert.ok(md.includes(`- ${dictZh['export.mdDone']}: 1`), 'Markdown 统计已完成数');
  assert.ok(md.includes(`- ${dictZh['export.mdTags']}: 计划内、归档`), 'Markdown 应列出标签并使用本地化分隔符');
  assert.ok(md.includes(`## ${dictZh['export.mdTodoSection']} (1)`), 'Markdown 应含待办分组及计数');
  assert.ok(md.includes(`## ${dictZh['export.mdDoneSection']} (1)`), 'Markdown 应含已完成分组及计数');
  assert.ok(md.includes(`## ${dictZh['export.mdArchivedSection']} (1)`), 'Markdown 应含已归档分组及计数');
  assert.ok(md.includes('写周报') && md.includes('修 bug') && md.includes('旧任务'), 'Markdown 应包含各任务标题');
  assert.ok(md.includes(dictZh['priority.high']), 'Markdown 应本地化优先级');
  /* 表头必须用「字段」级 key：detail.title 是面板标题（编辑任务），detail.desc 不存在 */
  const mdHeader = md.split('\n').find(l => l.startsWith('| | '));
  [dictZh['detail.fieldTitle'], dictZh['detail.priority'], dictZh['detail.tag'],
    dictZh['detail.startTime'], dictZh['detail.endTime'],
    dictZh['detail.createdTime'], dictZh['detail.doneTime'], dictZh['detail.fieldDesc']]
    .forEach((label) => assert.ok(mdHeader.includes(label), `Markdown 表头应含「${label}」`));
  assert.ok(!/detail\.[a-zA-Z]+/.test(md), 'Markdown 不得泄漏未命中的 i18n key（t() 会原样返回 key）');
  /* 创建/完成时间：createdAt 为 epoch 数字、doneAt 为 ISO 字符串，两种形态都要能落到本地时间 */
  const mdRows = md.split('\n').filter(l => l.startsWith('| ['));
  assert.equal(mdRows.length, 3, 'Markdown 应输出三行任务');
  assert.ok(mdHeader.split('|').length === mdRows[0].split('|').length, '表头与数据行列数必须一致');
  assert.equal(mdRows[0].split('|').length, 11, '应为勾选列 + 8 个字段列');
  const mdRowsByTitle = new Map(mdRows.map(row => [row.split('|')[2].trim(), row.split('|').map(c => c.trim())]));
  const createdCol = mdHeader.split('|').findIndex(c => c.includes(dictZh['detail.createdTime']));
  const doneCol = mdHeader.split('|').findIndex(c => c.includes(dictZh['detail.doneTime']));
  assert.ok(createdCol > 0 && doneCol > createdCol, '创建时间与完成时间列位置应在表头中就位');
  const todoRow = mdRowsByTitle.get('写周报');
  assert.equal(todoRow[createdCol], toLocalDatetime(new Date(1750000000000)), 'createdAt 应按 epoch 数字转为本地时间');
  assert.equal(todoRow[doneCol], dictZh['detail.unset'], '未完成任务的完成时间应为未设置');
  const doneRow = mdRowsByTitle.get('修 bug');
  assert.equal(doneRow[doneCol], toLocalDatetime(new Date('2026-09-29T18:00:00.000Z')), 'doneAt 应按 ISO 字符串转为本地时间');
  /* 缺失/非法时间不得输出 Invalid Date 或空单元格 */
  const mdSparse = buildMarkdownExport({
    todos: [
      { title: '无时间', createdAt: null, doneAt: null },
      { title: '坏时间', createdAt: 'not-a-date', doneAt: 'not-a-date' }
    ]
  }, { now: stampNow });
  mdSparse.split('\n').filter(l => l.startsWith('| [')).forEach((row) => {
    assert.ok(!/Invalid Date|undefined|NaN/.test(row), `非法时间不得泄漏到输出: ${row}`);
  });
  assert.ok(mdSparse.includes(dictZh['detail.unset']), '缺失时间应回落为未设置文案');
  assert.ok(md.includes('<br>'), 'Markdown 单元格内的换行应转成 <br>');
  assert.ok(!md.includes('sk-secret-value'), 'Markdown 不应输出任何凭据');
  const mdEmpty = buildMarkdownExport({ todos: [], tags: [] }, { now: stampNow });
  assert.ok(mdEmpty.includes(dictZh['export.mdEmpty']), '空数据应给出空态文案');

  /* 桌面端：os.showSaveDialog 在 nativeAllowList 内，取消不得写盘 */
  const desktopWrites = [];
  const saveDialogCalls = [];
  let saveDialogResult = 'C:\\Users\\test\\todo-backup-20260930-1504.json';
  globalThis.NL_PORT = 45699;
  globalThis.Neutralino = {
    os: { showSaveDialog: async (title, opts) => { saveDialogCalls.push({ title, opts }); return saveDialogResult; } },
    filesystem: { writeFile: async (p, content) => { desktopWrites.push({ path: p, content }); } }
  };
  const desktopOk = await exportData(sampleData, { format: 'json', now: stampNow, dialogTitle: '数据导出' });
  assert.equal(desktopOk.status, 'saved', '桌面端保存成功应返回 saved');
  assert.equal(desktopOk.path, 'C:\\Users\\test\\todo-backup-20260930-1504.json', '桌面端应回传保存路径供提示展示');
  assert.equal(desktopWrites.length, 1, '桌面端应写盘一次');
  assert.equal(desktopWrites[0].path, 'C:\\Users\\test\\todo-backup-20260930-1504.json', '应写入用户选定路径');
  /* 客户端签名为 showSaveDialog(title, options)：标题必须是独立首参，
   * 误传选项对象会让标题变成 "[object Object]" 且 defaultPath/filters 全部丢失 */
  assert.equal(saveDialogCalls[0].title, '数据导出', '保存对话框标题应作为第一个参数单独传入');
  assert.equal(typeof saveDialogCalls[0].title, 'string', '对话框标题必须是字符串，不能把选项对象当首参');
  assert.equal(saveDialogCalls[0].opts.defaultPath, 'todo-backup-20260930-1504.json', '保存对话框应预填导出文件名');
  assert.deepEqual(saveDialogCalls[0].opts.filters, [{ name: 'JSON', filter: ['json'] }], '保存对话框应按格式给出过滤器');
  const written = JSON.parse(desktopWrites[0].content);
  assert.equal(written.schemaVersion, EXPORT_SCHEMA_VERSION, '导出文件应带版本标记');
  assert.equal(written.exportedAt, '2026-09-30T15:04', '导出文件应记录本地导出时间');
  /* 备份必须可直接作为数据文件恢复：顶层即 todo_data 结构，而非嵌套 data 包装 */
  assert.ok(Array.isArray(written.todos), '导出文件顶层应为 todos 数组，可直接还原为数据文件');
  assert.ok(Array.isArray(written.tags), '导出文件顶层应为 tags 数组');
  assert.ok(!('data' in written), '导出文件不应嵌套 data 包装层，否则恢复会得到空数据');
  assert.ok(!('_index' in written), '落盘内容不得含 _index');
  assert.ok(written.aiConfig && typeof written.aiConfig === 'object', '导出文件应保留 aiConfig');
  assert.equal(written.aiConfig.apiKey, '', '落盘内容默认不含 apiKey');
  assert.equal(written.todos.length, 3, '落盘内容应含全部任务');
  assert.deepEqual(written.todos, sampleData.todos, '落盘任务应与运行态一致');
  assert.equal(written.theme, 'auto', '落盘内容应保留界面偏好');

  desktopWrites.length = 0;
  saveDialogResult = null;
  const desktopCancel = await exportData(sampleData, { format: 'markdown', now: stampNow });
  assert.equal(desktopCancel.status, 'cancelled', '用户取消保存对话框应返回 cancelled');
  assert.equal(desktopWrites.length, 0, '用户取消时不得写盘');

  /* 降级路径：运行时缺少 showSaveDialog 时写入「下载」目录，而不是让导出直接失败 */
  delete globalThis.Neutralino.os.showSaveDialog;
  const joinedPaths = [];
  globalThis.Neutralino.filesystem.getJoinedPath = async (base, name) => { joinedPaths.push([base, name]); return `${base}\\${name}`; };
  globalThis.Neutralino.os.getPath = async (kind) => { assert.equal(kind, 'download'); return 'C:\\Users\\test\\Downloads'; };
  const fallback = await exportData(sampleData, { format: 'json', now: stampNow });
  assert.equal(fallback.status, 'saved', '缺少保存对话框时仍应完成导出');
  assert.equal(fallback.path, 'C:\\Users\\test\\Downloads\\todo-backup-20260930-1504.json', '降级路径应写入下载目录并回传位置');
  assert.deepEqual(joinedPaths, [['C:\\Users\\test\\Downloads', 'todo-backup-20260930-1504.json']], '降级路径应拼接下载目录与文件名');
  assert.equal(desktopWrites.at(-1).path, 'C:\\Users\\test\\Downloads\\todo-backup-20260930-1504.json', '降级路径应真实写盘');

  delete globalThis.Neutralino;
  delete globalThis.NL_PORT;

  /* Web 端：Blob + 临时 a[download]，用完即 revoke */
  const savedAnchors = [];
  const createdBlobs = [];
  let revokedUrl = '';
  globalThis.Blob = class { constructor(parts, opts) { this.parts = parts; this.type = opts?.type; createdBlobs.push(this); } };
  globalThis.URL = { createObjectURL: () => 'blob:mock', revokeObjectURL: (u) => { revokedUrl = u; } };
  globalThis.document = {
    createElement: () => ({ click() { this.clicked = true; }, remove() {}, style: {} }),
    body: { appendChild: (node) => { node.clicked = false; savedAnchors.push(node); } }
  };
  const webOk = await exportData(sampleData, { format: 'markdown', now: stampNow });
  assert.equal(webOk.status, 'saved', 'Web 端应报告导出成功');
  assert.equal(webOk.path, undefined, 'Web 端无保存路径，提示不应带路径');
  assert.equal(webOk.fileName, 'todo-20260930-1504.md', 'Web 端应生成 Markdown 文件名');
  assert.equal(savedAnchors.length, 1, 'Web 端应创建一次下载链接');
  assert.equal(savedAnchors[0].download, 'todo-20260930-1504.md', '下载链接应带文件名');
  assert.ok(savedAnchors[0].clicked, '下载链接应被点击以触发保存');
  assert.equal(revokedUrl, 'blob:mock', '下载后应释放 object URL');
  assert.equal(createdBlobs.length, 1, 'Web 端应构造一次 Blob');
  assert.equal(createdBlobs[0].type, 'text/markdown;charset=utf-8', 'Markdown 下载应为 UTF-8 文本');
  assert.ok(!createdBlobs[0].parts[0].includes('sk-secret-value'), '下载内容不得夹带凭据');

  delete globalThis.Blob;
  delete globalThis.URL;
  delete globalThis.document;
  assert.ok(!('Blob' in globalThis) && !('document' in globalThis), '测试应清理浏览器全局桩');

  /* 非法数据：导出入口必须上抛，交由调用方提示而非静默产出空文件 */
  await assert.rejects(() => exportData(null, { format: 'json' }), TypeError, '导出非法数据应上抛');

  /* 接线：设置面板的导出卡片与绑定必须存在，且导出不写运行时索引 */
  assert.ok(/id="btn-export-data"/.test(settingsSource), '设置系统页签应提供导出按钮');
  assert.ok(/data-export-format="json"/.test(settingsSource) && /data-export-format="markdown"/.test(settingsSource), '应提供 JSON 与 Markdown 两种格式选择');
  assert.ok(/bindExportControls/.test(settingsSource), 'settings.js 应绑定导出控件');
  assert.ok(/updateExportControls/.test(settingsSource), 'settings.js 应回填导出控件状态（语言切换重建后保留选择）');
  assert.ok(/id="set-export-include-key"/.test(settingsSource) && /role="switch"/.test(settingsSource), '应提供 API Key 包含开关并使用 switch 语义');
  assert.ok(/aria-busy/.test(settingsSource), '导出按钮忙碌态应标记 aria-busy');
  const exportSection = /function bindExportControls\(overlay\) \{[\s\S]*?\n\}/.exec(settingsSource);
  assert.ok(exportSection, 'settings.js 应定义 bindExportControls');
  /* 去掉注释再判断，避免说明性文字里的 saveData() 字样造成误报 */
  const exportCodeOnly = exportSection[0].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/saveData\(\)/.test(exportCodeOnly), '导出为只读路径，不应调用 saveData()');
  /* dataExport.js 顶部已被本文件 import（全程无 DOM 全局），构建函数内也不得触碰 DOM */
  const exportModuleSource = readFileSync(path.join(__dirname, '../src/dataExport.js'), 'utf8');
  ['buildExportPayload', 'buildExportFileName', 'buildMarkdownExport'].forEach((fn) => {
    const body = new RegExp(`function ${fn}\\([\\s\\S]*?\\n\\}`).exec(exportModuleSource);
    assert.ok(body && !/\b(document|window|Blob|Neutralino)\b/.test(body[0]), `${fn} 应保持纯逻辑，不得触碰运行时全局`);
  });
  assert.ok(/'settings.exportData'/.test(settingsSource) || /t\('settings\.exportData'\)/.test(settingsSource), '导出按钮文案应走 i18n');
  assert.ok(/export-hint/.test(styleSource), '导出卡片应有明文风险提示样式');
  assert.ok(/\.export-format-opt\s*\{/.test(styleSource), '导出格式按钮应有样式');
  assert.ok(/\.export-format-opt\.active\s*\{/.test(styleSource), '导出格式按钮应有选中态样式');
  assert.ok(/export-format-opt/.test(readFileSync(path.join(__dirname, '../src/ripple.js'), 'utf8')), '导出格式按钮应纳入涟漪按压反馈');
  /* 导出不得携带凭据：明文 API Key 只在显式勾选时出现 */
  assert.equal(dictZh['settings.exportIncludeApiKey'], '包含 AI API Key', '中文文案应说明勾选后包含密钥');
  assert.equal(dictEn['settings.exportIncludeApiKey'], 'Include AI API Key', '英文文案应说明勾选后包含密钥');
}

/* 语言切换（i18n）：注册表驱动、归一化、字典完整性、切换入口与持久化 */
{
  const { normalizeLanguage, t: tr, getHtmlLang, getSupportedLanguages, DEFAULT_LANGUAGE, buildAiPrompt } = await import('../src/i18n/index.js');
  assert.equal(DEFAULT_LANGUAGE, 'zh');
  assert.equal(normalizeLanguage('zh-CN'), 'zh');
  assert.equal(normalizeLanguage('EN_us'), 'en');
  assert.equal(normalizeLanguage('xx'), 'zh');
  assert.equal(normalizeLanguage(''), 'zh');
  assert.equal(getHtmlLang('zh'), 'zh-CN');
  assert.equal(getHtmlLang('en'), 'en');
  assert.ok(getSupportedLanguages().length >= 2, '至少支持中英两种语言');
  assert.equal(tr('settings.title', {}, 'zh'), '设置');
  assert.equal(tr('settings.title', {}, 'en'), 'Settings');
  assert.equal(tr('list.countTasks', { count: 3 }, 'zh'), '3 个任务');
  assert.equal(tr('list.countTasks', { count: 3 }, 'en'), '3 tasks');
  assert.equal(tr('no.such.key', {}, 'en'), 'no.such.key');
  const { zh } = await import('../src/i18n/zh.js');
  const { en } = await import('../src/i18n/en.js');
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort(), '中英字典 key 集必须一致，新增语言照此扩展');
  const promptZh = buildAiPrompt({ summaryType: 'monthly', typeLabel: '月报', planLabel: '下月计划', rangeLabel: '9/1 ~ 9/30', doneList: '- 无', pendingList: '- 无' }, 'zh');
  const promptEn = buildAiPrompt({ summaryType: 'monthly', typeLabel: 'Monthly', planLabel: "Next month's plan", rangeLabel: '9/1 ~ 9/30', doneList: '- None', pendingList: '- None' }, 'en');
  assert.ok(/下月计划/.test(promptZh) && /简洁专业的中文/.test(promptZh), '中文 AI 模板应含计划标签与中文要求');
  assert.ok(/Next month/.test(promptEn) && /professional English/.test(promptEn), '英文 AI 模板应英文化');
  assert.ok(/data\.language/.test(appSource), 'app.js 应持久化 data.language 偏好');
  assert.ok(/normalizeLanguage/.test(appSource), 'app.js 应归一化 language 字段以兼容老数据');
  assert.ok(/setAppLanguage/.test(appSource), 'app.js 应提供 setAppLanguage 统一切换入口');
  assert.ok(/applyStaticTexts/.test(appSource), 'app.js 应提供静态壳翻译入口');
  assert.ok(/listViewCache\.key = ''/.test(appSource), '切换语言应失效列表缓存');
  assert.ok(/settings-lang-trigger|settings-lang-menu/.test(settingsSource), '设置头部应提供语言下拉（关闭按钮旁）');
  assert.ok(/settings-lang-option/.test(settingsSource), '语言下拉应提供可扩展的选项列表');
  assert.ok(/refreshSettingsLanguage|teardownPanelInstant/.test(settingsSource), '切换语言应重建已开设置面板以刷新静态文案（原地无动画重建）');
  /* 历史故障：面板只靠语言下拉点击回调里的一句 refreshSettingsLanguage() 重建，
   * 而该调用排在 applyLanguageFn() 之后；主应用切换链路（render/日历/弹窗收敛）中途抛错时
   * 整条语句被跳过，全局语言已变、设置窗口却停留在旧语言。
   * 修复：settings.js 订阅 onLanguageChange 自主重建，点击回调里的兜底调用放进 finally。 */
  assert.ok(/onLanguageChange\(\s*\(\)\s*=>\s*refreshSettingsLanguage\(\)\s*\)/.test(settingsSource), '设置面板应订阅语言变化事件自主重建，不依赖调用方回调');
  assert.ok(/finally\s*\{[\s\S]{0,400}?refreshSettingsLanguage\(\)/.test(settingsSource), '语言下拉切换的兜底重建应放在 finally 中，调用方抛错也要刷新面板');
  assert.ok(/panelLang === getLanguage\(\)/.test(settingsSource), '面板重建应按语言去重，避免事件与兜底重复重建丢焦点');
  assert.ok(!/系统通知不可用/.test(settingsSource), '设置面板不得硬编码中文通知状态文案，应走 i18n');
  /* 更新状态文案同样不能冻结在旧语言：updater 只记录 key/参数，由面板在渲染时翻译 */
  const updaterSourceI18n = readFileSync(path.join(__dirname, '../src/updater.js'), 'utf8');
  assert.ok(/errorKey: 'update\./.test(updaterSourceI18n) && /noticeKey: 'update\./.test(updaterSourceI18n), 'updater 应记录 i18n key 而非预翻译文案');
  assert.ok(!/启动更新失败：/.test(updaterSourceI18n), 'updater 不得硬编码中文失败文案，应走 i18n');
  assert.ok(/resolveUpdateText/.test(settingsSource), '设置面板应在渲染时按当前语言解析更新状态文案');
  assert.equal(tr('update.applyFailed', { msg: 'x' }, 'zh'), '启动更新失败：x');
  assert.equal(tr('update.applyFailed', { msg: 'x' }, 'en'), 'Failed to start the update: x');
  const calendarSourceI18n = readFileSync(path.join(__dirname, '../src/calendar.js'), 'utf8');
  assert.ok(!/WEEKDAY_NAMES = \['日'/.test(calendarSourceI18n), 'calendar.js 不得硬编码中文星期数组，应走 i18n');
  assert.ok(/getTrayMenuItems|onLanguageChange/.test(readFileSync(path.join(__dirname, '../src/main.js'), 'utf8')), '托盘菜单应随语言重建');
}

/* i18n 字面量守卫：源码中 t('a.b') / t(`a.b`) 的字面量必须在双字典中真实存在，
 * 否则 t() 会原样返回 key，界面直接显示 "detail.desc" 这类字符串。 */
{
  const { zh: dictZh2, en: dictEn2 } = { zh: (await import('../src/i18n/zh.js')).zh, en: (await import('../src/i18n/en.js')).en };
  const srcDir = path.join(__dirname, '../src');
  const missing = [];
  readdirSync(srcDir, { withFileTypes: true }).forEach((entry) => {
    if (!entry.isFile() || !entry.name.endsWith('.js')) return;
    const src = readFileSync(path.join(srcDir, entry.name), 'utf8')
      /* 排除动态拼接：t(`priority.${x}`) 之类无法静态校验 */
      .replace(/t\(\s*`[^`]*`\s*,?/g, ' ')
      .replace(/t\(\s*['"][^'"]*['"]\s*\+/g, ' t( ');
    [...src.matchAll(/\bt\(\s*['"]([a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z0-9]+)['"]/g)].forEach((m) => {
      const key = m[1];
      if (!(key in dictZh2)) missing.push(`${entry.name} zh 缺失 ${key}`);
      if (!(key in dictEn2)) missing.push(`${entry.name} en 缺失 ${key}`);
    });
  });
  assert.deepEqual(missing, [], `源码中的 i18n key 必须存在于中英字典: ${missing.join(' | ')}`);
}

/* i18n 回归：任务项渲染不得抛错。
 * 历史故障：createTodoItemEl/buildBadges 的形参命名为 t，遮蔽了 i18n 的 t() 翻译函数，
 * 列表渲染时抛 "t is not a function"，导致桌面端与 Web 端任务列表整体空白。
 * 这里用最小 DOM stub 真实调用一次渲染函数，并校验无障碍文案确实走了字典。 */
{
  const hadDocument = 'document' in globalThis;
  const previousDocument = globalThis.document;
  const previousElement = globalThis.Element;
  const previousLocalStorage = globalThis.localStorage;
  const previousWindow = globalThis.window;

  const createStubElement = (tag) => {
    const el = {
      tagName: String(tag).toUpperCase(),
      children: [],
      dataset: {},
      attrs: {},
      _text: '',
      className: '',
      get textContent() { return this._text; },
      set textContent(value) { this._text = String(value ?? ''); this.children = []; },
      setAttribute(key, value) { this.attrs[key] = String(value); },
      getAttribute(key) { return this.attrs[key] ?? null; },
      removeAttribute(key) { delete this.attrs[key]; },
      appendChild(child) { this.children.push(child); return child; },
      replaceChildren(...nodes) { this.children = nodes; },
      matches() { return false; },
      querySelectorAll() { return []; }
    };
    /* createIcon 依赖 <template>.innerHTML + content.firstElementChild，桩件直接返回图标节点 */
    if (el.tagName === 'TEMPLATE') {
      el._html = '';
      el.content = { firstElementChild: createStubElement('svg') };
      Object.defineProperty(el, 'innerHTML', {
        get() { return this._html; },
        set(value) { this._html = String(value); }
      });
    }
    return el;
  };

  globalThis.document = {
    documentElement: createStubElement('html'),
    createElement: createStubElement,
    createTextNode: (value) => ({ nodeValue: String(value) }),
    createDocumentFragment: () => createStubElement('#fragment'),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
  };
  globalThis.Element = class Element {};
  globalThis.localStorage = {
    store: new Map(),
    getItem(key) { return this.store.has(key) ? this.store.get(key) : null; },
    setItem(key, value) { this.store.set(key, String(value)); },
    removeItem(key) { this.store.delete(key); }
  };
  globalThis.window = { crypto: globalThis.crypto };

  try {
    const { createTodoItemEl } = await import('../src/renderTodoItem.js');
    const { zh: dictZh3, en: dictEn3 } = { zh: (await import('../src/i18n/zh.js')).zh, en: (await import('../src/i18n/en.js')).en };
    const sampleTodo = {
      id: 'render-check-1',
      title: '渲染回归用例',
      desc: 'desc',
      priority: 'high',
      tag: '回归',
      startTime: '2026-01-02',
      endTime: '2026-01-03',
      todo: true,
      important: true,
      done: false,
      doneAt: null,
      reminder: '2026-01-02T09:00',
      reminderRepeat: 'none',
      archived: false,
      archivedAt: null,
      createdAt: Date.now()
    };

    let rendered = null;
    assert.doesNotThrow(() => {
      rendered = createTodoItemEl(sampleTodo, { currentList: 'all', tags: ['回归'] });
    }, 'createTodoItemEl 不应抛错：形参遮蔽 i18n 的 t() 会让任务列表整体空白');
    assert.ok(rendered, 'createTodoItemEl 应返回任务项节点');
    assert.equal(rendered.children.length, 3, '任务项应包含勾选框、内容区和操作区');

    const [checkbox, body, actions] = rendered.children;
    assert.equal(checkbox.getAttribute('aria-label'), dictZh3['todo.markDone'], '勾选框 aria-label 应来自中文字典');
    assert.equal(body.getAttribute('aria-label'), dictZh3['todo.editTask'].replace('{title}', sampleTodo.title), '内容区 aria-label 应插值任务标题');
    assert.equal(actions.children[0].getAttribute('aria-label'), dictZh3['todo.unImportant'], '重要按钮 aria-label 应按当前状态切换');
    assert.equal(actions.children[1].getAttribute('aria-label'), dictZh3['todo.delete'], '删除按钮 aria-label 应来自字典');
    /* 徽标区同时含日期/起始日期/标签/优先级/TODO/提醒，验证 buildBadges 内部同样没有遮蔽翻译函数 */
    const badges = body.children[1];
    assert.ok(badges && badges.className === 'todo-meta', '应生成徽标区');
    assert.equal(badges.children.length, 6, '应渲染结束日期、起始日期、标签、优先级、TODO 和提醒共 6 个徽标');
    const reminderBadge = badges.children[5];
    assert.equal(reminderBadge.getAttribute('aria-label'), dictZh3['todo.reminderSet'], '提醒徽标 aria-label 应来自字典');
    assert.ok(checkbox.getAttribute('aria-label').length > 0, 'aria-label 不应为空');
    assert.ok(!/\btodo\.[a-zA-Z]/.test(checkbox.getAttribute('aria-label')), 'aria-label 不应回退成 i18n key');
    assert.ok(dictEn3['todo.markDone'] !== dictZh3['todo.markDone'], '中英字典应存在差异，便于校验翻译结果');
  } finally {
    if (hadDocument) globalThis.document = previousDocument;
    else delete globalThis.document;
    if (previousElement === undefined) delete globalThis.Element;
    else globalThis.Element = previousElement;
    if (previousLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousLocalStorage;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

/* i18n 回归：源码里不得再用 t 作为局部绑定后又调用 t()。
 * 只要某个作用域（形参 / const、let、var）声明了局部 t，作用域内的 t() 就不再是翻译函数。 */
{
  const srcRoot = path.join(__dirname, '../src');
  const listJsFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJsFiles(full);
    return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
  });

  /* 去掉注释、字符串与模板字面量，避免其中的括号干扰大括号配平 */
  const stripLiterals = (src) => {
    let out = '';
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      const next = src[i + 1];
      if (ch === '/' && next === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (ch === '/' && next === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
      if (ch === '"' || ch === "'") {
        i++;
        while (i < src.length) {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === ch) { i++; break; }
          i++;
        }
        out += '""';
        continue;
      }
      if (ch === '`') {
        i++;
        let depth = 0;
        while (i < src.length) {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '$' && src[i + 1] === '{') { depth++; i += 2; continue; }
          if (src[i] === '}' && depth > 0) { depth--; i++; continue; }
          if (src[i] === '`' && depth === 0) { i++; break; }
          if (src[i] === '\n' && depth === 0) break;
          i++;
        }
        out += '``';
        continue;
      }
      out += ch;
      i++;
    }
    return out;
  };

  const shadowedCalls = [];
  listJsFiles(srcRoot).forEach((file) => {
    const raw = readFileSync(file, 'utf8');
    if (!/import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*'[^']*i18n/.test(raw)) return;
    const code = stripLiterals(raw);
    const declRe = /(?:\(\s*t\s*(?:,|\))|,\s*t\s*\)\s*=>|=>\s*t\s*=>|\b(?:const|let|var)\s+t\s*=)/g;
    let match;
    while ((match = declRe.exec(code)) !== null) {
      const start = match.index;
      const open = code.indexOf('{', start);
      if (open === -1) continue;
      let depth = 0;
      let end = code.length;
      for (let i = open; i < code.length; i++) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (/(^|[^.\w$])t\s*\(/.test(code.slice(start, end))) {
        shadowedCalls.push(`${path.relative(srcRoot, file).replace(/\\/g, '/')}:${code.slice(0, start).split('\n').length}`);
      }
    }
  });
  assert.deepEqual(shadowedCalls, [], `局部 t 遮蔽了 i18n 翻译函数，调用 t() 会抛错: ${shadowedCalls.join(' | ')}`);
}

console.log('State checks passed');
