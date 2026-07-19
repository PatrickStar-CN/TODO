import { escapeHtml } from './utils/html.js';
import { applyTheme } from './theme.js';
import { closeDetail } from './detail.js';
import { showConfirmDialog } from './overlay.js';
import { DEFAULT_UI_STYLE, applyUiStyle, getUiMotionDuration, normalizeUiStyle } from './uiPreferences.js';
import { iconSvg } from './icons.js';

const TAG_COLORS = ['#4f46e5', '#06b6d4', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];

let data, saveData, showToast, render, testNotification, getNotificationStatus;
let settingsOverlay = null;

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

  // 打开
  document.getElementById('btn-settings').addEventListener('click', openPanel);

  // Escape 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsOverlay) {
      closePanel();
    }
  });
}
