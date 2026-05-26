import { toLocalDatetime } from './utils/date.js';

export function initReminders({ data, saveData, render, showToast, isNeutralinoEnv }) {
  let reminderLock = false;

  function checkReminders() {
    if (reminderLock) return;
    reminderLock = true;
    const now = new Date();
    let changed = false;
    data.todos.forEach(todo => {
      if (!todo.reminder || todo.done) return;
      const reminderTime = new Date(todo.reminder);
      if (reminderTime <= now) {
        triggerReminder(todo);
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
    });
    if (changed) {
      saveData();
      render();
    }
    reminderLock = false;
  }

  async function triggerReminder(todo) {
    showToast(`🔔 提醒：${todo.title}`);
    if (isNeutralinoEnv()) {
      try {
        const title = todo.title.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
        const xml = `<toast duration="short"><visual><binding template="ToastGeneric"><text>TODO 提醒</text><text>${title}</text></binding></visual></toast>`;
        const psScript = [
          '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
          '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null',
          '$x = New-Object Windows.Data.Xml.Dom.XmlDocument',
          `$x.LoadXml('${xml}')`,
          '$t = [Windows.UI.Notifications.ToastNotification]::new($x)',
          '$t.ExpirationTime = [DateTimeOffset]::Now.AddSeconds(8)',
          "$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe')",
          '$notifier.Show($t)'
        ].join('\r\n');
        const scriptPath = NL_PATH + '/.tmp_notify.ps1';
        const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
        const content = new TextEncoder().encode(psScript);
        const buf = new Uint8Array(bom.length + content.length);
        buf.set(bom);
        buf.set(content, bom.length);
        await Neutralino.filesystem.writeBinaryFile(scriptPath, buf.buffer);
        await Neutralino.os.execCommand(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`);
        await Neutralino.filesystem.remove(scriptPath);
      } catch (e) {}
    }
  }

  let intervalId = setInterval(checkReminders, 30000);
  setTimeout(checkReminders, 2000);

  function pause() {
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
  }

  function resume() {
    if (!intervalId) { intervalId = setInterval(checkReminders, 30000); }
  }

  return { pause, resume };
}
