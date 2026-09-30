import { toLocalDatetime } from './utils/date.js';
import { showWindowsToast } from './windowsToast.js';
import { isNeutralinoEnv } from './shared.js';
import { t } from './i18n/index.js';

function lastDayOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/* 计算下一个每月提醒：保留锚点日（不超过目标月天数），避免月末漂移 */
export function computeNextMonthlyReminder(reminderTime, now) {
  const next = new Date(reminderTime);
  const anchorDay = next.getDate();
  while (next <= now) {
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    next.setDate(Math.min(anchorDay, lastDayOfMonth(next)));
  }
  return next;
}

function getBrowserNotificationStatus() {
  if (typeof Notification === 'undefined') {
    return { state: 'unavailable', label: t('reminder.unsupported') };
  }
  if (Notification.permission === 'granted') {
    return { state: 'ready', label: t('reminder.browserReady') };
  }
  if (Notification.permission === 'denied') {
    return { state: 'blocked', label: t('reminder.blocked') };
  }
  return { state: 'pending', label: t('reminder.pending') };
}

export function initReminders({ data, saveData, render, showToast, subscribeDataChanges }) {
  let reminderLock = false;
  let timerId = null;
  let paused = false;

  function getNotificationStatus() {
    if (isNeutralinoEnv()) {
      const isWindows = typeof NL_OS === 'string' && NL_OS === 'Windows';
      const available = isWindows && typeof Neutralino?.os?.execCommand === 'function';
      return available
        ? { state: 'ready', label: t('reminder.winReady') }
        : { state: 'unavailable', label: t('reminder.winUnavailable') };
    }
    return getBrowserNotificationStatus();
  }

  async function sendSystemNotification(title, content, requestPermission = false) {
    if (isNeutralinoEnv()) {
      return showWindowsToast(title, content);
    }

    if (typeof Notification === 'undefined') return false;
    let permission = Notification.permission;
    if (permission === 'default' && requestPermission) {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') return false;
    new Notification(title, { body: content, icon: './icon.svg' });
    return true;
  }

  async function triggerReminder(todo) {
    showToast(t('reminder.prefix', { text: todo.title }));
    try {
      await sendSystemNotification(t('reminder.title'), todo.title);
    } catch (err) {
      console.warn('[reminder] system notification failed:', err);
    }
  }

  /* 同一轮到期的多个提醒合并为一条系统通知，避免串行 spawn 多个 powershell 进程 */
  async function triggerRemindersBatch(dueTodos) {
    if (dueTodos.length === 0) return;
    if (dueTodos.length === 1) {
      await triggerReminder(dueTodos[0]);
      return;
    }
    const preview = dueTodos.slice(0, 3).map(t => t.title).join('、');
    const suffix = dueTodos.length > 3 ? t('reminder.batchSuffixMore', { count: dueTodos.length }) : t('reminder.batchSuffix', { count: dueTodos.length });
    showToast(t('reminder.prefix', { text: `${preview}${dueTodos.length > 3 ? '…' : ''}` }));
    try {
      await sendSystemNotification(t('reminder.title'), t('reminder.batchBody', { suffix, preview: `${preview}${dueTodos.length > 3 ? '…' : ''}` }));
    } catch (err) {
      console.warn('[reminder] system notification failed:', err);
    }
  }

  function scheduleNext(delayOverride = null) {
    if (timerId) clearTimeout(timerId);
    timerId = null;
    if (paused) return;

    let delay = delayOverride;
    if (delay == null) {
      const now = Date.now();
      let nextTime = Infinity;
      for (const todo of data.todos) {
        if (!todo.reminder || todo.done) continue;
        const time = new Date(todo.reminder).getTime();
        if (Number.isFinite(time) && time < nextTime) nextTime = time;
      }
      if (!Number.isFinite(nextTime)) return;
      delay = Math.max(0, nextTime - now);
    }

    timerId = setTimeout(checkReminders, Math.min(delay, 2147483647));
  }

  async function checkReminders() {
    if (reminderLock) return;
    reminderLock = true;
    try {
      const now = new Date();
      let changed = false;
      const dueTodos = [];
      for (const todo of data.todos) {
        if (!todo.reminder || todo.done) continue;
        const reminderTime = new Date(todo.reminder);
        if (!Number.isFinite(reminderTime.getTime()) || reminderTime > now) continue;
        dueTodos.push(todo);
      }
      if (dueTodos.length > 0) {
        await triggerRemindersBatch(dueTodos);
      }
      for (const todo of dueTodos) {
        const reminderTime = new Date(todo.reminder);
        if (todo.reminderRepeat === 'daily') {
          const next = new Date(reminderTime);
          while (next <= now) next.setDate(next.getDate() + 1);
          todo.reminder = toLocalDatetime(next);
        } else if (todo.reminderRepeat === 'weekly') {
          const next = new Date(reminderTime);
          while (next <= now) next.setDate(next.getDate() + 7);
          todo.reminder = toLocalDatetime(next);
        } else if (todo.reminderRepeat === 'monthly') {
          todo.reminder = toLocalDatetime(computeNextMonthlyReminder(reminderTime, now));
        } else {
          todo.reminder = null;
        }
        changed = true;
      }
      if (changed) {
        saveData();
        render();
      }
    } finally {
      reminderLock = false;
      scheduleNext();
    }
  }

  async function testNotification() {
    try {
      const sent = await sendSystemNotification(t('reminder.appTitle'), t('reminder.working'), true);
      showToast(sent ? t('toast.testSent') : t('toast.testUnauthorized'));
      return sent;
    } catch (err) {
      console.warn('[reminder] test notification failed:', err);
      showToast(t('toast.testFailed'));
      return false;
    }
  }

  scheduleNext(2000);
  /* 高频编辑时防抖重排，避免每次 saveData 都 clearTimeout + 全量 rescan O(N) */
  let rescheduleTimer = null;
  const unsubscribe = subscribeDataChanges?.(() => {
    if (rescheduleTimer) clearTimeout(rescheduleTimer);
    rescheduleTimer = setTimeout(() => {
      rescheduleTimer = null;
      scheduleNext();
    }, 300);
  });

  function pause() {
    paused = true;
    if (timerId) clearTimeout(timerId);
    timerId = null;
  }

  function resume() {
    if (!paused) return;
    paused = false;
    scheduleNext();
  }

  function reschedule() {
    scheduleNext();
  }

  return { pause, resume, reschedule, testNotification, getNotificationStatus, checkReminders, destroy: unsubscribe };
}
