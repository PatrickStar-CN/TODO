import { zh } from './zh.js';
import { en } from './en.js';

export const SUPPORTED_LANGUAGES = [
  { code: 'zh', label: '中文', htmlLang: 'zh-CN' },
  { code: 'en', label: 'English', htmlLang: 'en' },
];

export const DEFAULT_LANGUAGE = 'zh';

const DICTS = { zh, en };

let currentLang = DEFAULT_LANGUAGE;
const listeners = new Set();

function canon(code) {
  const s = String(code || '').trim().replace(/_/g, '-').toLowerCase();
  if (!s) return '';
  if (s.startsWith('zh')) return 'zh';
  if (s.startsWith('en')) return 'en';
  const base = s.split('-')[0];
  if (DICTS[base]) return base;
  return '';
}

export function normalizeLanguage(v) {
  return canon(v) || DEFAULT_LANGUAGE;
}

export function getLanguage() {
  return currentLang;
}

export function getSupportedLanguages() {
  return SUPPORTED_LANGUAGES.slice();
}

export function getHtmlLang(code = currentLang) {
  const entry = SUPPORTED_LANGUAGES.find((l) => l.code === canon(code) || l.code === code);
  return entry ? entry.htmlLang : 'zh-CN';
}

export function t(key, params = {}, lang = currentLang) {
  const c = canon(lang) || currentLang;
  const dict = DICTS[c] || {};
  let text = dict[key];
  if (typeof text === 'undefined') text = (DICTS.en || {})[key];
  if (typeof text === 'undefined') text = (DICTS.zh || {})[key];
  if (typeof text === 'undefined') return key;
  if (!params || typeof params !== 'object') return text;
  return String(text).replace(/\{(\w+)\}/g, (m, name) => (
    params[name] === undefined || params[name] === null ? m : String(params[name])
  ));
}

export function getDictKeys() {
  return Object.keys(DICTS.zh || {}).sort();
}

export function getMissingKeys() {
  const base = getDictKeys();
  const missing = {};
  for (const code of Object.keys(DICTS)) {
    if (code === 'zh') continue;
    missing[code] = base.filter((k) => typeof DICTS[code][k] === 'undefined');
  }
  return missing;
}

export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setLanguage(code, opts = {}) {
  const next = normalizeLanguage(code);
  const changed = next !== currentLang;
  currentLang = next;
  try {
    document.documentElement.lang = getHtmlLang(next);
  } catch { /* non-DOM (tests) */ }
  if (changed || opts.force) listeners.forEach((fn) => {
    try { fn(next); } catch { /* ignore */ }
  });
  return next;
}

export function applyLanguage(code) {
  return setLanguage(code, { force: true });
}

export function getWeekdayName(day, lang = currentLang) {
  return t(`weekday.${day}`, {}, lang);
}

export function formatTodayDate(date, lang = currentLang) {
  return t('app.todayDate', {
    month: date.getMonth() + 1,
    day: date.getDate(),
    weekday: getWeekdayName(date.getDay(), lang),
  }, lang);
}

export function formatCalendarTitle(year, month, lang = currentLang) {
  return t('calendar.monthTitle', { year, month: month + 1 }, lang);
}

export function formatYearTitle(year, lang = currentLang) {
  return t('calendar.yearTitle', { year }, lang);
}

export function formatDayActivity(month, day, count, lang = currentLang) {
  return t('calendar.dayActivity', { month, day, count }, lang);
}

export function getPriorityLabel(value, lang = currentLang) {
  return t(`priority.${value || 'none'}`, {}, lang);
}

export function getRepeatLabel(value, lang = currentLang) {
  return t(`repeat.${value || 'none'}`, {}, lang);
}

export function getAiTypeLabels(summaryType, lang = currentLang) {
  const typeLabel = t(summaryType === 'daily' ? 'ai.daily' : summaryType === 'monthly' ? 'ai.monthly' : 'ai.weekly', {}, lang);
  const planLabel = t(summaryType === 'daily' ? 'ai.planDaily' : summaryType === 'monthly' ? 'ai.planMonthly' : 'ai.planWeekly', {}, lang);
  return { typeLabel, planLabel };
}

export function buildAiPrompt({ summaryType, typeLabel, planLabel, rangeLabel, doneList, pendingList }, lang = currentLang) {
  const c = canon(lang) || currentLang;
  const wordLimit = summaryType === 'daily' ? '300' : summaryType === 'monthly' ? '800' : '500';
  if (c === 'en') {
    return `You are a professional project-management assistant who writes concise, well-structured work reports.

Generate a high-quality ${typeLabel} from the task data below.

## Basics
- Report type: ${typeLabel}
- Date range: ${rangeLabel}

## Task data

### Completed tasks
${doneList}

### In-progress / pending tasks
${pendingList}

## Output format

Follow this Markdown structure strictly:

### ${typeLabel} · ${rangeLabel}

**1. Overview**
Summarize the focus and overall progress in 1-2 sentences.

**2. Completed items**
- Group completed tasks by tag or category
- Describe each in one sentence
- Highlight high-priority completions first

**3. In-progress items**
- List ongoing tasks
- Note priorities and expected outcomes
- Briefly flag blockers or risks

**4. ${planLabel}**
- Give 3-5 reasonable next steps based on pending work and cadence
- Put high-priority tasks first

**5. Retrospective**
Summarize efficiency and improvements in 1-2 sentences.

## Notes
- Language: concise professional English
- If a section has no data, write "None" without inventing content
- Synthesize instead of repeating raw data
- Keep it within ${wordLimit} words`;
  }
  return `你是一位专业的项目管理助手，擅长撰写简洁、结构清晰的工作报告。

请根据以下任务数据，生成一份高质量的${typeLabel}。

## 基本信息
- 报告类型：${typeLabel}
- 日期范围：${rangeLabel}

## 任务数据

### 已完成任务
${doneList}

### 进行中/未完成任务
${pendingList}

## 输出要求

请严格按照以下格式输出（使用 Markdown）：

### ${typeLabel} · ${rangeLabel}

**一、工作概览**
用 1-2 句话概括本期工作重点和整体进展。

**二、已完成事项**
- 将已完成任务按标签或类别分组列出
- 每项用一句话描述完成情况
- 如果有高优先级任务完成，优先列出并标注

**三、进行中事项**
- 列出当前仍在进行的任务
- 标注优先级和预计完成情况
- 如有阻塞或风险，简要说明

**四、${planLabel}**
- 根据进行中任务和整体节奏，给出 3-5 条合理的计划建议
- 优先级高的任务排在前面

**五、总结与反思**
用 1-2 句话总结本期效率和改进方向。

## 注意事项
- 语言：简洁专业的中文
- 如果某个分类没有数据，写"无"即可，不要编造内容
- 不要重复罗列原始数据，要有归纳和提炼
- 保持整体篇幅适中，控制在 ${wordLimit} 字以内`;
}
