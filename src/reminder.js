import { toLocalDatetime } from './utils/date.js';
import { showWindowsToast } from './windowsToast.js';

function getBrowserNotificationStatus() {
  if (typeof Notification === 'undefined') {
    return { state: 'unavailable', label: '当前环境不支持系统通知' };
  }
  if (Notification.permission === 'granted') {
    return { state: 'ready', label: '浏览器系统通知已启用' };
  }
  if (Notification.permission === 'denied') {
    return { state: 'blocked', label: '浏览器系统通知已被阻止' };
  }
  return { state: 'pending', label: '浏览器系统通知等待授权' };
}

export function initReminders({ data, saveData, render, showToast, isNeutralinoEnv, subscribeDataChanges }) {
  let reminderLock = false;
  let timerId = null;
  let paused = false;

  function getNotificationStatus() {
    if (isNeutralinoEnv()) {
      const isWindows = typeof NL_OS === 'string' && NL_OS === 'Windows';
      const available = isWindows && typeof Neutralino?.os?.execCommand === 'function';
      return available
        ? { state: 'ready', label: 'Windows 原生通知可用' }
        : { state: 'unavailable', label: 'Windows 原生通知不可用' };
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
    showToast(`提醒：${todo.title}`);
    try {
      await sendSystemNotification('TODO 提醒', todo.title);
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
      for (const todo of data.todos) {
        if (!todo.reminder || todo.done) continue;
        const reminderTime = new Date(todo.reminder);
        if (!Number.isFinite(reminderTime.getTime()) || reminderTime > now) continue;

        await triggerReminder(todo);
        if (todo.reminderRepeat === 'daily') {
          const next = new Date(reminderTime);
          while (next <= now) next.setDate(next.getDate() + 1);
          todo.reminder = toLocalDatetime(next);
        } else if (todo.reminderRepeat === 'weekly') {
          const next = new Date(reminderTime);
          while (next <= now) next.setDate(next.getDate() + 7);
          todo.reminder = toLocalDatetime(next);
        } else if (todo.reminderRepeat === 'monthly') {
          const next = new Date(reminderTime);
          while (next <= now) next.setMonth(next.getMonth() + 1);
          todo.reminder = toLocalDatetime(next);
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
      const sent = await sendSystemNotification('TODO Tools', '系统通知工作正常', true);
      showToast(sent ? '测试通知已发送' : '系统通知未授权');
      return sent;
    } catch (err) {
      console.warn('[reminder] test notification failed:', err);
      showToast('系统通知发送失败');
      return false;
    }
  }

  scheduleNext(2000);
  const unsubscribe = subscribeDataChanges?.(() => scheduleNext());

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
