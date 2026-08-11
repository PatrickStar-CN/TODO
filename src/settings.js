import { escapeHtml } from './utils/html.js';
import { applyTheme } from './theme.js';
import { closeDetail } from './detail.js';
import { showConfirmDialog } from './overlay.js';
import { DEFAULT_UI_STYLE, applyUiStyle, getUiMotionDuration, normalizeUiStyle } from './uiPreferences.js';
import { iconSvg } from './icons.js';
import { normalizeTimelineSettings } from './timeline.js';

const TAG_COLORS = ['#4f46e5', '#06b6d4', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];

let data, saveData, showToast, render, testNotification, getNotificationStatus;
let onTagRenamed = null;
let onTagDeleted = null;
let settingsOverlay = null;
let updater = null;
let updateStatusUnsub = null;

function getTagColor(tag) {
  if (!tag) return TAG_COLORS[0];
  const index = data.tags.indexOf(tag);
  return TAG_COLORS[(index >= 0 ? index : 0) % TAG_COLORS.length];
}

function getTagTaskCount(tag) {
  /* 优先使用 _index 索引（O(1)） */
  if (data._index && data._index.tagTotal) {
    return data._index.tagTotal[tag] || 0;
  }
  return data.todos.filter(t => t.tag === tag).length;
}

// --- 弹窗开关 ---

function closePanel() {
  updateStatusUnsub?.();
  updateStatusUnsub = null;
  if (!settingsOverlay) return;
  const modal = settingsOverlay.querySelector('.settings-modal');
  if (modal) modal.style.animation = 'modalShrinkOut var(--motion-normal) forwards';
  settingsOverlay.classList.add('closing');
  const overlayRef = settingsOverlay;
  settingsOverlay = null;
  overlayRef.addEventListener('animationend', () => overlayRef.remove(), { once: true });
  setTimeout(() => { if (overlayRef.parentNode) overlayRef.remove(); }, getUiMotionDuration('normal') + 50);
}

function openPanel() {
  if (settingsOverlay) return;

  // 关闭详情面板和 AI 总结面板
  const summaryPanel = document.getElementById('summary-panel');
  if (summaryPanel && !summaryPanel.classList.contains('hidden')) {
    summaryPanel.classList.add('hiding');
    summaryPanel.addEventListener('animationend', () => {
      summaryPanel.classList.add('hidden');
      summaryPanel.classList.remove('hiding');
    }, { once: true });
    setTimeout(() => {
      if (summaryPanel.classList.contains('hiding')) {
        summaryPanel.classList.add('hidden');
        summaryPanel.classList.remove('hiding');
      }
    }, 300);
  }
  closeDetail();

  // 创建弹窗
  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '设置');
  overlay.innerHTML = `
    <div class="settings-modal">
      <div class="settings-header">
        <h3>设置</h3>
        <button class="icon-btn settings-close-btn" id="close-settings" type="button" aria-label="关闭设置">${iconSvg('x')}</button>
      </div>
      <div class="settings-tabs" role="tablist" aria-label="设置分类">
<button class="settings-tab active" type="button" role="tab" aria-selected="true" data-tab="appearance">${iconSvg('settings')}<span>外观</span></button>
        <button class="settings-tab" type="button" role="tab" aria-selected="false" data-tab="ai">${iconSvg('document')}<span>AI 配置</span></button>
        <button class="settings-tab" type="button" role="tab" aria-selected="false" data-tab="notifications">${iconSvg('bell')}<span>提醒</span></button>
        <button class="settings-tab" type="button" role="tab" aria-selected="false" data-tab="tags">${iconSvg('tag')}<span>标签管理</span></button>
        <button class="settings-tab" type="button" role="tab" aria-selected="false" data-tab="system">${iconSvg('settings')}<span>系统</span></button>
      </div>
      <div class="settings-body">
        <div class="settings-pane active" data-pane="appearance">
          <section class="settings-appearance-card" aria-labelledby="appearance-theme-title">
            <div class="settings-appearance-card-heading">
              <div>
                <strong id="appearance-theme-title">主题模式</strong>
                <span>选择适合当前环境的显示方式</span>
              </div>
            </div>
            <div class="theme-options">
              <button class="theme-opt" type="button" aria-pressed="false" data-theme-value="auto">${iconSvg('monitor')}<span>跟随系统</span></button>
              <button class="theme-opt" type="button" aria-pressed="false" data-theme-value="light">${iconSvg('sun')}<span>白天</span></button>
              <button class="theme-opt" type="button" aria-pressed="false" data-theme-value="dark">${iconSvg('moon')}<span>夜间</span></button>
            </div>
          </section>
          <section class="settings-style-section settings-appearance-card" aria-labelledby="appearance-style-title">
            <div class="settings-style-heading">
              <div>
                <strong id="appearance-style-title">界面细节</strong>
                <span>微调圆角、透明度、字号、模糊与动画速度</span>
              </div>
              <button class="btn-secondary btn-sm settings-secondary-action" id="reset-ui-style" type="button">${iconSvg('undo')}<span>恢复默认</span></button>
            </div>
            <div class="settings-style-grid">
              ${createStyleSlider('radius', '圆角', 6, 20, 'px')}
              ${createStyleSlider('glassOpacity', '玻璃透明度', 35, 100, '%')}
              ${createStyleSlider('fontScale', '字体大小', 90, 115, '%')}
              ${createStyleSlider('blur', '模糊强度', 8, 28, 'px')}
              ${createStyleSlider('motionSpeed', '动画速度', 0, 200, '%', 50)}
            </div>
          </section>
          <section class="settings-content-card settings-timeline-card" aria-labelledby="settings-timeline-title">
            <div class="timeline-setting-row">
              <div class="settings-content-card-heading">
                <div>
                  <strong id="settings-timeline-title">任务时间线</strong>
                  <span>在主任务列表右侧显示创建与完成时间</span>
                </div>
              </div>
              <button class="settings-switch" id="set-timeline-enabled" type="button" role="switch" aria-checked="false" aria-label="开启任务时间线">
                <span aria-hidden="true"></span>
              </button>
            </div>
            <div class="timeline-sort-settings" id="timeline-sort-settings">
              <span class="timeline-sort-label">排序依据</span>
              <div class="timeline-sort-options" role="group" aria-label="时间线排序依据">
                <button type="button" data-timeline-sort="created" aria-pressed="false">创建时间</button>
                <button type="button" data-timeline-sort="completed" aria-pressed="false">完成时间</button>
              </div>
              <p>开启时间线后生效；按完成时间排序时隐藏未完成任务，所有模式均为最新在上。</p>
            </div>
          </section>
        </div>
        <div class="settings-pane" data-pane="ai">
          <section class="settings-content-card settings-ai-card" aria-labelledby="settings-ai-card-title">
            <div class="settings-content-card-heading">
              <div>
                <strong id="settings-ai-card-title">连接信息</strong>
                <span>配置信息仅保存在当前设备</span>
              </div>
            </div>
            <div class="settings-form-grid">
              <div class="settings-row settings-field-wide">
                <label for="set-api-url">API 地址</label>
                <input type="text" id="set-api-url" placeholder="https://api.openai.com/v1">
              </div>
              <div class="settings-row">
                <label for="set-api-key">API Key</label>
                <input type="password" id="set-api-key" placeholder="sk-...">
              </div>
              <div class="settings-row">
                <label for="set-model">模型</label>
                <input type="text" id="set-model" placeholder="gpt-4o-mini">
              </div>
              <div class="settings-row settings-field-wide">
                <label for="set-prompt">自定义提示词</label>
                <textarea id="set-prompt" rows="3" placeholder="留空使用默认提示词"></textarea>
              </div>
            </div>
            <button class="btn-primary btn-sm settings-primary-action" id="set-save-ai" type="button">${iconSvg('check')}<span>保存 AI 配置</span></button>
          </section>
        </div>
        <div class="settings-pane" data-pane="notifications">
          <section class="settings-content-card settings-notification-card" aria-labelledby="settings-notification-title">
            <div class="notification-setting-card">
              <span class="notification-status-dot" id="notification-status-dot" aria-hidden="true"></span>
              <div class="notification-setting-copy">
                <strong id="settings-notification-title">系统通知</strong>
                <span id="notification-status-text"></span>
              </div>
              <button class="btn-secondary btn-sm settings-secondary-action" id="test-notification" type="button">${iconSvg('bell')}<span>发送测试通知</span></button>
            </div>
            <div class="settings-notification-note">
              ${iconSvg('clock')}
              <span>带提醒时间的任务会在应用运行时触发通知。</span>
            </div>
          </section>
</div>
        <div class="settings-pane" data-pane="tags">
          <section class="settings-content-card settings-tags-card" aria-label="标签列表与新建标签">
            <div class="settings-tag-add-bar">
              <span class="tag-dot settings-tag-preview" id="settings-tag-preview" aria-hidden="true"></span>
              <input type="text" id="set-add-tag-input" placeholder="添加新标签..." maxlength="20" autocomplete="off" spellcheck="false" aria-label="新标签名称">
              <button class="icon-btn settings-tag-add-btn" id="set-add-tag-btn" type="button" title="添加标签" aria-label="添加标签">${iconSvg('plus')}</button>
            </div>
            <div id="settings-tag-list" class="settings-tag-list"></div>
          </section>
        </div>
        <div class="settings-pane" data-pane="system">
          <section class="settings-content-card settings-update-card" aria-labelledby="settings-update-title">
            <div class="settings-content-card-heading">
              <div>
                <strong id="settings-update-title">软件更新</strong>
                <span>从 GitHub Releases 获取最新版本，替换后自动重启</span>
              </div>
            </div>
            <div class="update-version-row">
              <span>当前版本</span>
              <strong id="update-current-version"></strong>
            </div>
            <div id="update-status-area" class="update-status-area" aria-live="polite"></div>
            <div class="update-actions">
              <button class="btn-primary btn-sm settings-primary-action" id="btn-check-update" type="button">${iconSvg('refresh')}<span>检查更新</span></button>
              <button class="btn-primary btn-sm settings-primary-action hidden" id="btn-download-update" type="button">${iconSvg('download')}<span>下载更新</span></button>
              <button class="btn-primary btn-sm settings-primary-action hidden" id="btn-restart-update" type="button">${iconSvg('refresh')}<span>立即重启</span></button>
            </div>
          </section>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  settingsOverlay = overlay;

  // 设置弹窗从触发按钮位置放大动画
  const modal = overlay.querySelector('.settings-modal');
  const triggerBtn = document.getElementById('btn-settings');
  if (triggerBtn) {
    const rect = triggerBtn.getBoundingClientRect();
    modal.style.setProperty('--origin-x', `${rect.left + rect.width / 2 - window.innerWidth / 2}px`);
    modal.style.setProperty('--origin-y', `${rect.top + rect.height / 2 - window.innerHeight / 2}px`);
  }
  modal.style.animation = 'modalExpandIn var(--motion-panel)';

  // 点击遮罩关闭（点击 modal 内部不触发）
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closePanel();
  });

  // 关闭按钮
  overlay.querySelector('#close-settings').addEventListener('click', closePanel);

  // Tab 切换
  overlay.querySelector('.settings-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.settings-tab');
    if (!tab) return;
    switchTab(overlay, tab.dataset.tab);
  });

  // 主题切换
  overlay.querySelectorAll('.theme-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      data.theme = btn.dataset.themeValue;
      saveData();
      applyTheme(data.theme, { animate: true });
      updateThemeSelection(overlay);
    });
  });

  // AI 配置保存
  overlay.querySelector('#set-save-ai').addEventListener('click', () => {
    data.aiConfig.apiUrl = overlay.querySelector('#set-api-url').value.trim();
    data.aiConfig.apiKey = overlay.querySelector('#set-api-key').value.trim();
    data.aiConfig.model = overlay.querySelector('#set-model').value.trim();
    data.aiConfig.customPrompt = overlay.querySelector('#set-prompt').value.trim();
    saveData();
    showToast('AI 配置已保存');
  });

  // 新建标签
  const addTagInput = overlay.querySelector('#set-add-tag-input');
  overlay.querySelector('#set-add-tag-btn').addEventListener('click', () => createTag(overlay));
  addTagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      createTag(overlay);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      addTagInput.value = '';
    }
  });

  bindUiStyleControls(overlay);
  bindTimelineControls(overlay);
  bindUpdateControls(overlay);

  overlay.querySelector('#test-notification').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const label = button.querySelector('span');
    button.disabled = true;
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
    if (label) label.textContent = '发送中';
    try {
      await testNotification?.();
      updateNotificationStatus(overlay);
    } finally {
      button.disabled = false;
      button.classList.remove('is-loading');
      button.removeAttribute('aria-busy');
      if (label) label.textContent = '发送测试通知';
    }
  });

  // 标签列表事件委托
  const tagListEl = overlay.querySelector('#settings-tag-list');
  tagListEl.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('[data-role="delete-tag"]');
    if (deleteBtn) {
      deleteTag(deleteBtn.dataset.tag, overlay);
      return;
    }
  });

  tagListEl.addEventListener('dblclick', (e) => {
    const nameEl = e.target.closest('[data-role="rename-tag"]');
    if (!nameEl) return;
    const item = nameEl.closest('.tag-manage-item');
    const oldTag = item.dataset.tag;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tag-rename-input';
    input.value = oldTag;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const doRename = () => {
      const newName = input.value.trim();
      if (!newName || newName === oldTag) {
        renderTagList(overlay);
        return;
      }
      if (data.tags.includes(newName)) {
        showToast('标签名已存在');
        input.focus();
        return;
      }
      const idx = data.tags.indexOf(oldTag);
      if (idx !== -1) data.tags[idx] = newName;
      data.todos.forEach(todo => { if (todo.tag === oldTag) todo.tag = newName; });
      if (data._index) data._index = null; /* 强制下次 render 时重建（重命名不增删，但确保一致） */
      onTagRenamed?.(oldTag, newName);
      saveData();
      render();
      renderTagList(overlay);
      showToast('标签已重命名');
    };

    input.addEventListener('blur', doRename);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); renderTagList(overlay); }
    });
  });

  // 渲染内容
  renderContent(overlay);
}

function switchTab(overlay, tabName) {
  const tabs = [...overlay.querySelectorAll('.settings-tab')];
  const activeTab = overlay.querySelector('.settings-tab.active');
  const fromIndex = tabs.indexOf(activeTab);
  const toIndex = tabs.findIndex(tab => tab.dataset.tab === tabName);
  const targetPane = overlay.querySelector(`.settings-pane[data-pane="${tabName}"]`);
  if (targetPane?.classList.contains('active')) return;
  targetPane?.style.setProperty('--settings-pane-shift', toIndex >= fromIndex ? '10px' : '-10px');

  overlay.querySelectorAll('.settings-tab').forEach(t => {
    const active = t.dataset.tab === tabName;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  });
  overlay.querySelectorAll('.settings-pane').forEach(p => {
    p.classList.toggle('active', p.dataset.pane === tabName);
  });
}

// --- 内容渲染 ---

function renderContent(overlay) {
  updateThemeSelection(overlay);
  updateUiStyleControls(overlay);
  fillAiConfigFields(overlay);
  updateNotificationStatus(overlay);
  updateTimelineControls(overlay);
  renderTagList(overlay);
}

function updateNotificationStatus(overlay) {
  const status = getNotificationStatus?.() || { state: 'unavailable', label: '系统通知不可用' };
  const dot = overlay.querySelector('#notification-status-dot');
  const text = overlay.querySelector('#notification-status-text');
  if (dot) dot.dataset.state = status.state;
  if (text) text.textContent = status.label;
}

function updateThemeSelection(overlay) {
  overlay.querySelectorAll('.theme-opt').forEach(btn => {
    const active = btn.dataset.themeValue === data.theme;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

function fillAiConfigFields(overlay) {
  const cfg = data.aiConfig || {};
  overlay.querySelector('#set-api-url').value = cfg.apiUrl || '';
  overlay.querySelector('#set-api-key').value = cfg.apiKey || '';
  overlay.querySelector('#set-model').value = cfg.model || '';
  overlay.querySelector('#set-prompt').value = cfg.customPrompt || '';
}

function bindTimelineControls(overlay) {
  const enabledButton = overlay.querySelector('#set-timeline-enabled');
  enabledButton.addEventListener('click', () => {
    data.timeline = normalizeTimelineSettings({
      ...data.timeline,
      enabled: !data.timeline?.enabled,
    });
    saveData();
    render();
    updateTimelineControls(overlay);
  });

  overlay.querySelectorAll('[data-timeline-sort]').forEach(button => {
    button.addEventListener('click', () => {
      data.timeline = normalizeTimelineSettings({
        ...data.timeline,
        sortBy: button.dataset.timelineSort,
      });
      saveData();
      render();
      updateTimelineControls(overlay);
    });
  });
}

function updateTimelineControls(overlay) {
  data.timeline = normalizeTimelineSettings(data.timeline);
  const enabledButton = overlay.querySelector('#set-timeline-enabled');
  enabledButton.classList.toggle('active', data.timeline.enabled);
  enabledButton.setAttribute('aria-checked', String(data.timeline.enabled));

  const sortSettings = overlay.querySelector('#timeline-sort-settings');
  sortSettings.querySelectorAll('[data-timeline-sort]').forEach(button => {
    const active = button.dataset.timelineSort === data.timeline.sortBy;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

/* --- 软件更新（系统 Tab） --- */

const UPDATE_PHASE_TEXT = {
  idle: '',
  checking: '正在检查更新…',
  latest: '已是最新版本',
  available: '',
  downloading: '正在下载更新…',
  verifying: '正在校验更新包…',
  ready: '更新包已就绪，重启后完成更新',
  failed: ''
};

function renderUpdateStatus(overlay, s) {
  if (!overlay.isConnected) return;
  const statusArea = overlay.querySelector('#update-status-area');
  const btnCheck = overlay.querySelector('#btn-check-update');
  const btnDownload = overlay.querySelector('#btn-download-update');
  const btnRestart = overlay.querySelector('#btn-restart-update');
  if (!statusArea || !btnCheck || !btnDownload || !btnRestart) return;

  btnCheck.classList.toggle('hidden', s.phase === 'checking' || s.phase === 'downloading' || s.phase === 'verifying');
  btnDownload.classList.toggle('hidden', s.phase !== 'available');
  btnRestart.classList.toggle('hidden', s.phase !== 'ready');
  btnCheck.disabled = s.phase === 'checking';
  btnDownload.disabled = s.phase === 'downloading' || s.phase === 'verifying';

  if (s.error) {
    statusArea.innerHTML = `<span class="update-status-error">${escapeHtml(s.error)}</span>`;
    return;
  }

  let html = '';
  if (s.notice) {
    html += `<span class="update-status-text">${escapeHtml(s.notice)}</span>`;
  }
  if (s.phase === 'available' && s.version) {
    html += `<div class="update-status-version">发现新版本 <strong>v${escapeHtml(s.version)}</strong></div>`;
    if (s.body) {
      const brief = s.body.replace(/\r?\n/g, ' ').slice(0, 240);
      html += `<div class="update-status-body">${escapeHtml(brief)}${s.body.length > 240 ? '…' : ''}</div>`;
    }
  } else if (s.phase === 'downloading' || s.phase === 'verifying') {
    const pct = Math.round((s.progress || 0) * 100);
    html += `<div class="update-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`;
    html += `<span class="update-status-text">${UPDATE_PHASE_TEXT[s.phase]}${s.phase === 'downloading' ? ` ${pct}%` : ''}</span>`;
  } else if (UPDATE_PHASE_TEXT[s.phase]) {
    html += `<span class="update-status-text">${UPDATE_PHASE_TEXT[s.phase]}${s.phase === 'latest' && s.version ? `（v${escapeHtml(s.version)}）` : ''}</span>`;
  }
  statusArea.innerHTML = html;
}

function bindUpdateControls(overlay) {
  const versionEl = overlay.querySelector('#update-current-version');
  if (versionEl) {
    versionEl.textContent = updater && updater.isAvailable() ? `v${updater.getCurrentVersion() || '?'}` : '—';
  }
  const btnCheck = overlay.querySelector('#btn-check-update');
  const btnDownload = overlay.querySelector('#btn-download-update');
  const btnRestart = overlay.querySelector('#btn-restart-update');
  const statusArea = overlay.querySelector('#update-status-area');

  if (!updater || !updater.isAvailable()) {
    if (statusArea) statusArea.textContent = '浏览器端不支持自动更新，请使用桌面版。';
    if (btnCheck) btnCheck.disabled = true;
    if (btnDownload) btnDownload.disabled = true;
    if (btnRestart) btnRestart.disabled = true;
    return;
  }

  const applyStatus = (s) => renderUpdateStatus(overlay, s);
  updateStatusUnsub?.();
  updateStatusUnsub = updater.onStatus(applyStatus);
  applyStatus(updater.getState());

  btnCheck?.addEventListener('click', () => updater.checkForUpdates());
  btnDownload?.addEventListener('click', () => {
    btnDownload.disabled = true;
    updater.downloadAndPrepare().catch(e => {
      console.warn('[updater] download failed:', e);
      if (statusArea) statusArea.textContent = `下载更新失败：${e?.message || e}`;
    });
  });
  btnRestart?.addEventListener('click', () => {
    showConfirmDialog('更新包已就绪，应用将退出并自动完成替换和重启？', () => updater.applyUpdate());
  });
}

// --- 标签管理 ---

function renderTagList(overlay) {
  const container = overlay.querySelector('#settings-tag-list');
  updateTagCreatePreview(overlay);
  if (data.tags.length === 0) {
    container.innerHTML = '<div class="settings-tag-empty">暂无标签</div>';
    return;
  }
  container.innerHTML = data.tags.map(tag => `
    <div class="tag-manage-item" data-tag="${escapeHtml(tag)}">
      <span class="tag-dot" style="background:${getTagColor(tag)}"></span>
      <span class="tag-manage-name" data-role="rename-tag">${escapeHtml(tag)}</span>
      <span class="tag-manage-count">${getTagTaskCount(tag)}</span>
      <button class="tag-delete-btn" data-role="delete-tag" data-tag="${escapeHtml(tag)}" title="删除标签" aria-label="删除标签">${iconSvg('x')}</button>
    </div>
  `).join('');
}

function createStyleSlider(key, label, min, max, unit, step = 1) {
  return `
    <label class="ui-style-control" for="ui-style-${key}">
      <span class="ui-style-control-label">${label}</span>
      <output class="ui-style-value" data-style-value="${key}"></output>
      <input id="ui-style-${key}" type="range" min="${min}" max="${max}" step="${step}" data-style-key="${key}" data-style-unit="${unit}">
    </label>
  `;
}

function bindUiStyleControls(overlay) {
  const controls = overlay.querySelectorAll('[data-style-key]');

  controls.forEach(control => {
    control.addEventListener('input', () => {
      const key = control.dataset.styleKey;
      data.uiStyle = normalizeUiStyle({ ...data.uiStyle, [key]: control.value });
      applyUiStyle(data.uiStyle);
      updateUiStyleValue(overlay, key);
    });
    control.addEventListener('change', () => saveData());
  });

  overlay.querySelector('#reset-ui-style').addEventListener('click', () => {
    data.uiStyle = { ...DEFAULT_UI_STYLE };
    applyUiStyle(data.uiStyle);
    updateUiStyleControls(overlay);
    saveData();
    showToast('界面风格已恢复默认');
  });
}

function updateUiStyleControls(overlay) {
  data.uiStyle = normalizeUiStyle(data.uiStyle);
  overlay.querySelectorAll('[data-style-key]').forEach(control => {
    control.value = String(data.uiStyle[control.dataset.styleKey]);
    updateUiStyleValue(overlay, control.dataset.styleKey);
  });
}

function updateUiStyleValue(overlay, key) {
  const control = overlay.querySelector(`[data-style-key="${key}"]`);
  const output = overlay.querySelector(`[data-style-value="${key}"]`);
  if (control && output) {
    output.textContent = key === 'motionSpeed' && Number(control.value) === 0
      ? '关闭'
      : `${control.value}${control.dataset.styleUnit}`;
  }
}

function updateTagCreatePreview(overlay) {
  const preview = overlay.querySelector('#settings-tag-preview');
  if (preview) preview.style.background = TAG_COLORS[data.tags.length % TAG_COLORS.length];
}

function createTag(overlay) {
  const input = overlay.querySelector('#set-add-tag-input');
  const name = input.value.trim();
  if (!name) {
    input.focus();
    return;
  }
  if (data.tags.includes(name)) {
    showToast('标签已存在');
    input.focus();
    input.select();
    return;
  }

  data.tags.push(name);
  saveData();
  render();
  input.value = '';
  renderTagList(overlay);
  input.focus();
  showToast('标签创建成功');
}

function deleteTag(tag, overlay) {
  const count = getTagTaskCount(tag);
  const message = count > 0
    ? `标签"${tag}"下还有 ${count} 个任务，删除后这些任务会变成无标签，确定继续吗？`
    : `确定要删除标签"${tag}"吗？`;

  showConfirmDialog(message, () => {
    data.tags = data.tags.filter(t => t !== tag);
    data.todos.forEach(todo => { if (todo.tag === tag) todo.tag = ''; });
    if (data._index) data._index = null; /* 强制下次 render 时重建 */
    onTagDeleted?.(tag);
    saveData();
    render();
    renderTagList(overlay);
    showToast('标签已删除');
  });
}

// --- 导出 ---

export function initSettings(deps) {
  data = deps.data;
  saveData = deps.saveData;
  showToast = deps.showToast;
  render = deps.render;
  testNotification = deps.testNotification;
  getNotificationStatus = deps.getNotificationStatus;
  onTagRenamed = deps.onTagRenamed || null;
  onTagDeleted = deps.onTagDeleted || null;
  updater = deps.updater || null;

  // 打开
  document.getElementById('btn-settings').addEventListener('click', openPanel);

  // Escape 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsOverlay) {
      closePanel();
    }
  });
}
