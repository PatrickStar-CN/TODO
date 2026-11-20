import { escapeHtml } from './utils/html.js';
import { formatDateTime } from './utils/date.js';
import { genId } from './utils/id.js';
import { sortByPriority, splitPendingDone } from './selectors.js';
import { iconSvg } from './icons.js';
import { ensureDisplayHz, initMiniSnap } from './miniSnap.js';
import { getUiMotionDuration } from './uiPreferences.js';
import { getTagDotStyle, getTagBadgeStyle, isNeutralinoEnv } from './shared.js';
import { t, getPriorityLabel, getRepeatLabel } from './i18n/index.js';

export function initMiniMode({ data, saveData, render, showToast, showContextMenu, closeWindow, reminders, appConfig, todoStore }) {
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
  const miniDetailSubtitle = document.getElementById('mini-detail-subtitle');
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
    isMiniMode: () => isMiniMode,
    thresholdCss: snapCfg.threshold,
    stripCss: snapCfg.strip,
    collapseDelay: snapCfg.delay
  });

  /* ---- 模式切换：只改 #app-frame 容器尺寸（data-mode + --mode-w/--mode-h） ----
     两种布局常驻 DOM，切换由 CSS 变量过渡完成，不重建主视图、不动窗口几何；
     窗口尺寸/位置交给幂等的 ensureWindowGeometry(mode)，仅在真正变化时下发一次。 */
  const appFrame = document.getElementById('app-frame');
  let switching = false;
  let appliedGeometry = '';
  /* 主窗口矩形记忆：会话内按模式记住位置与尺寸，退出再进入时还原上次矩形 */
  const geometryMemory = Object.create(null);

  /* 容器尺寸的 px 值只在 CSS 变量缺失时兜底；窗口几何落定后统一改写成 100%，
     让 C 区尺寸跟随真实视口，避免 setSize 生效前的短暂不匹配被呈现出来 */
  let inlineModeFrameSize = false;

  function setModeFrameSize(size) {
    if (!appFrame) return;
    if (size) {
      inlineModeFrameSize = true;
      appFrame.style.setProperty('--mode-w', `${size.width}px`);
      appFrame.style.setProperty('--mode-h', `${size.height}px`);
    } else if (inlineModeFrameSize) {
      inlineModeFrameSize = false;
      appFrame.style.setProperty('--mode-w', '100%');
      appFrame.style.setProperty('--mode-h', '100%');
    }
  }

  /* 应用模式：data-mode 驱动布局层显示。容器默认铺满视口，
     只在没有窗口 API 的 Web 端切换迷你布局时用 px 兜底一次 */
  function applyFrameMode(mode, size) {
    if (!appFrame) return;
    /* 容器一律铺满视口：px 兜底只在窗口 API 落地前用一帧，
       落地（或 Web 端）后立刻清掉，否则用户缩放迷你窗口时容器仍按旧 px 渲染 */
    setModeFrameSize(size || null);
    appFrame.dataset.mode = mode;
    if (size) requestAnimationFrame(() => setModeFrameSize(null));
  }

  /* 当前窗口所在显示器：位置读窗口矩形，取代旧的 displays[0]，多显示器下才落在同一块屏 */
  async function getCurrentWorkArea() {
    try {
      const [displays, pos, size] = await Promise.all([
        Neutralino.computer.getDisplays(),
        Neutralino.window.getPosition(),
        Neutralino.window.getSize()
      ]);
      if (!displays?.length) return null;
      const cx = pos.x + Math.round(size.width / 2);
      const cy = pos.y + Math.round(size.height / 2);
      const hit = displays.find((d) => {
        const r = d.workArea || d.resolution;
        return r && cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height;
      }) || displays[0];
      return hit?.workArea || hit?.resolution || null;
    } catch {
      return null;
    }
  }

  /* 幂等：同一 mode + 同一尺寸重复调用不下发任何窗口 API。
     先去掉边框再 setSize（回填 WS_THICKFRAME 会在顶部留横条，neutralinojs #948/#1328），
     并把 C 区尺寸与容器同步，避免 webview 视口尺度不一致产生白边。 */
  async function ensureWindowGeometry(mode) {
    if (!isNeutralinoEnv()) {
      applyFrameMode(mode);
      return;
    }
    const mini = mode === 'mini';
    /* 先记住当前矩形（位置 + 尺寸），供下次回到该模式时还原 */
    try {
      const [prevPos, prevSize] = await Promise.all([
        Neutralino.window.getPosition(),
        Neutralino.window.getSize()
      ]);
      geometryMemory[mini ? 'main' : 'mini'] = {
        x: prevPos.x,
        y: prevPos.y,
        width: Math.round(prevSize.width / (window.devicePixelRatio || 1)),
        height: Math.round(prevSize.height / (window.devicePixelRatio || 1))
      };
    } catch {}
    /* 主窗口沿用用户上次手动缩放后的尺寸，回不到配置里的固定 px */
    const mainRect = geometryMemory.main;
    const width = mini ? miniWidth : (mainRect?.width || appConfig?.windowWidth || 1100);
    const height = mini ? miniHeight : (mainRect?.height || appConfig?.windowHeight || 700);
    const key = `${mode}:${width}x${height}`;
    const size = { width, height };
    if (appliedGeometry === key) {
      applyFrameMode(mode, mini ? size : null);
      return;
    }
    const area = await getCurrentWorkArea();
    if (mini) {
      const remembered = geometryMemory.mini;
      const position = remembered || {
        x: area ? Math.round(area.x + area.width - width - 20) : null,
        y: area ? Math.round(area.y + 20) : null
      };
      try {
        await Neutralino.window.setAlwaysOnTop(true);
        await Neutralino.window.setBorderless(true);
        /* 定位与伸缩一次下发：setSize 的 position 字段同时完成移动与 RECT 写入，
           少一次 IPC 往返，窗口也不在中途位置闪一下 */
        await Neutralino.window.setSize({
          width,
          height,
          minWidth: miniMinWidth,
          minHeight: miniMinHeight,
          resizable: false,
          ...(position.x != null ? { position: { x: position.x, y: position.y } } : {})
        });
      } catch (e) { console.warn('ensureWindowGeometry(mini) error:', e); }
    } else {
      const remembered = geometryMemory.main;
      const target = remembered || (area ? {
        x: Math.round(area.x + (area.width - width) / 2),
        y: Math.round(area.y + (area.height - height) / 2)
      } : null);
      const sizeArgs = {
        width,
        height,
        minWidth: appConfig?.minWidth || 800,
        minHeight: appConfig?.minHeight || 500,
        /* resizable 必须与冷启动一致：false 会留下不可缩放的窗口；
           true 时 Windows 会回填 WS_THICKFRAME，属于普通窗口的既定期望 */
        resizable: true
      };
      try {
        /* 顺序固定为 边框 → 置顶 → 尺寸+位置。边框下发会跨到 win32 SetWindowLong 并触发
           WM_NCCALCSIZE，紧随其后的 setSize 会与它重叠，导致原生窗框晚半拍才重绘；
           定位并入同一次 setSize，少一次往返。 */
        await Neutralino.window.setBorderless(false);
        await Neutralino.window.setAlwaysOnTop(false);
        await Neutralino.window.setSize({
          ...sizeArgs,
          ...(target ? { position: { x: target.x, y: target.y } } : {})
        });
      } catch (e) { console.warn('ensureWindowGeometry(main) error:', e); }
      /* resizable:true 会让 Windows 在 setSize 之后才回填 WS_THICKFRAME 并再触发一次
         非客户区重算；补一次尺寸不变的 setSize 把这次迟到的重算吃掉 */
      Promise.resolve()
        .then(() => Neutralino.window.setSize(sizeArgs))
        .catch((e) => console.warn('ensureWindowGeometry(main) settle error:', e));
    }
    appliedGeometry = key;
    /* 迷你容器按目标尺寸兜底，主容器一律交给视口，避免窗口与容器尺寸错位 */
    applyFrameMode(mode, mini ? size : null);
  }

  function renderMiniPanel() {
    const { pending } = splitPendingDone(data.todos);
    document.getElementById('mini-pending-count').textContent = pending.length;

    const sorted = sortByPriority(pending);
    const items = sorted.slice(0, 8);
    miniList.classList.toggle('is-empty', items.length === 0);
    miniList.innerHTML = items.length === 0
      ? `<div class="mini-empty-state">${iconSvg('inbox')}<strong>${t('mini.empty')}</strong><span>${t('mini.emptyHint')}</span></div>`
      : items.map(item => {
        const prioCls = item.priority && item.priority !== 'none' ? item.priority : '';
        const tagChip = item.tag
          ? `<span class="mini-item-tag" ${getTagBadgeStyle(item.tag, data.tags)}><span class="tag-dot" aria-hidden="true"></span><span class="mini-item-tag-label">${escapeHtml(item.tag)}</span></span>`
          : '';
        return `<div class="mini-todo-item${prioCls ? ` p-${prioCls}` : ''}" data-id="${item.id}">
          <button class="mini-checkbox" type="button" data-mini-toggle="${item.id}" aria-label="${t('todo.completeTask', { title: escapeHtml(item.title) })}"></button>
          <span class="mini-todo-title">${escapeHtml(item.title)}</span>
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
      const label = { high: t('mini.prioHigh'), medium: t('mini.prioMedium'), low: t('mini.prioLow') }[todo.priority];
      html += `<div class="mini-tooltip-row">${iconSvg('circle', `icon-priority-${todo.priority}`)}<span>${label}</span></div>`;
    }
    if (todo.tag) {
      html += `<div class="mini-tooltip-row"><span class="tag-dot" ${getTagDotStyle(todo.tag, data.tags)}></span>${escapeHtml(todo.tag)}</div>`;
    }
    if (todo.endTime) {
      html += `<div class="mini-tooltip-row">${iconSvg('calendar')}<span>${formatDateTime(todo.endTime)}</span></div>`;
    }
    if (todo.startTime) {
      html += `<div class="mini-tooltip-row">${iconSvg('clock')}<span>${t('mini.startPrefix', { time: formatDateTime(todo.startTime) })}</span></div>`;
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
    return getPriorityLabel(todo.priority || 'none');
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
    addRow('flag', t('mini.rowPriority'), `<span class="mini-priority-dot ${dotClass}" aria-hidden="true"></span>${getMiniPriorityLabel(todo)}`);
    if (todo.tag) {
      addRow('tag', t('mini.rowTag'), `<span class="tag-dot" ${getTagDotStyle(todo.tag, data.tags)} aria-hidden="true"></span>${escapeHtml(todo.tag)}`);
    }
    if (todo.startTime) {
      addRow('clock', t('mini.rowStart'), escapeHtml(formatDateTime(todo.startTime)));
    }
    if (todo.endTime) {
      addRow('calendar', t('mini.rowEnd'), escapeHtml(formatDateTime(todo.endTime)));
    }
    if (todo.reminder) {
      const repeatLabel = getRepeatLabel(todo.reminderRepeat) === getRepeatLabel('none') ? '' : getRepeatLabel(todo.reminderRepeat);
      addRow('bell', t('mini.rowReminder'), `${escapeHtml(formatDateTime(todo.reminder))}${repeatLabel ? `（${repeatLabel}）` : ''}`);
    }
    addRow('plus', t('mini.rowCreate'), escapeHtml(formatDateTime(todo.createdAt)));
    return rows.join('');
  }

  function renderMiniDetail(todo) {
    if (!todo) return;
    currentMiniDetailId = todo.id;
    /* 头部保持固定标题，任务标题完整展示在可滚动正文里：
       超长标题不会撑开/挤占头部，也不会被省略号截断 */
    const summary = [t('mini.pending')];
    if (todo.priority && todo.priority !== 'none') summary.push(getMiniPriorityLabel(todo));
    if (todo.tag) summary.push(todo.tag);
    miniDetailTitle.textContent = t('mini.detail');
    miniDetailTitle.title = t('mini.detail');
    miniDetailSubtitle.textContent = summary.join(' · ');
    miniDetailCard.setAttribute('aria-label', todo.title || t('mini.detail'));
    miniDetailToggleLabel.textContent = todo.done ? t('mini.unDone') : t('mini.markDone');
    let html = `<div class="mini-detail-task-title">${escapeHtml(todo.title || '')}</div>`;
    if (todo.desc) {
      html += `<div class="mini-detail-desc">${escapeHtml(todo.desc)}</div>`;
    }
    html += `<div class="mini-detail-meta">${buildMiniDetailRows(todo)}</div>`;
    miniDetailBody.innerHTML = html;
    miniDetailBody.scrollTop = 0;
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

  /* 期望标题以 UTF-8 base64 下发：命令行参数不是 UTF-8 文本，中文标题内联会变成问号，
     在脚本里解码后比较，任何语言的标题都能精确匹配。 */
  function encodeUtf8Base64(str) {
    let bin = '';
    for (const b of new TextEncoder().encode(String(str))) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  /* 目标窗口定位：WG_MINI 必然有标题栏按钮，用来确认句柄合法（防止改到桌面/浏览器窗口）；
     标题与配置的 windowTitle 不一致时退化为只认 WG_MINI，因为标题随语言/文档变化。
     只取 Z 序前 8 个可见的其他进程窗口，尽量让任务栏、托盘这些非目标窗口落选。 */
  /* 窗口圆角与界面圆角取同一个设置值（设置 → 外观 → 圆角，6–20px）：
     DWM 圆角半径单位是 1/96 英寸，96 DPI 下 1 单位约等于 1px，四角才跟面板严丝合缝 */
  function currentWindowRadius() {
    const raw = Number(data?.uiStyle?.radius);
    const radius = Number.isFinite(raw) ? raw : 12;
    return Math.min(20, Math.max(6, Math.round(radius)));
  }

  /* 一次调用把目标形态的扩展样式与 DWM 圆角一起写回：两者在同一个进程内下发，
     窗框只重算一遍。style 取 'mini'（去边框可拖拽）或 'main'（装回原生窗框），
     圆角半径两种形态一致，都跟随设置里的圆角。 */
  function buildMiniModeCommand(hwnd, style) {
    /* 只改目标位的差集写法，而不是整字覆盖：WS_EX_STATICEDGE 之类窗口自带的位原样保留，
       退出迷你模式时样式才能被系统接受（整字覆盖里的 0x00180000 保留位会被
       SetWindowLongPtr 拒绝，err=87）。迷你态清 LAYERED(0x00080000) 保留静态边与 APPWINDOW。 */
    const styleExpr = style === 'mini'
      ? '$newEx = $ex -band (-bnot 0x00080000)'
      : '$newEx = ($ex -band (-bnot 0x00180000)) -bor 0x00080008';
    /* DWMWA_WINDOW_CORNER_PREFERENCE(33)=DWMWCP_ROUND，DWM_WINDOW_CORNER_RADIUS(38)=圆角半径；
       半径要显式写，否则系统只给默认的小圆角，迷你窗口的四角会明显比面板更尖 */
    const windowRadius = currentWindowRadius();
    return 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' +
      encodeUtf16LeBase64(
        `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class TbToggle{[DllImport("user32.dll",SetLastError=true)]public static extern IntPtr GetWindowLongPtr(IntPtr hWnd,int nIndex);[DllImport("user32.dll",SetLastError=true)]public static extern IntPtr SetWindowLongPtr(IntPtr hWnd,int nIndex,IntPtr dwNewLong);[DllImport("user32.dll",SetLastError=true)]public static extern bool SetWindowPos(IntPtr hWnd,IntPtr hWndInsertAfter,int X,int Y,int cx,int cy,uint uFlags);[DllImport("user32.dll")]public static extern bool IsWindow(IntPtr hWnd);[DllImport("dwmapi.dll")]public static extern int DwmSetWindowAttribute(IntPtr hWnd,int attr,ref int v,int size);}'
 $GWL_EXSTYLE = -20; $GWL_STYLE = -16
 $hwnd = [IntPtr][int64]${hwnd}
 if ((-not [TbToggle]::IsWindow($hwnd)) -or ($hwnd -eq [IntPtr]::Zero)) { 'NO_WINDOW' } else {
   $frame = ([TbToggle]::GetWindowLongPtr($hwnd,$GWL_STYLE)).ToInt64()
   $ex = ([TbToggle]::GetWindowLongPtr($hwnd,$GWL_EXSTYLE)).ToInt64()
   ${styleExpr}
   [TbToggle]::SetWindowLongPtr($hwnd,$GWL_EXSTYLE,[IntPtr]$newEx) | Out-Null
   /* 有 WS_POPUP 说明是 borderless 形态：原位保留 frame 样式位，只补 WS_THICKFRAME，绝不写负掩码 */
   if ($newEx -band 0x08) { $newFrame = $frame -bor 0x00040000 } else { $newFrame = $frame }
   [TbToggle]::SetWindowLongPtr($hwnd,$GWL_STYLE,[IntPtr]$newFrame) | Out-Null
   $v = 2
   [TbToggle]::DwmSetWindowAttribute($hwnd,33,[ref]$v,4) | Out-Null
   $rc = ${windowRadius}
   [TbToggle]::DwmSetWindowAttribute($hwnd,38,[ref]$rc,4) | Out-Null
   [TbToggle]::SetWindowPos($hwnd,[IntPtr]::Zero,0,0,0,0,0x27) | Out-Null
   'OK' }`
      );
  }

  /* DWM 圆角两种形态取同一半径，都跟随设置里的圆角；样式位与圆角在同一次进程内下发。
     单飞 + 脏标记：PowerShell 冷启动是秒级的，用户在设置里拖动滑杆会连续触发，
     并发重算非客户区只会让窗框反复闪，最后一个半径落下后再补一次即可 */
  let shapeInFlight = false;
  let shapeDirty = false;

  async function runWindowShape(style) {
    if (!isNeutralinoEnv()) return;
    if (shapeInFlight) {
      shapeDirty = true;
      return;
    }
    shapeInFlight = true;
    try {
      const hwnd = await resolveWindowHandle();
      if (hwnd !== null) {
        try {
          const r = await Neutralino.os.execCommand(buildMiniModeCommand(hwnd, style));
          if (r?.stdOut?.trim() !== 'OK') {
            console.warn('mini window shape: window not found,', r?.stdOut?.trim() || r?.stdErr || r?.exitCode);
          }
        } catch (e) { console.warn('mini window shape error:', e); }
      }
    } finally {
      shapeInFlight = false;
    }
    if (shapeDirty) {
      shapeDirty = false;
      await runWindowShape(style);
    }
  }


  async function enterMiniMode() {
    if (switching || isMiniMode) return;
    switching = true;
    try {
      isMiniMode = true;
      closeMiniDetail();
      reminders.pause();
      document.documentElement.classList.add('mini-mode-active');
      /* 与 .mini-panel 的 96% 玻璃背景保持一致，避免窗口边缘露出纯白底色 */
      document.body.style.background = 'color-mix(in srgb, var(--bg-surface) 96%, transparent)';
      /* 先按目标尺寸布好容器（窗口 API 落地前第一帧就有正确比例），
         再由 ensureWindowGeometry 一次性下发窗口几何 */
      applyFrameMode('mini', { width: miniWidth, height: miniHeight });
      miniPanel.classList.remove('hidden');
      miniInputRow.classList.add('hidden');
      renderMiniPanel();
      if (isNeutralinoEnv()) {
        try {
          /* 拖拽区先于窗口几何注册：几何与窗框重算都要等进程/IPC，先挂上拖拽区，
             迷你窗口一出现就能拖动，不必等后面几步走完 */
          await Neutralino.window.setDraggableRegion('mini-drag-region');
          /* 贴边吸附关闭时把收起偏移归零，避免上次收起状态残留 */
          await ensureWindowGeometry('mini');
          miniSnap.attach();
        } catch (e) { console.warn('enterMiniMode error:', e); }
        /* 窗框形态（直角/样式位）是纯外观，不进入上面的等待链：PowerShell 冷启动要秒级，
           串进来就会让切换卡住、期间窗口拖不动。失败也不影响切换本身 */
        runWindowShape('mini');
      }
    } finally {
      switching = false;
    }
  }

  async function exitMiniMode() {
    if (switching || !isMiniMode) return;
    switching = true;
    try {
      isMiniMode = false;
      clearTimeout(miniTooltipTimer);
      closeMiniDetail();
      reminders.resume();
      if (isNeutralinoEnv()) {
        /* 退出前停用贴边吸附：清理计时器与监听，防止残留状态影响主窗口 */
        miniSnap.detach();
        try {
          await Neutralino.window.unsetDraggableRegion('mini-drag-region');
        } catch (e) {}
      }
      miniInputRow.classList.add('hidden');
      document.documentElement.classList.remove('mini-mode-active');
      document.body.style.background = '';
      /* 容器继续保持迷你尺寸（main 挂载点本来就铺满 #app-frame）：
         提前把 data-mode 切成主模式会让主布局先按迷你窗口排一遍，
         窗口恢复前既闪一下也会白白重排一次大列表 */
      miniPanel.classList.add('hidden');
      if (isNeutralinoEnv()) {
        /* 边框、置顶、尺寸、位置全部由 ensureWindowGeometry 一次下发：
           这里不再重复调 setBorderless/setAlwaysOnTop，避免同一个原生窗框
           被重算两遍（第一遍还是无边框形态），也少一次等待 IPC 的卡顿 */
        try {
          await ensureWindowGeometry('main');
        } catch (e) { console.warn('exitMiniMode geometry error:', e); }
      }
      /* 只刷新状态栏这类轻量信息：主视图 DOM 全程保留，切换不重建列表 */
      try { render(); } catch (e) { console.warn('exitMiniMode render error:', e); }
      /* 窗口尺寸已恢复，再把容器切回主模式：容器默认 100%，视口一变就跟随 */
      applyFrameMode('main');
      /* 几何落定后再恢复原生窗框：一次进程内换回普通扩展样式、清 WS_POPUP、
         补回 WS_THICKFRAME、装回 DWM 圆角并 SWP_FRAMECHANGED 重算非客户区。
         串行执行是必要的，否则重算会落在边框切换中途，标题栏要等下一次拖动才正确 */
      /* 样式还原失败也不能把 switching 永久锁死：否则之后再也切不回迷你模式 */
      try {
        await runWindowShape('main');
      } catch (e) { console.warn('exitMiniMode frame restore error:', e); }
    } finally {
      switching = false;
    }
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
    /* 容器由 --mode-w/--mode-h 钉回 100% 后自动跟随视口，
       缩放后的矩形记进 appliedGeometry 与矩形记忆，下次进入按这个尺寸还原 */
    appliedGeometry = `mini:${w}x${h}`;
    const mem = geometryMemory.mini || (geometryMemory.mini = { x: null, y: null });
    mem.width = w;
    mem.height = h;
    /* resizable 必须每帧都带上：Windows 在无边框窗口上会重算 WS_THICKFRAME，
       漏掉就会把迷你窗口变成不可缩放，退出时窗框也回不到原生样式 */
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
      { icon: 'undo', label: t('mini.exitMini'), action: exitMiniMode },
      { separator: true },
      { icon: 'x', label: t('common.closeWindow'), action: closeWindow }
    ], { className: 'context-menu--mini' });
  });

  /* 启动时实测刷新率，贴边收起的时长据此换算，首次交互即可命中缓存 */
  try {
    ensureDisplayHz();
  } catch {}

  /* 目标窗口定位：优先按配置里的 windowTitle 精确匹配；标题法可能因语言包或多文档
     页面失配，再用“扩展样式非零 + 可见 + 有任务栏按钮（WS_EX_APPWINDOW）”兜底。
     扩展样式为 0 的窗口是 WS_EX_NOACTIVATE 的幽灵窗口（EnumWindows 也会返回它们），
     改它们的样式对标题栏和任务栏毫无影响，而错误命中会让真正的窗口被跳过。 */
  function buildWindowLocateCommand(title) {
    const want = encodeUtf8Base64(String(title));
    return 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' +
      encodeUtf16LeBase64(
        `Add-Type -TypeDefinition 'using System;using System.Text;using System.Runtime.InteropServices;public class WindowLocator{[DllImport("user32.dll")]public static extern bool EnumWindows(EnumWindowsProc cb,IntPtr lParam);[DllImport("user32.dll")]public static extern int GetWindowThreadProcessId(IntPtr hwnd,out int pid);[DllImport("user32.dll")]public static extern IntPtr GetWindowLongPtr(IntPtr hwnd,int nIndex);[DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr hwnd);[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr hwnd,StringBuilder sb,int max);public delegate bool EnumWindowsProc(IntPtr hwnd,IntPtr lParam);}'
 $GWL_EXSTYLE = -20; $WS_EX_APPWINDOW = 0x40000
 $script:exact = [IntPtr]::Zero; $script:fallback = [IntPtr]::Zero
 $cb = [WindowLocator+EnumWindowsProc]{ param($h,$l)
   $pid2 = 0
   [WindowLocator]::GetWindowThreadProcessId($h,[ref]$pid2) | Out-Null
   if ($pid2 -eq $PID) { return $true }
   $ex = ([WindowLocator]::GetWindowLongPtr($h,$GWL_EXSTYLE)).ToInt64()
   if (($ex -eq 0) -or (-not [WindowLocator]::IsWindowVisible($h))) { return $true }
   $want = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${want}'))
   $sb = New-Object System.Text.StringBuilder 256
   [WindowLocator]::GetWindowText($h,$sb,256) | Out-Null
   if ($sb.ToString() -eq $want) { $script:exact = $h; return $false }
   if (((($ex -band $WS_EX_APPWINDOW) -ne 0)) -and ($script:fallback -eq [IntPtr]::Zero)) { $script:fallback = $h }
   return $true }
 [WindowLocator]::EnumWindows($cb,[IntPtr]::Zero) | Out-Null
 $found = $script:exact
 if ($found -eq [IntPtr]::Zero) { $found = $script:fallback }
 if ($found -ne [IntPtr]::Zero) { 'OK:' + $found.ToInt64() } else { 'NO_WINDOW' }`
      );
  }

  /* 窗口句柄缓存：Neutralino 的客户端库不暴露窗口句柄，只能靠 PowerShell 枚举拿到。
     枚举要起一个进程（约 100-300ms），所以结果缓存起来；但普通模式启动时窗口可能还没
     显示，缓存会拿到空的兜底结果，因此只缓存能通过 IsWindow 校验的句柄 */
  let cachedWindowHandle = null;

  async function resolveWindowHandle() {
    /* 客户端库 6.7.0 不暴露 window.hwnd（grep hwnd 为 0），句柄优先取运行时值，缺失时退回按标题枚举 */
    const exposed = Number(Neutralino?.window?.hwnd);
    if (Number.isFinite(exposed) && exposed > 0) return Math.trunc(exposed);
    const target = windowTitle();
    try {
      if (cachedWindowHandle !== null) {
        const check = await Neutralino.os.execCommand(buildWindowVerifyCommand(cachedWindowHandle, target));
        if (String(check?.stdOut || '').trim() === 'OK') return cachedWindowHandle;
        cachedWindowHandle = null;
      }
      const r = await Neutralino.os.execCommand(buildWindowLocateCommand(target));
      const m = /^OK:(\d+)$/.exec(String(r?.stdOut || '').trim());
      if (!m) {
        console.warn('mini window handle: window not found,', String(r?.stdOut || '').trim() || r?.stdErr || r?.exitCode);
        return null;
      }
      cachedWindowHandle = Number(m[1]);
      return cachedWindowHandle;
    } catch (e) {
      console.warn('mini window handle error:', e);
      return null;
    }
  }

  /* 缓存句柄每次使用前先校验：句柄可能属于已经退出的上一轮窗口，Windows 还会把
     同一个数值复用给新窗口，命中别人的窗口比找不到更糟 */
  function buildWindowVerifyCommand(hwnd, title) {
    const want = encodeUtf8Base64(String(title));
    return 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' +
      encodeUtf16LeBase64(
        `Add-Type -TypeDefinition 'using System;using System.Text;using System.Runtime.InteropServices;public class WindowVerify{[DllImport("user32.dll")]public static extern bool IsWindow(IntPtr hWnd);[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr hWnd,StringBuilder sb,int max);}'
 $hwnd = [IntPtr][int64]${hwnd}
 if ((-not [WindowVerify]::IsWindow($hwnd)) -or ($hwnd -eq [IntPtr]::Zero)) { 'STALE' } else {
   $want = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${want}'))
   $sb = New-Object System.Text.StringBuilder 512
   [WindowVerify]::GetWindowText($hwnd,$sb,512) | Out-Null
   if ($sb.ToString() -eq $want) { 'OK' } else { 'STALE' } }`
      );
  }

  /* 标题取配置项 windowTitle；appConfig 是首屏之后异步加载的，读不到时退回文档标题 */
  function windowTitle() {
    return appConfig?.windowTitle || appConfig?.window?.title || document.title || 'TODO';
  }

  /* applyRoundedCorners 保留给启动时预热：预先枚举并缓存窗口句柄，进入迷你模式时少一次进程启动 */
  /* 设置里改了圆角就同步窗口本身的圆角：迷你模式下宿主窗口就是可见的那块面板，
     不跟设置走的话四角会与面板圆角对不上。切换中的窗口交给切换流程自己收尾，避免并发重算非客户区 */
  function refreshWindowRadius() {
    if (switching) return;
    /* 主模式在窗口不可见时（设置面板打开也可能落在隐藏窗口上）不必重算，
       但迷你模式一定可见，必须跟着设置立刻变 */
    runWindowShape(isMiniMode ? 'mini' : 'main').catch(() => {});
  }

  return { enterMiniMode, exitMiniMode, renderMiniPanel, isMiniMode: () => isMiniMode, applyRoundedCorners: () => runWindowShape('main'), refreshWindowRadius };
}
