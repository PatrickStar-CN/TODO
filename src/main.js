import './style.css';
import { initApp } from './app.js';
import { initRipple } from './ripple.js';
import { registerWindowsToastApp } from './windowsToast.js';

function setupTray() {
  Neutralino.os.setTray({
    icon: '/dist/icon.png',
    menuItems: [
      { id: 'show', text: '显示窗口' },
      { id: 'quit', text: '退出' }
    ]
  });

  Neutralino.events.on('trayMenuItemClicked', (event) => {
    switch (event.detail.id) {
      case 'show':
        Neutralino.window.show();
        Neutralino.window.focus();
        break;
      case 'quit':
        Neutralino.app.exit();
        break;
    }
  });

  Neutralino.events.on('windowClose', () => {
    Neutralino.window.hide();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initRipple();
  if (typeof Neutralino !== 'undefined') {
    Neutralino.init();
    Neutralino.events.on('ready', () => {
      setupTray();
      Neutralino.window.center();
      registerWindowsToastApp().catch((error) => {
        console.warn('[reminder] Windows notification registration failed:', error);
      });
    });
  }
  initApp();
});
