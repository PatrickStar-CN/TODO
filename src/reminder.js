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

export function initReminders({ data, saveData, render, showToast, isNeutralinoEnv }) {
  let reminderLock = false;

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
    new Notification(title, { body: content, icon: './icon.png' });
    return true;
  }

  async function triggerReminder(todo) {
    showToast(`🔔 提醒：${todo.title}`);
    try {
      await sendSystemNotification('TODO 提醒', todo.title);
    } catch (err) {
      console.warn('[reminder] system notification failed:', err);
    }
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

  let intervalId = setInterval(checkReminders, 30000);
  let initialTimeoutId = setTimeout(() => {
    initialTimeoutId = null;
    checkReminders();
  }, 2000);

  function pause() {
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
    if (initialTimeoutId) { clearTimeout(initialTimeoutId); initialTimeoutId = null; }
  }

  function resume() {
    if (!intervalId) {
      intervalId = setInterval(checkReminders, 30000);
      checkReminders();
    }
  }

  return { pause, resume, testNotification, getNotificationStatus, checkReminders };
}
