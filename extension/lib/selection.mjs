import {EditorAdapter} from '../../prototypes/editor/editor-adapter.mjs';
import {boundaries} from './candidates.mjs';
import {validText, LineleafError} from './policy.mjs';

import {EXCLUDED, excluded, rangeFor, selectionFor, contextFor, contextCurrent, embeddingAllowed} from './editor-context.mjs';
export {excluded};

export function editorOf(element) {
  if (!(element instanceof Element)) return null;
  if (element.matches('textarea, input')) return element;
  const editable = element.closest('[contenteditable]');
  if (!editable || !editable.isContentEditable) return null;
  let parent = editable.parentElement;
  while (parent?.isContentEditable) { parent = parent.parentElement; }
  return parent ? [...parent.children].find(child => child.contains(editable) || child === editable) ?? editable : editable;
}
export function captureSelection(focused) {
  if (!embeddingAllowed()) throw new LineleafError('INVALID_REQUEST');
  const active = editorOf(focused), range = rangeFor(focused);
  if (active && excluded(active)) throw new LineleafError('INVALID_REQUEST');
  const isInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
  let element = active, start, end, source;
  if (isInput) {
    if (active.disabled || active.readOnly || active.value.length > 100000) throw new LineleafError('INVALID_REQUEST');
    start = active.selectionStart; end = active.selectionEnd; source = active.value;
  } else if (range) {
    const anchor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    if (!validText(range.toString())) throw new LineleafError('INVALID_REQUEST');
    element = editorOf(anchor);
    if (excluded(anchor) || (element && excluded(element)) || range.cloneContents().querySelector(EXCLUDED)) {
      throw new LineleafError('INVALID_REQUEST');
    }
    if (element && element.textContent.length <= 100000 && element.contains(range.startContainer) && element.contains(range.endContainer)) {
      const prefix = range.cloneRange(); prefix.selectNodeContents(element); prefix.setEnd(range.startContainer, range.startOffset);
      start = prefix.toString().length; source = element.textContent;
      end = start + range.toString().length;
      // Complex block editors have different Range/textContent conventions: copy only.
      if (source.slice(start, end) !== range.toString()) element = null;
    } else element = null;
    if (!element) {
      const text = range.toString(); if (!validText(text)) throw new LineleafError('INVALID_REQUEST');
      const context = contextFor(anchor);
      return {text, adapter: null, snapshot: null, offset: 0, field: null,
        valid: () => contextCurrent(anchor, context) && !excluded(anchor) && !excluded(range.endContainer.parentElement)
          && range.toString() === text && !range.cloneContents().querySelector(EXCLUDED)};
    }
  } else throw new LineleafError('INVALID_REQUEST');
  const text = source.slice(start, end), points = boundaries(source);
  if (!validText(text) || !points.has(start) || !points.has(end)) throw new LineleafError('INVALID_REQUEST');
  const guard = new EditorAdapter(element), snapshot = guard.snapshot({copy: true});
  if (!snapshot) { guard.dispose(); throw new LineleafError('INVALID_REQUEST'); }
  return {text, adapter: guard.current(snapshot) ? guard : null, guard, snapshot, offset: start, field: element,
    valid: () => guard.currentCapture(snapshot)};
}
// `at`: the text offset whose paragraph to read, instead of the caret's (to find again a paragraph that was checked earlier).
export function captureParagraph(element, adapter, at = null) {
  if (!element || !embeddingAllowed() || excluded(element) || element.querySelector(EXCLUDED) || !element.isConnected
      || element.disabled || element.readOnly || (element.value ?? element.textContent).length > 100000) throw new LineleafError('INVALID_REQUEST');
  const snapshot = adapter.snapshot(); if (!snapshot) throw new LineleafError('INVALID_REQUEST');
  let caret = Number.isInteger(at) ? at : element.selectionStart;
  if (!Number.isInteger(caret)) {
    const selection = selectionFor(element);
    if (!selection?.focusNode || !element.contains(selection.focusNode)) throw new LineleafError('INVALID_REQUEST');
    const prefix = document.createRange(); prefix.selectNodeContents(element); prefix.setEnd(selection.focusNode, selection.focusOffset); caret = prefix.toString().length;
  }
  const source = snapshot.source, start = source.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
  const next = source.indexOf('\n', caret), end = next === -1 ? source.length : next;
  const text = source.slice(start, end);
  if (!validText(text) || !/\p{L}/u.test(text)) throw new LineleafError('INVALID_REQUEST');
  return {text, offset: start, snapshot, adapter, field: element, valid: () => adapter.current(snapshot)};
}
// Explicit rewrite scope for text fields and flat editors: the selected text when there is any, otherwise the caret paragraph.
export function captureRewriteScope(element, adapter) {
  if (!element || !embeddingAllowed() || excluded(element) || element.querySelector(EXCLUDED) || !element.isConnected
      || element.disabled || element.readOnly || (element.value ?? element.textContent).length > 100000) throw new LineleafError('INVALID_REQUEST');
  let start = element.selectionStart, end = element.selectionEnd;
  if (!Number.isInteger(start)) {
    const selection = selectionFor(element);
    if (!selection?.rangeCount || !element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) throw new LineleafError('INVALID_REQUEST');
    const offset = (node, at) => { const prefix = document.createRange(); prefix.selectNodeContents(element); prefix.setEnd(node, at); return prefix.toString().length; };
    [start, end] = [offset(selection.anchorNode, selection.anchorOffset), offset(selection.focusNode, selection.focusOffset)].sort((a, b) => a - b);
  }
  if (start === end) return {...captureParagraph(element, adapter), scope: 'paragraph'};
  const snapshot = adapter.snapshot(); if (!snapshot) throw new LineleafError('INVALID_REQUEST');
  const text = snapshot.source.slice(start, end), points = boundaries(snapshot.source);
  if (!validText(text) || !/\p{L}/u.test(text) || !points.has(start) || !points.has(end)) throw new LineleafError('INVALID_REQUEST');
  return {text, offset: start, snapshot, adapter, field: element, scope: 'selection', valid: () => adapter.current(snapshot)};
}
