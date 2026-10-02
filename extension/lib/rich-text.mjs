// Copy-only paragraph capture for rich editors (Draft.js, Lexical, Slate, ProseMirror, Quill, Gmail-style
// composers and other contenteditable surfaces). Lineleaf reads the caret's paragraph and positions an
// overlay from DOM ranges. It never writes to, focuses, or attaches observers to the editor.
import {EXCLUDED, contextFor, contextCurrent, embeddingAllowed, excluded, previewAllowed, selectionFor} from './editor-context.mjs';
import {validText, LineleafError} from './policy.mjs';
import {visibleEditorRect} from './geometry.mjs';

const invalid = () => new LineleafError('INVALID_REQUEST');
const INLINE = /^(?:inline|contents|ruby)/;
const MAX_BLOCK = 100000;

// Block-level container of a node, found without relying on any framework markup.
function blockFor(host, node) {
  let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  while (element && element !== host && INLINE.test(getComputedStyle(element).display)) element = element.parentElement;
  return element && host.contains(element) ? element : host;
}

// How CSS treats whitespace inside `element`: spaces are kept (pre, pre-wrap, break-spaces) and/or newlines are line breaks.
function whitespaceOf(element) {
  const style = getComputedStyle(element);
  const collapse = style.whiteSpaceCollapse || {normal: 'collapse', nowrap: 'collapse', pre: 'preserve', 'pre-wrap': 'preserve',
    'pre-line': 'preserve-breaks', 'break-spaces': 'break-spaces'}[style.whiteSpace] || 'collapse';
  return {spaces: collapse === 'preserve' || collapse === 'break-spaces', breaks: collapse !== 'collapse'};
}

// Visible text of `root` as one string with a 1:1 UTF-16 mapping back to DOM text nodes. Block boundaries and <br>
// become '\n'. Collapsible whitespace is reduced the way CSS renders it (one space; none at the start or end of a
// line), zero-width editor placeholders are skipped and NBSP is normalised to a space so model-supplied context
// matches. Skipped characters simply have no entry. Nothing here changes the DOM.
export function textMap(root) {
  const runs = [], inline = new Map();
  const isInline = element => {
    if (!inline.has(element)) inline.set(element, INLINE.test(getComputedStyle(element).display));
    return inline.get(element);
  };
  const owner = node => {
    let element = node.parentElement;
    while (element && element !== root && isInline(element)) element = element.parentElement;
    return element ?? root;
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: node => node.nodeType === Node.TEXT_NODE || node.localName === 'br' ? NodeFilter.FILTER_ACCEPT
      : getComputedStyle(node).display === 'none' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP
  });
  let text = '', previous = null, space = true; // `space`: the next collapsible space is leading or follows another
  const append = (value, run) => { runs.push({...run, start: text.length, length: value.length}); text += value; };
  // A collapsible space that ends a line is not rendered.
  const trim = () => {
    const last = runs.at(-1);
    if (!last?.trailingSpace || last.start + last.length !== text.length) return;
    text = text.slice(0, -1); last.length--; last.trailingSpace = false;
    if (!last.length) runs.pop();
  };
  const lineBreak = run => { trim(); append('\n', run); space = true; };
  const separate = block => {
    if (previous && block !== previous && text && !text.endsWith('\n')) lineBreak({node: null});
    previous = block;
  };
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    separate(owner(node));
    if (node.nodeType !== Node.TEXT_NODE) { lineBreak({node: null, br: node}); continue; }
    const mode = whitespaceOf(node.parentElement);
    let piece = '', from = 0, trailing = false;
    const flush = () => { if (piece) append(piece, {node, nodeStart: from, trailingSpace: trailing}); piece = ''; trailing = false; };
    const keep = (i, value, collapsible) => { if (!piece) from = i; piece += value; trailing = collapsible; space = collapsible; };
    for (let i = 0; i < node.data.length; i++) {
      const c = node.data[i];
      // Skipped from the text, but still a character in the line: a space before it is not at the end of the line.
      if (c === '\u200b' || c === '\ufeff') { flush(); if (runs.at(-1)) runs.at(-1).trailingSpace = false; space = false; continue; }
      if (c === '\u00a0') { keep(i, ' ', false); continue; }
      if (c === '\n' && mode.breaks) { flush(); trim(); keep(i, '\n', false); flush(); space = true; continue; }
      if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\n') {
        if (mode.spaces) keep(i, c === '\r' || c === '\f' ? ' ' : c, false);
        else if (space) flush(); // Collapsed into the previous space or the start of the line.
        else keep(i, ' ', true);
        continue;
      }
      keep(i, c, false);
    }
    flush();
  }
  trim();
  return {text, runs};
}

export function locate(runs, index, end) {
  for (const run of runs) {
    if (!run.node) continue;
    const stop = run.start + run.length;
    if (end ? index > run.start && index <= stop : index >= run.start && index < stop) return [run.node, run.nodeStart + index - run.start];
  }
  return null;
}

export function caretIndex(map, node, offset) {
  if (node.nodeType === Node.TEXT_NODE) {
    let found = null;
    for (const run of map.runs) if (run.node === node && offset >= run.nodeStart) found = run;
    if (found) return found.start + Math.min(found.length, offset - found.nodeStart);
    const first = map.runs.find(run => run.node === node);
    if (first) return first.start;
  }
  const caret = document.createRange(); caret.setStart(node, offset);
  for (const run of map.runs) {
    if (!run.node && !run.br) continue;
    const [container, at] = run.br ? [run.br.parentNode, Array.prototype.indexOf.call(run.br.parentNode.childNodes, run.br)] : [run.node, run.nodeStart];
    if (caret.comparePoint(container, at) >= 0) return run.start;
  }
  return map.text.length;
}

const ids = new WeakMap();
let counter = 0;

// `editable` marks a capture from a verified editor family (see richReplacementAllowed): rich-edit.mjs may apply edits to it.
// Without it the capture is copy-only and this module still writes nothing.
export function captureRichParagraph(host, {editable = false} = {}) {
  if (!host?.isConnected || !embeddingAllowed() || !previewAllowed(host) || host.textContent.length > MAX_BLOCK) throw invalid();
  const selection = selectionFor(host), focus = selection?.focusNode;
  if (!focus || !host.contains(focus)) throw invalid();
  const probe = focus.nodeType === Node.ELEMENT_NODE
    ? focus.childNodes[selection.focusOffset] ?? focus.childNodes[selection.focusOffset - 1] ?? focus : focus;
  const block = blockFor(host, probe);
  if (excluded(block) || block.querySelector(EXCLUDED) || block.textContent.length > MAX_BLOCK) throw invalid();
  let map, caret;
  try { map = textMap(block); caret = caretIndex(map, focus, selection.focusOffset); } catch { throw invalid(); }
  const start = map.text.lastIndexOf('\n', Math.max(0, caret - 1)) + 1, next = map.text.indexOf('\n', caret);
  const text = map.text.slice(start, next === -1 ? map.text.length : next);
  if (!validText(text) || !/\p{L}/u.test(text)) throw invalid();
  if (!ids.has(block)) ids.set(block, ++counter);
  const context = contextFor(host), source = map.text;
  const valid = () => host.isConnected && block.isConnected && previewAllowed(host) && !excluded(block) && !block.querySelector(EXCLUDED)
    && contextCurrent(host, context) && textMap(block).text === source;
  return {preview: !editable, editable, id: ids.get(block), text, offset: start, snapshot: null, adapter: null, field: host, valid, block, source,
    // Underlines are recomputed from the live nodes each time, so framework re-renders cannot leave detached ranges.
    rects(edit) {
      const visible = visibleEditorRect(host);
      if (!visible || getComputedStyle(host).writingMode !== 'horizontal-tb') return [];
      const fresh = textMap(block);
      if (fresh.text !== source) return [];
      const a = locate(fresh.runs, start + edit.start, false), b = locate(fresh.runs, start + edit.end, true);
      if (!a || !b) return [];
      const range = document.createRange(); range.setStart(...a); range.setEnd(...b);
      return [...range.getClientRects()].map(r => ({left: Math.max(visible.left, r.left), top: r.top, right: Math.min(visible.right, r.right), bottom: r.bottom}))
        .filter(r => r.right > r.left && r.bottom > visible.top && r.bottom <= visible.bottom + 1);
    },
    layout() { const r = block.getBoundingClientRect(); return `${r.x}:${r.y}:${r.width}:${r.height}`; }};
}
