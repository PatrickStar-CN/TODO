let tooltip = null;
let activeTarget = null;
let showFrame = 0;

function ensureTooltip() {
  if (tooltip) return tooltip;
  tooltip = document.createElement('div');
  tooltip.className = 'glass-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  document.body.appendChild(tooltip);
  return tooltip;
}

function getTooltipText(target) {
  return target?.getAttribute('title') || target?.dataset.glassTooltip || '';
}

function positionTooltip(target) {
  const tip = ensureTooltip();
  const targetRect = target.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const margin = 10;
  const viewportPadding = 8;
  let placement = 'top';
  let top = targetRect.top - tipRect.height - margin;

  if (top < viewportPadding) {
    placement = 'bottom';
    top = targetRect.bottom + margin;
  }

  let left = targetRect.left + (targetRect.width - tipRect.width) / 2;
  left = Math.max(viewportPadding, Math.min(left, window.innerWidth - tipRect.width - viewportPadding));
  top = Math.max(viewportPadding, Math.min(top, window.innerHeight - tipRect.height - viewportPadding));

  tip.dataset.placement = placement;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
  tip.classList.add('visible');
}

function showTooltip(target) {
  const text = getTooltipText(target).trim();
  if (!text) return;
  if (activeTarget && activeTarget !== target) hideTooltip();

  activeTarget = target;
  target.dataset.glassTooltip = text;
  target.removeAttribute('title');

  const tip = ensureTooltip();
  tip.textContent = text;
  tip.classList.remove('visible');
  cancelAnimationFrame(showFrame);
  showFrame = requestAnimationFrame(() => {
    if (activeTarget === target) positionTooltip(target);
  });
}

function hideTooltip() {
  cancelAnimationFrame(showFrame);
  if (activeTarget?.dataset.glassTooltip) {
    activeTarget.setAttribute('title', activeTarget.dataset.glassTooltip);
  }
  activeTarget = null;
  tooltip?.classList.remove('visible');
}

function findTooltipTarget(node) {
  if (!(node instanceof Element)) return null;
  const target = node.closest('[title], [data-glass-tooltip]');
  if (!target) return null;

  // Visible labels already explain the control. Removing title here also
  // prevents the browser's native tooltip from duplicating that label.
  const isHeatmapCell = target.matches('.calendar-day.year-day');
  if (!isHeatmapCell && target.innerText.trim()) {
    target.removeAttribute('title');
    delete target.dataset.glassTooltip;
    return null;
  }

  return target;
}

export function initGlassTooltip() {
  document.addEventListener('pointerover', (event) => {
    const target = findTooltipTarget(event.target);
    if (!target || target === activeTarget) return;
    showTooltip(target);
  });

  document.addEventListener('pointerout', (event) => {
    if (!activeTarget) return;
    if (activeTarget.contains(event.relatedTarget)) return;
    hideTooltip();
  });

  document.addEventListener('focusin', (event) => {
    const target = findTooltipTarget(event.target);
    if (target) showTooltip(target);
  });

  document.addEventListener('focusout', (event) => {
    if (activeTarget && !activeTarget.contains(event.relatedTarget)) hideTooltip();
  });

  window.addEventListener('scroll', hideTooltip, true);
  window.addEventListener('resize', hideTooltip);
}
