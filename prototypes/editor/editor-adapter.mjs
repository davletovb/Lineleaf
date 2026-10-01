import {contextFor, contextCurrent, replacementAllowed, excluded, selectionFor, rangeFor, deepActive} from '../../extension/lib/editor-context.mjs';
// A-04 investigation: deliberately small Chromium adapter, not a site integration.
const INLINE = new Set(["SPAN", "B", "STRONG", "I", "EM", "U", "S"]);
const UNSAFE = new WeakSet();
const copies = reason => ({status: "copy", reason});
const contextFailure = element => {
  UNSAFE.add(element);
  return {...copies('context_changed_during_edit'), restored: false, stateUncertain: true, contextChanged: true};
};
const text = element => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
  ? element.value : element.textContent;

export function validSpan(source, edit) {
  if (!edit || !Number.isInteger(edit.start) || !Number.isInteger(edit.end)
      || edit.start < 0 || edit.end <= edit.start || edit.end > source.length
      || typeof edit.before !== "string" || typeof edit.after !== "string"
      || !edit.before || edit.before === edit.after || edit.after.length > 2000
      || /[\r\n\0]/u.test(edit.after) || source.slice(edit.start, edit.end) !== edit.before) return false;
  const boundaries = new Set([source.length]);
  for (const segment of new Intl.Segmenter("en", {granularity: "grapheme"}).segment(source)) {
    boundaries.add(segment.index);
  }
  return boundaries.has(edit.start) && boundaries.has(edit.end);
}

function supported(element) {
  if (UNSAFE.has(element) || !replacementAllowed(element) || !element.isConnected || element.disabled || element.readOnly) return false;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) return ["text", "search"].includes(element.type);
  if (element.getAttribute("contenteditable") !== "true" || !element.isContentEditable) return false;
  return [...element.querySelectorAll("*")].every(child => INLINE.has(child.tagName)
    && !child.hasAttribute("contenteditable") && !child.shadowRoot);
}

function textNodes(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node, offset = 0;
  while ((node = walker.nextNode())) {
    nodes.push({node, start: offset, end: offset + node.length});
    offset += node.length;
  }
  return nodes;
}

function point(element, offset) {
  const nodes = textNodes(element);
  const entry = nodes.find(x => offset >= x.start && offset <= x.end);
  return entry ? {node: entry.node, offset: offset - entry.start} : {node: element, offset: 0};
}

function offsetOf(element, node, offset) {
  if (node !== element && !element.contains(node)) return null;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.setEnd(node, offset);
  return range.toString().length;
}

function selection(element) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return {start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection};
  }
  const selected = selectionFor(element);
  if (!selected?.rangeCount) return null;
  const start = offsetOf(element, selected.anchorNode, selected.anchorOffset);
  const end = offsetOf(element, selected.focusNode, selected.focusOffset);
  if (start !== null && end !== null) return {start, end};
  const range = rangeFor(element);
  if (!range || !element.contains(range.startContainer) || !element.contains(range.endContainer)) return null;
  return {start: offsetOf(element, range.startContainer, range.startOffset), end: offsetOf(element, range.endContainer, range.endOffset)};
}

function select(element, selected) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.setSelectionRange(selected.start, selected.end, selected.direction ?? "none");
  } else {
    const start = point(element, selected.start), end = point(element, selected.end);
    document.getSelection().setBaseAndExtent(start.node, start.offset, end.node, end.offset);
  }
}

const transformed = (offset, edit) => offset <= edit.start ? offset
  : offset >= edit.end ? offset + edit.after.length - (edit.end - edit.start) : edit.start + edit.after.length;

function saveTree(node) {
  return {node, data: node instanceof CharacterData ? node.data : null,
    attributes: node instanceof Element ? [...node.attributes].map(x => [x.name, x.value]) : [],
    children: [...node.childNodes].map(saveTree)};
}
function sameTree(saved, node = saved.node, root = true, replacement = null) {
  if (node.nodeType !== saved.node.nodeType) return false;
  if (saved.data !== null) return node.data === (replacement?.node === saved.node ? replacement.data : saved.data);
  if (node !== saved.node || (!root && JSON.stringify([...node.attributes].map(x => [x.name, x.value])) !== JSON.stringify(saved.attributes))) return false;
  return node.childNodes.length === saved.children.length && saved.children.every((child, i) => sameTree(child, node.childNodes[i], false, replacement));
}
function restoreTree(saved, root = true) {
  if (saved.data !== null) saved.node.data = saved.data;
  else {
    if (!root && saved.node instanceof Element) {
      for (const attribute of [...saved.node.attributes]) saved.node.removeAttribute(attribute.name);
      for (const [name, value] of saved.attributes) saved.node.setAttribute(name, value);
    }
    for (const child of saved.children) restoreTree(child, false);
    saved.node.replaceChildren(...saved.children.map(x => x.node));
  }
}

export class EditorAdapter {
  constructor(element) {
    this.element = element;
    this.revision = 0;
    this.documentRevision = 0;
    this.composing = false;
    this.snapshots = new WeakSet();
    this.changed = () => { this.revision++; };
    this.documentChanged = () => { this.documentRevision++; };
    this.compositionStart = () => { this.composing = true; this.revision++; };
    this.compositionEnd = () => { this.composing = false; this.revision++; };
    element.addEventListener("input", this.changed);
    element.addEventListener("compositionstart", this.compositionStart);
    element.addEventListener("compositionend", this.compositionEnd);
    document.addEventListener("input", this.documentChanged, true);
    this.observer = new MutationObserver(records => { if (records.length) this.revision++; });
    this.observer.observe(element, {subtree: true, characterData: true, childList: true, attributes: true});
    const path = contextFor(element).path;
    this.contextChanged = records => {
      if (records.some(record => record.type === 'attributes' || [...record.addedNodes, ...record.removedNodes].some(node => path.includes(node)))) this.revision++;
    };
    this.contextObserver = new MutationObserver(this.contextChanged);
    this.slots = path.filter(node => node.nodeType === Node.ELEMENT_NODE && node.localName === 'slot');
    for (const slot of this.slots) slot.addEventListener('slotchange', this.changed);
    for (const parent of path.slice(1)) this.contextObserver.observe(parent, parent.nodeType === Node.ELEMENT_NODE ? {childList: true, attributes: true,
      attributeFilter: ['data-lineleaf-ignore', 'aria-hidden', 'contenteditable', 'class', 'sandbox', 'slot', 'name', 'data-slate-editor', 'data-lexical-editor']} : {childList: true});
  }

  flush() { if (this.observer.takeRecords().length) this.revision++; this.contextChanged(this.contextObserver.takeRecords()); }

  snapshot({copy = false} = {}) {
    this.flush();
    if (this.composing || excluded(this.element) || !this.element.isConnected || this.element.disabled || this.element.readOnly || (!copy && !supported(this.element))) return null;
    const result = Object.freeze({source: text(this.element), revision: this.revision, context: contextFor(this.element)});
    this.snapshots.add(result);
    return result;
  }

  currentCapture(snapshot) {
    this.flush();
    return this.snapshots.has(snapshot) && snapshot.revision === this.revision
      && snapshot.source === text(this.element) && contextCurrent(this.element, snapshot.context)
      && !excluded(this.element) && !this.element.disabled && !this.element.readOnly && !this.composing;
  }

  current(snapshot) { return this.currentCapture(snapshot) && supported(this.element); }

  apply(snapshot, edit) {
    if (!snapshot || !this.current(snapshot)) return copies("stale_or_unavailable");
    if (!validSpan(snapshot.source, edit)) return copies("invalid_span");
    const element = this.element;
    const input = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
    const target = input ? null : textNodes(element).find(x => edit.start >= x.start && edit.end <= x.end);
    if (!input && !target) {
      return copies("crosses_format_boundary");
    }
    element.focus({preventScroll: true});
    if (!this.current(snapshot)) return copies("changed_on_focus");
    const oldSelection = selection(element);
    if (!oldSelection) return copies("selection_unavailable");
    const beforeTree = input ? null : saveTree(element);
    const replacement = input ? null : {node: target.node, data: target.node.data.slice(0, edit.start - target.start)
      + edit.after + target.node.data.slice(edit.end - target.start)};
    const beforeDocumentRevision = this.documentRevision;
    select(element, {start: edit.start, end: edit.end});
    const expected = snapshot.source.slice(0, edit.start) + edit.after + snapshot.source.slice(edit.end);
    // insertText retains Chromium's undo history. Direct restoration is only failed-edit recovery.
    let succeeded = false;
    try { succeeded = document.execCommand("insertText", false, edit.after); } catch { /* refuse below */ }
    this.flush();
    if (!contextCurrent(element, snapshot.context)) { this.lastEdit = null; return contextFailure(element); }
    if (!succeeded || text(element) !== expected || !supported(element) || (!input && !sameTree(beforeTree, element, true, replacement))) {
      this.lastEdit = null;
      const recovered = this.restore(snapshot.source, oldSelection, beforeTree, beforeDocumentRevision, snapshot.context);
      return {...copies("native_edit_not_confirmed"), ...recovered};
    }
    select(element, {...oldSelection, start: transformed(oldSelection.start, edit), end: transformed(oldSelection.end, edit)});
    this.lastEdit = {before: snapshot.source, after: expected, selection: oldSelection, beforeTree,
      revision: this.revision, documentRevision: this.documentRevision, context: contextFor(element)};
    return {status: "applied"};
  }

  restore(source, oldSelection, beforeTree, beforeDocumentRevision, context) {
    const element = this.element;
    if (!contextCurrent(element, context)) return contextFailure(element);
    let stateUncertain = false;
    // A synchronous site handler may edit another field. Never pop that field's global undo entry.
    if (text(element) !== source && deepActive() === element
        && this.documentRevision === beforeDocumentRevision + 1) {
      try { document.execCommand("undo"); } catch { /* field-local recovery below */ }
    }
    if (!contextCurrent(element, context)) return contextFailure(element);
    if (text(element) !== source || (beforeTree && !sameTree(beforeTree))) {
      const input = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
      const reset = () => {
        if (input) {
          const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, source);
        } else restoreTree(beforeTree);
      };
      reset();
      // Notify controlled state using the restored value. A site that rejects even the original is copy-only.
      element.dispatchEvent(new InputEvent("input", {bubbles: true, composed: true, inputType: "historyUndo"}));
      if (!contextCurrent(element, context)) return contextFailure(element);
      if (text(element) !== source || (beforeTree && !sameTree(beforeTree))) { reset(); stateUncertain = true; }
    }
    this.flush();
    try { if (element.isConnected && text(element) === source) select(element, oldSelection); } catch { stateUncertain = true; }
    UNSAFE.add(element); // Future adapters for this field refuse replacement until the page reloads.
    return {restored: text(element) === source && (!beforeTree || sameTree(beforeTree)), stateUncertain};
  }

  undo() {
    this.flush();
    const edit = this.lastEdit;
    if (!edit || !contextCurrent(this.element, edit.context) || this.revision !== edit.revision || this.documentRevision !== edit.documentRevision
        || text(this.element) !== edit.after || !supported(this.element) || this.composing) return copies("undo_unavailable");
    this.element.focus({preventScroll: true});
    this.flush();
    if (!contextCurrent(this.element, edit.context) || this.revision !== edit.revision || text(this.element) !== edit.after) return copies("changed_on_focus");
    this.lastEdit = null;
    let succeeded = false;
    try { succeeded = document.execCommand("undo"); } catch { /* refuse below */ }
    this.flush();
    if (!contextCurrent(this.element, edit.context)) return contextFailure(this.element);
    if (!succeeded || text(this.element) !== edit.before || (edit.beforeTree && !sameTree(edit.beforeTree))) {
      return {...copies("native_undo_not_confirmed"), ...this.restore(edit.before, edit.selection, edit.beforeTree, edit.documentRevision, edit.context)};
    }
    select(this.element, edit.selection);
    return {status: "undone"};
  }

  dispose() {
    this.observer.disconnect();
    this.contextObserver.disconnect();
    for (const slot of this.slots) slot.removeEventListener('slotchange', this.changed);
    this.element.removeEventListener("input", this.changed);
    this.element.removeEventListener("compositionstart", this.compositionStart);
    this.element.removeEventListener("compositionend", this.compositionEnd);
    document.removeEventListener("input", this.documentChanged, true);
    this.snapshots = new WeakSet();
    this.lastEdit = null;
  }
}
