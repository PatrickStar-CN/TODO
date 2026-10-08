import './style.css';
import { flushAppData, initApp } from './app.js';
import { acquireSingleInstance, releaseSingleInstance } from './singleInstance.js';
import { initRipple } from './ripple.js';
import { registerWindowsToastApp } from './windowsToast.js';
import { hydrateIcons } from './icons.js';
import { initGlassTooltip } from './glassTooltip.js';
import { initOverlayScrollbars } from './overlayScrollbars.js';
import { t, getLanguage, onLanguageChange } from './i18n/index.js';

const SECOND_INSTANCE_EVENT = 'todo-tools:second-instance';
const RESTORE_MAIN_WINDOW_EVENT = 'todo-tools:restore-main-window';
const INSTANCE_ID_KEY = 'todo-tools-instance-id';

let instanceId = '';

function createInstanceId() {
  const storedId = sessionStorage.getItem(INSTANCE_ID_KEY);
  if (storedId) return storedId;
  const generatedId = window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  sessionStorage.setItem(INSTANCE_ID_KEY, generatedId);
  return generatedId;
}

async function focusCurrentInstance() {
  document.dispatchEvent(new CustomEvent(RESTORE_MAIN_WINDOW_EVENT));
  await Neutralino.window.show().catch(() => {});
  await Neutralino.window.unminimize().catch(() => {});
  await Neutralino.window.focus().catch(() => {});
}

async function notifyExistingInstance() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await Neutralino.app.broadcast(SECOND_INSTANCE_EVENT, { instanceId }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 120));
  }
}

function setupSingleInstanceListener() {
  Neutralino.events.on(SECOND_INSTANCE_EVENT, (event) => {
    if (event.detail?.instanceId === instanceId) return;
    focusCurrentInstance().catch((error) => {
      console.warn('[single-instance] Failed to focus existing instance:', error);
    });
  });
}

async function claimSingleInstance() {
  instanceId = createInstanceId();
  setupSingleInstanceListener();

  /* OS 命名 Mutex 仲裁：胜负由持有者自身的 createdNew/exit 42 决定，
   * 探测仅是让第二实例退得更快的优化（见 singleInstance.js）。 */
  const { primary } = await acquireSingleInstance();
  if (!primary) {
    await notifyExistingInstance();
    await Neutralino.app.exit();
    return false;
  }
  return true;
}

async function exitApp() {
  try {
    await flushAppData();
  } catch (err) {
    console.warn('[exit] failed to flush data:', err);
  }
  await releaseSingleInstance().catch(() => {});
  await Neutralino.app.exit().catch(() => {});
}

function getTrayMenuItems() {
  return [
    { id: 'show', text: t('tray.show') },
    { id: 'quit', text: t('tray.quit') }
  ];
}

function setupTray() {
  const applyTrayMenu = () => {
    try {
      Neutralino.os.setTray({
        icon: '/dist/icon.png',
        menuItems: getTrayMenuItems()
      });
    } catch (err) {
      console.warn('[tray] failed to create system tray:', err);
    }
  };
  applyTrayMenu();
  try {
    onLanguageChange(() => {
      if (typeof Neutralino !== 'undefined') applyTrayMenu();
    });
  } catch { /* ignore */ }

  Neutralino.events.on('trayMenuItemClicked', (event) => {
    switch (event.detail.id) {
      case 'show':
        Neutralino.window.show().catch(() => {});
        Neutralino.window.focus().catch(() => {});
        break;
      case 'quit':
        exitApp();
        break;
    }
  });

  Neutralino.events.on('windowClose', () => {
    flushAppData().catch(() => {}).finally(() => {
      Neutralino.window.hide().catch(() => {});
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  hydrateIcons();
  initRipple();
  initGlassTooltip();
  initOverlayScrollbars();
  if (typeof Neutralino !== 'undefined') {
    Neutralino.init();
    Neutralino.events.on('ready', async () => {
      try {
        if (!await claimSingleInstance()) return;
      } catch (error) {
        console.warn('[single-instance] check failed, continuing as sole instance:', error);
      }
      try {
        setupTray();
      } catch (error) {
        console.warn('[tray] failed to initialize tray:', error);
      }
      try {
        await initApp();
      } catch (error) {
        console.error('[initApp] failed to initialize app:', error);
        return;
      }
      Neutralino.window.center().catch(() => {});
      await Neutralino.window.show().catch(() => {});
      await Neutralino.window.focus().catch(() => {});
      registerWindowsToastApp().catch((error) => {
        console.warn('[reminder] Windows notification registration failed:', error);
      });
    });
  } else {
    initApp();
  }
});
