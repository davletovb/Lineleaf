import {ancestry} from './editor-context.mjs';

function translationOnly(transform) {
  if (transform === 'none') return true;
  try {
    const matrix = new DOMMatrixReadOnly(transform);
    return ['m11', 'm22', 'm33', 'm44'].every(key => matrix[key] === 1)
      && ['m12', 'm13', 'm14', 'm21', 'm23', 'm24', 'm31', 'm32', 'm34'].every(key => matrix[key] === 0);
  } catch { return false; }
}
export function visibleEditorRect(element) {
  const box = element.getBoundingClientRect();
  let left = Math.max(0, box.left + element.clientLeft), top = Math.max(0, box.top + element.clientTop);
  let right = Math.min(innerWidth, box.left + element.clientLeft + element.clientWidth);
  let bottom = Math.min(innerHeight, box.top + element.clientTop + element.clientHeight);
  for (const parent of ancestry(element)) {
    if (!(parent instanceof Element)) continue;
    const style = getComputedStyle(parent);
    // Rotated/scaled/perspective or shaped clipping needs its own tested geometry adapter.
    if (style.visibility !== 'visible' || style.display === 'none' || !translationOnly(style.transform)
        || style.rotate !== 'none' || style.scale !== 'none'
        || style.perspective !== 'none' || style.clipPath !== 'none') return null;
    if (parent === element) continue;
    const r = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, r.left + parent.clientLeft); right = Math.min(right, r.left + parent.clientLeft + parent.clientWidth); }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, r.top + parent.clientTop); bottom = Math.min(bottom, r.top + parent.clientTop + parent.clientHeight); }
  }
  return right > left && bottom > top ? {left, top, right, bottom, width: right - left, height: bottom - top} : null;
}

function point(element, offset) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); let node, length = 0;
  while ((node = walker.nextNode())) { if (offset <= length + node.length) return [node, offset - length]; length += node.length; }
  return [element, element.childNodes.length];
}
export function suggestionRects(element, source, start, end, mirror) {
  const box = element.getBoundingClientRect(), style = getComputedStyle(element), visible = visibleEditorRect(element);
  if (!visible) return [];
  if (box.width < 1 || box.height < 1 || style.writingMode !== 'horizontal-tb' || Math.abs(box.width - element.offsetWidth) > 2) return [];
  const input = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
  const range = document.createRange(); let shiftX = 0, shiftY = 0;
  if (input) {
    for (const property of ['font', 'fontKerning', 'fontFeatureSettings', 'fontVariationSettings', 'letterSpacing', 'lineHeight', 'textAlign', 'direction', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'textIndent', 'overflowWrap', 'wordBreak']) mirror.style[property] = style[property];
    mirror.style.width = `${element.clientWidth}px`; mirror.style.whiteSpace = element instanceof HTMLInputElement ? 'pre' : 'pre-wrap';
    mirror.textContent = source; range.setStart(mirror.firstChild, start); range.setEnd(mirror.firstChild, end);
    const origin = mirror.getBoundingClientRect();
    shiftX = box.left + element.clientLeft - origin.left - element.scrollLeft;
    shiftY = box.top + element.clientTop - origin.top - element.scrollTop;
    if (element instanceof HTMLInputElement) shiftY += Math.max(0, (element.clientHeight - mirror.offsetHeight) / 2);
  } else {
    const a = point(element, start), b = point(element, end); range.setStart(...a); range.setEnd(...b);
  }
  const {left, top, right, bottom} = visible;
  return [...range.getClientRects()].map(r => ({left: Math.max(left, r.left + shiftX), top: r.top + shiftY,
    right: Math.min(right, r.right + shiftX), bottom: r.bottom + shiftY}))
    .filter(r => r.right > r.left && r.bottom > top && r.bottom <= bottom + 1);
}
