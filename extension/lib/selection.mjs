import {EditorAdapter} from '../../prototypes/editor/editor-adapter.mjs';
import {boundaries} from './candidates.mjs';
import {validText, LineleafError} from './policy.mjs';

const EXCLUDED = '[data-lineleaf-ignore], [aria-hidden="true"], pre, code';
export function excluded(element) {
  if (!(element instanceof Element)) return true;
  if (element.closest(EXCLUDED)) return true;
  if (element instanceof HTMLInputElement && !['text', 'search'].includes(element.type)) return true;
  return /(?:password|one-time-code|cc-|credit.?card|security.?code|cvc|cvv)/i.test(
    [element.getAttribute('autocomplete'), element.getAttribute('name'), element.id].filter(Boolean).join(' '));
}
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
  const selection = document.getSelection(), active = editorOf(focused);
  if (active && excluded(active)) throw new LineleafError('INVALID_REQUEST');
  const isInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
  let element = active, start, end, source;
  if (isInput) {
    if (active.disabled || active.readOnly || active.value.length > 100000) throw new LineleafError('INVALID_REQUEST');
    start = active.selectionStart; end = active.selectionEnd; source = active.value;
  } else if (selection?.rangeCount && !selection.isCollapsed) {
    const range = selection.getRangeAt(0), anchor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
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
      return {text, adapter: null, snapshot: null, offset: 0, field: null};
    }
  } else throw new LineleafError('INVALID_REQUEST');
  const text = source.slice(start, end), points = boundaries(source);
  if (!validText(text) || !points.has(start) || !points.has(end)) throw new LineleafError('INVALID_REQUEST');
  const adapter = new EditorAdapter(element), snapshot = adapter.snapshot();
  if (!snapshot) { adapter.dispose(); return {text, adapter: null, snapshot: null, offset: 0, field: element}; }
  return {text, adapter, snapshot, offset: start, field: element};
}
export function captureParagraph(element, adapter) {
  if (!element || excluded(element) || element.querySelector(EXCLUDED) || !element.isConnected
      || element.disabled || element.readOnly || (element.value ?? element.textContent).length > 100000) throw new LineleafError('INVALID_REQUEST');
  const snapshot = adapter.snapshot(); if (!snapshot) throw new LineleafError('INVALID_REQUEST');
  let caret = element.selectionStart;
  if (!Number.isInteger(caret)) {
    const selection = document.getSelection();
    if (!selection?.focusNode || !element.contains(selection.focusNode)) throw new LineleafError('INVALID_REQUEST');
    const prefix = document.createRange(); prefix.selectNodeContents(element); prefix.setEnd(selection.focusNode, selection.focusOffset); caret = prefix.toString().length;
  }
  const source = snapshot.source, start = source.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
  const next = source.indexOf('\n', caret), end = next === -1 ? source.length : next;
  const text = source.slice(start, end);
  if (!validText(text) || !/\p{L}/u.test(text)) throw new LineleafError('INVALID_REQUEST');
  return {text, offset: start, snapshot, adapter, field: element};
}
