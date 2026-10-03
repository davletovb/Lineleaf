// Lineleaf's small icon set, drawn as SVG elements (no markup strings, so it works under a page's CSP and Trusted Types).
// Shapes live on a 24 x 24 grid; colour comes from `currentColor`. The `solid` flag marks parts that are filled instead of stroked.
const SVG = 'http://www.w3.org/2000/svg';
const ICONS = {
  // The Lineleaf mark: a leaf with its vein (the "line").
  leaf: [['path', 'M5 19C5 10.5 10.2 5 19 5c0 8.8-5.5 14-14 14z', true], ['path', 'M6.5 17.5 14 10', false, 'vein']],
  check: [['path', 'M5 12.5l4.5 4.5L19 7.5']],
  close: [['path', 'M6 6l12 12M18 6L6 18']],
  left: [['path', 'M14.5 6l-6 6 6 6']],
  right: [['path', 'M9.5 6l6 6-6 6']],
  down: [['path', 'M6 9.5l6 6 6-6']],
  up: [['path', 'M6 14.5l6-6 6 6']],
  refresh: [['path', 'M20 11a8 8 0 1 0-2.3 5.7M20 4.5V11h-6.5']],
  pause: [['path', 'M8.5 5.5v13M15.5 5.5v13']],
  stop: [['path', 'M7 7h10v10H7z']],
  sliders: [['path', 'M4 7h9M19 7h1M4 17h1M11 17h9'], ['circle', '16 7 2.2'], ['circle', '8 17 2.2']],
  sparkle: [['path', 'M12 3.5l1.9 5.2 5.1 1.8-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.8z']],
  copy: [['path', 'M9 9h10v11H9zM5 15V4h10']],
  undo: [['path', 'M9 14L4 9l5-5M4 9h9.5a6 6 0 0 1 0 12H11']],
  plus: [['path', 'M12 5v14M5 12h14']],
  alert: [['path', 'M12 4.5l9 15.5H3zM12 10.5v4M12 17.3v.2']],
  info: [['circle', '12 12 9'], ['path', 'M12 11v5M12 8v.2']],
  lock: [['path', 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3']]
};
export function icon(name, {size = 16, label = ''} = {}) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'll-icon'); svg.setAttribute('width', size); svg.setAttribute('height', size);
  if (label) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label); } else svg.setAttribute('aria-hidden', 'true');
  for (const [tag, shape, solid, role] of ICONS[name] ?? []) {
    const part = document.createElementNS(SVG, tag);
    if (tag === 'circle') { const [cx, cy, r] = shape.split(' '); part.setAttribute('cx', cx); part.setAttribute('cy', cy); part.setAttribute('r', r); } else part.setAttribute('d', shape);
    if (solid) part.setAttribute('class', 'solid');
    if (role === 'vein') { part.setAttribute('class', 'vein'); }
    svg.append(part);
  }
  return svg;
}
// A button that shows an icon with an accessible text label. The text stays in the button, hidden when `iconOnly`.
export function iconLabel(name, text, {iconOnly = false, size = 16} = {}) {
  const parts = [icon(name, {size})];
  if (iconOnly) { const label = document.createElement('span'); label.className = 'sr'; label.textContent = text; parts.push(label); } else parts.push(document.createTextNode(text));
  return parts;
}
