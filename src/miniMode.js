import { escapeHtml } from './utils/html.js';
import { formatDate } from './utils/date.js';
import { genId } from './utils/id.js';
import { sortByPriority, splitPendingDone } from './selectors.js';

export function initMiniMode({ data, saveData, render, showToast, isNeutralinoEnv, getTagDotStyle, showContextMenu, closeWindow }) {
  let isMiniMode = false;
  const miniPanel = document.getElementById('mini-panel');
  const miniList = document.getElementById('mini-list');
  const miniTooltip = document.getElementById('mini-tooltip');
  const miniInputRow = document.getElementById('mini-input-row');
  const miniQuickAdd = document.getElementById('mini-quick-add');

  function renderMiniPanel() {
    const { pending, done } = splitPendingDone(data.todos);
    document.getElementById('mini-pending-count').textContent = pending.length;
    document.getElementById('mini-done-count').textContent = done.length;

    const sorted = sortByPriority(pending);
    const items = sorted.slice(0, 8);
    miniList.innerHTML = items.length === 0
      ? '<div class="empty-state-sm">暂无待办</div>'
      : items.map(t => {
        const prioCls = t.priority && t.priority !== 'none' ? `p-${t.priority}` : '';
        return `<div class="mini-todo-item" data-id="${t.id}">
          <div class="mini-checkbox" data-mini-toggle="${t.id}"></div>
          ${prioCls ? `<div class="mini-priority-dot ${prioCls}"></div>` : ''}
          <span class="mini-todo-title">${escapeHtml(t.title)}</span>
        </div>`;
      }).join('');
  }

  function showMiniTooltip(todoId, anchorEl) {
    const todo = data.todos.find(t => t.id === todoId);
    if (!todo) return;
    const rect = anchorEl.getBoundingClientRect();
    let html = `<div class="mini-tooltip-title">${escapeHtml(todo.title)}</div>`;
    if (todo.desc) {
      html += `<div class="mini-tooltip-row">${escapeHtml(todo.desc)}</div>`;
    }
    if (todo.priority && todo.priority !== 'none') {
      const label = { high: '🔴 高优先级', medium: '🟡 中优先级', low: '🟢 低优先级' }[todo.priority];
      html += `<div class="mini-tooltip-row">${label}</div>`;
    }
    if (todo.tag) {
      html += `<div class="mini-tooltip-row"><span class="tag-dot" ${getTagDotStyle(todo.tag)}></span>${escapeHtml(todo.tag)}</div>`;
    }
    if (todo.endTime) {
      html += `<div class="mini-tooltip-row">📅 ${formatDate(todo.endTime)}</div>`;
    }
    if (todo.startTime) {
      html += `<div class="mini-tooltip-row">🕐 开始: ${formatDate(todo.startTime)}</div>`;
    }
    miniTooltip.innerHTML = html;
    miniTooltip.classList.remove('hidden');
    miniTooltip.style.left = `${rect.left}px`;
    miniTooltip.style.top = `${rect.bottom + 4}px`;
    const tooltipRect = miniTooltip.getBoundingClientRect();
    if (tooltipRect.bottom > window.innerHeight) {
      miniTooltip.style.top = `${rect.top - tooltipRect.height - 4}px`;
    }
    if (tooltipRect.right > window.innerWidth) {
      miniTooltip.style.left = `${window.innerWidth - tooltipRect.width - 8}px`;
    }
  }

  function hideMiniTooltip() {
    miniTooltip.classList.add('hidden');
  }

  async function enterMiniMode() {
    isMiniMode = true;
    document.querySelector('.app').style.display = 'none';
    miniPanel.classList.remove('hidden');
    renderMiniPanel();
    if (isNeutralinoEnv()) {
      try {
        await Neutralino.window.setAlwaysOnTop(true);
        await Neutralino.window.setBorderless(true);
        await Neutralino.window.setSize({
          width: 280,
          height: 320,
          minWidth: 200,
          minHeight: 150
        });
        const displays = await Neutralino.computer.getDisplays();
        const primary = displays[0];
        const x = primary.resolution.width - 280 - 20;
        const y = 20;
        await Neutralino.window.move(x, y);
        await Neutralino.window.setDraggableRegion('mini-drag-region');
      } catch (e) { console.warn('enterMiniMode error:', e); }
    }
  }

  async function exitMiniMode() {
    isMiniMode = false;
    miniPanel.classList.add('hidden');
    miniInputRow.classList.add('hidden');
    document.querySelector('.app').style.display = '';
    if (isNeutralinoEnv()) {
      try {
        await Neutralino.window.unsetDraggableRegion('mini-drag-region');
      } catch (e) {}
      try {
        await Neutralino.window.setAlwaysOnTop(false);
        await Neutralino.window.setBorderless(false);
      } catch (e) {}
      await new Promise(r => setTimeout(r, 100));
      try {
        await Neutralino.window.setSize({
          width: 1100,
          height: 700,
          minWidth: 800,
          minHeight: 500
        });
        await Neutralino.window.center();
      } catch (e) { console.warn('exitMiniMode resize error:', e); }
    }
    render();
  }

  document.getElementById('btn-mini-mode').addEventListener('click', enterMiniMode);
  document.getElementById('btn-exit-mini').addEventListener('click', (e) => {
    e.stopPropagation();
    exitMiniMode();
  });

  document.getElementById('btn-mini-add').addEventListener('click', (e) => {
    e.stopPropagation();
    miniInputRow.classList.toggle('hidden');
    if (!miniInputRow.classList.contains('hidden')) {
      setTimeout(() => miniQuickAdd.focus(), 50);
    }
  });

  miniQuickAdd.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && miniQuickAdd.value.trim()) {
      const todo = {
        id: genId(),
        title: miniQuickAdd.value.trim(),
        desc: '',
        priority: 'none',
        tag: '',
        startTime: null,
        endTime: null,
        todo: true,
        important: false,
        done: false,
        doneAt: null,
        reminder: null,
        reminderRepeat: 'none',
        createdAt: Date.now()
      };
      data.todos.push(todo);
      saveData();
      miniQuickAdd.value = '';
      renderMiniPanel();
    } else if (e.key === 'Escape') {
      miniInputRow.classList.add('hidden');
    }
  });

  miniList.addEventListener('click', (e) => {
    const checkbox = e.target.closest('[data-mini-toggle]');
    if (checkbox) {
      const id = checkbox.dataset.miniToggle;
      const todo = data.todos.find(t => t.id === id);
      if (todo) {
        todo.done = !todo.done;
        todo.doneAt = todo.done ? new Date().toISOString() : null;
        if (todo.done && todo.reminderRepeat === 'none') {
          todo.reminder = null;
        }
        saveData();
        renderMiniPanel();
      }
    }
  });

  let miniTooltipTimer = null;
  miniList.addEventListener('mouseover', (e) => {
    const item = e.target.closest('.mini-todo-item');
    if (!item) return;
    clearTimeout(miniTooltipTimer);
    miniTooltipTimer = setTimeout(() => {
      showMiniTooltip(item.dataset.id, item);
    }, 400);
  });

  miniList.addEventListener('mouseout', (e) => {
    const item = e.target.closest('.mini-todo-item');
    if (!item || !item.contains(e.relatedTarget)) {
      clearTimeout(miniTooltipTimer);
      hideMiniTooltip();
    }
  });

  miniPanel.addEventListener('mouseleave', hideMiniTooltip);

  miniPanel.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      { icon: '↩️', label: '退出迷你模式', action: exitMiniMode },
      { separator: true },
      { icon: '❌', label: '关闭窗口', action: closeWindow }
    ]);
  });

  return { enterMiniMode, exitMiniMode, renderMiniPanel, isMiniMode: () => isMiniMode };
}
