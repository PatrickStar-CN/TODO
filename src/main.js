import './style.css';
import { flushAppData, initApp } from './app.js';
import { initRipple } from './ripple.js';
import { registerWindowsToastApp } from './windowsToast.js';
import { hydrateIcons } from './icons.js';
import { initGlassTooltip } from './glassTooltip.js';
import { initOverlayScrollbars } from './overlayScrollbars.js';

const SECOND_INSTANCE_EVENT = 'todo-tools:second-instance';
const RESTORE_MAIN_WINDOW_EVENT = 'todo-tools:restore-main-window';
const INSTANCE_ID_KEY = 'todo-tools-instance-id';
const INSTANCE_LOCK_DIR = 'todo-tools-instance.lock';
const INSTANCE_LOCK_FILE = 'owner.json';
const LOCK_STALE_MS = 8000;
const LOCK_HEARTBEAT_MS = 2000;

let instanceId = '';
let lockPath = '';
let lockFilePath = '';
let lockHeartbeatTimer = null;
let ownsInstanceLock = false;

function createInstanceId() {
  const storedId = sessionStorage.getItem(INSTANCE_ID_KEY);
  if (storedId) return storedId;
  const generatedId = window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  sessionStorage.setItem(INSTANCE_ID_KEY, generatedId);
  return generatedId;
}

async function getInstanceLockPath() {
  if (lockPath) return lockPath;
  const tempPath = await Neutralino.os.getPath('temp');
  lockPath = await Neutralino.filesystem.getJoinedPath(tempPath, INSTANCE_LOCK_DIR);
  return lockPath;
}

async function getInstanceLockFilePath() {
  if (lockFilePath) return lockFilePath;
  lockFilePath = await Neutralino.filesystem.getJoinedPath(await getInstanceLockPath(), INSTANCE_LOCK_FILE);
  return lockFilePath;
}

async function readInstanceLock() {
  try {
    return JSON.parse(await Neutralino.filesystem.readFile(await getInstanceLockFilePath()));
  } catch {
    return null;
  }
}

async function writeInstanceLock() {
  await Neutralino.filesystem.writeFile(await getInstanceLockFilePath(), JSON.stringify({
    instanceId,
    updatedAt: Date.now()
  }));
}

async function releaseInstanceLock() {
  if (lockHeartbeatTimer) {
    clearInterval(lockHeartbeatTimer);
    lockHeartbeatTimer = null;
  }
  if (!ownsInstanceLock) return;

  ownsInstanceLock = false;
  const currentLock = await readInstanceLock();
  if (currentLock?.instanceId === instanceId) {
    await Neutralino.filesystem.remove(await getInstanceLockPath()).catch(() => {});
  }
}

function startInstanceHeartbeat() {
  if (lockHeartbeatTimer) clearInterval(lockHeartbeatTimer);
  lockHeartbeatTimer = setInterval(() => {
    writeInstanceLock().catch((error) => {
      console.warn('[single-instance] Failed to refresh instance lock:', error);
    });
  }, LOCK_HEARTBEAT_MS);
}

async function createLockDirectory() {
  try {
    await Neutralino.filesystem.createDirectory(await getInstanceLockPath());
    return true;
  } catch {
    return false;
  }
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

  if (await createLockDirectory()) {
    await writeInstanceLock();
    ownsInstanceLock = true;
    startInstanceHeartbeat();
    return true;
  }

  let currentLock = await readInstanceLock();
  if (!currentLock) {
    await new Promise(resolve => setTimeout(resolve, 100));
    currentLock = await readInstanceLock();
  }
  const lockAge = Date.now() - Number(currentLock?.updatedAt || 0);
  if (currentLock?.instanceId === instanceId || !currentLock?.instanceId || lockAge < 0 || lockAge >= LOCK_STALE_MS) {
    await Neutralino.filesystem.remove(await getInstanceLockPath()).catch(() => {});
    if (await createLockDirectory()) {
      await writeInstanceLock();
      ownsInstanceLock = true;
      startInstanceHeartbeat();
      return true;
    }
  }

  if (currentLock?.instanceId) {
    await notifyExistingInstance();
    await Neutralino.app.exit();
    return false;
  }

  return false;
}

async function exitApp() {
  try {
    await flushAppData();
  } catch (err) {
    console.warn('[exit] failed to flush data:', err);
  }
  await releaseInstanceLock().catch(() => {});
  await Neutralino.app.exit().catch(() => {});
}

function setupTray() {
  try {
    Neutralino.os.setTray({
      icon: '/dist/icon.png',
      menuItems: [
        { id: 'show', text: '显示窗口' },
        { id: 'quit', text: '退出' }
      ]
    });
  } catch (err) {
    console.warn('[tray] failed to create system tray:', err);
  }

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
        console.warn('[single-instance] lock check failed, continuing as sole instance:', error);
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
