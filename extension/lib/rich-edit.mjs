// Replaces one suggestion in a recognized rich editor (Draft.js, Lexical, Slate, ProseMirror, Quill) through the editor's own
// input pipeline, the way a user's edit would arrive. Lineleaf never writes to the editor's DOM. The text is checked before and
// after, and anything unexpected leaves the editor copy-only for the rest of the page's life.
//
// How the edit is delivered (measured against the real libraries): the exact range is selected, the editor is given time to
// register that selection, and the edit is first offered as a cancelable `beforeinput`. Slate and Lexical (for deletions) take
// ownership of it and update their model. If nobody cancels it, the same edit runs as a native `insertText`/`delete` command,
// which Draft.js, ProseMirror, Quill and Lexical (for insertions) reconcile from the DOM. A native command alone leaves Slate's
// model unchanged while its DOM shows the new text, so the offer comes first.
//
// An edit that replaces the whole text of a node is delivered as two edits: the new text is inserted after the old, then the old
// is deleted. Replacing everything in one command makes the browser remove the emptied node (with Draft.js, X's composer, the
// `span[data-text]` leaf React owns); the editor's model keeps working but no longer reaches what is on screen, so the text can
// be neither typed over nor deleted. Keeping the node non-empty throughout leaves the editor's own nodes in place.
import {deepActive, eventElement, selectionFor, richReplacementAllowed, markRichUnsafe} from './editor-context.mjs';
import {captureRichParagraph, textMap, locate, caretIndex, whitespaceOf} from './rich-text.mjs';
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

// Where the user's caret sits in the block's text. The range the overlay remembered comes first: it was taken before this code
// moved focus, whereas the live selection has by then been reset by the focus change (to the start of the text in Draft.js).
// The live selection is the fallback, for when nothing usable was remembered.
function carets(capture, remembered) {
  const map = textMap(capture.block), selection = selectionFor(capture.field), inside = node => node && capture.block.contains(node);
  let anchor, focus;
  if (remembered && inside(remembered.startContainer) && inside(remembered.endContainer)) {
    anchor = [remembered.startContainer, remembered.startOffset]; focus = [remembered.endContainer, remembered.endOffset];
  } else if (selection?.rangeCount && inside(selection.anchorNode) && inside(selection.focusNode)) {
    anchor = [selection.anchorNode, selection.anchorOffset]; focus = [selection.focusNode, selection.focusOffset];
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

// Reads the checked text again: from its own block when the editor kept it, so a moved caret cannot change what is verified.
// Editors that own their state rebuild blocks when they re-render, which detaches the original, so the block the caret is in
// is the fallback; a selection-scoped capture reads the same span (`length`) of that block.
function reread(host, capture, index, length) {
  const selected = capture.scope === 'selection', spans = selected ? {length} : {};
  const attempts = [() => captureRichParagraph(host, {editable: true, at: {block: capture.block, index, ...spans}}),
    () => { const around = captureRichParagraph(host, {editable: true}); return selected ? captureRichParagraph(host, {editable: true, at: {block: around.block, index, length}}) : around; }];
  for (const attempt of attempts) {
    try { return attempt(); } catch { /* try the block the caret is in */ }
  }
  return null;
}
// The edit counts as applied when the text is exactly the expected text. If the user kept typing while it settled the text
// legitimately differs, so then the replacement and its left context must still be there and the original wording (with its
// surroundings) must not have come back: that is the signature of an editor restoring its old state. A selection is verified
// as a span and as the whole block around it, so a rebuilt block cannot hide a change to the text next to the selection.
function check(host, capture, edit, expected, typed) {
  const selected = capture.scope === 'selection', start = capture.offset + edit.start, end = capture.offset + edit.end;
  const fresh = selected ? reread(host, capture, start, edit.after.length) : reread(host, capture, start + edit.after.length);
  if (!fresh) return null;
  const whole = capture.source.slice(0, start) + edit.after + capture.source.slice(end);
  if (fresh.text === expected && fresh.offset === capture.offset && (!selected || fresh.source === whole)) return fresh;
  if (!typed) return null;
  const text = selected ? fresh.source : fresh.text, source = selected ? capture.source : capture.text, from = selected ? start : edit.start, to = selected ? end : edit.end;
  const left = source.slice(Math.max(0, from - 20), from);
  return !text.includes(source.slice(Math.max(0, from - 20), to + 20)) && text.includes(left + edit.after) ? fresh : null;
}
const failed = (host, capture, edit, reason = null) => {
  markRichUnsafe(host);
  const again = reread(host, capture, capture.offset + edit.start, capture.text.length), changed = again?.text !== capture.text;
  return copy(reason ?? (changed ? 'native_edit_not_confirmed' : 'editor_rejected'), changed);
};
const focusedOn = host => { const active = deepActive(); return active === host || host.contains(active); };

// Trusted input in the editor after the edit was issued is the user's typing, not the editor's doing. Our own command raises
// its `beforeinput`/`input` synchronously while `issuing` is set.
function watchUser(host) {
  const state = {typed: false, issuing: false}, seen = event => {
    const target = eventElement(event);
    if (event.isTrusted && !state.issuing && (target === host || host.contains(target))) state.typed = true;
  };
  const types = ['beforeinput', 'input', 'compositionstart'];
  for (const type of types) document.addEventListener(type, seen, true);
  state.stop = () => { for (const type of types) document.removeEventListener(type, seen, true); };
  return state;
}

// Offers one edit as a cancelable `beforeinput`, then runs it as a native command if nobody took it. Our own events are flagged
// as ours so they are not mistaken for the user's typing.
function deliver(host, user, inputType, data) {
  user.issuing = true;
  try {
    const taken = !host.dispatchEvent(new InputEvent('beforeinput', {bubbles: true, cancelable: true, composed: true, inputType, data}));
    return taken || (inputType === 'insertText' ? document.execCommand('insertText', false, data) : document.execCommand('delete'));
  } catch { return false; } finally { user.issuing = false; }
}

const same = (a, b) => a.replace(/\u00a0/g, ' ') === b;

// Text the page's text map would not read back as typed: spacing a collapsing editor renders as one space (or drops at the edges of a
// line), tabs and line breaks, and characters the map skips or normalises. Such an edit could not be verified, so it is refused
// before anything changes.
function readsBackAsTyped(node, text) {
  if (/[\u00a0\u200b\ufeff]/.test(text)) return false;
  return whitespaceOf(node.parentElement).spaces || !/\s\s|^\s|\s$|[\t\r\f\n]/.test(text);
}

// The paragraph that holds the edit now: the block it was in, or the one the caret is in when the editor re-rendered.
function paragraphOf(host, capture, index) {
  for (const attempt of [() => captureRichParagraph(host, {editable: true, at: {block: capture.block, index}}), () => captureRichParagraph(host, {editable: true})]) {
    try { return attempt().block; } catch { /* try the paragraph the caret is in */ }
  }
  return null;
}

// Where the old text is now, as one range inside one text node, or null when it is not there as captured.
function oldText(host, capture, edit) {
  const block = paragraphOf(host, capture, capture.offset + edit.end); if (!block) return null;
  const map = textMap(block), a = locate(map.runs, capture.offset + edit.start, false), b = locate(map.runs, capture.offset + edit.end, true);
  return a && b && a[0] === b[0] && same(a[0].data.slice(a[1], b[1]), edit.before) ? {node: a[0], from: a[1], to: b[1]} : null;
}
const followedBy = (range, text) => same(range.node.data.slice(range.to, range.to + text.length), text);
const takeOut = async (host, user, node, from, to) => node.isConnected && await select(host, node, from, node, to) && deliver(host, user, 'deleteContentBackward', null);

// Replaces all the text of one node without ever emptying it: insert after the old text, then select the old text and delete it.
// Returns true when both steps took and the paragraph reads as expected, a reason string when it could not start (nothing has changed
// then), or false when it did not complete. After a first step that has taken, anything unexpected puts the draft back by taking the
// inserted text out again, so the draft is not left as old text followed by new text.
async function replaceWhole(host, user, capture, edit, found, expected) {
  if (!(await select(host, found.node, found.to, found.node, found.to)) || !capture.valid()) return 'selection_unavailable';
  if (!deliver(host, user, 'insertText', edit.after)) return false;
  await tick();
  // The old text should still be where it was, with the new text right after it. The editor may have re-rendered meanwhile.
  const old = oldText(host, capture, edit);
  if (old && followedBy(old, edit.after) && await takeOut(host, user, old.node, old.from, old.to)) {
    await tick();
    if (check(host, capture, edit, expected, user.typed)) return true;
  }
  const again = oldText(host, capture, edit); // Still there means the second step did not happen: take the first back out.
  if (again && followedBy(again, edit.after)) { await takeOut(host, user, again.node, again.to, again.to + edit.after.length); await tick(); }
  return false;
}

// Applies `edit` (relative to capture.text). Returns {status: 'applied', capture, typed, moved, steps} with a fresh capture of the same
// paragraph, or {status: 'copy', reason, changed}. `changed` is true when the paragraph no longer matches what it was.
// `typed`: the user typed while the edit settled. `moved`: focus is no longer in the editor, so nothing may pull it back.
export async function applyRichEdit(capture, edit, remembered = null) {
  const user = watchUser(capture.field);
  try { return await apply(capture, edit, remembered, user); } finally { user.stop(); }
}

async function apply(capture, edit, remembered, user) {
  const host = capture.field;
  if (!capture.valid()) return copy('stale_or_unavailable');
  // A selection is replaced as a whole; a partial edit inside it cannot be re-read as the same span.
  if (capture.scope === 'selection' && !(edit.start === 0 && edit.end === capture.text.length)) return copy('invalid_span');
  if (!canApplyRich(capture, edit)) return copy(validSpan(capture.text, edit) ? 'crosses_format_boundary' : 'invalid_span');
  host.focus({preventScroll: true}); await tick();
  if (!capture.valid()) return copy('changed_on_focus');
  if (!focusedOn(host)) return copy('focus_moved');
  const saved = carets(capture, remembered);
  // The editor may re-render while it handles the focus or the new selection: look the range up again and require it to hold.
  let found = null;
  for (let attempt = 0; attempt < 2 && !found; attempt++) {
    const range = target(capture, edit);
    if (!range) return copy('stale_or_unavailable');
    if (await select(host, range.node, range.from, range.node, range.to) && capture.valid()) found = range;
    if (!focusedOn(host)) return copy('focus_moved');
  }
  if (!found) return copy('selection_unavailable');
  const remove = edit.after === '', expected = capture.text.slice(0, edit.start) + edit.after + capture.text.slice(edit.end);
  if (!remove && !readsBackAsTyped(found.node, edit.after)) return copy('spacing_collapses');
  const whole = !remove && found.from === 0 && found.to === found.node.data.length;
  let ok;
  if (whole) {
    const done = await replaceWhole(host, user, capture, edit, found, expected);
    if (typeof done === 'string') return copy(done);
    ok = done;
  } else ok = deliver(host, user, remove ? 'deleteContentBackward' : 'insertText', remove ? null : edit.after);
  await tick();
  let fresh = ok ? check(host, capture, edit, expected, user.typed) : null;
  if (!fresh) return failed(host, capture, edit);
  // Put the caret back unless the user has already taken it somewhere (typing) or left the editor.
  if (saved && !user.typed && focusedOn(host)) { await restore(fresh, saved, edit, capture); fresh = check(host, capture, edit, expected, user.typed) ?? fresh; }
  // Editors that own their state can re-render the old text a moment later.
  await wait(STABLE_MS);
  fresh = check(host, capture, edit, expected, user.typed);
  return fresh ? {status: 'applied', capture: fresh, typed: user.typed, moved: !focusedOn(host), steps: whole ? 2 : 1} : failed(host, capture, edit, 'editor_reverted');
}
