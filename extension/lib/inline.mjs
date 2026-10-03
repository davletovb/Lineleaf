import {deepActive, eventElement, navigationToken, observeNavigation, embeddingAllowed, previewAllowed, richReplacementAllowed, selectionFor} from './editor-context.mjs';
import {EditorAdapter, validSpan, replacementSupported} from '../../prototypes/editor/editor-adapter.mjs';
import {captureRichParagraph} from './rich-text.mjs';
import {applyRichEdit, canApplyRich} from './rich-edit.mjs';
import {captureParagraph, captureRewriteScope, editorOf, excluded} from './selection.mjs';
import {suggestionRects, visibleEditorRect} from './geometry.mjs';
import {AUTO_IDLE, AUTO_INTERVAL, AUTOMATIC_HOLD, WATCHDOG, FLAG_LABELS, REWRITE_LABELS, categoryLabel, dictionaryWord} from './policy.mjs';
import {messageFor} from './messages.mjs';
import {icon, iconLabel} from './icons.mjs';
import tokens from '../tokens.css';
import base from '../base.css';
import styles from '../inline.css';

const node = (tag, text = '', attributes = {}) => {
  const el = document.createElement(tag); el.textContent = text;
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  return el;
};
const trusted = fn => event => { if (event.isTrusted) void fn(event); };
// Anatomy, top to bottom: the assistant badge by the field; underlines in the text; one card that opens from either. The card is
// a header, the suggestion (or rewrite preview), the rewrite tools, a status strip and a quiet footer of everyday actions.
class InlineView {
  constructor(field, actions) {
    this.field = field; this.actions = actions; this.edits = []; this.index = 0; this.anchored = false;
    this.host = node('div', '', {'data-lineleaf-inline': ''}); this.root = this.host.attachShadow({mode: 'closed'});
    const sheet = new CSSStyleSheet(); sheet.replaceSync(tokens + base + styles); this.root.adoptedStyleSheets = [sheet];
    this.layer = node('div', '', {class: 'layer'}); this.lines = node('div');
    this.badge = node('button', '', {class: 'badge', 'data-state': 'idle', 'data-tip': 'Lineleaf', 'aria-label': 'Lineleaf writing assistance. Alt Shift L opens suggestions.'});
    this.badge.append(node('span', '', {class: 'ring', 'aria-hidden': 'true'}), icon('leaf', {size: 18}));
    this.card = node('section', '', {class: 'card', hidden: '', 'aria-label': 'Lineleaf suggestions'});
    this.announcer = node('span', '', {class: 'sr', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true'});
    this.mirror = node('div', '', {class: 'mirror', 'aria-hidden': 'true'});
    this.layer.append(this.lines, this.badge, this.card, this.announcer); this.root.append(this.layer, this.mirror);
    document.documentElement.append(this.host);
    this.track = () => this.remember(); document.addEventListener('selectionchange', this.track);
    this.badge.addEventListener('click', trusted(() => this.open()));
    this.root.addEventListener('keydown', trusted(event => { if (event.key === 'Escape') { event.preventDefault(); this.hide(); } }));
  }
  focused() { return document.activeElement === this.host; }
  announce(message) { if (this.announcer.textContent !== message) this.announcer.textContent = message; }
  update(capture, edits, message, undo = false, copyOnly = false, busy = false) {
    clearInterval(this.ticker); this.busySince = busy ? this.busySince || Date.now() : 0; this.busy = busy;
    this.capture = capture; this.edits = edits; this.message = message; this.undo = undo; this.copyOnly = copyOnly; this.index = Math.min(this.index, Math.max(0, edits.length - 1)); this.anchored = false;
    this.announce(message);
    const rewrite = edits.some(edit => edit.rewrite), wording = edits.filter(edit => edit.category === 'clarity').length, working = busy || /^(Checking|Working)/.test(message);
    this.badge.dataset.state = rewrite ? 'rewrite' : !edits.length ? 'idle' : wording === edits.length ? 'clarity' : 'fix';
    this.badge.dataset.busy = working ? 'true' : 'false';
    this.badge.dataset.tip = rewrite ? 'Rewrite ready' : edits.length ? `${edits.length} suggestion${edits.length === 1 ? '' : 's'}` : working ? 'Checking…' : 'Lineleaf';
    this.badge.replaceChildren(node('span', '', {class: 'ring', 'aria-hidden': 'true'}), icon(rewrite ? 'sparkle' : 'leaf', {size: 18}),
      ...(edits.length && !rewrite ? [node('span', String(edits.length), {class: 'count', 'aria-hidden': 'true'})] : []));
    this.badge.setAttribute('aria-label', `${message} Alt Shift L opens Lineleaf.`);
    this.card.hidden = true; this.card.replaceChildren(); this.draw();
  }
  // A button with an optional icon. `iconOnly` keeps the label for assistive technology and for the button's name.
  button(label, fn, attrs = {}, glyph = null, iconOnly = false) {
    const button = node('button', glyph ? '' : label, attrs); if (glyph) button.append(...iconLabel(glyph, label, {iconOnly}));
    button.addEventListener('click', trusted(fn)); return button;
  }
  // Draft.js clears the DOM selection when it blurs, so a plain focus() would put the caret at the start of the document.
  remember() {
    if (this.field instanceof HTMLInputElement || this.field instanceof HTMLTextAreaElement) return;
    const selection = selectionFor(this.field);
    if (selection?.rangeCount && this.field.contains(selection.focusNode)) this.range = selection.getRangeAt(0).cloneRange();
  }
  restore() {
    if (!this.range || !this.field.isConnected) return;
    const selection = selectionFor(this.field);
    try { selection.removeAllRanges(); selection.addRange(this.range); } catch { /* the editor replaced the nodes; keep its own caret */ }
  }
  // `anchored`: opened from an underline, so the card sits by that word instead of by the field.
  open(index = 0, anchored = false) {
    this.remember();
    this.index = Math.min(index, Math.max(0, this.edits.length - 1)); this.anchored = anchored; this.card.dataset.compact = anchored ? 'true' : 'false'; this.card.replaceChildren(); this.card.hidden = false;
    const title = node('h2', 'Lineleaf', {id: 'card-title', tabindex: '-1'}), head = node('header', '', {class: 'head'}), logo = node('span', '', {class: 'logo', 'aria-hidden': 'true'});
    logo.append(icon('leaf', {size: 20}));
    head.append(logo, title, this.button('✕', () => this.hide(), {'aria-label': 'Close suggestions', class: 'icon quiet'}, 'close', true)); this.card.append(head);
    const body = node('div', '', {class: 'body'}); this.card.append(body);
    const edit = this.edits[this.index];
    if (edit?.rewrite) this.rewritePreview(body, edit, title);
    else if (edit) this.suggestion(body, edit);
    const preview = Boolean(this.capture?.preview);
    if (preview) body.append(node('p', 'Copy-only editor: Lineleaf never edits this field. Copy a suggestion and paste it yourself.', {class: 'note'}));
    else if (this.capture?.editable && this.copyOnly) body.append(node('p', 'This editor did not take the change cleanly, so Lineleaf is copy-only here until the page reloads. Check your draft; the editor’s own undo (Ctrl/⌘ Z) reverses its changes.', {class: 'note'}));
    else if (this.capture?.editable && edit && !canApplyRich(this.capture, edit)) body.append(node('p', 'This change spans formatting or a mention, so Lineleaf can only copy it.', {class: 'note'}));
    this.card.append(this.rewriteRow());
    const strip = node('div', '', {class: 'strip'}), status = node('p', this.message, {id: 'status', role: 'status', 'aria-live': 'polite'});
    if (this.busy) status.dataset.busy = 'true';
    strip.append(status, ...this.elapsed()); this.card.append(strip);
    const foot = node('footer', '', {class: 'foot'});
    if (this.undo) foot.append(this.button('Undo last edit', () => this.actions.undo(), {class: 'quiet small'}, 'undo'));
    const check = this.button('Check now', () => this.actions.check(), {class: 'quiet small'}, 'refresh'); check.disabled = Boolean(this.busy);
    foot.append(check, this.button('Cancel check', () => this.actions.cancel(), {class: 'quiet small'}, 'stop'), this.button('Pause Lineleaf', () => this.actions.pause(), {class: 'quiet small'}, 'pause'),
      this.button('Settings', () => this.actions.settings(), {class: 'quiet small'}, 'sliders'));
    this.card.append(foot, node('p', preview ? 'Codex via Seatline · model processing may be remote. Lineleaf does not change this editor.'
      : 'Codex via Seatline · model processing may be remote. Changes need your acceptance.', {class: 'privacy'}));
    this.draw(); title.focus({preventScroll: true});
  }
  // One correction or wording suggestion: its kind, the change, the way to accept it, and where it sits among the others.
  suggestion(body, edit) {
    body.append(node('p', categoryLabel(edit.category), {class: 'category', 'data-category': edit.category}));
    const change = node('p', '', {class: 'change'}); change.append(node('span', edit.before, {class: 'before'}), node('span', ' → ', {class: 'arrow', 'aria-hidden': 'true'}), node('span', edit.after || '(remove)', {class: 'after'}));
    body.append(change);
    const controls = node('div', '', {class: 'row actions'});
    if (!this.capture?.preview) controls.append(this.acceptButton(edit));
    controls.append(this.button('Dismiss', () => this.actions.dismiss(edit)), this.copyButton(edit));
    if (edit.category === 'spelling' && dictionaryWord(edit.before)) controls.append(this.button('Add to dictionary', () => this.actions.addWord(edit.before), {class: 'quiet'}, 'plus'));
    body.append(controls);
    const explanation = node('details'); explanation.append(node('summary', 'Why this suggestion?'), node('p', edit.explanation, {class: 'explanation'})); body.append(explanation);
    const meta = node('div', '', {class: 'meta'});
    if (this.edits.length > 1) {
      const pager = node('div', '', {class: 'pager'});
      pager.append(this.button('Previous', () => this.open((this.index + this.edits.length - 1) % this.edits.length, this.anchored), {class: 'icon quiet'}, 'left', true),
        node('span', `${this.index + 1} of ${this.edits.length}`), this.button('Next', () => this.open((this.index + 1) % this.edits.length, this.anchored), {class: 'icon quiet'}, 'right', true));
      meta.append(pager);
    }
    if (this.anchored) { // Opened from a word: just the suggestion. More brings in the rewrite tools and everyday actions.
      const more = this.button('More', () => {
        const compact = this.card.dataset.compact !== 'true'; this.card.dataset.compact = String(compact);
        more.replaceChildren(...iconLabel(compact ? 'down' : 'up', compact ? 'More' : 'Less')); more.setAttribute('aria-expanded', String(!compact)); this.draw();
      }, {class: 'quiet small', 'aria-expanded': 'false'}, 'down');
      meta.append(more);
    }
    if (meta.children.length) body.append(meta);
  }
  acceptButton(edit) {
    const mapped = {...edit, start: edit.start + this.capture.offset, end: edit.end + this.capture.offset};
    const accept = this.button(edit.rewrite ? 'Replace' : 'Accept', () => this.actions.accept(edit), {class: 'primary', 'aria-label': edit.rewrite ? 'Replace the text with the suggested rewrite' : `Accept suggestion: ${edit.after || 'remove text'}`}, 'check');
    accept.disabled = this.copyOnly || !this.capture.valid() || !(this.capture.editable ? canApplyRich(this.capture, edit) : validSpan(this.capture.snapshot.source, mapped));
    return accept;
  }
  copyButton(edit) {
    return this.button('Copy', async () => {
      try { await navigator.clipboard.writeText(edit.after); this.status('Suggestion copied.'); }
      catch { const copy = node('textarea', '', {readonly: '', 'aria-label': 'Suggestion to copy'}); copy.value = edit.after; this.card.append(copy); copy.focus(); copy.select(); this.status('Clipboard unavailable. Copy the selected text with your keyboard.'); }
    }, {class: 'quiet'}, 'copy');
  }
  // A rewrite replaces a whole selection or paragraph, so it is shown as before/after text rather than an underline.
  rewritePreview(body, edit, title) {
    title.textContent = REWRITE_LABELS[edit.rewrite] ?? 'Rewrite';
    body.append(node('p', `${this.capture?.scope === 'selection' ? 'Selected text' : 'This paragraph'} · ${categoryLabel(edit.category)}`, {class: 'category', 'data-category': edit.category}));
    body.append(node('p', 'Original', {class: 'label'}), node('p', edit.before, {class: 'text'}), node('p', 'Suggested', {class: 'label'}), node('p', edit.after, {class: 'text suggested'}));
    if (edit.flags?.length) body.append(node('p', `Check this version: it changes ${edit.flags.map(flag => FLAG_LABELS[flag]).join(', ')}.`, {class: 'note warn'}));
    const explanation = node('details'); explanation.append(node('summary', 'About this rewrite'), node('p', edit.explanation, {class: 'explanation'})); body.append(explanation);
    const controls = node('div', '', {class: 'row actions'});
    if (!this.capture?.preview) controls.append(this.acceptButton(edit));
    controls.append(this.button('Try again', () => this.actions.rewrite(edit.rewrite), {}, 'refresh'), this.copyButton(edit), this.button('Back', () => this.actions.dismiss(edit), {class: 'quiet'}, 'undo'));
    body.append(controls);
  }
  // Explicit, optional rewrites of the selection, or of the caret paragraph when nothing is selected.
  rewriteRow() {
    const group = node('div', '', {class: 'rewrite', role: 'group', 'aria-label': 'Rewrite'});
    group.append(node('p', 'Rewrite', {class: 'label', 'aria-hidden': 'true'}), node('p', 'Rewrite your selection, or this paragraph if nothing is selected.', {class: 'muted'}));
    const chips = node('div', '', {class: 'chips'});
    for (const mode of ['improve', 'paraphrase']) chips.append(this.button(REWRITE_LABELS[mode], () => this.actions.rewrite(mode), {'data-rewrite': mode, class: 'chip lead'}, 'sparkle'));
    for (const mode of ['clearer', 'shorter', 'formal', 'friendly']) chips.append(this.button(REWRITE_LABELS[mode], () => this.actions.rewrite(mode), {'data-rewrite': mode, class: 'chip'}));
    for (const button of chips.children) button.disabled = Boolean(this.busy); // One request at a time; Cancel check stays available.
    group.append(chips); return group;
  }
  // While a request runs the card stays open and counts the seconds (visual only, so the live region is not read out every second).
  elapsed() {
    if (!this.busy) return [];
    const line = node('p', '', {class: 'muted', 'aria-hidden': 'true', 'data-elapsed': ''}), tick = () => { line.textContent = `Waiting for Codex… ${Math.round((Date.now() - this.busySince) / 1000)} s. Choose Cancel check to stop.`; };
    tick(); this.ticker = setInterval(tick, 1000); return [line];
  }
  status(message) { this.message = message; this.announce(message); const status = this.card.querySelector('#status'); if (status && status.textContent !== message) status.textContent = message; }
  hide() { this.card.hidden = true; this.draw(); this.field.focus({preventScroll: true}); this.restore(); }
  rects(edit) { return this.capture.rects ? this.capture.rects(edit) : suggestionRects(this.field, this.capture.snapshot.source, this.capture.offset + edit.start, this.capture.offset + edit.end, this.mirror); }
  draw() {
    const field = this.field, r = visibleEditorRect(field); this.lines.replaceChildren();
    this.layer.hidden = !r; if (!r) { this.mirror.textContent = ''; return; }
    const valid = Boolean(this.capture?.valid()), shown = !this.card.hidden, found = new Map();
    if (valid) for (let i = 0; i < this.edits.length; i++) if (!this.edits[i].rewrite) found.set(i, this.rects(this.edits[i]));
    // A translated document root also translates fixed-position containing blocks.
    const origin = this.layer.getBoundingClientRect();
    this.badge.style.left = `${Math.max(8, Math.min(innerWidth - this.badge.offsetWidth - 8, r.right - this.badge.offsetWidth)) - origin.left}px`;
    this.badge.style.top = `${Math.max(8, Math.min(innerHeight - this.badge.offsetHeight - 4, r.bottom + 4)) - origin.top}px`;
    if (shown) {
      const width = this.card.offsetWidth, height = this.card.offsetHeight, word = this.anchored ? found.get(this.index)?.[0] : null;
      let left = Math.max(12, Math.min(innerWidth - width - 12, r.right - width)), top = Math.max(12, Math.min(innerHeight - height - 12, r.bottom + 8));
      if (word) { // By the word, below it, or above when there is no room below.
        left = Math.max(12, Math.min(innerWidth - width - 12, word.left - 16));
        top = word.bottom + 10 + height <= innerHeight - 12 ? word.bottom + 10 : Math.max(12, Math.min(innerHeight - height - 12, word.top - height - 10));
      }
      this.card.style.left = `${left - origin.left}px`; this.card.style.top = `${top - origin.top}px`;
    }
    for (const [i, rectangles] of found) {
      const edit = this.edits[i];
      for (const rectangle of rectangles) {
        if (shown && i === this.index) { // The word the open card is about.
          const mark = node('div', '', {class: 'mark', 'data-category': edit.category, 'aria-hidden': 'true'});
          mark.style.left = `${rectangle.left - origin.left}px`; mark.style.top = `${rectangle.top - origin.top}px`; mark.style.width = `${rectangle.right - rectangle.left}px`; mark.style.height = `${rectangle.bottom - rectangle.top}px`; this.lines.append(mark);
        }
        const line = this.button('', () => this.open(i, true), {class: 'underline', tabindex: '-1', 'aria-hidden': 'true', 'data-category': edit.category});
        line.style.left = `${rectangle.left - origin.left}px`; line.style.top = `${rectangle.bottom - 3 - origin.top}px`; line.style.width = `${rectangle.right - rectangle.left}px`; this.lines.append(line);
      }
    }
    if (!valid) this.mirror.textContent = '';
  }
  close() { clearInterval(this.ticker); document.removeEventListener('selectionchange', this.track); this.host.remove(); this.capture = null; this.edits = []; this.mirror.textContent = ''; }
}

export function mountInline(api) {
  let field, adapter, view, capture, edits = [], port, timer, expiry, watchdog, frame, policy = null, epoch = 0, generation = 0;
  let composing = false, applying = false, blocked = false, lastKey = null, pendingKey = null, dirty = false, nextAt = 0, undo = false, copyOnly = false, geometry = '';
  let mode = 'edit', settling = 0, before; // 'rich' = no adapter: caret-paragraph capture; Accept only in a verified editor family
  let held = null; // proofreading suggestions set aside while an explicit rewrite is shown
  let working = false; // a request to the provider is in flight
  let clarityDue = false, clarityFor = null; // an optional clearer-wording check is waiting for the shared automatic interval, for this paragraph key
  const compositions = new WeakSet();
  // `available`: the site is enabled and not paused (site-state answered). `permitted`: automatic checking is also on. Without it the
  // assistant stays out of sight and reads nothing until the user asks with Alt Shift L, then sends only what an explicit action names.
  const available = () => policy !== null && document.visibilityState === 'visible';
  const permitted = () => policy?.automatic === true && document.visibilityState === 'visible';
  const active = () => deepActive() === field;
  const stop = () => {
    generation++; working = false; clearTimeout(timer); clearTimeout(watchdog); timer = null;
    if (port) { const old = port; port = null; try { old.postMessage({type: 'cancel'}); old.disconnect(); } catch { /* worker restarted */ } }
  };
  function drop() { stop(); clearTimeout(expiry); adapter?.dispose(); view?.close(); held = null; clarityDue = false; clarityFor = null; field = adapter = view = capture = null; mode = 'edit'; settling++; before = undefined; edits = []; lastKey = pendingKey = null; dirty = false; blocked = false; undo = false; copyOnly = false; composing = false; geometry = ''; }
  function update(message) { view?.update(capture, edits, message, undo, copyOnly, working); }
  // Bring back the proofreading suggestions that were set aside for a rewrite, if their text is still the current text.
  function restoreHeld(message) {
    const previous = held; held = null;
    if (!previous?.capture.valid()) return false;
    capture = previous.capture; edits = previous.edits; update(message); return true;
  }
  // A failed explicit rewrite is not a failed check: it brings back the suggestions set aside for it, leaves automatic checking
  // alone and opens the card with the reason. Only a failed proofreading check pauses further automatic checks.
  function failed(code, rewriteMode, wording = false, explicit = Boolean(rewriteMode)) {
    working = false;
    if (wording) clarityDue = false; // Optional extra check: say why, keep the corrections on screen, never pause automatic checking.
    else if (rewriteMode) restoreHeld(messageFor(code)); else blocked = true;
    update(messageFor(code)); if (explicit) view?.open(); // The user asked for something, so say why it did not happen.
  }
  // The corrections and the clearer-wording suggestions share one list; wording never overlaps a correction.
  function addWording(found) {
    const fresh = found.filter(c => !edits.some(e => e.category !== 'clarity' && c.start < e.end && e.start < c.end));
    edits = [...edits.filter(e => e.category !== 'clarity'), ...fresh].sort((a, b) => a.start - b.start);
    return fresh.length;
  }
  const countMessage = () => {
    const wording = edits.filter(e => e.category === 'clarity').length;
    return `${edits.length} suggestion${edits.length === 1 ? '' : 's'}${wording ? ` (${wording} clearer wording)` : ''}. ${replaceable() ? 'Review before accepting.' : 'Review and copy; this editor is not changed.'}`;
  };
  async function rpc(type, payload = null) {
    try { return await api.runtime.sendMessage({type, payload}); } catch { return {ok: false, code: 'UNAVAILABLE'}; }
  }
  async function refresh() {
    const ticket = ++epoch, result = await rpc('site-state'); if (ticket !== epoch) return;
    policy = result.ok ? result.value : null;
    if (!permitted()) { drop(); return; }
    choose(deepActive());
  }
  function eligibleDOM() {
    if (!field?.isConnected || !embeddingAllowed() || excluded(field) || field.disabled || field.readOnly || visibleEditorRect(field) === null) return false;
    // Rich editors legitimately contain inline code or islands elsewhere; their paragraph is checked at capture time.
    return mode === 'rich' ? previewAllowed(field) : !field.querySelector('[data-lineleaf-ignore], [aria-hidden="true"], pre, code');
  }
  const capturePara = () => mode === 'rich' ? captureRichParagraph(field, {editable: richReplacementAllowed(field)}) : captureParagraph(field, adapter);
  // Explicit rewrites: the selection when there is one, otherwise the caret paragraph.
  // Only an empty selection falls back to the paragraph: a selection Lineleaf cannot use is refused, never widened to more text.
  function captureScope() {
    if (mode !== 'rich') return captureRewriteScope(field, adapter);
    const editable = richReplacementAllowed(field), selection = selectionFor(field);
    const selected = Boolean(selection?.rangeCount && field.contains(selection.focusNode) && !selection.isCollapsed);
    return captureRichParagraph(field, selected ? {editable, selection: true} : {editable});
  }
  // Whether Accept can ever exist for this field: the adapter editors and the verified rich families, until one misbehaves.
  const replaceable = () => mode === 'edit' || (Boolean(field) && richReplacementAllowed(field));
  function choose(target, invoked = false) {
    if (applying || target === view?.host) return;
    if (!available()) { drop(); return; }
    if (!permitted() && !invoked) { if (!field || editorOf(target) !== field) drop(); return; } // Focus alone builds nothing without the opt-in.
    const next = editorOf(target);
    if (!next || excluded(next)) { drop(); return; }
    if (next !== field) {
      drop(); field = next; composing = compositions.has(field);
      if (replacementSupported(field)) {
        adapter = new EditorAdapter(field);
        if (!adapter.usable() || !eligibleDOM()) { drop(); return; } // Eligibility only: the text is read when an action names what to check.
      } else if (previewAllowed(field)) {
        mode = 'rich';
        if (!eligibleDOM()) { drop(); return; }
      } else { drop(); return; }
      view = new InlineView(field, {accept, undo: undoEdit, dismiss: edit => { if (edit.rewrite && restoreHeld('Rewrite dismissed. Your text is unchanged.')) { view.open(); return; } edits = edits.filter(x => x !== edit); update(edits.length ? (replaceable() ? 'Review each suggestion before accepting.' : 'Review each suggestion. Copy one to use it.') : 'Suggestions dismissed. Your text is unchanged.'); if (edits.length) view.open(); else view.hide(); },
        check: () => { stop(); void run(false); }, rewrite: rewriteMode => { stop(); void run(false, rewriteMode); }, cancel: () => { stop(); blocked = false; update(messageFor('CANCELLED')); view?.open(); },
        addWord: async word => { const result = await rpc('add-word', {word}); if (!result.ok) view?.status(messageFor(result.code)); },
        pause: async () => { const result = await rpc('pause'); if (!result.ok) view?.status(messageFor(result.code)); },
        settings: async () => { const result = await rpc('open-settings'); if (!result.ok) view?.status(messageFor(result.code)); }});
      update(idleMessage());
    }
    queue();
  }
  const keyFor = value => `${value.id ?? ''}:${value.offset}:${value.text}`;
  function queue(delay = AUTO_IDLE) {
    clearTimeout(timer); if (!permitted() || !navigator.onLine || !active() || composing || blocked || !eligibleDOM()) return;
    // A change that has not been checked yet (its paragraph key differs from the last one checked) comes before the optional wording check.
    if (dirty && pendingKey !== lastKey) timer = setTimeout(() => { timer = null; void run(true); }, Math.max(delay, nextAt - Date.now()));
    else if (clarityDue) timer = setTimeout(() => { timer = null; void run(true, null, true); }, Math.max(0, nextAt - Date.now())); // After the corrections, on the shared interval.
  }
  async function run(automatic, rewriteMode = null, wording = false) {
    if (!field || port || composing || applying || !eligibleDOM() || document.visibilityState !== 'visible') {
      // An automatic check may wait silently; something the user chose must never do nothing without saying why.
      if (!automatic && field && view) {
        update(port ? 'A request is already running. Choose Cancel check to stop it.' : composing ? 'Finish the text you are composing, then try again.'
          : applying ? 'Lineleaf is applying an edit. Try again in a moment.' : 'Lineleaf cannot use this field right now: it may be hidden, read-only or excluded.');
        view.open();
      }
      return;
    }
    if (automatic && (!permitted() || !active() || blocked)) return;
    if (!navigator.onLine) { failed('OFFLINE', rewriteMode, wording, !automatic); return; }
    // Explicit Check now restores the field focus before capturing its current paragraph.
    if (!automatic) { field.focus({preventScroll: true}); view?.restore(); blocked = false; clarityDue = false; }
    let next;
    try { next = rewriteMode ? captureScope() : capturePara(); }
    catch {
      if (wording) { clarityDue = false; return; }
      if (rewriteMode) { update('Rewrites need 1–2,000 characters of text with letters inside one paragraph. Select text within a single paragraph, or put the caret in one.'); view?.open(); return; }
      capture = null; edits = [];
      if (automatic) update('Automatic checking needs a supported paragraph of 1–2,000 characters. Select text for a manual check.');
      else { update('Check now needs 1–2,000 characters of text with letters in one paragraph. Put the caret in a paragraph with text.'); view?.open(); }
      return;
    }
    if (wording ? !clarityDue || keyFor(next) !== clarityFor : automatic && (!dirty || keyFor(next) !== pendingKey || keyFor(next) === lastKey)) { if (wording) clarityDue = false; return; }
    const ticket = ++generation, selectedField = field, state = await rpc('site-state');
    if (ticket !== generation || selectedField !== field || !eligibleDOM() || !next.valid()) return;
    if (wording && state.ok && !state.value.clarity) { clarityDue = false; return; }
    if (!state.ok || (automatic && !state.value.automatic)) { failed(state.code ?? 'AUTOMATIC_DISABLED', rewriteMode, wording, !automatic); return; }
    if (rewriteMode) held = capture && !edits.some(edit => edit.rewrite) ? {capture, edits} : held; // Set the suggestions aside; Back restores them.
    policy = state.value; capture = next; if (!wording) { edits = []; if (!rewriteMode) lastKey = keyFor(next); } copyOnly = false; clarityDue = false; // `undo` stays: the adapter refuses it once the text has changed
    clearTimeout(expiry); expiry = setTimeout(drop, 5 * 60 * 1000);
    if (automatic) nextAt = Date.now() + AUTO_INTERVAL;
    working = true;
    update(rewriteMode ? `Working on “${REWRITE_LABELS[rewriteMode]}” with Codex… You can keep typing.` : wording ? 'Looking for clearer wording with Codex… You can keep typing.' : 'Checking with Codex… You can keep typing.');
    if (!automatic) view?.open(); // Stay visible while it runs: progress, and Cancel check.
    const id = crypto.randomUUID();
    try {
      const current = api.runtime.connect({name: 'lineleaf-writing-v1'}); port = current;
      const finish = () => { clearTimeout(watchdog); if (port === current) { port = null; working = false; } try { current.disconnect(); } catch { /* document gone */ } };
      current.onDisconnect.addListener(() => { void api.runtime.lastError; if (port === current) { port = null; clearTimeout(watchdog); failed('UNAVAILABLE', rewriteMode, wording, !automatic); } });
      current.onMessage.addListener(message => {
        if (port !== current || message.id !== id || ticket !== generation) return;
        if (!eligibleDOM() || !capture?.valid()) { stop(); capture = null; edits = []; held = null; queue(); update(messageFor('STALE')); return; }
        if (message.type === 'result') {
          finish(); if (!Array.isArray(message.edits)) { failed('INVALID_OUTPUT', rewriteMode, wording, !automatic); return; }
          if (rewriteMode) {
            edits = message.edits; clearTimeout(expiry); expiry = setTimeout(drop, 5 * 60 * 1000);
            const label = REWRITE_LABELS[rewriteMode];
            if (edits.length) update(`${label}: review the suggested text. ${replaceable() ? 'Replace it or try again.' : 'Copy it; this editor is not changed.'}`);
            else if (!restoreHeld(`${label}: no change suggested. This already reads well.`)) update(`${label}: no change suggested. This already reads well.`);
            view.open(); return;
          }
          if (wording) { addWording(message.edits); update(edits.length ? countMessage() : 'No corrections or clearer wording suggested.'); }
          else {
            edits = message.edits; update(edits.length ? countMessage() : 'No corrections suggested.');
            if (!automatic && !edits.length) view?.open(); // An explicit Check now with nothing to show still answers.
            // With the optional setting on, the same paragraph gets one more automatic request for clearer wording, after the shared interval.
            if (automatic && policy?.clarity === true) { clarityDue = true; clarityFor = keyFor(capture); queue(); }
          }
          clearTimeout(expiry); expiry = setTimeout(drop, 5 * 60 * 1000);
        } else if (message.type === 'error') {
          finish(); const retryable = ['AUTO_WAIT', 'BUSY', 'QUEUE_FULL', 'PROVIDER_RATE_LIMITED', 'AUTO_PAUSED'].includes(message.code);
          // A refusal that says when to come back is retried then; AUTO_PAUSED (another tab's timeout) may be several minutes away.
          const retryDelay = Math.max(1000, Math.min(message.code === 'AUTO_PAUSED' ? AUTOMATIC_HOLD : 60000, message.retryAfterMs || (message.code === 'PROVIDER_RATE_LIMITED' ? 60000 : 5000)));
          if (wording) { // Optional and best-effort: wait out a shared-interval refusal once more, otherwise give up on this text; corrections stay and automatic checking goes on.
            if (retryable) { clarityDue = true; nextAt = Date.now() + retryDelay; queue(); } else clarityDue = false;
            if (!retryable) update(messageFor(message.code));
            return;
          }
          if (retryable && automatic) { lastKey = null; nextAt = Date.now() + retryDelay; queue(nextAt - Date.now()); }
          else blocked = !rewriteMode && message.code !== 'CANCELLED';
          if (rewriteMode) restoreHeld(messageFor(message.code));
          update(messageFor(message.code)); if (!automatic) view?.open();
        }
      });
      watchdog = setTimeout(() => { stop(); failed('PROVIDER_TIMEOUT', rewriteMode, wording, !automatic); }, WATCHDOG[automatic ? 'automatic' : 'manual']);
      current.postMessage({type: 'start', id, text: capture.text, mode: rewriteMode ?? (wording ? 'clarity' : 'proofread'), kind: automatic ? 'automatic' : 'manual'});
    } catch { stop(); failed('UNAVAILABLE', rewriteMode, wording, !automatic); }
  }
  const RICH_FAILURES = {
    stale_or_unavailable: 'The text changed before this could be applied. Choose Check now to review the current text.',
    changed_on_focus: 'The text changed before this could be applied. Choose Check now to review the current text.',
    focus_moved: 'Nothing was changed because you moved elsewhere. Choose Accept again when you are back in the editor.',
    selection_unavailable: 'The editor would not select that text, so nothing was changed. Use Copy.',
    crosses_format_boundary: 'This change spans formatting or a mention, so Lineleaf can only copy it.',
    invalid_span: 'This suggestion no longer matches the text. Choose Check now to review the current text.',
    spacing_collapses: 'This text has spacing the editor would collapse, so Lineleaf can only copy it. Use Copy.',
    editor_rejected: 'The editor did not apply the change. Lineleaf is copy-only here. Use Copy.',
    native_edit_not_confirmed: 'The editor’s text is not what Lineleaf expected. Check your draft; its own undo (Ctrl/⌘ Z) reverses its changes. Use Copy.',
    editor_reverted: 'The editor reverted the change. Lineleaf is copy-only here. Use Copy.'
  };
  // Verified rich editors: the edit goes through the editor's own input pipeline, so its history owns the undo.
  async function acceptRich(edit) {
    if (applying || !capture?.editable || composing || !capture.valid()) return;
    stop(); applying = true;
    const selected = capture, selectedView = view;
    view.status('Applying…');
    let result;
    try { result = await applyRichEdit(selected, edit, view.range); }
    catch { result = {status: 'copy', reason: 'native_edit_not_confirmed', changed: true}; }
    finally { applying = false; }
    if (capture !== selected || view !== selectedView) return;
    // The user went to another field while the edit settled: hand off to it and never pull focus back to this editor.
    const active = deepActive(), here = active === field || field.contains(active) || active === view.host;
    if (!here && active && active !== document.body && active !== document.documentElement) { drop(); choose(active); return; }
    if (result.status === 'applied') {
      // Keep the other suggestions that still point at the same words, moved by the length change.
      const next = result.capture, delta = edit.after.length - (edit.end - edit.start);
      edits = edits.filter(x => x !== edit).map(x => x.start >= edit.end ? {...x, start: x.start + delta, end: x.end + delta} : x)
        .filter(x => (x.end <= edit.start || x.start >= edit.end + delta) && next.text.slice(x.start, x.end) === x.before);
      // Typing during the edit was not seen as typing (it happened while applying): check the paragraph again after a pause.
      const recheck = result.typed === true || Boolean(edit.rewrite); // A rewrite's new text is proofread after a pause.
      // The automatic check reads the whole caret paragraph, so its key (not the key of a rewritten selection) is what must match.
      held = null; capture = next; undo = false; copyOnly = false; lastKey = recheck ? null : keyFor(next); pendingKey = recheck ? paragraphKey() : null; dirty = recheck;
      if (clarityDue) clarityFor = keyFor(next);
      update(`Applied. ${edits.length ? `${edits.length} more suggestion${edits.length === 1 ? '' : 's'}. ` : ''}Press Ctrl/⌘ Z to undo${result.steps === 2 ? ' (it takes two presses here)' : ''}.`);
      if (here) view.hide();
      queue(); return;
    }
    undo = false; edits = [edit]; copyOnly = !['stale_or_unavailable', 'changed_on_focus', 'invalid_span', 'crosses_format_boundary', 'selection_unavailable', 'focus_moved', 'spacing_collapses'].includes(result.reason);
    update(RICH_FAILURES[result.reason] ?? 'Safe replacement is unavailable. Use Copy.'); if (here) view.open();
  }
  function accept(edit) {
    if (!capture || !eligibleDOM()) return;
    if (mode !== 'edit') { void acceptRich(edit); return; }
    stop(); applying = true;
    const selected = capture, selectedView = view;
    let result;
    try { result = capture.adapter.apply(capture.snapshot, {...edit, start: capture.offset + edit.start, end: capture.offset + edit.end}); }
    finally { applying = false; }
    if (capture !== selected || view !== selectedView) return;
    undo = result?.status === 'applied'; edits = undo ? [] : [edit]; copyOnly = !undo;
    update(result?.contextChanged ? 'The editor changed context during this edit. Review its draft and use its own undo; safe restoration is unavailable.' : undo ? 'Applied. You can undo this edit before other typing.' : result?.restored ? `Original text restored. Use Copy.${result.stateUncertain ? ' Site state could not be verified.' : ''}` : 'Safe replacement is unavailable. Use the manual panel to preview and copy.');
    if (!undo) { blocked = true; view.open(); return; }
    held = null; capture = null; view.capture = null; clarityDue = false; if (edit.rewrite) dirty = true; // The new text gets its corrections first, then its own wording check.
    try { pendingKey = keyFor(captureParagraph(field, adapter)); } catch { pendingKey = null; }
    queue(); view.open();
  }
  function undoEdit() {
    applying = true; let result; const selectedView = view;
    try { result = adapter?.undo(); } finally { applying = false; }
    if (view !== selectedView) return;
    undo = false; edits = []; capture = null; held = null; lastKey = null;
    update(result?.contextChanged ? 'The editor changed context during undo. Review its draft; safe restoration is unavailable.' : result?.status === 'undone' ? 'Undone. Your original text is restored.' : result?.restored ? 'Original text restored. Further edits use Copy.' : 'Undo unavailable after other edits. Use the editor’s undo control.');
  }
  // Rich editors. A trusted typing event only arms a check when the caret paragraph really changed: an editor can cancel
  // `beforeinput` (maxlength, read-only state, a handler) without re-rendering or emitting `input`. Draft.js, Lexical and
  // Slate cancel it *and* re-render with no native `input`, so the result is read one task later. The pre-edit key comes
  // only from `beforeinput`/`compositionstart`; `input` never overwrites it, or editors that apply the change and also
  // emit `input` would never arm.
  const paragraphKey = () => { try { return keyFor(capturePara()); } catch { return null; } };
  const idleMessage = () => !permitted()
    ? `Automatic checking is off, so nothing is sent until you choose Check now or a rewrite.${replaceable() ? '' : ' Lineleaf never edits this editor.'}`
    : replaceable()
      ? 'Lineleaf checks this paragraph after you pause typing. Alt Shift L opens controls.'
      : 'Lineleaf checks this paragraph after you pause typing and shows suggestions to copy. It never edits this editor. Alt Shift L opens controls.';
  const changedMessage = trustedEdit => permitted()
    ? (trustedEdit ? 'Text changed. Checking after a pause.' : 'The editor changed. Choose Check now to review the current text.')
    : 'The text changed. Choose Check now or a rewrite to use the current text.';
  function settle() {
    const ticket = ++settling;
    setTimeout(() => {
      if (ticket !== settling || mode !== 'rich' || !field) return;
      const was = before, after = paragraphKey(); before = undefined;
      if (after === was) return; // The editor rejected or ignored the edit: keep any check already armed.
      stop(); capture = null; edits = []; held = null; undo = false; copyOnly = false; clarityDue = false; pendingKey = after; dirty = after !== null && permitted();
      update(dirty ? 'Text changed. Checking after a pause.' : after !== null ? changedMessage(true) : idleMessage()); queue();
    }, 0);
  }
  function typed(event) {
    const target = eventElement(event);
    if (applying || !field || mode !== 'rich' || !(target === field || field.contains(target))) return;
    if (!permitted()) { stop(); capture = null; edits = []; held = null; update(changedMessage(true)); return; } // Nothing is checked unasked, so nothing is read per keystroke.
    if (event.type === 'compositionstart') { stop(); capture = null; edits = []; update(changedMessage(true)); }
    // Keep the pre-edit key of the earliest edit that has not settled yet: on a busy page a later rejected keystroke could
    // otherwise overwrite it with the already-changed key and hide the change.
    if ((event.type === 'compositionstart' || (event.type === 'beforeinput' && !event.isComposing)) && before === undefined) before = paragraphKey();
    settle();
  }
  const changed = event => {
    const target = eventElement(event);
    if (applying || !field || !(target === field || field.contains(target))) return;
    stop(); capture = null; edits = []; held = null; undo = false; copyOnly = false; clarityDue = false; dirty = event.isTrusted === true && permitted();
    pendingKey = null;
    if (dirty) { try { pendingKey = keyFor(captureParagraph(field, adapter)); } catch { pendingKey = null; } }
    update(changedMessage(event.isTrusted === true)); queue();
  };
  document.addEventListener('focusin', event => { const target = eventElement(event); if (target !== view?.host) choose(target); }, true);
  document.addEventListener('input', event => { if (!field) choose(eventElement(event)); if (mode === 'rich' && event.isTrusted) typed(event); else changed(event); }, true);
  document.addEventListener('beforeinput', event => { if (mode === 'rich' && field && event.isTrusted) typed(event); }, true);
  document.addEventListener('compositionstart', event => { const target = eventElement(event); compositions.add(editorOf(target) ?? target); if (field && (target === field || field.contains(target))) { composing = true; if (mode === 'rich' && event.isTrusted) typed(event); else changed(event); } }, true);
  document.addEventListener('compositionend', event => { const target = eventElement(event); compositions.delete(editorOf(target) ?? target); if (field && (target === field || field.contains(target))) { composing = false; if (mode === 'rich' && event.isTrusted) typed(event); else changed(event); } }, true);
  // With automatic checking off the card is built only here, for the field the user is in; nothing is read or sent until an action.
  document.addEventListener('keydown', trusted(event => {
    if (!(event.altKey && event.shiftKey && event.code === 'KeyL')) return;
    if (!view && !permitted()) choose(deepActive(), true); // choose() declines when the site is disabled or paused
    if (view) { event.preventDefault(); view.open(); }
  }), true);
  const paint = () => { if (!frame) frame = requestAnimationFrame(() => { frame = null; view?.draw(); }); };
  document.addEventListener('scroll', paint, {capture: true, passive: true}); window.addEventListener('resize', paint);
  let route = navigationToken();
  const navigated = () => { const next = navigationToken(); if (next !== route) { route = next; epoch++; drop(); void refresh(); } };
  observeNavigation(navigated);
  window.visualViewport?.addEventListener('resize', paint); window.visualViewport?.addEventListener('scroll', paint);
  const poll = setInterval(() => {
    navigated(); if (!field || applying) return;
    if (!available() || !eligibleDOM() || !view?.host.isConnected) { drop(); return; }
    if (capture && !capture.valid()) { changed({target: field}); }
    const r = field.getBoundingClientRect(), clip = visibleEditorRect(field), position = [r.x, r.y, r.width, r.height, clip?.left, clip?.top, clip?.right, clip?.bottom, field.scrollTop, field.scrollLeft, adapter?.layoutRevision ?? 0, capture?.layout?.() ?? ''].join(':');
    if (position !== geometry) { geometry = position; paint(); }
  }, 250);
  api.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== api.runtime.id) return;
    if (message.type === 'lineleaf-policy-changed') { epoch++; policy = null; drop(); void refresh(); }
    if (message.type === 'lineleaf-open') drop();
  });
  document.addEventListener('visibilitychange', () => { epoch++; drop(); if (document.visibilityState === 'visible') void refresh(); });
  window.addEventListener('offline', () => { stop(); blocked = true; update(messageFor('OFFLINE')); });
  window.addEventListener('online', () => { if (blocked) view?.status('Connection restored. Choose Check now when ready.'); });
  window.addEventListener('pagehide', () => { epoch++; policy = null; drop(); });
  window.addEventListener('pageshow', () => { void refresh(); });
  void refresh();
  return {close: () => { epoch++; policy = null; drop(); clearInterval(poll); cancelAnimationFrame(frame); }};
}
