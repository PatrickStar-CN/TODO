import { escapeHtml } from './utils/html.js';
import { applyTheme } from './theme.js';
import { closeDetail } from './detail.js';
import { showConfirmDialog } from './overlay.js';

const TAG_COLORS = ['#4f46e5', '#06b6d4', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];

let data, saveData, showToast, render;
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
  if (modal) modal.style.animation = 'modalShrinkOut 0.2s cubic-bezier(0.4, 0, 1, 1) forwards';
  settingsOverlay.classList.add('closing');
  const overlayRef = settingsOverlay;
  settingsOverlay = null;
  overlayRef.addEventListener('animationend', () => overlayRef.remove(), { once: true });
  setTimeout(() => { if (overlayRef.parentNode) overlayRef.remove(); }, 300);
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
        <button class="icon-btn" id="close-settings">✕</button>
      </div>
      <div class="settings-tabs">
        <button class="settings-tab active" data-tab="appearance">外观</button>
        <button class="settings-tab" data-tab="ai">AI 配置</button>
        <button class="settings-tab" data-tab="tags">标签管理</button>
      </div>
      <div class="settings-body">
        <div class="settings-pane active" data-pane="appearance">
          <div class="settings-row">
            <label>主题</label>
            <div class="theme-options">
              <button class="theme-opt" data-theme="auto">🌗 跟随系统</button>
              <button class="theme-opt" data-theme="light">☀️ 白天</button>
              <button class="theme-opt" data-theme="dark">🌙 夜间</button>
            </div>
          </div>
        </div>
        <div class="settings-pane" data-pane="ai">
          <div class="settings-row">
            <label>API 地址</label>
            <input type="text" id="set-api-url" placeholder="https://api.openai.com/v1/chat/completions">
          </div>
          <div class="settings-row">
            <label>API Key</label>
            <input type="password" id="set-api-key" placeholder="sk-...">
          </div>
          <div class="settings-row">
            <label>模型</label>
            <input type="text" id="set-model" placeholder="gpt-4o-mini">
          </div>
          <div class="settings-row">
            <label>自定义提示词</label>
            <textarea id="set-prompt" rows="4" placeholder="留空使用默认提示词"></textarea>
          </div>
          <button class="btn-primary btn-sm" id="set-save-ai">保存 AI 配置</button>
        </div>
        <div class="settings-pane" data-pane="tags">
          <div id="settings-tag-list" class="settings-tag-list"></div>
          <button id="set-add-tag-btn">+ 新建标签</button>
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
  modal.style.animation = 'modalExpandIn 0.28s cubic-bezier(0.16, 1, 0.3, 1)';

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
      data.theme = btn.dataset.theme;
      saveData();
      applyTheme(data.theme);
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
  overlay.querySelector('#set-add-tag-btn').addEventListener('click', () => {
    openCreateTagInline(overlay);
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
  overlay.querySelectorAll('.settings-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });
  overlay.querySelectorAll('.settings-pane').forEach(p => {
    p.classList.toggle('active', p.dataset.pane === tabName);
  });
}

// --- 内容渲染 ---

function renderContent(overlay) {
  updateThemeSelection(overlay);
  fillAiConfigFields(overlay);
  renderTagList(overlay);
}

function updateThemeSelection(overlay) {
  overlay.querySelectorAll('.theme-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === data.theme);
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
  if (data.tags.length === 0) {
    container.innerHTML = '<div class="settings-tag-empty">暂无标签</div>';
    return;
  }
  container.innerHTML = data.tags.map(tag => `
    <div class="tag-manage-item" data-tag="${escapeHtml(tag)}">
      <span class="tag-dot" style="background:${getTagColor(tag)}"></span>
      <span class="tag-manage-name" data-role="rename-tag">${escapeHtml(tag)}</span>
      <span class="tag-manage-count">${getTagTaskCount(tag)}</span>
      <button class="tag-delete-btn" data-role="delete-tag" data-tag="${escapeHtml(tag)}" title="删除标签">✕</button>
    </div>
  `).join('');
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

function openCreateTagInline(overlay) {
  const container = overlay.querySelector('#settings-tag-list');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tag-rename-input';
  input.placeholder = '输入标签名称';
  container.insertBefore(input, container.firstChild);
  input.focus();

  const finish = () => {
    const name = input.value.trim();
    if (name) {
      if (data.tags.includes(name)) {
        showToast('标签已存在');
      } else {
        data.tags.push(name);
        saveData();
        render();
        renderTagList(overlay);
        showToast('标签创建成功');
      }
    }
    input.remove();
  };

  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.remove(); }
  });
}

// --- 导出 ---

export function initSettings(deps) {
  data = deps.data;
  saveData = deps.saveData;
  showToast = deps.showToast;
  render = deps.render;

  // 打开
  document.getElementById('btn-settings').addEventListener('click', openPanel);

  // Escape 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsOverlay) {
      closePanel();
    }
  });
}
