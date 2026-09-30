import { escapeHtml } from './utils/html.js';
import { applyTheme } from './theme.js';
import { closeDetail } from './detail.js';
import { showConfirmDialog } from './overlay.js';
import { exportData, EXPORT_FORMATS } from './dataExport.js';
import { DEFAULT_UI_STYLE, applyUiStyle, getUiMotionDuration, normalizeUiStyle } from './uiPreferences.js';
import { createFocusTrap, enableRovingTablist } from './utils/focus.js';
import { iconSvg } from './icons.js';
import { normalizeTimelineSettings } from './timeline.js';
import { getTagDotStyle, getTagTaskCount, TAG_COLORS } from './shared.js';
import { t, getLanguage, getSupportedLanguages, normalizeLanguage, onLanguageChange } from './i18n/index.js';

let data, saveData, showToast, render, testNotification, getNotificationStatus;
let applyLanguageFn = null;
let onTagRenamed = null;
let onTagDeleted = null;
let settingsOverlay = null;
let settingsReleaseFocus = null;
let settingsRovingCleanup = null;
let settingsPreviouslyFocused = null;
let updater = null;
let updateStatusUnsub = null;
/* 面板当前已渲染的语言：语言变化事件可能与调用方兜底重复触发，据此跳过多余的重建 */
let panelLang = null;
/* 导出选项存模块级：语言切换会原地重建面板，存在这里才能在重建后回填 */
let exportFormat = 'json';
let exportIncludeKey = false;

// --- 弹窗开关 ---

function closePanel() {
  updateStatusUnsub?.();
  updateStatusUnsub = null;
  if (!settingsOverlay) return;
  const modal = settingsOverlay.querySelector('.settings-modal');
  if (modal) modal.style.animation = 'modalShrinkOut var(--motion-normal) forwards';
  settingsOverlay.classList.add('closing');
  const overlayRef = settingsOverlay;
  const releaseFocus = settingsReleaseFocus;
  const rovingCleanup = settingsRovingCleanup;
  const previouslyFocused = settingsPreviouslyFocused;
  settingsOverlay = null;
  settingsReleaseFocus = null;
  settingsRovingCleanup = null;
  settingsPreviouslyFocused = null;
  if (typeof rovingCleanup === 'function') rovingCleanup();
  overlayRef.addEventListener('animationend', () => overlayRef.remove(), { once: true });
  setTimeout(() => { if (overlayRef.parentNode) overlayRef.remove(); }, getUiMotionDuration('normal') + 50);
  setTimeout(() => {
    if (typeof releaseFocus === 'function') releaseFocus();
    else if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus({ preventScroll: true });
  }, getUiMotionDuration('normal') + 60);
}

function openPanel(opts = {}) {
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
  overlay.setAttribute('aria-label', t('settings.title'));
  const curLang = normalizeLanguage(data.language || getLanguage());
  const curEntry = getSupportedLanguages().find((l) => l.code === curLang) || getSupportedLanguages()[0];
  const langMenuItems = getSupportedLanguages().map((l) => {
    const active = l.code === curLang;
    return `<button class="settings-lang-option${active ? ' active' : ''}" type="button" role="option" data-lang-value="${l.code}" aria-selected="${String(active)}">${iconSvg('globe')}<span>${l.label}</span><span class="lang-code-sm" aria-hidden="true">${l.code.toUpperCase()}</span>${active ? iconSvg('check', 'settings-lang-check') : ''}</button>`;
  }).join('');
  overlay.innerHTML = `
    <div class="settings-modal">
      <div class="settings-header">
        <h3>${t('settings.title')}</h3>
        <div class="settings-header-actions">
          <div class="settings-lang-switch" id="settings-lang-switch">
            <button class="settings-lang-trigger" id="settings-lang-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="${t('settings.languageTitle')}">
              ${iconSvg('globe', 'settings-lang-trigger-icon')}<span>${curEntry.label}</span><span class="settings-lang-trigger-arrow">${iconSvg('chevron-down')}</span>
            </button>
            <div class="settings-lang-menu hidden" id="settings-lang-menu" role="listbox" aria-label="${t('settings.languageTitle')}">
              ${langMenuItems}
            </div>
          </div>
          <button class="icon-btn settings-close-btn" id="close-settings" type="button" aria-label="${t('settings.close')}">${iconSvg('x')}</button>
        </div>
      </div>
      <div class="settings-tabs" role="tablist" aria-label="${t('settings.category')}">
        <button class="settings-tab active" type="button" role="tab" aria-selected="true" tabindex="0" aria-controls="settings-pane-appearance" id="settings-tab-appearance" data-tab="appearance">${iconSvg('settings')}<span>${t('settings.tabAppearance')}</span></button>
        <button class="settings-tab" type="button" role="tab" aria-selected="false" tabindex="-1" aria-controls="settings-pane-ai" id="settings-tab-ai" data-tab="ai">${iconSvg('document')}<span>${t('settings.tabAi')}</span></button>
        <button class="settings-tab" type="button" role="tab" aria-selected="false" tabindex="-1" aria-controls="settings-pane-notifications" id="settings-tab-notifications" data-tab="notifications">${iconSvg('bell')}<span>${t('settings.tabNotifications')}</span></button>
        <button class="settings-tab" type="button" role="tab" aria-selected="false" tabindex="-1" aria-controls="settings-pane-tags" id="settings-tab-tags" data-tab="tags">${iconSvg('tag')}<span>${t('settings.tabTags')}</span></button>
        <button class="settings-tab" type="button" role="tab" aria-selected="false" tabindex="-1" aria-controls="settings-pane-system" id="settings-tab-system" data-tab="system">${iconSvg('settings')}<span>${t('settings.tabSystem')}</span></button>
      </div>
      <div class="settings-body">
        <div class="settings-pane active" data-pane="appearance" role="tabpanel" id="settings-pane-appearance" aria-labelledby="settings-tab-appearance" tabindex="0">
          <section class="settings-appearance-card" aria-labelledby="appearance-theme-title">
            <div class="settings-appearance-card-heading">
              <div>
                <strong id="appearance-theme-title">${t('settings.themeTitle')}</strong>
                <span>${t('settings.themeSub')}</span>
              </div>
            </div>
            <div class="theme-options">
              <button class="theme-opt" type="button" aria-pressed="false" data-theme-value="auto">${iconSvg('monitor')}<span>${t('settings.themeAuto')}</span></button>
              <button class="theme-opt" type="button" aria-pressed="false" data-theme-value="light">${iconSvg('sun')}<span>${t('settings.themeLight')}</span></button>
              <button class="theme-opt" type="button" aria-pressed="false" data-theme-value="dark">${iconSvg('moon')}<span>${t('settings.themeDark')}</span></button>
            </div>
          </section>
          <section class="settings-style-section settings-appearance-card" aria-labelledby="appearance-style-title">
            <div class="settings-style-heading">
              <div>
                <strong id="appearance-style-title">${t('settings.styleTitle')}</strong>
                <span>${t('settings.styleSub')}</span>
              </div>
              <button class="btn-secondary btn-sm settings-secondary-action" id="reset-ui-style" type="button">${iconSvg('undo')}<span>${t('settings.resetStyle')}</span></button>
            </div>
            <div class="settings-style-grid">
              ${createStyleSlider('radius', t('settings.radius'), 6, 20, 'px')}
              ${createStyleSlider('glassOpacity', t('settings.glass'), 35, 100, '%')}
              ${createStyleSlider('fontScale', t('settings.font'), 90, 115, '%')}
              ${createStyleSlider('blur', t('settings.blur'), 8, 28, 'px')}
              ${createStyleSlider('motionSpeed', t('settings.motion'), 0, 200, '%', 50)}
            </div>
          </section>
          <section class="settings-content-card settings-timeline-card" aria-labelledby="settings-timeline-title">
            <div class="timeline-setting-row">
              <div class="settings-content-card-heading">
                <div>
                  <strong id="settings-timeline-title">${t('settings.timelineTitle')}</strong>
                  <span>${t('settings.timelineSub')}</span>
                </div>
              </div>
              <button class="settings-switch" id="set-timeline-enabled" type="button" role="switch" aria-checked="false" aria-label="${t('settings.timelineSwitch')}">
                <span aria-hidden="true"></span>
              </button>
            </div>
            <div class="timeline-sort-settings" id="timeline-sort-settings">
              <span class="timeline-sort-label">${t('settings.sortBy')}</span>
              <div class="timeline-sort-options" role="group" aria-label="${t('settings.sortGroup')}">
                <button type="button" data-timeline-sort="created" aria-pressed="false">${t('settings.sortCreated')}</button>
                <button type="button" data-timeline-sort="completed" aria-pressed="false">${t('settings.sortCompleted')}</button>
              </div>
              <p>${t('settings.sortHint')}</p>
            </div>
          </section>
        </div>
        <div class="settings-pane" data-pane="ai" role="tabpanel" id="settings-pane-ai" aria-labelledby="settings-tab-ai" tabindex="0">
          <section class="settings-content-card settings-ai-card" aria-labelledby="settings-ai-card-title">
            <div class="settings-content-card-heading">
              <div>
                <strong id="settings-ai-card-title">${t('settings.aiTitle')}</strong>
                <span>${t('settings.aiSub')}</span>
              </div>
            </div>
            <div class="settings-form-grid">
              <div class="settings-row settings-field-wide">
                <label for="set-api-url">${t('settings.apiUrl')}</label>
                <input type="text" id="set-api-url" placeholder="https://api.openai.com/v1">
              </div>
              <div class="settings-row">
                <label for="set-api-key">${t('settings.apiKey')}</label>
                <input type="password" id="set-api-key" placeholder="sk-...">
              </div>
              <div class="settings-row">
                <label for="set-model">${t('settings.model')}</label>
                <input type="text" id="set-model" placeholder="gpt-4o-mini">
              </div>
              <div class="settings-row settings-field-wide">
                <label for="set-prompt">${t('settings.prompt')}</label>
                <textarea id="set-prompt" rows="3" placeholder="${t('settings.promptPlaceholder')}"></textarea>
              </div>
            </div>
            <button class="btn-primary btn-sm settings-primary-action" id="set-save-ai" type="button">${iconSvg('check')}<span>${t('settings.saveAi')}</span></button>
          </section>
        </div>
        <div class="settings-pane" data-pane="notifications" role="tabpanel" id="settings-pane-notifications" aria-labelledby="settings-tab-notifications" tabindex="0">
          <section class="settings-content-card settings-notification-card" aria-labelledby="settings-notification-title">
            <div class="notification-setting-card">
              <span class="notification-status-dot" id="notification-status-dot" aria-hidden="true"></span>
              <div class="notification-setting-copy">
                <strong id="settings-notification-title">${t('settings.notifyTitle')}</strong>
                <span id="notification-status-text"></span>
              </div>
              <button class="btn-secondary btn-sm settings-secondary-action" id="test-notification" type="button">${iconSvg('bell')}<span>${t('settings.testNotify')}</span></button>
            </div>
            <div class="settings-notification-note">
              ${iconSvg('clock')}
              <span>${t('settings.notifyHint')}</span>
            </div>
          </section>
</div>
        <div class="settings-pane" data-pane="tags" role="tabpanel" id="settings-pane-tags" aria-labelledby="settings-tab-tags" tabindex="0">
          <section class="settings-content-card settings-tags-card" aria-label="${t('settings.tagListLabel')}">
            <div class="settings-tag-add-bar">
              <span class="tag-dot settings-tag-preview" id="settings-tag-preview" aria-hidden="true"></span>
              <input type="text" id="set-add-tag-input" placeholder="${t('settings.addTagPlaceholder')}" maxlength="20" autocomplete="off" spellcheck="false" aria-label="${t('settings.newTagAria')}">
              <button class="icon-btn settings-tag-add-btn" id="set-add-tag-btn" type="button" title="${t('settings.addTag')}" aria-label="${t('settings.addTag')}">${iconSvg('plus')}</button>
            </div>
            <div id="settings-tag-list" class="settings-tag-list"></div>
          </section>
        </div>
        <div class="settings-pane" data-pane="system" role="tabpanel" id="settings-pane-system" aria-labelledby="settings-tab-system" tabindex="0">
          <section class="settings-content-card settings-update-card" aria-labelledby="settings-update-title">
            <div class="settings-content-card-heading">
              <div>
                <strong id="settings-update-title">${t('settings.updateTitle')}</strong>
                <span>${t('settings.updateSub')}</span>
              </div>
            </div>
            <div class="update-version-row">
              <span>${t('settings.currentVersion')}</span>
              <strong id="update-current-version"></strong>
            </div>
            <div id="update-status-area" class="update-status-area" aria-live="polite"></div>
            <div class="update-actions">
              <button class="btn-primary btn-sm settings-primary-action" id="btn-check-update" type="button">${iconSvg('refresh')}<span>${t('settings.checkUpdate')}</span></button>
              <button class="btn-primary btn-sm settings-primary-action hidden" id="btn-download-update" type="button">${iconSvg('download')}<span>${t('settings.downloadUpdate')}</span></button>
              <button class="btn-secondary btn-sm settings-secondary-action hidden" id="btn-cancel-update" type="button">${iconSvg('x')}<span>${t('settings.cancelDownload')}</span></button>
              <button class="btn-primary btn-sm settings-primary-action hidden" id="btn-restart-update" type="button">${iconSvg('refresh')}<span>${t('settings.restartNow')}</span></button>
            </div>
          </section>
          <section class="settings-content-card settings-export-card" aria-labelledby="settings-export-title">
            <div class="settings-content-card-heading">
              <div>
                <strong id="settings-export-title">${t('settings.exportTitle')}</strong>
                <span>${t('settings.exportSub')}</span>
              </div>
            </div>
            <div class="export-format-options" role="group" aria-label="${t('settings.exportFormatLabel')}">
              <button class="export-format-opt active" type="button" aria-pressed="true" data-export-format="json">${iconSvg('document')}<span>${t('settings.exportFormatJson')}</span></button>
              <button class="export-format-opt" type="button" aria-pressed="false" data-export-format="markdown">${iconSvg('clipboard')}<span>${t('settings.exportFormatMarkdown')}</span></button>
            </div>
            <div class="settings-row export-key-row">
              <span id="settings-export-key-label">${t('settings.exportIncludeApiKey')}</span>
              <button class="settings-switch" id="set-export-include-key" type="button" role="switch" aria-checked="false" aria-labelledby="settings-export-key-label">
                <span aria-hidden="true"></span>
              </button>
            </div>
            <div class="update-actions">
              <button class="btn-primary btn-sm settings-primary-action" id="btn-export-data" type="button">${iconSvg('download')}<span>${t('settings.exportData')}</span></button>
            </div>
            <p class="export-hint">${t('settings.exportHint')}</p>
          </section>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  settingsOverlay = overlay;
  panelLang = getLanguage();
  const preservedFocus = opts.previouslyFocused && document.contains(opts.previouslyFocused)
    ? opts.previouslyFocused
    : document.activeElement;
  settingsPreviouslyFocused = preservedFocus;
  settingsReleaseFocus = createFocusTrap(overlay, {
    previouslyFocused: settingsPreviouslyFocused,
    initialFocus: overlay.querySelector('#close-settings') || undefined,
  });
  settingsRovingCleanup?.();
  settingsRovingCleanup = enableRovingTablist(overlay.querySelector('.settings-tabs'), '.settings-tab');

  // 设置弹窗从触发按钮位置放大动画（语言切换原地重建时跳过，避免闪烁）
  const modal = overlay.querySelector('.settings-modal');
  const triggerBtn = document.getElementById('btn-settings');
  if (triggerBtn) {
    const rect = triggerBtn.getBoundingClientRect();
    modal.style.setProperty('--origin-x', `${rect.left + rect.width / 2 - window.innerWidth / 2}px`);
    modal.style.setProperty('--origin-y', `${rect.top + rect.height / 2 - window.innerHeight / 2}px`);
  }
  if (opts.suppressAnimation) {
    modal.style.animation = 'none';
    overlay.style.animation = 'none';
  } else {
    modal.style.animation = 'modalExpandIn var(--motion-panel)';
  }

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
  overlay.querySelectorAll('.theme-opt[data-theme-value]').forEach(btn => {
    btn.addEventListener('click', () => {
      data.theme = btn.dataset.themeValue;
      saveData();
      applyTheme(data.theme, { animate: true });
      updateThemeSelection(overlay);
    });
  });

  // 语言切换：关闭按钮旁下拉，选择后全应用即时更新（面板原地重建）
  const langTrigger = overlay.querySelector('#settings-lang-trigger');
  const langMenu = overlay.querySelector('#settings-lang-menu');
  const setLangMenuOpen = (open) => {
    if (!langTrigger || !langMenu) return;
    langTrigger.setAttribute('aria-expanded', String(open));
    langMenu.classList.toggle('hidden', !open);
  };
  const closeLangMenu = () => setLangMenuOpen(false);
  if (langTrigger && langMenu) {
    langTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = langMenu.classList.contains('hidden');
      // 关闭其他可能打开的菜单后切换
      setLangMenuOpen(open);
      if (open) {
        const active = langMenu.querySelector('.settings-lang-option.active');
        (active || langMenu.querySelector('.settings-lang-option'))?.focus({ preventScroll: true });
      }
    });
    langMenu.querySelectorAll('.settings-lang-option').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = normalizeLanguage(btn.dataset.langValue);
        if (next === normalizeLanguage(data.language)) {
          closeLangMenu();
          langTrigger.focus({ preventScroll: true });
          return;
        }
        data.language = next;
        saveData();
        try {
          if (typeof applyLanguageFn === 'function') {
            applyLanguageFn(next);
          } else {
            render?.();
          }
        } finally {
          /* 先关闭菜单再重建，避免重建时残留展开态；
           * 面板重建由 onLanguageChange 订阅负责，此处仅兜底未注入 applyLanguage 的降级路径，
           * 且放在 finally 中：调用方链路即使抛错也不会让面板停留在旧语言 */
          closeLangMenu();
          refreshSettingsLanguage();
        }
      });
    });
    // 点击设置弹窗其他区域关闭语言菜单
    overlay.addEventListener('click', (e) => {
      if (!e.target.closest('#settings-lang-switch') && !langMenu.classList.contains('hidden')) {
        closeLangMenu();
      }
    });
    langMenu.addEventListener('keydown', (e) => {
      const opts = [...langMenu.querySelectorAll('.settings-lang-option')];
      const idx = opts.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        const next = opts[(idx + dir + opts.length) % opts.length];
        next?.focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeLangMenu();
        langTrigger.focus({ preventScroll: true });
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        document.activeElement?.click();
      }
    });
    langTrigger.addEventListener('keydown', (e) => {
      if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && langMenu.classList.contains('hidden')) {
        e.preventDefault();
        setLangMenuOpen(true);
        langMenu.querySelector('.settings-lang-option.active')?.focus({ preventScroll: true });
      } else if (e.key === 'Escape' && !langMenu.classList.contains('hidden')) {
        e.preventDefault();
        closeLangMenu();
      }
    });
  }

  // AI 配置保存
  overlay.querySelector('#set-save-ai').addEventListener('click', () => {
    data.aiConfig.apiUrl = overlay.querySelector('#set-api-url').value.trim();
    data.aiConfig.apiKey = overlay.querySelector('#set-api-key').value.trim();
    data.aiConfig.model = overlay.querySelector('#set-model').value.trim();
    data.aiConfig.customPrompt = overlay.querySelector('#set-prompt').value.trim();
    saveData();
    showToast(t('toast.aiSaved'));
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
  bindExportControls(overlay);

  overlay.querySelector('#test-notification').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const label = button.querySelector('span');
    button.disabled = true;
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
    if (label) label.textContent = t('toast.testSending');
    try {
      await testNotification?.();
      updateNotificationStatus(overlay);
    } finally {
      button.disabled = false;
      button.classList.remove('is-loading');
      button.removeAttribute('aria-busy');
      if (label) label.textContent = t('settings.testNotify');
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
        showToast(t('settings.tagExists'));
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
      showToast(t('toast.tagRenamed'));
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
    t.tabIndex = active ? 0 : -1;
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
  updateExportControls(overlay);
}

function teardownPanelInstant() {
  updateStatusUnsub?.();
  updateStatusUnsub = null;
  if (typeof settingsRovingCleanup === 'function') {
    try { settingsRovingCleanup(); } catch { /* ignore */ }
  }
  settingsRovingCleanup = null;
  /* 立即重建：不播放关闭动画、不归还焦点（焦点由重建后恢复），旧节点直接移除 */
  settingsReleaseFocus = null;
  if (settingsOverlay && settingsOverlay.parentNode) {
    settingsOverlay.parentNode.removeChild(settingsOverlay);
  }
  settingsOverlay = null;
}

/* 语言切换后面板原地重建：同步交换文案，无关闭/展开动画；
 * 保留当前 Tab、滚动位置、AI 表单与标签输入框的未保存输入，标签重命名先提交 */
function refreshSettingsLanguage() {
  const prev = settingsOverlay;
  if (!prev || !prev.isConnected) return;
  /* 事件订阅与调用方兜底可能先后触发，已按当前语言重建过就直接返回，避免二次重建丢焦点 */
  if (panelLang === getLanguage()) return;
  const activeTab = prev.querySelector('.settings-tab.active')?.dataset.tab || 'appearance';
  const body = prev.querySelector('.settings-body');
  const scrollTop = body ? body.scrollTop : 0;
  const trigger = (settingsPreviouslyFocused && document.contains(settingsPreviouslyFocused))
    ? settingsPreviouslyFocused
    : document.getElementById('btn-settings');
  const renameInput = prev.querySelector('.tag-rename-input');
  if (renameInput) renameInput.blur();
  const saved = {};
  ['set-api-url', 'set-api-key', 'set-model', 'set-prompt', 'set-add-tag-input'].forEach((id) => {
    const el = prev.querySelector(`#${id}`);
    if (el) saved[id] = el.value;
  });
  teardownPanelInstant();
  openPanel({ previouslyFocused: trigger, suppressAnimation: true });
  const overlay = settingsOverlay;
  if (!overlay) return;
  if (activeTab !== 'appearance') switchTab(overlay, activeTab);
  Object.keys(saved).forEach((id) => {
    const el = overlay.querySelector(`#${id}`);
    if (el && typeof saved[id] === 'string') el.value = saved[id];
  });
  const nextBody = overlay.querySelector('.settings-body');
  if (nextBody) nextBody.scrollTop = scrollTop;
  // 重建后将焦点还给语言触发器（便于继续操作），初始的 #close-settings 聚焦在 rAF 后被覆盖
  requestAnimationFrame(() => {
    overlay.querySelector('#settings-lang-trigger')?.focus({ preventScroll: true });
  });
}

function updateNotificationStatus(overlay) {
  const status = getNotificationStatus?.() || { state: 'unavailable', label: t('reminder.unsupported') };
  const dot = overlay.querySelector('#notification-status-dot');
  const text = overlay.querySelector('#notification-status-text');
  if (dot) dot.dataset.state = status.state;
  if (text) text.textContent = status.label;
}

function updateThemeSelection(overlay) {
  overlay.querySelectorAll('.theme-opt[data-theme-value]').forEach(btn => {
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
  checking: () => t('update.checking'),
  latest: () => t('update.latest'),
  available: '',
  downloading: () => t('update.downloading'),
  verifying: () => t('update.verifying'),
  ready: () => t('update.ready'),
  failed: ''
};

function updatePhaseText(phase) {
  const v = UPDATE_PHASE_TEXT[phase];
  return typeof v === 'function' ? v() : (v || '');
}

/* 更新状态文案优先用 i18n key 在渲染时翻译：updater 只记录 key/参数，
 * 这样切换语言后重建面板能拿到当前语言的提示，而不是发射时缓存的旧语言文本 */
function resolveUpdateText(key, params, fallback) {
  if (key) return t(key, params || {});
  return fallback || '';
}

function renderUpdateStatus(overlay, s) {
  if (!overlay.isConnected) return;
  const statusArea = overlay.querySelector('#update-status-area');
  const btnCheck = overlay.querySelector('#btn-check-update');
  const btnDownload = overlay.querySelector('#btn-download-update');
  const btnCancel = overlay.querySelector('#btn-cancel-update');
  const btnRestart = overlay.querySelector('#btn-restart-update');
  if (!statusArea || !btnCheck || !btnDownload || !btnRestart) return;

  btnCheck.classList.toggle('hidden', s.phase === 'checking' || s.phase === 'downloading' || s.phase === 'verifying');
  btnDownload.classList.toggle('hidden', s.phase !== 'available');
  btnCancel?.classList.toggle('hidden', s.phase !== 'downloading' && s.phase !== 'verifying');
  btnRestart.classList.toggle('hidden', s.phase !== 'ready');
  const busy = s.phase === 'checking' || s.phase === 'downloading' || s.phase === 'verifying';
  btnCheck.disabled = busy;
  btnDownload.disabled = busy;
  btnCheck.setAttribute('aria-busy', String(s.phase === 'checking'));
  btnDownload.setAttribute('aria-busy', String(s.phase === 'downloading' || s.phase === 'verifying'));

  const errorText = resolveUpdateText(s.errorKey, s.errorParams, s.error);
  if (errorText) {
    statusArea.innerHTML = `<span class="update-status-error">${escapeHtml(errorText)}</span>`;
    return;
  }

  let html = '';
  const noticeText = resolveUpdateText(s.noticeKey, s.noticeParams, s.notice);
  if (noticeText) {
    html += `<span class="update-status-text">${escapeHtml(noticeText)}</span>`;
  }
  if (s.phase === 'available' && s.version) {
    html += `<div class="update-status-version">${t('update.found')} <strong>v${escapeHtml(s.version)}</strong></div>`;
    if (s.body) {
      const brief = s.body.replace(/\r?\n/g, ' ').slice(0, 240);
      html += `<div class="update-status-body">${escapeHtml(brief)}${s.body.length > 240 ? '…' : ''}</div>`;
    }
  } else if (s.phase === 'downloading' || s.phase === 'verifying') {
    const pct = Math.round((s.progress || 0) * 100);
    const existingBar = statusArea.querySelector('.update-progress');
    const existingFill = statusArea.querySelector('.update-progress > span');
    const existingPct = statusArea.querySelector('[data-progress-pct]');
    if (existingBar && existingFill && existingPct) {
      /* 原地更新宽度与文案，复用 CSS transition 做平滑过渡；
       * 每次 innerHTML 重建节点会杀掉过渡，表现为 0→100 直跳 */
      existingFill.style.width = `${pct}%`;
      existingBar.setAttribute('aria-valuenow', String(pct));
      existingPct.textContent = s.phase === 'downloading' ? ` ${pct}%` : '';
      return;
    }
    html += `<div class="update-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`;
    html += `<span class="update-status-text">${updatePhaseText(s.phase)}<span data-progress-pct>${s.phase === 'downloading' ? ` ${pct}%` : ''}</span></span>`;
  } else if (updatePhaseText(s.phase)) {
    html += `<span class="update-status-text">${updatePhaseText(s.phase)}${s.phase === 'latest' && s.version ? `（v${escapeHtml(s.version)}）` : ''}</span>`;
  }
  statusArea.innerHTML = html;
}

function bindUpdateControls(overlay) {
  const versionEl = overlay.querySelector('#update-current-version');
  const refreshVersion = () => {
    if (!versionEl || !overlay.isConnected) return;
    versionEl.textContent = updater && updater.isAvailable() ? `v${updater.getCurrentVersion() || '?'}` : '—';
  };
  refreshVersion();
  /* 打开面板时即解析本地版本（Neutralino.app.getConfig 异步），避免一直显示 v? 直到首次检查 */
  if (updater?.resolveCurrentVersion) {
    updater.resolveCurrentVersion().then(refreshVersion).catch(() => {});
  }
  const btnCheck = overlay.querySelector('#btn-check-update');
  const btnDownload = overlay.querySelector('#btn-download-update');
  const btnCancel = overlay.querySelector('#btn-cancel-update');
  const btnRestart = overlay.querySelector('#btn-restart-update');
  const statusArea = overlay.querySelector('#update-status-area');

  if (!updater || !updater.isAvailable()) {
    if (statusArea) statusArea.textContent = t('settings.webNoUpdate');
    if (btnCheck) btnCheck.disabled = true;
    if (btnDownload) btnDownload.disabled = true;
    if (btnCancel) btnCancel.disabled = true;
    if (btnRestart) btnRestart.disabled = true;
    return;
  }

  const applyStatus = (s) => renderUpdateStatus(overlay, s);
  updateStatusUnsub?.();
  updateStatusUnsub = updater.onStatus(applyStatus);
  applyStatus(updater.getState());

  btnCheck?.addEventListener('click', () => updater.checkForUpdates());
  btnDownload?.addEventListener('click', () => {
    /* 禁用态由 updater 状态机驱动（renderUpdateStatus），此处不手动置灰，避免失败后无法恢复 */
    updater.downloadAndPrepare().catch(e => {
      console.warn('[updater] download failed:', e);
    });
  });
  btnRestart?.addEventListener('click', () => {
    showConfirmDialog(t('update.applyConfirm'), () => updater.applyUpdate());
  });
  btnCancel?.addEventListener('click', () => updater.cancelDownload());
}

// --- 标签管理 ---

function renderTagList(overlay) {
  const container = overlay.querySelector('#settings-tag-list');
  updateTagCreatePreview(overlay);
  if (data.tags.length === 0) {
    container.innerHTML = `<div class="settings-tag-empty">${t('settings.noTags')}</div>`;
    return;
  }
  container.innerHTML = data.tags.map(tag => `
    <div class="tag-manage-item" data-tag="${escapeHtml(tag)}">
      <span class="tag-dot" ${getTagDotStyle(tag, data.tags)}></span>
      <span class="tag-manage-name" data-role="rename-tag">${escapeHtml(tag)}</span>
      <span class="tag-manage-count">${getTagTaskCount(data, tag)}</span>
      <button class="tag-delete-btn" data-role="delete-tag" data-tag="${escapeHtml(tag)}" title="${t('settings.deleteTag')}" aria-label="${t('settings.deleteTag')}">${iconSvg('x')}</button>
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
  let previewFrame = null;
  let pendingPreview = null;

  const flushPreview = () => {
    previewFrame = null;
    if (!pendingPreview || !overlay.isConnected) {
      pendingPreview = null;
      return;
    }
    const { key, value } = pendingPreview;
    pendingPreview = null;
    /* 高频 input 只在 rAF 内合并且落盘仍走 change：blur/字号等重排贵属性拖动不抖动 */
    data.uiStyle = normalizeUiStyle({ ...data.uiStyle, [key]: value });
    applyUiStyle(data.uiStyle);
    updateUiStyleValue(overlay, key);
  };

  controls.forEach(control => {
    control.addEventListener('input', () => {
      pendingPreview = { key: control.dataset.styleKey, value: control.value };
      updateUiStyleValue(overlay, control.dataset.styleKey);
      if (previewFrame) return;
      previewFrame = requestAnimationFrame(flushPreview);
    });
    control.addEventListener('change', () => {
      if (previewFrame) {
        cancelAnimationFrame(previewFrame);
        previewFrame = null;
      }
      pendingPreview = null;
      const key = control.dataset.styleKey;
      data.uiStyle = normalizeUiStyle({ ...data.uiStyle, [key]: control.value });
      applyUiStyle(data.uiStyle);
      updateUiStyleValue(overlay, key);
      saveData();
    });
  });

  overlay.querySelector('#reset-ui-style').addEventListener('click', () => {
    data.uiStyle = { ...DEFAULT_UI_STYLE };
    applyUiStyle(data.uiStyle);
    updateUiStyleControls(overlay);
    saveData();
    showToast(t('toast.uiReset'));
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
      ? t('settings.motionOff')
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
    showToast(t('toast.tagExists'));
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
  showToast(t('toast.tagCreated'));
}

function deleteTag(tag, overlay) {
  const count = getTagTaskCount(data, tag);
  const message = count > 0
    ? t('confirm.deleteTagWithCount', { tag, count })
    : t('confirm.deleteTag', { tag });

  showConfirmDialog(message, () => {
    data.tags = data.tags.filter(t => t !== tag);
    data.todos.forEach(todo => { if (todo.tag === tag) todo.tag = ''; });
    if (data._index) data._index = null; /* 强制下次 render 时重建 */
    onTagDeleted?.(tag);
    saveData();
    render();
    renderTagList(overlay);
    showToast(t('toast.tagDeleted'));
  });
}

// --- 导出 ---

function updateExportControls(overlay) {
  overlay.querySelectorAll('[data-export-format]').forEach((button) => {
    const active = button.dataset.exportFormat === exportFormat;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const keySwitch = overlay.querySelector('#set-export-include-key');
  if (keySwitch) {
    keySwitch.classList.toggle('active', exportIncludeKey);
    keySwitch.setAttribute('aria-checked', String(exportIncludeKey));
  }
}

function bindExportControls(overlay) {
  overlay.querySelectorAll('[data-export-format]').forEach((button) => {
    button.addEventListener('click', () => {
      const format = button.dataset.exportFormat;
      if (!EXPORT_FORMATS.includes(format)) return;
      exportFormat = format;
      updateExportControls(overlay);
    });
  });

  const keySwitch = overlay.querySelector('#set-export-include-key');
  keySwitch?.addEventListener('click', () => {
    exportIncludeKey = !exportIncludeKey;
    updateExportControls(overlay);
  });

  overlay.querySelector('#btn-export-data')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const label = button.querySelector('span');
    button.disabled = true;
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
    try {
      /* 导出为只读路径：不调用 saveData()，也不改运行时索引 */
      const result = await exportData(data, {
        format: exportFormat,
        includeApiKey: exportIncludeKey,
        dialogTitle: t('settings.exportTitle')
      });
      /* 用户主动取消保存对话框时不提示，避免噪音 */
      if (result.status === 'cancelled') return;
      showToast(result.path ? t('toast.exportSaved', { path: result.path }) : t('toast.exportDownloaded'));
    } catch (err) {
      console.warn('[export] failed:', err);
      showToast(t('toast.exportFailed'));
    } finally {
      button.disabled = false;
      button.classList.remove('is-loading');
      button.removeAttribute('aria-busy');
      if (label) label.textContent = t('settings.exportData');
    }
  });
}

export function initSettings(deps) {
  data = deps.data;
  saveData = deps.saveData;
  showToast = deps.showToast;
  render = deps.render;
  testNotification = deps.testNotification;
  getNotificationStatus = deps.getNotificationStatus;
  applyLanguageFn = deps.applyLanguage || null;
  onTagRenamed = deps.onTagRenamed || null;
  onTagDeleted = deps.onTagDeleted || null;
  updater = deps.updater || null;

  // 打开
  document.getElementById('btn-settings').addEventListener('click', openPanel);

  /* 语言变化即重建已开面板：不依赖调用方在切换后主动回调，
   * 避免主应用切换链路中途抛错时设置窗口停留在旧语言 */
  onLanguageChange(() => refreshSettingsLanguage());

  // Escape 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsOverlay) {
      closePanel();
    }
  });
}
