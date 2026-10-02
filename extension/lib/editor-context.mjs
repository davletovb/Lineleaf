import {EXCLUDED, COMPLEX} from './editor-policy.mjs';
export {EXCLUDED} from './editor-policy.mjs';
// Only the active editor's composed ancestry is inspected; no page-wide shadow traversal.
export function ancestry(element) {
  const result = [];
  for (let node = element; node; node = node.assignedSlot ?? node.parentNode ?? node.host) result.push(node);
  return result;
}
export function deepActive() {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  return element;
}
export function eventElement(event) {
  return event.composedPath?.().find(node => node instanceof Element) ?? event.target;
}
function embeddings() {
  const result = [];
  try { for (let current = window; current !== current.top; current = current.parent) {
    const frame = current.frameElement;
    if (!frame) return null;
    result.push(...ancestry(frame));
  } } catch { return null; }
  return result;
}
export function embeddingAllowed() {
  const path = embeddings();
  return path !== null && path.every(node => {
    if (node.nodeType !== Node.ELEMENT_NODE) return true;
    const style = node.ownerDocument.defaultView.getComputedStyle(node);
    return !node.matches(EXCLUDED) && !node.hasAttribute('sandbox') && style.display !== 'none' && style.visibility === 'visible';
  });
}
export function navigationToken() {
  const entries = [];
  try { for (let current = window;; current = current.parent) {
    entries.push(`${current.location.href}:${current.navigation?.currentEntry?.key ?? ''}`);
    if (current === current.top) break;
  } } catch { entries.push('inaccessible-parent'); }
  return entries.join('|');
}
export function observeNavigation(changed) {
  let cleanups = [];
  const clear = () => { for (const cleanup of cleanups) cleanup(); cleanups = []; };
  const attach = () => {
    clear();
    try { for (let current = window;; current = current.parent) {
      const target = current;
      target.navigation?.addEventListener('currententrychange', changed);
      target.addEventListener('popstate', changed); target.addEventListener('hashchange', changed);
      cleanups.push(() => { target.navigation?.removeEventListener('currententrychange', changed); target.removeEventListener('popstate', changed); target.removeEventListener('hashchange', changed); });
      if (target === target.top) break;
    } } catch { /* Cross-origin frames never obtain an eligible policy. */ }
  };
  window.addEventListener('pagehide', clear); window.addEventListener('pageshow', attach); attach();
}
const contextPath = element => [...ancestry(element), ...(embeddings() ?? [])];
export function contextFor(element) { return {route: navigationToken(), path: contextPath(element)}; }
export function contextCurrent(element, context) {
  const path = contextPath(element);
  return element.isConnected && embeddingAllowed() && context.route === navigationToken()
    && path.length === context.path.length && path.every((node, i) => node === context.path[i]);
}
export function classPolicy(value) {
  const probe = document.createElement('span'); probe.className = value ?? '';
  return `${probe.matches(EXCLUDED)}:${probe.matches(COMPLEX)}`;
}
export function excluded(element) {
  if (!(element instanceof Element)) return true;
  if (ancestry(element).some(node => node instanceof Element && node.matches(EXCLUDED))) return true;
  if (element instanceof HTMLInputElement && !['text', 'search'].includes(element.type)) return true;
  return /(?:password|one-time-code|cc-|credit.?card|security.?code|cvc|cvv)/i.test(
    [element.getAttribute('autocomplete'), element.getAttribute('name'), element.id].filter(Boolean).join(' '));
}
export function replacementAllowed(element) {
  if (excluded(element)) return false;
  const host = location.hostname;
  if (host === 'docs.google.com') return false; // Never treat Docs' input proxy as its document.
  const rich = !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement);
  if (rich && (host === 'mail.google.com' || /(^|\.)linkedin\.com$/.test(host)
      || /(^|\.)slack\.com$/.test(host) || /(^|\.)notion\.(?:so|site)$/.test(host))) return false;
  return !ancestry(element).some(node => node instanceof Element && node.matches(COMPLEX)) && !element.querySelector(COMPLEX);
}
export function selectionFor(element) {
  const root = element?.getRootNode();
  return root instanceof ShadowRoot && typeof root.getSelection === 'function' ? root.getSelection() : document.getSelection();
}
export function rangeFor(element) {
  const selection = selectionFor(element);
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  if (typeof selection.getComposedRanges === 'function') {
    const shadowRoots = ancestry(element).filter(node => node instanceof ShadowRoot && node.mode === 'open');
    const ranges = selection.getComposedRanges({shadowRoots});
    if (ranges.length !== 1) return null;
    const selected = ranges[0], range = document.createRange();
    range.setStart(selected.startContainer, selected.startOffset); range.setEnd(selected.endContainer, selected.endOffset);
    return range;
  }
  return selection.getRangeAt(0);
}
