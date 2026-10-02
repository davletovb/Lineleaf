// Copy-only paragraph capture for rich editors (Draft.js, Lexical, Slate, ProseMirror, Quill, Gmail-style
// composers and other contenteditable surfaces). Lineleaf reads the caret's paragraph and positions an
// overlay from DOM ranges. It never writes to, focuses, or attaches observers to the editor.
import {EXCLUDED, contextFor, contextCurrent, embeddingAllowed, excluded, previewAllowed, selectionFor} from './editor-context.mjs';
import {validText, LineleafError} from './policy.mjs';
import {visibleEditorRect} from './geometry.mjs';

const invalid = () => new LineleafError('INVALID_REQUEST');
const INLINE = /^(?:inline|contents|ruby)/;
const KEEPS_NEWLINES = /^(?:pre|pre-wrap|pre-line|break-spaces)$/;
const MAX_BLOCK = 100000;

// Block-level container of a node, found without relying on any framework markup.
function blockFor(host, node) {
  let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  while (element && element !== host && INLINE.test(getComputedStyle(element).display)) element = element.parentElement;
  return element && host.contains(element) ? element : host;
}

// Visible text of `root` as one string with a 1:1 UTF-16 mapping back to DOM text nodes. Block boundaries and <br>
// become '\n'. Zero-width editor placeholders are skipped; NBSP is normalised to a space so model-supplied context
// matches. Nothing here changes the DOM.
function textMap(root) {
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
  let text = '', previous = null;
  const append = (value, run) => { runs.push({...run, start: text.length, length: value.length}); text += value; };
  const separate = block => {
    if (previous && block !== previous && text && !text.endsWith('\n')) append('\n', {node: null});
    previous = block;
  };
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType !== Node.TEXT_NODE) { separate(owner(node)); append('\n', {node: null, br: node}); continue; }
    const keeps = KEEPS_NEWLINES.test(getComputedStyle(node.parentElement).whiteSpace);
    // Source-formatting whitespace between blocks is collapsed by CSS and never rendered: it is not text.
    if (!keeps && !/\S/.test(node.data) && [node.previousSibling, node.nextSibling].every(sibling => !sibling || (sibling.nodeType === Node.ELEMENT_NODE && !isInline(sibling)))) continue;
    separate(owner(node));
    let piece = '', from = 0;
    const flush = () => { if (piece) append(piece, {node, nodeStart: from}); piece = ''; };
    for (let i = 0; i < node.data.length; i++) {
      const c = node.data[i];
      if (c === '​' || c === '﻿') { flush(); continue; }
      if (!piece) from = i;
      piece += c === ' ' || c === '\r' ? ' ' : c === '\n' && !keeps ? ' ' : c;
    }
    flush();
  }
  return {text, runs};
}

function locate(runs, index, end) {
  for (const run of runs) {
    if (!run.node) continue;
    const stop = run.start + run.length;
    if (end ? index > run.start && index <= stop : index >= run.start && index < stop) return [run.node, run.nodeStart + index - run.start];
  }
  return null;
}

function caretIndex(map, node, offset) {
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

export function captureRichParagraph(host) {
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
  const valid = () => host.isConnected && block.isConnected && previewAllowed(host) && !excluded(block)
    && contextCurrent(host, context) && textMap(block).text === source;
  return {preview: true, id: ids.get(block), text, offset: start, snapshot: null, adapter: null, field: host, valid,
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
