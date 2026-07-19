import { isSameDay, isToday, formatDate, formatDateTime } from './utils/date.js';
import { renderGlassSelect, initGlassSelectGroup } from './glassSelect.js';
import { iconSvg, setIcon } from './icons.js';

let activePicker = null;
let _insideClick = false;

function closeActivePicker() {
  if (activePicker) {
    activePicker.close();
    activePicker = null;
  }
}

export function closeDatePicker() {
  closeActivePicker();
}

document.addEventListener('click', (e) => {
  if (_insideClick) return;
  if (activePicker && !e.target.closest('.date-picker') && !e.target.closest('.dp-trigger')) {
    closeActivePicker();
  }
});

document.addEventListener('click', (e) => {
  if (activePicker && e.target.closest('.date-picker')) {
    _insideClick = true;
    requestAnimationFrame(() => { _insideClick = false; });
  }
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && activePicker) {
    e.preventDefault();
    e.stopPropagation();
    closeActivePicker();
  }
});

function parseValue(value, mode) {
  if (!value) return null;
  if (mode === 'datetime') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  const parts = String(value).split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function toInputValue(date, mode) {
  if (!date) return '';
  if (mode === 'datetime') {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${dd}T${h}:${min}`;
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function displayText(value, mode) {
  const d = parseValue(value, mode);
  if (!d) return mode === 'datetime' ? '选择日期时间' : '选择日期';
  return mode === 'datetime' ? formatDateTime(d.toISOString()) : formatDate(d.toISOString());
}

class DatePicker {
  constructor(inputEl, options = {}) {
    this.input = inputEl;
    this.mode = options.mode || (inputEl.type === 'datetime-local' ? 'datetime' : 'date');
    this.onChange = options.onChange || null;
    this.selectedDate = null;
    this.viewYear = null;
    this.viewMonth = null;
    this.pickHour = 0;
    this.pickMinute = 0;

    this._buildTrigger();
    this._readInitialValue();
  }

  _buildTrigger() {
    const wrapper = document.createElement('div');
    wrapper.className = 'dp-wrapper';

    this.trigger = document.createElement('div');
    this.trigger.className = 'dp-trigger';
    this.trigger.textContent = displayText(this.input.value, this.mode);

    const clearBtn = document.createElement('button');
    clearBtn.className = 'dp-clear-btn';
    setIcon(clearBtn, 'x');
    clearBtn.setAttribute('aria-label', '清除');
    clearBtn.title = '清除';
    clearBtn.style.display = this.input.value ? '' : 'none';
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._setValue('');
      clearBtn.style.display = 'none';
    });

    wrapper.appendChild(this.trigger);
    wrapper.appendChild(clearBtn);

    this.input.style.cssText += ';position:absolute;opacity:0;pointer-events:none;width:0;height:0;';
    this.input.parentNode.insertBefore(wrapper, this.input);
    wrapper.appendChild(this.input);

    this.trigger.addEventListener('click', () => this.toggle());
  }

  _readInitialValue() {
    this.selectedDate = parseValue(this.input.value, this.mode);
    if (this.selectedDate) {
      this.pickHour = this.selectedDate.getHours();
      this.pickMinute = this.selectedDate.getMinutes();
    }
  }

  _setValue(val) {
    this.input.value = val;
    this.trigger.textContent = displayText(val, this.mode);
    const clearBtn = this.trigger.parentElement.querySelector('.dp-clear-btn');
    if (clearBtn) clearBtn.style.display = val ? '' : 'none';
    this.selectedDate = parseValue(val, this.mode);
    this.input.dispatchEvent(new Event('change', { bubbles: true }));
    if (this.onChange) this.onChange(val);
  }

  toggle() {
    if (activePicker && activePicker !== this) closeActivePicker();
    if (this.panel && this.panel.isConnected) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    if (this.panel && this.panel.isConnected) return;

    this._readInitialValue();

    const now = new Date();
    if (!this.selectedDate) {
      this.selectedDate = isToday(now) ? new Date(now) : null;
      this.pickHour = now.getHours();
      this.pickMinute = now.getMinutes();
    }

    this.viewYear = this.selectedDate
      ? this.selectedDate.getFullYear()
      : now.getFullYear();
    this.viewMonth = this.selectedDate
      ? this.selectedDate.getMonth()
      : now.getMonth();

    this.panel = document.createElement('div');
    this.panel.className = 'date-picker';
    this._renderPanel();

    document.body.appendChild(this.panel);
    this._positionPanel();
    activePicker = this;

    requestAnimationFrame(() => {
      this._positionPanel();
    });
  }

  close() {
    if (this.panel && this.panel.parentNode) {
      this.panel.remove();
    }
    if (activePicker === this) activePicker = null;
  }

  _positionPanel() {
    if (!this.panel || !this.trigger) return;
    const rect = this.trigger.getBoundingClientRect();
    let top = rect.bottom + window.scrollY + 6;
    let left = rect.left + window.scrollX;

    requestAnimationFrame(() => {
      const pH = this.panel.offsetHeight;
      const pW = this.panel.offsetWidth;
      const viewportTop = window.scrollY + 8;
      const viewportBottom = window.scrollY + window.innerHeight - 8;
      const availableHeight = Math.max(240, window.innerHeight - 16);

      this.panel.style.maxHeight = `${availableHeight}px`;
      this.panel.style.overflowY = pH > availableHeight ? 'auto' : '';

      if (top + pH > viewportBottom) {
        const aboveTop = rect.top + window.scrollY - pH - 6;
        top = aboveTop >= viewportTop
          ? aboveTop
          : Math.max(viewportTop, viewportBottom - Math.min(pH, availableHeight));
      }
      top = Math.max(viewportTop, Math.min(top, viewportBottom - Math.min(pH, availableHeight)));
      if (left + pW > window.innerWidth + window.scrollX) {
        left = window.innerWidth + window.scrollX - pW - 8;
      }
      if (left < 0) left = 8;
      this.panel.style.top = top + 'px';
      this.panel.style.left = left + 'px';
    });
  }

  _renderPanel() {
    const year = this.viewYear;
    const month = this.viewMonth;
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrev = new Date(year, month, 0).getDate();
    const todayDate = new Date();

    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;

    let dayCells = '';

    for (let i = firstDay - 1; i >= 0; i--) {
      dayCells += `<span class="dp-day dp-other">${daysInPrev - i}</span>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const td = isToday(date);
      const sel = this.selectedDate && isSameDay(date, this.selectedDate);
      dayCells += `<span class="dp-day${td ? ' dp-today' : ''}${sel ? ' dp-selected' : ''}" data-d="${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}">${d}</span>`;
    }
    const totalCells = firstDay + daysInMonth;
    const remaining = (7 - totalCells % 7) % 7;
    for (let i = 1; i <= remaining; i++) {
      dayCells += `<span class="dp-day dp-other">${i}</span>`;
    }

    const timeRowHtml = this.mode === 'datetime' ? `
      <div class="dp-time-row">
        <label>时</label>
        ${renderGlassSelect({
          id: 'dp-hour-select',
          className: 'dp-hour',
          value: this.pickHour,
          options: Array.from({ length: 24 }, (_, h) => ({ value: h, label: String(h).padStart(2, '0') })),
          ariaLabel: '选择小时',
        })}
        <label>分</label>
        ${renderGlassSelect({
          id: 'dp-minute-select',
          className: 'dp-minute',
          value: this.pickMinute,
          options: Array.from({ length: 60 }, (_, m) => ({ value: m, label: String(m).padStart(2, '0') })),
          ariaLabel: '选择分钟',
        })}
      </div>` : '';

    this.panel.innerHTML = `
      <div class="dp-header">
        <button type="button" class="dp-nav-btn" data-nav="prev" aria-label="上一个月">${iconSvg('chevron-left')}</button>
        <button type="button" class="dp-title" data-action="pick-month">${year}\u5E74${month + 1}\u6708</button>
        <button type="button" class="dp-nav-btn" data-nav="next" aria-label="下一个月">${iconSvg('chevron-right')}</button>
        ${isToday(todayDate) ? `<button type="button" class="icon-btn dp-today-btn today-jump-btn" title="\u56DE\u5230\u4ECA\u5929" aria-label="\u56DE\u5230\u4ECA\u5929">${iconSvg('today')}</button>` : ''}
      </div>
      <div class="dp-weekdays"><span>\u65E5</span><span>\u4E00</span><span>\u4E8C</span><span>\u4E09</span><span>\u56DB</span><span>\u4E94</span><span>\u516D</span></div>
      <div class="dp-grid">${dayCells}</div>
      ${timeRowHtml}
      <div class="dp-actions">
        <button type="button" class="dp-btn dp-btn-confirm">\u786E\u5B9A</button>
        <button type="button" class="dp-btn dp-btn-clear">\u6E05\u9664</button>
      </div>
    `;

    this._bindEvents();
  }

  _bindEvents() {
    this.panel.querySelector('[data-nav="prev"]').addEventListener('click', () => {
      this.viewMonth--;
      if (this.viewMonth < 0) { this.viewMonth = 11; this.viewYear--; }
      this._renderPanel();
    });
    this.panel.querySelector('[data-nav="next"]').addEventListener('click', () => {
      this.viewMonth++;
      if (this.viewMonth > 11) { this.viewMonth = 0; this.viewYear++; }
      this._renderPanel();
    });

    const todayBtn = this.panel.querySelector('.dp-today-btn');
    if (todayBtn) {
      todayBtn.addEventListener('click', () => {
        const t = new Date();
        this.viewYear = t.getFullYear();
        this.viewMonth = t.getMonth();
        this.selectedDate = new Date(t.getFullYear(), t.getMonth(), t.getDate(), this.pickHour, this.pickMinute);
        this._renderPanel();
      });
    }

    this.panel.querySelectorAll('.dp-day:not(.dp-other)').forEach(el => {
      el.addEventListener('click', () => {
        this.selectedDate = new Date(el.dataset.d + 'T00:00:00');
        if (this.mode === 'datetime') {
          this.selectedDate.setHours(this.pickHour, this.pickMinute, 0, 0);
        }
        this._renderPanel();
      });
    });

    initGlassSelectGroup(this.panel, {
      onChange: (select, value) => {
        if (select.classList.contains('dp-hour')) this.pickHour = parseInt(value, 10);
        if (select.classList.contains('dp-minute')) this.pickMinute = parseInt(value, 10);
      },
    });

    this.panel.querySelector('.dp-btn-confirm').addEventListener('click', () => {
      if (this.selectedDate) {
        if (this.mode === 'datetime') {
          this.selectedDate.setHours(this.pickHour, this.pickMinute, 0, 0);
        }
        this._setValue(toInputValue(this.selectedDate, this.mode));
      }
      this.close();
    });

    this.panel.querySelector('.dp-btn-clear').addEventListener('click', () => {
      this._setValue('');
      this.close();
    });
  }
}

export function initDatePicker(inputEl, options) {
  if (!inputEl || inputEl._datePicker) return;
  inputEl._datePicker = new DatePicker(inputEl, options);
  return inputEl._datePicker;
}

export function openDatePicker(inputEl) {
  if (inputEl && inputEl._datePicker) inputEl._datePicker.open();
}
