function point(element, offset) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); let node, length = 0;
  while ((node = walker.nextNode())) { if (offset <= length + node.length) return [node, offset - length]; length += node.length; }
  return [element, element.childNodes.length];
}
export function suggestionRects(element, source, start, end, mirror) {
  const box = element.getBoundingClientRect(), style = getComputedStyle(element);
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
  const left = Math.max(0, box.left + element.clientLeft), top = Math.max(0, box.top + element.clientTop);
  const right = Math.min(innerWidth, box.left + element.clientLeft + element.clientWidth), bottom = Math.min(innerHeight, box.top + element.clientTop + element.clientHeight);
  return [...range.getClientRects()].map(r => ({left: Math.max(left, r.left + shiftX), top: r.top + shiftY,
    right: Math.min(right, r.right + shiftX), bottom: r.bottom + shiftY}))
    .filter(r => r.right > r.left && r.bottom > top && r.bottom <= bottom + 1);
}
