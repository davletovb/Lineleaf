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

// ---------- badge placement ----------
// The badge is a 30 px control by the field. Composers put their own controls (send, voice, a model picker) in the strip right
// under the editable, so a fixed offset from the editable lands on them. Instead the badge looks at what is on screen: it picks
// the first spot around the visible input box that nothing meaningful covers, and stays there until that stops being true.
const BADGE = 30, GAP = 4, EDGE = 8, STEP = BADGE + 6, REPLACE_MS = 400;
const SAMPLES = [[3, 3], [27, 3], [15, 15], [3, 27], [27, 27]]; // inside the badge's square: corners and middle
const CLICKABLE = 'a[href],button,input,select,textarea,summary,label,img,svg,canvas,video,picture,[role=button],[role=link],[role=menuitem],[role=tab],[role=switch],[role=checkbox],[role=combobox],[role=option],[contenteditable=""],[contenteditable=true],[tabindex]:not([tabindex="-1"])';
const clear = color => color === 'transparent' || /(?:,|\/)\s*0(?:\.0+)?\)$/.test(color);

// Does this element draw a visible box of its own: a border, a shadow, or a fill that differs from what is behind it?
function drawsBox(element) {
  const style = getComputedStyle(element), parent = element.parentElement ? getComputedStyle(element.parentElement) : null;
  return ['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(style[`border${side}Width`]) >= 1 && style[`border${side}Style`] !== 'none' && !clear(style[`border${side}Color`]))
    || style.boxShadow !== 'none' || (!clear(style.backgroundColor) && style.backgroundColor !== parent?.backgroundColor);
}
// The box the user sees as "the input": the outermost ancestor that draws its own box and is not much bigger than the editable
// (a card holding the field and its toolbar, a pill holding it between buttons), or null when the editable stands alone.
function surfaceOf(field) {
  const own = field.getBoundingClientRect(); let surface = null, depth = 0;
  for (const node of ancestry(field)) {
    if (!(node instanceof Element)) continue;
    if (node === document.body || node === document.documentElement || ++depth > 7) break;
    const r = node.getBoundingClientRect();
    if (r.width > own.width * 2.2 + 40 || r.height > own.height + 240) break; // grew into the page layout: stop climbing
    if (drawsBox(node)) surface = node;
  }
  return surface;
}

// The topmost element at a point that is not Lineleaf's own, looking into open shadow roots.
function topAt(x, y, ignore) {
  let element = document.elementsFromPoint(x, y).find(e => e !== ignore);
  for (let inner; element?.shadowRoot && (inner = element.shadowRoot.elementFromPoint(x, y)) && inner !== element; element = inner);
  return element ?? null;
}
// Would the badge hide something? A container of the field never does; a control, a picture or text does.
function covers(element, held) {
  for (let node = element; node && !held.has(node); node = node.parentElement) {
    if (node.matches(CLICKABLE)) return true;
    const cursor = getComputedStyle(node).cursor; // a clickable <div> says so by its cursor, set on it and inherited below
    if (cursor === 'pointer' && (!node.parentElement || getComputedStyle(node.parentElement).cursor !== 'pointer')) return true;
  }
  return !held.has(element) && [...element.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.data.trim());
}
const covered = (x, y, held, ignore) => SAMPLES.reduce((count, [dx, dy]) => {
  const element = topAt(x + dx, y + dy, ignore); return count + (element && covers(element, held) ? 1 : 0);
}, 0);

// Spots in order of preference: below the box at its end, above it at its end, then sliding toward its start along each edge,
// then beside it. All are outside the box, so the badge never covers text and never straddles a rounded border. The last is where
// the badge used to be (bottom-right under the editable, pulled onto the screen): it is always on screen, and it competes like the rest.
function spots(box, editor) {
  const list = [], limit = Math.max(1, Math.min(12, Math.floor((box.right - box.left) / STEP)));
  for (let i = 0; i < limit; i++) {
    const x = box.right - BADGE - i * STEP;
    list.push([`below-end:${i}`, x, box.bottom + GAP], [`above-end:${i}`, x, box.top - BADGE - GAP]);
  }
  list.push(['after', box.right + GAP, box.bottom - BADGE], ['before', box.left - BADGE - GAP, box.bottom - BADGE]);
  const fits = list.filter(([, x, y]) => x >= EDGE && y >= EDGE && x + BADGE <= innerWidth - EDGE && y + BADGE <= innerHeight - EDGE);
  fits.push(['fallback', Math.max(EDGE, Math.min(innerWidth - BADGE - EDGE, editor.right - BADGE)), Math.max(EDGE, Math.min(innerHeight - BADGE - 4, editor.bottom + GAP))]);
  return fits.map(([place, left, top]) => ({place, left, top}));
}

// `memo` belongs to one view. The place it chose is kept between paints (scrolling moves the box, and the place with it) and is
// looked at again only every REPLACE_MS, so the badge does not hop while the user types. It moves when its place stops fitting
// or is covered, to the first spot that is clear, or failing that the one that hides the least.
export function badgeSpot(field, editor, ignore, memo, now = performance.now()) {
  const due = !(now - memo.at < REPLACE_MS);
  if (due || (memo.surface && !memo.surface.isConnected)) memo.surface = surfaceOf(field);
  const surface = memo.surface?.getBoundingClientRect(), box = surface
    ? {left: Math.min(surface.left, editor.left), top: Math.min(surface.top, editor.top), right: Math.max(surface.right, editor.right), bottom: Math.max(surface.bottom, editor.bottom)} : editor;
  const list = spots(box, editor), kept = list.find(spot => spot.place === memo.place);
  if (kept && !due) return kept;
  memo.at = now;
  const held = new Set(ancestry(field)); let best = null, bestCount = Infinity;
  for (const spot of kept ? [kept, ...list.filter(other => other !== kept)] : list) { // the current place first: it stays when it is still as clear as any
    const count = covered(spot.left, spot.top, held, ignore);
    if (count < bestCount) { best = spot; bestCount = count; }
    if (count === 0) break;
  }
  memo.place = best.place;
  return best;
}
