// Replaces one suggestion in a recognized rich editor (Draft.js, Lexical, Slate, ProseMirror, Quill) through the editor's own
// input pipeline, the way a user's edit would arrive. Lineleaf never writes to the editor's DOM. The text is checked before and
// after, and anything unexpected leaves the editor copy-only for the rest of the page's life.
//
// How the edit is delivered (measured against the real libraries): the exact range is selected, the editor is given time to
// register that selection, and the edit is first offered as a cancelable `beforeinput`. Slate and Lexical (for deletions) take
// ownership of it and update their model. If nobody cancels it, the same edit runs as a native `insertText`/`delete` command,
// which Draft.js, ProseMirror, Quill and Lexical (for insertions) reconcile from the DOM. A native command alone leaves Slate's
// model unchanged while its DOM shows the new text, so the offer comes first.
import {selectionFor, richReplacementAllowed, markRichUnsafe} from './editor-context.mjs';
import {captureRichParagraph, textMap, locate, caretIndex} from './rich-text.mjs';
import {validSpan} from '../../prototypes/editor/editor-adapter.mjs';

const STABLE_MS = 250;
const copy = (reason, changed = false) => ({status: 'copy', reason, changed});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
// A task and two frames, so the editor's selection handling and re-render have run; bounded for throttled tabs.
const tick = () => new Promise(resolve => {
  setTimeout(() => {
    let done = false; const finish = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(() => requestAnimationFrame(finish)); setTimeout(finish, 120);
  }, 0);
});

// The DOM range of the edit, only when it sits inside one text node and holds exactly the text the model named. Edits that
// cross a formatting, mention or leaf boundary, or span collapsed or zero-width characters, are copy-only.
function target(capture, edit) {
  const map = textMap(capture.block);
  if (map.text !== capture.source) return null;
  const a = locate(map.runs, capture.offset + edit.start, false), b = locate(map.runs, capture.offset + edit.end, true);
  if (!a || !b || a[0] !== b[0] || b[1] <= a[1]) return null;
  if (a[0].data.slice(a[1], b[1]).replace(/ /g, ' ') !== edit.before) return null;
  return {node: a[0], from: a[1], to: b[1]};
}

export function canApplyRich(capture, edit) {
  return capture.editable === true && richReplacementAllowed(capture.field) && validSpan(capture.text, edit) && target(capture, edit) !== null;
}

async function select(host, anchor, anchorOffset, focus, focusOffset) {
  const selection = selectionFor(host);
  const held = () => selection.rangeCount > 0 && selection.anchorNode === anchor && selection.anchorOffset === anchorOffset
    && selection.focusNode === focus && selection.focusOffset === focusOffset;
  if (held()) return true;
  const changed = new Promise(resolve => {
    const done = () => { document.removeEventListener('selectionchange', done); resolve(); };
    document.addEventListener('selectionchange', done); setTimeout(done, 150);
  });
  try { selection.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset); } catch { return false; }
  await changed; await tick();
  return held();
}

// Where the user's selection sits in the block's text, from the live selection or, when the editor cleared it on blur
// (Draft.js does), the range the overlay remembered.
function carets(capture, remembered) {
  const map = textMap(capture.block), selection = selectionFor(capture.field), inside = node => node && capture.block.contains(node);
  let anchor, focus;
  if (selection?.rangeCount && inside(selection.anchorNode) && inside(selection.focusNode)) {
    anchor = [selection.anchorNode, selection.anchorOffset]; focus = [selection.focusNode, selection.focusOffset];
  } else if (remembered && inside(remembered.startContainer) && inside(remembered.endContainer)) {
    anchor = [remembered.startContainer, remembered.startOffset]; focus = [remembered.endContainer, remembered.endOffset];
  } else return null;
  try { return {anchor: caretIndex(map, ...anchor), focus: caretIndex(map, ...focus)}; } catch { return null; }
}

const shifted = (index, edit, offset) => {
  const start = offset + edit.start, end = offset + edit.end;
  return index <= start ? index : index >= end ? index + edit.after.length - (end - start) : start + edit.after.length;
};

async function restore(fresh, saved, edit, capture) {
  const map = textMap(fresh.block);
  const point = index => locate(map.runs, index, false) ?? locate(map.runs, index, true);
  const a = point(shifted(saved.anchor, edit, capture.offset)), b = point(shifted(saved.focus, edit, capture.offset));
  if (a && b) await select(fresh.field, a[0], a[1], b[0], b[1]);
}

const verified = (host, expected, offset) => {
  try { const fresh = captureRichParagraph(host, {editable: true}); return fresh.text === expected && fresh.offset === offset ? fresh : null; }
  catch { return null; }
};
const unchanged = (host, capture) => {
  try { return captureRichParagraph(host, {editable: true}).text === capture.text; } catch { return false; }
};
const failed = (host, capture, reason = null) => {
  markRichUnsafe(host);
  const changed = !unchanged(host, capture);
  return copy(reason ?? (changed ? 'native_edit_not_confirmed' : 'editor_rejected'), changed);
};

// Applies `edit` (relative to capture.text). Returns {status: 'applied', capture} with a fresh capture of the same paragraph,
// or {status: 'copy', reason, changed}. `changed` is true when the paragraph no longer matches what it was.
export async function applyRichEdit(capture, edit, remembered = null) {
  const host = capture.field;
  if (!capture.valid()) return copy('stale_or_unavailable');
  if (!canApplyRich(capture, edit)) return copy(validSpan(capture.text, edit) ? 'crosses_format_boundary' : 'invalid_span');
  host.focus({preventScroll: true}); await tick();
  if (!capture.valid()) return copy('changed_on_focus');
  const saved = carets(capture, remembered);
  // The editor may re-render while it handles the focus or the new selection: look the range up again and require it to hold.
  let found = null;
  for (let attempt = 0; attempt < 2 && !found; attempt++) {
    const range = target(capture, edit);
    if (!range) return copy('stale_or_unavailable');
    if (await select(host, range.node, range.from, range.node, range.to) && capture.valid()) found = range;
  }
  if (!found) return copy('selection_unavailable');
  const remove = edit.after === '', expected = capture.text.slice(0, edit.start) + edit.after + capture.text.slice(edit.end);
  let handled = false, ok = false;
  try {
    handled = !host.dispatchEvent(new InputEvent('beforeinput', {bubbles: true, cancelable: true, composed: true,
      inputType: remove ? 'deleteContentBackward' : 'insertText', data: remove ? null : edit.after}));
    ok = handled || (remove ? document.execCommand('delete') : document.execCommand('insertText', false, edit.after));
  } catch { ok = false; }
  await tick();
  let fresh = ok ? verified(host, expected, capture.offset) : null;
  if (!fresh) return failed(host, capture);
  if (saved) { await restore(fresh, saved, edit, capture); fresh = verified(host, expected, capture.offset) ?? fresh; }
  // Editors that own their state can re-render the old text a moment later.
  await wait(STABLE_MS);
  fresh = verified(host, expected, capture.offset);
  return fresh ? {status: 'applied', capture: fresh} : failed(host, capture, 'editor_reverted');
}
