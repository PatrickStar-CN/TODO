import { toLocalDateInput, parseLocalDateInput, formatMonthDay } from './utils/date.js';
import { escapeHtml } from './utils/html.js';
import { closeDetail } from './detail.js';
import { resolveAiApiUrl } from './utils/aiApi.js';
import { getUiMotionDuration } from './uiPreferences.js';

export function initAiSummary({ data, saveData, showToast }) {
  let summaryType = 'daily';
  const summaryPanel = document.getElementById('summary-panel');
  const summaryOutput = document.getElementById('summary-output');
  const summaryFooter = document.getElementById('summary-footer');
  const summaryDateInput = document.getElementById('summary-date');
  const generateReportBtn = document.getElementById('btn-generate-report');
  const generateReportLabel = generateReportBtn.querySelector('.summary-generate-label');
  let isGeneratingReport = false;

  summaryDateInput.value = toLocalDateInput(new Date());

  let summaryOverlay = null;
  const summaryDateRangeEl = document.getElementById('summary-date-range');

  summaryDateInput.addEventListener('change', updateSummaryDateRange);

  function updateSummaryDateRange() {
    const dateStr = summaryDateInput.value;
    if (!dateStr) {
      summaryDateRangeEl.textContent = '';
      return;
    }
    const baseDate = parseLocalDateInput(dateStr);
    if (!baseDate) {
      summaryDateRangeEl.textContent = '';
      return;
    }
    if (summaryType === 'weekly') {
      const day = baseDate.getDay();
      const start = new Date(baseDate);
      start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      summaryDateRangeEl.textContent = `${formatMonthDay(start)} ~ ${formatMonthDay(end)}`;
    } else {
      summaryDateRangeEl.textContent = '';
    }
  }

  document.getElementById('btn-open-summary').addEventListener('click', () => {
    closeDetail();

    // 记录触发按钮位置，用于弹窗从点击处放大动画
    const btn = document.getElementById('btn-open-summary');
    const rect = btn.getBoundingClientRect();
    summaryPanel.style.setProperty('--origin-x', `${rect.left + rect.width / 2 - window.innerWidth / 2}px`);
    summaryPanel.style.setProperty('--origin-y', `${rect.top + rect.height / 2 - window.innerHeight / 2}px`);

    summaryPanel.classList.remove('hidden', 'hiding');
    summaryPanel.style.animation = 'none';
    summaryPanel.offsetHeight;
    summaryPanel.style.animation = 'modalExpandIn var(--motion-panel)';

    if (!summaryOverlay) {
      summaryOverlay = document.createElement('div');
      summaryOverlay.className = 'summary-overlay';
      summaryOverlay.addEventListener('click', () => {
        document.getElementById('close-summary').click();
      });
      document.body.appendChild(summaryOverlay);
    }
    summaryOverlay.classList.remove('hiding');
  });

  document.getElementById('close-summary').addEventListener('click', () => {
    summaryPanel.classList.add('hiding');
    summaryPanel.style.animation = 'modalShrinkOut var(--motion-normal) forwards';
    if (summaryOverlay) {
      summaryOverlay.classList.add('hiding');
      summaryOverlay.addEventListener('animationend', () => {
        summaryOverlay.remove();
        summaryOverlay = null;
      }, { once: true });
      setTimeout(() => { if (summaryOverlay && summaryOverlay.parentNode) { summaryOverlay.remove(); summaryOverlay = null; } }, getUiMotionDuration('normal') + 50);
    }
    summaryPanel.addEventListener('animationend', () => {
      summaryPanel.classList.add('hidden');
      summaryPanel.classList.remove('hiding');
      summaryPanel.style.animation = '';
    }, { once: true });
    setTimeout(() => {
      if (summaryPanel.classList.contains('hiding')) {
        summaryPanel.classList.add('hidden');
        summaryPanel.classList.remove('hiding');
        summaryPanel.style.animation = '';
      }
    }, getUiMotionDuration('normal') + 50);
  });

  document.querySelectorAll('.summary-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.summary-tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      summaryType = tab.dataset.type;
      updateSummaryDateRange();
    });
  });

  generateReportBtn.addEventListener('click', async () => {
    if (isGeneratingReport) {
      showToast('报告正在生成中');
      return;
    }
    if (!data.aiConfig.apiUrl || !data.aiConfig.apiKey || !data.aiConfig.model) {
      showToast('请先配置 API');
      return;
    }
    const dateStr = summaryDateInput.value;
    if (!dateStr) {
      showToast('请选择日期');
      return;
    }

    const baseDate = parseLocalDateInput(dateStr);
    if (!baseDate) {
      showToast('日期格式无效');
      return;
    }
    let startDate, endDate, rangeLabel;

    if (summaryType === 'daily') {
      startDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 1);
      rangeLabel = formatMonthDay(startDate);
    } else {
      const day = baseDate.getDay();
      startDate = new Date(baseDate);
      startDate.setDate(startDate.getDate() - (day === 0 ? 6 : day - 1));
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 7);
      const weekEnd = new Date(endDate);
      weekEnd.setDate(weekEnd.getDate() - 1);
      rangeLabel = `${formatMonthDay(startDate)} ~ ${formatMonthDay(weekEnd)}`;
    }

    const doneTodos = data.todos.filter(t => {
      if (!t.done || !t.doneAt) return false;
      const d = new Date(t.doneAt);
      return d >= startDate && d < endDate;
    });
    const pendingTodos = data.todos.filter(t => {
      if (t.done) return false;
      const created = new Date(t.createdAt);
      const end = t.endTime ? new Date(t.endTime) : null;
      return created < endDate && (!end || end >= startDate);
    });

    const typeLabel = summaryType === 'daily' ? '日报' : '周报';
    const planLabel = summaryType === 'daily' ? '明日计划' : '下周计划';
    const doneList = doneTodos.length > 0
      ? doneTodos.map(t => `- ${t.title}${t.priority !== 'none' ? `（优先级：${{high:'高',medium:'中',low:'低'}[t.priority]}）` : ''}${t.tag ? `（标签：${t.tag}）` : ''}${t.desc ? `\n  备注：${t.desc}` : ''}`).join('\n')
      : '- 无';
    const pendingList = pendingTodos.length > 0
      ? pendingTodos.map(t => `- ${t.title}${t.priority !== 'none' ? `（优先级：${{high:'高',medium:'中',low:'低'}[t.priority]}）` : ''}${t.tag ? `（标签：${t.tag}）` : ''}${t.desc ? `\n  备注：${t.desc}` : ''}`).join('\n')
      : '- 无';

    const prompt = buildPrompt({ data, summaryType, typeLabel, planLabel, rangeLabel, doneList, pendingList });

    isGeneratingReport = true;
    generateReportBtn.disabled = true;
    generateReportBtn.classList.add('is-loading');
    generateReportBtn.setAttribute('aria-busy', 'true');
    generateReportLabel.textContent = '生成中...';
    summaryOutput.textContent = '';
    summaryFooter.classList.add('hidden');
    summaryOutput.innerHTML = '<div class="summary-loading"><span class="summary-loading-indicator" aria-hidden="true"></span><strong>正在生成总结</strong><span>AI 正在整理任务进度，请稍候</span></div>';

    try {
      const response = await fetch(resolveAiApiUrl(data.aiConfig.apiUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${data.aiConfig.apiKey}`
        },
        body: JSON.stringify({
          model: data.aiConfig.model,
          messages: [{ role: 'user', content: prompt }],
          stream: true
        })
      });

      if (!response.ok) {
        const err = await response.text();
        summaryOutput.textContent = `请求失败：${response.status}\n${err || '请检查 API 地址、模型名称或服务状态'}`;
        return;
      }

      summaryOutput.textContent = '';
      const reader = response.body?.getReader();
      if (!reader) {
        const json = await response.json();
        const content = json.choices?.[0]?.message?.content || json.choices?.[0]?.text || '';
        summaryOutput.textContent = content || '接口未返回报告内容';
        summaryFooter.classList.remove('hidden');
        return;
      }
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') break;
          try {
            const json = JSON.parse(payload);
            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              summaryOutput.textContent += content;
            }
          } catch {}
        }
      }
      summaryFooter.classList.remove('hidden');
    } catch (err) {
      summaryOutput.textContent = `请求出错: ${err.message}`;
    } finally {
      isGeneratingReport = false;
      generateReportBtn.disabled = false;
      generateReportBtn.classList.remove('is-loading');
      generateReportBtn.removeAttribute('aria-busy');
      generateReportLabel.textContent = '生成报告';
    }
  });

  document.getElementById('btn-copy-report').addEventListener('click', () => {
    const text = summaryOutput.textContent;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      showToast('已复制到剪贴板');
    }).catch(() => {
      showToast('复制失败');
    });
  });
}

function buildPrompt({ data, summaryType, typeLabel, planLabel, rangeLabel, doneList, pendingList }) {
  if (data.aiConfig.customPrompt) {
    return data.aiConfig.customPrompt
      .replace(/\{type\}/g, typeLabel)
      .replace(/\{range\}/g, rangeLabel)
      .replace(/\{doneList\}/g, doneList)
      .replace(/\{pendingList\}/g, pendingList)
      .replace(/\{plan\}/g, planLabel);
  }
  const wordLimit = summaryType === 'daily' ? '300' : '500';
  return `你是一位专业的项目管理助手，擅长撰写简洁、结构清晰的工作报告。

请根据以下任务数据，生成一份高质量的${typeLabel}。

## 基本信息
- 报告类型：${typeLabel}
- 日期范围：${rangeLabel}

## 任务数据

### 已完成任务
${doneList}

### 进行中/未完成任务
${pendingList}

## 输出要求

请严格按照以下格式输出（使用 Markdown）：

### ${typeLabel} · ${rangeLabel}

**一、工作概览**
用 1-2 句话概括本期工作重点和整体进展。

**二、已完成事项**
- 将已完成任务按标签或类别分组列出
- 每项用一句话描述完成情况
- 如果有高优先级任务完成，优先列出并标注

**三、进行中事项**
- 列出当前仍在进行的任务
- 标注优先级和预计完成情况
- 如有阻塞或风险，简要说明

**四、${planLabel}**
- 根据进行中任务和整体节奏，给出 3-5 条合理的计划建议
- 优先级高的任务排在前面

**五、总结与反思**
用 1-2 句话总结本期效率和改进方向。

## 注意事项
- 语言：简洁专业的中文
- 如果某个分类没有数据，写"无"即可，不要编造内容
- 不要重复罗列原始数据，要有归纳和提炼
- 保持整体篇幅适中，控制在 ${wordLimit} 字以内`;
}
