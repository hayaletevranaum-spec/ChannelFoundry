const DEFAULT_MARGIN = 14;
const DEFAULT_GAP = 10;

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, minimum, maximum) {
  if (maximum < minimum) return (minimum + maximum) / 2;
  return Math.min(Math.max(value, minimum), maximum);
}

export function resolveHoverCardPosition(anchorRect, cardRect, viewport = {}, options = {}) {
  const viewportLeft = finite(viewport.left, 0);
  const viewportTop = finite(viewport.top, 0);
  const viewportWidth = Math.max(1, finite(viewport.width, globalThis.innerWidth ?? 1));
  const viewportHeight = Math.max(1, finite(viewport.height, globalThis.innerHeight ?? 1));
  const margin = Math.max(0, finite(options.margin, DEFAULT_MARGIN));
  const gap = Math.max(0, finite(options.gap, DEFAULT_GAP));
  const cardWidth = Math.max(0, finite(cardRect?.width, 0));
  const cardHeight = Math.max(0, finite(cardRect?.height, 0));
  const viewportRight = viewportLeft + viewportWidth;
  const viewportBottom = viewportTop + viewportHeight;
  const anchorLeft = finite(anchorRect?.left, viewportLeft);
  const anchorRight = finite(anchorRect?.right, anchorLeft);
  const anchorTop = finite(anchorRect?.top, viewportTop);
  const anchorBottom = finite(anchorRect?.bottom, anchorTop);
  const centeredLeft = (anchorLeft + anchorRight - cardWidth) / 2;
  const left = clamp(centeredLeft, viewportLeft + margin, viewportRight - margin - cardWidth);
  const roomBelow = viewportBottom - margin - anchorBottom;
  const roomAbove = anchorTop - viewportTop - margin;
  const placement = roomBelow >= cardHeight + gap || roomBelow >= roomAbove ? 'below' : 'above';
  const preferredTop = placement === 'below' ? anchorBottom + gap : anchorTop - gap - cardHeight;
  const top = clamp(preferredTop, viewportTop + margin, viewportBottom - margin - cardHeight);

  return { left, top, placement };
}
