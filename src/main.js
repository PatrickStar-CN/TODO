import './style.css';
import { initApp } from './app.js';

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
  if (typeof Neutralino !== 'undefined') {
    Neutralino.init();
    Neutralino.events.on('ready', () => {
      setupTray();
    });
  }
  initApp();
});
