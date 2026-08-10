import { escapeHtml } from './utils/html.js';
import { formatDateTime } from './utils/date.js';
import { genId } from './utils/id.js';
import { sortByPriority, splitPendingDone } from './selectors.js';
import { iconSvg } from './icons.js';
import { initMiniSnap } from './miniSnap.js';

export function initMiniMode({ data, saveData, render, showToast, isNeutralinoEnv, getTagDotStyle, getTagBadgeStyle, showContextMenu, closeWindow, reminders, appConfig, todoStore }) {
  let isMiniMode = false;
  let miniTooltipTimer = null;
  let currentMiniDetailId = null;
  const miniPanel = document.getElementById('mini-panel');
  const miniList = document.getElementById('mini-list');
  const miniTooltip = document.getElementById('mini-tooltip');
  const miniInputRow = document.getElementById('mini-input-row');
  const miniQuickAdd = document.getElementById('mini-quick-add');
  const miniDetailCard = document.getElementById('mini-detail-card');
  const miniDetailBody = document.getElementById('mini-detail-body');
  const miniDetailTitle = document.getElementById('mini-detail-title');
  const miniDetailToggleLabel = document.getElementById('mini-detail-toggle-label');

  const miniCfg = appConfig?.miniMode || {};
  const miniMinWidth = miniCfg.minWidth || 220;
  const miniMinHeight = miniCfg.minHeight || 220;
  /* 当前会话内记住手动缩放后的尺寸，再次进入迷你模式时沿用 */
  let miniWidth = miniCfg.width || 240;
  let miniHeight = miniCfg.height || 288;

  /* 顶部贴边吸附 + 自动收起（仅桌面端生效），参数来自 app.config.json 的 miniMode.snap */
  const snapCfg = miniCfg.snap || {};
  const miniSnap = initMiniSnap({
    isNeutralinoEnv,
    isMiniMode: () => isMiniMode,
    thresholdCss: snapCfg.threshold,
    stripCss: snapCfg.strip,
    collapseDelay: snapCfg.delay
  });

  function renderMiniPanel() {
    const { pending, done } = splitPendingDone(data.todos);
    document.getElementById('mini-pending-count').textContent = pending.length;
    document.getElementById('mini-done-count').textContent = done.length;

    const sorted = sortByPriority(pending);
    const items = sorted.slice(0, 8);
    miniList.classList.toggle('is-empty', items.length === 0);
    miniList.innerHTML = items.length === 0
      ? `<div class="mini-empty-state">${iconSvg('inbox')}<strong>暂无待办</strong><span>点击右上角添加任务</span></div>`
      : items.map(t => {
        const prioCls = t.priority && t.priority !== 'none' ? t.priority : '';
        const tagChip = t.tag
          ? `<span class="mini-item-tag" ${getTagBadgeStyle(t.tag)}><span class="tag-dot" aria-hidden="true"></span><span class="mini-item-tag-label">${escapeHtml(t.tag)}</span></span>`
          : '';
        return `<div class="mini-todo-item${prioCls ? ` p-${prioCls}` : ''}" data-id="${t.id}">
          <button class="mini-checkbox" type="button" data-mini-toggle="${t.id}" aria-label="完成任务：${escapeHtml(t.title)}"></button>
          <span class="mini-todo-title">${escapeHtml(t.title)}</span>
          ${tagChip}
        </div>`;
      }).join('');

    /* 详情卡打开时若任务被移除/已完成则关闭，保持与列表同步 */
    if (currentMiniDetailId) {
      const syncedTodo = todoStore?.get(currentMiniDetailId)
        || data.todos.find(t => t.id === currentMiniDetailId);
      if (!syncedTodo || syncedTodo.done) closeMiniDetail();
    }
  }

  function showMiniTooltip(todoId, anchorEl) {
    const todo = todoStore?.get(todoId) || data.todos.find(t => t.id === todoId);
    if (!todo) return;
    const rect = anchorEl.getBoundingClientRect();
    let html = `<div class="mini-tooltip-title">${escapeHtml(todo.title)}</div>`;
    if (todo.desc) {
      html += `<div class="mini-tooltip-row">${escapeHtml(todo.desc)}</div>`;
    }
    if (todo.priority && todo.priority !== 'none') {
      const label = { high: '高优先级', medium: '中优先级', low: '低优先级' }[todo.priority];
      html += `<div class="mini-tooltip-row">${iconSvg('circle', `icon-priority-${todo.priority}`)}<span>${label}</span></div>`;
    }
    if (todo.tag) {
      html += `<div class="mini-tooltip-row"><span class="tag-dot" ${getTagDotStyle(todo.tag)}></span>${escapeHtml(todo.tag)}</div>`;
    }
    if (todo.endTime) {
      html += `<div class="mini-tooltip-row">${iconSvg('calendar')}<span>${formatDateTime(todo.endTime)}</span></div>`;
    }
    if (todo.startTime) {
      html += `<div class="mini-tooltip-row">${iconSvg('clock')}<span>开始: ${formatDateTime(todo.startTime)}</span></div>`;
    }
    miniTooltip.innerHTML = html;
    miniTooltip.classList.remove('hidden');
    positionMiniTooltip(rect);
  }

  /* 三级定位：下方放不下再翻到上方，上下都放不下则贴底夹紧（配合 max-height 内部滚动）。
     左侧同理做视口夹紧，避免迷你窗口边缘裁切。 */
  function positionMiniTooltip(rect) {
    const gap = 4;
    const safe = 8;
    const tipWidth = miniTooltip.offsetWidth;
    const tipHeight = miniTooltip.offsetHeight;

    let top = rect.bottom + gap;
    if (top + tipHeight > window.innerHeight - safe
        && rect.top - tipHeight - gap >= safe) {
      top = rect.top - tipHeight - gap;
    }
    if (top + tipHeight > window.innerHeight - safe) {
      top = Math.max(safe, window.innerHeight - tipHeight - safe);
    }

    let left = rect.left;
    if (left + tipWidth > window.innerWidth - safe) {
      left = Math.max(safe, window.innerWidth - tipWidth - safe);
    }

    miniTooltip.style.left = `${Math.round(left)}px`;
    miniTooltip.style.top = `${Math.round(top)}px`;
  }

  function hideMiniTooltip() {
    miniTooltip.classList.add('hidden');
  }

  /* ---- 任务详情卡：点击任务打开完整信息，窗口空间不足时内部滚动 ---- */
  function getMiniPriorityLabel(todo) {
    return { high: '高', medium: '中', low: '低', none: '无' }[todo.priority || 'none'] || '无';
  }

  function getMiniPriorityDotClass(todo) {
    return { high: 'p-high', medium: 'p-medium', low: 'p-low', none: '' }[todo.priority || 'none'] || '';
  }

  function buildMiniDetailRows(todo) {
    const rows = [];
    const addRow = (icon, label, valueHtml) => {
      rows.push(`<div class="mini-detail-meta-item"><span class="mini-detail-meta-icon">${iconSvg(icon)}</span><span class="mini-detail-meta-label">${label}</span><span class="mini-detail-meta-value">${valueHtml}</span></div>`);
    };
    const dotClass = getMiniPriorityDotClass(todo);
    addRow('flag', '优先级', `<span class="mini-priority-dot ${dotClass}" aria-hidden="true"></span>${getMiniPriorityLabel(todo)}`);
    if (todo.tag) {
      addRow('tag', '标签', `<span class="tag-dot" ${getTagDotStyle(todo.tag)} aria-hidden="true"></span>${escapeHtml(todo.tag)}`);
    }
    if (todo.startTime) {
      addRow('clock', '开始', escapeHtml(formatDateTime(todo.startTime)));
    }
    if (todo.endTime) {
      addRow('calendar', '截止', escapeHtml(formatDateTime(todo.endTime)));
    }
    if (todo.reminder) {
      const repeatLabel = { daily: '每天', weekly: '每周', monthly: '每月' }[todo.reminderRepeat] || '';
      addRow('bell', '提醒', `${escapeHtml(formatDateTime(todo.reminder))}${repeatLabel ? `（${repeatLabel}）` : ''}`);
    }
    addRow('plus', '创建', escapeHtml(formatDateTime(todo.createdAt)));
    return rows.join('');
  }

  function renderMiniDetail(todo) {
    if (!todo) return;
    currentMiniDetailId = todo.id;
    miniDetailTitle.textContent = todo.title;
    miniDetailTitle.title = todo.title;
    miniDetailToggleLabel.textContent = todo.done ? '取消完成' : '标记完成';
    let html = '';
    if (todo.desc) {
      html += `<div class="mini-detail-desc">${escapeHtml(todo.desc)}</div>`;
    }
    html += `<div class="mini-detail-meta">${buildMiniDetailRows(todo)}</div>`;
    miniDetailBody.innerHTML = html;
  }

  function openMiniDetail(todoId) {
    const todo = todoStore?.get(todoId) || data.todos.find(t => t.id === todoId);
    if (!todo) return;
    hideMiniTooltip();
    clearTimeout(miniTooltipTimer);
    renderMiniDetail(todo);
    miniDetailCard.classList.remove('hidden');
  }

  function closeMiniDetail() {
    miniDetailCard.classList.add('hidden');
    currentMiniDetailId = null;
  }

  function handleMiniDetailToggle() {
    const todo = currentMiniDetailId
      ? (todoStore?.get(currentMiniDetailId) || data.todos.find(t => t.id === currentMiniDetailId))
      : null;
    if (!todo) { closeMiniDetail(); return; }
    const mutate = target => {
      target.done = !target.done;
      target.doneAt = target.done ? new Date().toISOString() : null;
      if (target.done && target.reminderRepeat === 'none') target.reminder = null;
    };
    if (todoStore) todoStore.update(todo, mutate);
    else mutate(todo);
    saveData();
    renderMiniPanel();
    closeMiniDetail();
  }

  /* Win11 DWM 平滑圆角：无边框窗口默认直角，通过 dwmapi 的 DWMWA_WINDOW_CORNER_PREFERENCE
     (33) 设为 ROUND (2)，圆角外的区域由系统自动穿透点击。
     在应用启动时（窗口仍处于 hidden 状态）就设置，进入迷你模式时属性已就绪，不会闪现直角。
     定位窗口用 EnumWindows 按标题（config 的 window.title）匹配——隐藏窗口也能枚举到，
     不依赖 MainWindowHandle（窗口隐藏时它为 0）。
     PowerShell 脚本经 UTF-16LE base64 编码后执行，避免引号转义问题。 */
  function encodeUtf16LeBase64(str) {
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      bytes.push(code & 0xff, code >> 8);
    }
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  const roundCornerCommand = 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' +
    encodeUtf16LeBase64(
      `Add-Type -TypeDefinition 'using System;using System.Text;using System.Runtime.InteropServices;public class DwmRounder{[DllImport("dwmapi.dll")]public static extern int DwmSetWindowAttribute(IntPtr hwnd,int attr,ref int value,int size);[DllImport("user32.dll")]public static extern bool EnumWindows(EnumWindowsProc cb,IntPtr lParam);[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr hwnd,StringBuilder sb,int max);public delegate bool EnumWindowsProc(IntPtr hwnd,IntPtr lParam);}'
$script:hwnd = [IntPtr]::Zero
$cb = [DwmRounder+EnumWindowsProc]{ param($h,$l) $sb = New-Object System.Text.StringBuilder 256; [DwmRounder]::GetWindowText($h,$sb,256) | Out-Null; if ($sb.ToString() -eq 'TODO') { $script:hwnd = $h; return $false }; return $true }
[DwmRounder]::EnumWindows($cb,[IntPtr]::Zero) | Out-Null
if ($script:hwnd -ne [IntPtr]::Zero) { $v = 2; [DwmRounder]::DwmSetWindowAttribute($script:hwnd, 33, [ref]$v, 4) | Out-Null; 'OK' } else { 'NO_WINDOW' }`
    );

  let cornerRoundApplied = false;

  /* 设置窗口 DWM 圆角（幂等）：成功一次后置位，避免重复启动 PowerShell；
     stdOut 不是 OK 说明未找到目标窗口，记入控制台便于排查 */
  function applyRoundedCorners() {
    if (!isNeutralinoEnv() || cornerRoundApplied) return;
    Neutralino.os.execCommand(roundCornerCommand).then(r => {
      if (r?.stdOut?.trim() === 'OK') {
        cornerRoundApplied = true;
      } else {
        console.warn('mini corner round: window not found,', r?.stdOut?.trim() || r?.stdErr || r?.exitCode);
      }
    }).catch(e => console.warn('mini corner round error:', e));
  }

  /* 迷你模式窗口隐藏任务栏：通过 WS_EX_TOOLWINDOW 让窗口不出现在任务栏，
     仅保留系统托盘入口。进入迷你模式设置该样式，退出时恢复普通窗口样式。
     与 DWM 圆角一致，用 EnumWindows 按窗口标题定位（标题来自 config 的 window.title），
     隐藏窗口也能枚举到。 */
  function buildTaskbarToggleCommand(hideFromTaskbar) {
    const styleExpr = hideFromTaskbar
      ? '($style -bor 0x80)'
      : '($style -band (-bnot 0x80))';
    return 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' +
      encodeUtf16LeBase64(
        `Add-Type -TypeDefinition 'using System;using System.Text;using System.Runtime.InteropServices;public class TbToggle{[DllImport("user32.dll")]public static extern bool EnumWindows(EnumWindowsProc cb,IntPtr lParam);[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr hwnd,StringBuilder sb,int max);[DllImport("user32.dll")]public static extern IntPtr GetWindowLongPtr(IntPtr hWnd,int nIndex);[DllImport("user32.dll")]public static extern IntPtr SetWindowLongPtr(IntPtr hWnd,int nIndex,IntPtr dwNewLong);public delegate bool EnumWindowsProc(IntPtr hwnd,IntPtr lParam);}'
$script:hwnd = [IntPtr]::Zero
$cb = [TbToggle+EnumWindowsProc]{ param($h,$l) $sb = New-Object System.Text.StringBuilder 256; [TbToggle]::GetWindowText($h,$sb,256) | Out-Null; if ($sb.ToString() -eq 'TODO') { $script:hwnd = $h; return $false }; return $true }
[TbToggle]::EnumWindows($cb,[IntPtr]::Zero) | Out-Null
if ($script:hwnd -ne [IntPtr]::Zero) { $GWL_EXSTYLE = -20; $style = ([TbToggle]::GetWindowLongPtr($script:hwnd,$GWL_EXSTYLE)).ToInt64(); $new = ${styleExpr}; [TbToggle]::SetWindowLongPtr($script:hwnd,$GWL_EXSTYLE,[IntPtr]$new) | Out-Null; 'OK' } else { 'NO_WINDOW' }`
      );
  }

  let taskbarHidden = false;

  function setMiniTaskbarHidden(hideFromTaskbar) {
    if (!isNeutralinoEnv() || taskbarHidden === hideFromTaskbar) return;
    Neutralino.os.execCommand(buildTaskbarToggleCommand(hideFromTaskbar)).then(r => {
      if (r?.stdOut?.trim() === 'OK') {
        taskbarHidden = hideFromTaskbar;
      } else {
        console.warn('mini taskbar toggle: window not found,', r?.stdOut?.trim() || r?.stdErr || r?.exitCode);
      }
}).catch(e => console.warn('mini taskbar toggle error:', e));
  }

  async function enterMiniMode() {
    isMiniMode = true;
    closeMiniDetail();
    reminders.pause();
    document.documentElement.classList.add('mini-mode-active');
    document.querySelector('.app').style.display = 'none';
    /* 与 .mini-panel 的 96% 玻璃背景保持一致，避免窗口边缘露出纯白底色 */
    document.body.style.background = 'color-mix(in srgb, var(--bg-surface) 96%, transparent)';
    miniPanel.classList.remove('hidden');
    renderMiniPanel();
    if (isNeutralinoEnv()) {
      try {
        await Neutralino.window.setAlwaysOnTop(true);
        /* 先移除边框再调整尺寸：
           1) setSize 必须带 resizable: false，否则 webview 会重新加回 WS_THICKFRAME，
              在 Windows 顶部重绘出一条残留横条（neutralinojs #948/#1328）；
           2) 先移除边框会触发客户区变化，让 WebView2 视口先同步到完整窗口，
              再缩小到 mini 尺寸时视口跟随真实尺寸，避免右侧/底部残留旧视口的白边 */
        await Neutralino.window.setBorderless(true);
        await Neutralino.window.setSize({
          width: miniWidth,
          height: miniHeight,
          minWidth: miniMinWidth,
          minHeight: miniMinHeight,
          resizable: false
        });
        const displays = await Neutralino.computer.getDisplays();
        const primary = displays[0];
        const x = primary.resolution.width - miniWidth - 20;
        const y = 20;
        await Neutralino.window.move(x, y);
        await Neutralino.window.setDraggableRegion('mini-drag-region');
        /* 贴边吸附 + 收起交互：拖拽结束判定吸附，移出窗口后自动收起 */
        miniSnap.attach();
        /* DWM 圆角在应用启动时已设置（applyRoundedCorners），这里仅在启动设置
           失败时兜底重试一次；已成功则跳过，避免反复启动 PowerShell */
        if (!cornerRoundApplied) applyRoundedCorners();
        /* 迷你模式窗口不占用任务栏，只保留系统托盘入口 */
        setMiniTaskbarHidden(true);
      } catch (e) { console.warn('enterMiniMode error:', e); }
    }
  }

  async function exitMiniMode() {
    isMiniMode = false;
    clearTimeout(miniTooltipTimer);
    closeMiniDetail();
    reminders.resume();
    miniPanel.classList.add('hidden');
    miniInputRow.classList.add('hidden');
    document.documentElement.classList.remove('mini-mode-active');
    document.body.style.background = '';
    document.querySelector('.app').style.display = '';
    if (isNeutralinoEnv()) {
      /* 退出前停用贴边吸附：清理计时器与监听，防止残留状态影响主窗口 */
      miniSnap.detach();
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
          width: appConfig?.windowWidth || 1100,
          height: appConfig?.windowHeight || 700,
          minWidth: appConfig?.minWidth || 800,
          minHeight: appConfig?.minHeight || 500,
          resizable: true
        });
        await Neutralino.window.center();
      } catch (e) { console.warn('exitMiniMode resize error:', e); }
      /* 恢复主窗口正常任务栏入口 */
      setMiniTaskbarHidden(false);
    }
    render();
  }

  document.getElementById('btn-mini-mode-footer').addEventListener('click', enterMiniMode);
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
        archived: false,
        archivedAt: null,
        createdAt: Date.now()
      };
      if (todoStore) todoStore.add(todo);
      else data.todos.push(todo);
      saveData();
      miniQuickAdd.value = '';
      renderMiniPanel();
    } else if (e.key === 'Escape') {
      miniInputRow.classList.add('hidden');
    }
  });

  /* ---- 详情卡控件 ---- */
  document.getElementById('btn-mini-detail-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeMiniDetail();
  });
  document.getElementById('btn-mini-detail-toggle').addEventListener('click', (e) => {
    e.stopPropagation();
    handleMiniDetailToggle();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentMiniDetailId) closeMiniDetail();
  });

  /* ---- 迷你窗口缩放：无边框模式下 native 缩放条不可用，用右下角手柄 + setSize 实现 ---- */
  const miniResizeHandle = document.getElementById('mini-resize-handle');
  let resizeState = null;
  let resizeRafId = null;

  function applyMiniResize(width, height) {
    if (!isNeutralinoEnv()) return;
    const w = Math.max(miniMinWidth, Math.round(width));
    const h = Math.max(miniMinHeight, Math.round(height));
    miniWidth = w;
    miniHeight = h;
    Neutralino.window.setSize({ width: w, height: h, minWidth: miniMinWidth, minHeight: miniMinHeight, resizable: false })
      .catch(e => console.warn('mini resize error:', e));
  }

  /* setSize 使用物理像素；在 HiDPI 屏幕（dpr>1）上若直接用 CSS px 的起始宽高，
     会先得到一个比真实窗口小的尺寸，表现为"猛然缩小后再随拖动"回升。
     这里把读到的 CSS px 统一乘 devicePixelRatio 再交给 setSize。 */
  function captureResizeStart(e) {
    const dpr = window.devicePixelRatio || 1;
    return {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: Math.round(window.innerWidth * dpr),
      startHeight: Math.round(window.innerHeight * dpr),
      dpr
    };
  }

  function resizeDelta(state, e) {
    return {
      width: state.startWidth + (e.clientX - state.startX) * state.dpr,
      height: state.startHeight + (e.clientY - state.startY) * state.dpr
    };
  }

  if (miniResizeHandle) {
    if (!isNeutralinoEnv()) miniResizeHandle.classList.add('hidden');
    miniResizeHandle.addEventListener('pointerdown', (e) => {
      if (!isMiniMode) return;
      e.preventDefault();
      miniResizeHandle.setPointerCapture(e.pointerId);
      resizeState = captureResizeStart(e);
    });
    miniResizeHandle.addEventListener('pointermove', (e) => {
      if (!resizeState || e.pointerId !== resizeState.pointerId || resizeRafId != null) return;
      resizeRafId = requestAnimationFrame(() => {
        resizeRafId = null;
        const d = resizeDelta(resizeState, e);
        applyMiniResize(d.width, d.height);
      });
    });
    const endMiniResize = (e) => {
      if (!resizeState) return;
      if (resizeRafId != null) {
        cancelAnimationFrame(resizeRafId);
        resizeRafId = null;
      }
      if (e && e.pointerId === resizeState.pointerId) {
        const d = resizeDelta(resizeState, e);
        applyMiniResize(d.width, d.height);
      }
      resizeState = null;
    };
    miniResizeHandle.addEventListener('pointerup', endMiniResize);
    miniResizeHandle.addEventListener('pointercancel', endMiniResize);
  }

  miniList.addEventListener('click', (e) => {
    const checkbox = e.target.closest('[data-mini-toggle]');
    if (checkbox) {
      const id = checkbox.dataset.miniToggle;
      const todo = todoStore?.get(id) || data.todos.find(t => t.id === id);
      if (todo) {
        const mutate = target => {
          target.done = !target.done;
          target.doneAt = target.done ? new Date().toISOString() : null;
          if (target.done && target.reminderRepeat === 'none') target.reminder = null;
        };
        if (todoStore) todoStore.update(todo, mutate);
        else mutate(todo);
        saveData();
        renderMiniPanel();
      }
      return;
    }
    const item = e.target.closest('.mini-todo-item');
    if (item) openMiniDetail(item.dataset.id);
  });

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
      { icon: 'undo', label: '退出迷你模式', action: exitMiniMode },
      { separator: true },
      { icon: 'x', label: '关闭窗口', action: closeWindow }
    ], { className: 'context-menu--mini' });
  });

  return { enterMiniMode, exitMiniMode, renderMiniPanel, isMiniMode: () => isMiniMode, applyRoundedCorners };
}
