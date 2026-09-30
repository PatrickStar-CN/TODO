import { t } from './i18n/index.js';
import { toLocalDatetime } from './utils/date.js';
import { isNeutralinoEnv } from './shared.js';

/* 数据导出：把 todo_data.json 形态的数据导出为 JSON 备份或 Markdown 清单。
 * JSON 备份与数据文件同结构，可直接放回 todo_data.json 恢复；
 * 加密密钥绑定设备环境指纹，跨设备迁移必须走明文，parseStoredData 可直读明文。
 * 本模块顶层不触碰 DOM / window / Blob，保证 Node 环境可被 check-state.js 直接 import。 */

export const EXPORT_FORMATS = ['json', 'markdown'];

/* 导出快照的版本标记，便于日后格式演进时区分旧备份 */
export const EXPORT_SCHEMA_VERSION = 1;

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/* 与 createPersistenceSnapshots() 同策略：_index 是纯运行时数据，绝不外泄 */
export function buildExportPayload(data, options = {}) {
  if (!isPlainObject(data)) {
    throw new TypeError('buildExportPayload 需要传入数据对象');
  }
  const includeApiKey = options.includeApiKey === true;
  const { _index, ...base } = data;
  const aiConfig = isPlainObject(base.aiConfig) ? { ...base.aiConfig } : {};
  if (!includeApiKey) aiConfig.apiKey = '';
  return {
    ...base,
    todos: Array.isArray(base.todos) ? base.todos : [],
    tags: Array.isArray(base.tags) ? base.tags : [],
    aiConfig,
  };
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function stampOf(now) {
  const date = now instanceof Date ? now : new Date();
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}`;
}

export function buildExportFileName(format, now = new Date()) {
  if (format === 'markdown') return `todo-${stampOf(now)}.md`;
  if (format === 'json') return `todo-backup-${stampOf(now)}.json`;
  throw new TypeError(`不支持的导出格式: ${format}`);
}

/* JSON 备份直接采用 todo_data.json 的顶层结构，落地即可作为数据文件恢复。
 * exportedAt / schemaVersion 作为同级元信息随文件一起保留：normalizeData 属就地
 * 归一化、未识别的键会被原样保留，因此这两个字段既能自描述又不影响恢复结果。 */
function serializeJsonExport(data, options = {}) {
  const payload = buildExportPayload(data, options);
  return JSON.stringify({
    ...payload,
    exportedAt: toLocalDatetime(options.now instanceof Date ? options.now : new Date()),
    schemaVersion: EXPORT_SCHEMA_VERSION,
  }, null, 2);
}

function escapeMarkdownCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

function formatTimestamp(value) {
  if (value === null || value === undefined || value === '') return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return toLocalDatetime(date);
}

/* Markdown 清单：表头给出导出时间与统计，正文按待办 / 已完成 / 已归档分组 */
export function buildMarkdownExport(data, options = {}) {
  if (!isPlainObject(data)) {
    throw new TypeError('buildMarkdownExport 需要传入数据对象');
  }
  const todos = Array.isArray(data.todos) ? data.todos.filter(isPlainObject) : [];
  const tags = Array.isArray(data.tags) ? data.tags.filter(tag => typeof tag === 'string' && tag) : [];
  const now = options.now instanceof Date ? options.now : new Date();
  const groups = [
    { title: t('export.mdTodoSection'), list: todos.filter(todo => !todo.done && !todo.archived) },
    { title: t('export.mdDoneSection'), list: todos.filter(todo => todo.done && !todo.archived) },
    { title: t('export.mdArchivedSection'), list: todos.filter(todo => todo.archived) },
  ];
  const lines = [
    `# ${t('export.mdTitle')}`,
    '',
    `- ${t('export.mdExportedAt')}: ${toLocalDatetime(now)}`,
    `- ${t('export.mdTotal')}: ${todos.length}`,
    `- ${t('export.mdDone')}: ${todos.filter(todo => todo.done).length}`,
    `- ${t('export.mdTags')}: ${tags.length ? tags.join(t('export.mdListSeparator')) : t('detail.noTag')}`,
    ''
  ];

  groups.forEach((group) => {
    lines.push(`## ${group.title} (${group.list.length})`, '');
    if (group.list.length === 0) {
      lines.push(t('export.mdEmpty'), '');
      return;
    }
    lines.push('| | ' + [t('detail.fieldTitle'), t('detail.priority'), t('detail.tag'), t('detail.startTime'), t('detail.endTime'), t('detail.createdTime'), t('detail.doneTime'), t('detail.fieldDesc')].join(' | ') + ' |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    group.list.forEach((todo) => {
      const title = String(todo.title ?? '').trim();
      const priority = todo.priority && todo.priority !== 'none' ? t(`priority.${todo.priority}`) : t('detail.none');
      const tag = todo.tag || t('detail.unsetTag');
      const start = formatTimestamp(todo.startTime) || t('detail.unset');
      const end = formatTimestamp(todo.endTime) || t('detail.unset');
      /* createdAt 历史上既有 epoch 数字也有 ISO 字符串，formatTimestamp 已兼容两种 */
      const created = formatTimestamp(todo.createdAt) || t('detail.unset');
      const done = formatTimestamp(todo.doneAt) || t('detail.unset');
      const desc = String(todo.desc ?? '').trim() || t('detail.unset');
      lines.push(`| [${todo.done ? 'x' : ' '}] | ${escapeMarkdownCell(title)} | ${escapeMarkdownCell(priority)} | ${escapeMarkdownCell(tag)} | ${start} | ${end} | ${created} | ${done} | ${escapeMarkdownCell(desc)} |`);
    });
    lines.push('');
  });

  return lines.join('\n');
}

function buildExportContent(data, options = {}) {
  const format = EXPORT_FORMATS.includes(options.format) ? options.format : 'json';
  if (format === 'markdown') {
    return { format, text: buildMarkdownExport(data, options), mime: 'text/markdown;charset=utf-8' };
  }
  return { format, text: serializeJsonExport(data, options), mime: 'application/json;charset=utf-8' };
}

function saveTextByBrowser(text, fileName, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function joinPath(base, name) {
  try {
    return await Neutralino.filesystem.getJoinedPath(base, name);
  } catch {
    return `${base.replace(/[\\/]$/, '')}/${name}`;
  }
}

/* 桌面端：os.showSaveDialog 在 nativeAllowList 的 os.* 内。
 * 客户端签名为 showSaveDialog(title, options) —— 标题是独立的第一个参数，
 * 不能把选项对象当第一个参数传（会被展开成 title，选项随之丢失）。
 * 用户取消时返回空值；返回可能是字符串路径，也可能是 { filePath }。 */
async function saveTextByNeutralino(text, fileName, format, dialogTitle) {
  let path = '';
  const showSaveDialog = Neutralino?.os?.showSaveDialog;
  if (typeof showSaveDialog === 'function') {
    const result = await showSaveDialog.call(Neutralino.os, dialogTitle, {
      defaultPath: fileName,
      filters: [{ name: format === 'markdown' ? 'Markdown' : 'JSON', filter: [format === 'markdown' ? 'md' : 'json'] }]
    });
    /* 用户主动取消：不写盘，交给调用方决定是否提示 */
    if (!result) return { status: 'cancelled' };
    path = typeof result === 'string' ? result : result.filePath;
    if (!path) return { status: 'cancelled' };
  } else {
    const downloads = await Neutralino.os.getPath('download');
    path = await joinPath(downloads, fileName);
  }
  await Neutralino.filesystem.writeFile(path, text);
  return { status: 'saved', path };
}

/* 入口：只读，不触发 saveData()。
 * dialogTitle 由调用方提供（走 i18n）；返回
 * { status: 'saved', path?, format, fileName } 或 { status: 'cancelled' }；
 * 失败一律上抛由调用方提示，绝不静默吞掉。 */
export async function exportData(data, options = {}) {
  const { format, includeApiKey = false, now = new Date(), dialogTitle = '' } = options;
  const content = buildExportContent(data, { format, includeApiKey, now });
  const fileName = buildExportFileName(content.format, now);
  if (isNeutralinoEnv()) {
    const saved = await saveTextByNeutralino(content.text, fileName, content.format, dialogTitle);
    return { ...saved, format: content.format, fileName };
  }
  saveTextByBrowser(content.text, fileName, content.mime);
  return { status: 'saved', format: content.format, fileName };
}
