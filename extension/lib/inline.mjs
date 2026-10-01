import {EditorAdapter, validSpan} from '../../prototypes/editor/editor-adapter.mjs';
import {captureParagraph, editorOf, excluded} from './selection.mjs';
import {suggestionRects} from './geometry.mjs';
import {AUTO_IDLE, AUTO_INTERVAL, categoryLabel, dictionaryWord} from './policy.mjs';
import {messageFor} from './messages.mjs';
import styles from '../inline.css';

const node = (tag, text = '', attributes = {}) => {
  const el = document.createElement(tag); el.textContent = text;
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  return el;
};
const trusted = fn => event => { if (event.isTrusted) void fn(event); };
class InlineView {
  constructor(field, actions) {
    this.field = field; this.actions = actions; this.edits = []; this.index = 0;
    this.host = node('div', '', {'data-lineleaf-inline': ''}); this.root = this.host.attachShadow({mode: 'closed'});
    const sheet = new CSSStyleSheet(); sheet.replaceSync(styles); this.root.adoptedStyleSheets = [sheet];
    this.layer = node('div', '', {class: 'layer'}); this.lines = node('div');
    this.badge = node('button', 'Lineleaf', {class: 'badge', 'aria-label': 'Lineleaf writing assistance. Alt Shift L opens suggestions.'});
    this.card = node('section', '', {class: 'card', hidden: '', 'aria-label': 'Lineleaf suggestions'});
    this.announcer = node('span', '', {class: 'sr', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true'});
    this.mirror = node('div', '', {class: 'mirror', 'aria-hidden': 'true'});
    this.layer.append(this.lines, this.badge, this.card, this.announcer); this.root.append(this.layer, this.mirror);
    document.documentElement.append(this.host);
    this.badge.addEventListener('click', trusted(() => this.open()));
    this.root.addEventListener('keydown', trusted(event => { if (event.key === 'Escape') { event.preventDefault(); this.hide(); } }));
  }
  focused() { return document.activeElement === this.host; }
  update(capture, edits, message, undo = false, copyOnly = false) {
    this.capture = capture; this.edits = edits; this.message = message; this.undo = undo; this.copyOnly = copyOnly; this.index = Math.min(this.index, Math.max(0, edits.length - 1));
    this.announcer.textContent = message;
    this.badge.textContent = edits.length ? `Lineleaf · ${edits.length} suggestion${edits.length === 1 ? '' : 's'}` : message.startsWith('Checking') ? 'Lineleaf · checking…' : 'Lineleaf · review';
    this.badge.setAttribute('aria-label', `${message} Alt Shift L opens Lineleaf.`);
    this.card.hidden = true; this.card.replaceChildren(); this.draw();
  }
  button(label, fn, attrs = {}) {
    const button = node('button', label, attrs); button.addEventListener('click', trusted(fn)); return button;
  }
  open(index = 0) {
    this.index = Math.min(index, Math.max(0, this.edits.length - 1)); this.card.replaceChildren(); this.card.hidden = false;
    const title = node('h2', 'Lineleaf', {id: 'card-title', tabindex: '-1'}), heading = node('div', '', {class: 'heading'});
    heading.append(title, this.button('✕', () => this.hide(), {'aria-label': 'Close suggestions'})); this.card.append(heading);
    const edit = this.edits[this.index];
    if (edit) {
      this.card.append(node('p', categoryLabel(edit.category), {class: 'category'}));
      const change = node('p', '', {class: 'change'}); change.append(node('span', edit.before, {class: 'before'}), document.createTextNode(' → '), node('span', edit.after || '(remove)', {class: 'after'}));
      this.card.append(change);
      const explanation = node('details'); explanation.append(node('summary', 'Why this suggestion?'), node('p', edit.explanation, {class: 'explanation'})); this.card.append(explanation);
      const controls = node('div', '', {class: 'row'});
      const mapped = {...edit, start: edit.start + this.capture.offset, end: edit.end + this.capture.offset};
      const accept = this.button('Accept', () => this.actions.accept(edit), {class: 'primary', 'aria-label': `Accept suggestion: ${edit.after || 'remove text'}`});
      accept.disabled = this.copyOnly || !this.capture.adapter.current(this.capture.snapshot) || !validSpan(this.capture.snapshot.source, mapped);
      controls.append(accept, this.button('Dismiss', () => this.actions.dismiss(edit)), this.button('Copy', async () => {
        try { await navigator.clipboard.writeText(edit.after); this.status('Suggestion copied.'); }
        catch { const copy = node('textarea', '', {readonly: '', 'aria-label': 'Suggestion to copy'}); copy.value = edit.after; this.card.append(copy); copy.focus(); copy.select(); this.status('Clipboard unavailable. Copy the selected text with your keyboard.'); }
      }));
      if (edit.category === 'spelling' && dictionaryWord(edit.before)) controls.append(this.button('Add to dictionary', () => this.actions.addWord(edit.before)));
      this.card.append(controls);
      if (this.edits.length > 1) {
        const navigation = node('div', '', {class: 'row'}); navigation.append(this.button('Previous', () => this.open((this.index + this.edits.length - 1) % this.edits.length)), node('span', `${this.index + 1} of ${this.edits.length}`), this.button('Next', () => this.open((this.index + 1) % this.edits.length))); this.card.append(navigation);
      }
    }
    this.card.append(node('p', this.message, {id: 'status', role: 'status', 'aria-live': 'polite'}), node('p', 'Codex via Seatline · model processing may be remote. Changes need your acceptance.', {class: 'muted'}));
    const footer = node('div', '', {class: 'row'});
    if (this.undo) footer.append(this.button('Undo last edit', () => this.actions.undo()));
    footer.append(this.button('Check now', () => this.actions.check()), this.button('Cancel check', () => this.actions.cancel()), this.button('Pause Lineleaf', () => this.actions.pause()), this.button('Settings', () => this.actions.settings()));
    this.card.append(footer); this.draw(); title.focus({preventScroll: true});
  }
  status(message) { this.message = message; this.announcer.textContent = message; const status = this.card.querySelector('#status'); if (status) status.textContent = message; }
  hide() { this.card.hidden = true; this.field.focus({preventScroll: true}); }
  draw() {
    const field = this.field, r = field.getBoundingClientRect(); this.lines.replaceChildren();
    this.badge.style.left = `${Math.max(8, Math.min(innerWidth - this.badge.offsetWidth - 8, r.right - this.badge.offsetWidth))}px`;
    this.badge.style.top = `${Math.max(8, Math.min(innerHeight - 30, r.bottom + 3))}px`;
    if (!this.card.hidden) {
      const width = this.card.offsetWidth, height = this.card.offsetHeight;
      this.card.style.left = `${Math.max(12, Math.min(innerWidth - width - 12, r.right - width))}px`;
      this.card.style.top = `${Math.max(12, Math.min(innerHeight - height - 12, r.bottom + 8))}px`;
    }
    if (!this.capture?.adapter.current(this.capture.snapshot)) { this.mirror.textContent = ''; return; }
    for (let i = 0; i < this.edits.length; i++) {
      const edit = this.edits[i], start = this.capture.offset + edit.start, end = this.capture.offset + edit.end;
      for (const rectangle of suggestionRects(field, this.capture.snapshot.source, start, end, this.mirror)) {
        const line = this.button('', () => this.open(i), {class: 'underline', tabindex: '-1', 'aria-hidden': 'true', 'data-category': edit.category});
        line.style.left = `${rectangle.left}px`; line.style.top = `${rectangle.bottom - 3}px`; line.style.width = `${rectangle.right - rectangle.left}px`; this.lines.append(line);
      }
    }
  }
  close() { this.host.remove(); this.capture = null; this.edits = []; this.mirror.textContent = ''; }
}

export function mountInline(api) {
  let field, adapter, view, capture, edits = [], port, timer, expiry, watchdog, frame, policy = null, epoch = 0, generation = 0;
  let composing = false, applying = false, blocked = false, lastKey = null, pendingKey = null, dirty = false, nextAt = 0, undo = false, copyOnly = false, geometry = '';
  const compositions = new WeakSet();
  const permitted = () => policy?.automatic === true && document.visibilityState === 'visible';
  const active = () => document.activeElement === field;
  const stop = () => {
    generation++; clearTimeout(timer); clearTimeout(watchdog); timer = null;
    if (port) { const old = port; port = null; try { old.postMessage({type: 'cancel'}); old.disconnect(); } catch { /* worker restarted */ } }
  };
  function drop() { stop(); clearTimeout(expiry); adapter?.dispose(); view?.close(); field = adapter = view = capture = null; edits = []; lastKey = pendingKey = null; dirty = false; blocked = false; undo = false; copyOnly = false; composing = false; geometry = ''; }
  function update(message) { view?.update(capture, edits, message, undo, copyOnly); }
  async function rpc(type, payload = null) {
    try { return await api.runtime.sendMessage({type, payload}); } catch { return {ok: false, code: 'UNAVAILABLE'}; }
  }
  async function refresh() {
    const ticket = ++epoch, result = await rpc('site-state'); if (ticket !== epoch) return;
    policy = result.ok ? result.value : null;
    if (!permitted()) { drop(); return; }
    choose(document.activeElement);
  }
  function eligibleDOM() {
    return field?.isConnected && !excluded(field) && !field.querySelector('[data-lineleaf-ignore], [aria-hidden="true"], pre, code')
      && !field.disabled && !field.readOnly && field.getClientRects().length > 0 && getComputedStyle(field).visibility === 'visible';
  }
  function choose(target) {
    if (applying || target === view?.host) return;
    if (!permitted()) { drop(); return; }
    const next = editorOf(target);
    if (!next || excluded(next)) { drop(); return; }
    if (next !== field) {
      drop(); field = next; composing = compositions.has(field); adapter = new EditorAdapter(field);
      if (!adapter.snapshot() || !eligibleDOM()) { drop(); return; }
      view = new InlineView(field, {accept, undo: undoEdit, dismiss: edit => { edits = edits.filter(x => x !== edit); update(edits.length ? 'Review each suggestion before accepting.' : 'Suggestions dismissed. Your text is unchanged.'); if (edits.length) view.open(); },
        check: () => { stop(); void run(false); }, cancel: () => { stop(); blocked = false; update(messageFor('CANCELLED')); },
        addWord: async word => { const result = await rpc('add-word', {word}); if (!result.ok) view?.status(messageFor(result.code)); },
        pause: async () => { const result = await rpc('pause'); if (!result.ok) view?.status(messageFor(result.code)); },
        settings: async () => { const result = await rpc('open-settings'); if (!result.ok) view?.status(messageFor(result.code)); }});
      update('Lineleaf checks this paragraph after you pause typing. Alt Shift L opens controls.');
    }
    queue();
  }
  const keyFor = value => `${value.offset}:${value.text}`;
  function queue(delay = AUTO_IDLE) {
    clearTimeout(timer); if (!dirty || !permitted() || !navigator.onLine || !active() || composing || blocked || !eligibleDOM()) return;
    timer = setTimeout(() => { timer = null; void run(true); }, Math.max(delay, nextAt - Date.now()));
  }
  async function run(automatic) {
    if (!field || port || composing || applying || !eligibleDOM() || document.visibilityState !== 'visible') return;
    if (automatic && (!permitted() || !active() || blocked)) return;
    if (!navigator.onLine) { blocked = true; update(messageFor('OFFLINE')); return; }
    // Explicit Check now restores the field focus before capturing its current paragraph.
    if (!automatic) { field.focus({preventScroll: true}); blocked = false; }
    let next;
    try { next = captureParagraph(field, adapter); }
    catch { capture = null; edits = []; update('Automatic checking needs a supported paragraph of 1–2,000 characters. Select text for a manual check.'); return; }
    if (automatic && (!dirty || keyFor(next) !== pendingKey || keyFor(next) === lastKey)) return;
    const ticket = ++generation, selectedField = field, state = await rpc('site-state');
    if (ticket !== generation || selectedField !== field || !eligibleDOM() || !next.adapter.current(next.snapshot)) return;
    if (!state.ok || (automatic && !state.value.automatic)) { blocked = true; update(messageFor(state.code ?? 'AUTOMATIC_DISABLED')); return; }
    policy = state.value; capture = next; edits = []; undo = false; copyOnly = false; lastKey = keyFor(next);
    clearTimeout(expiry); expiry = setTimeout(drop, 5 * 60 * 1000);
    if (automatic) nextAt = Date.now() + AUTO_INTERVAL;
    update('Checking with Codex… You can keep typing.');
    const id = crypto.randomUUID();
    try {
      const current = api.runtime.connect({name: 'lineleaf-writing-v1'}); port = current;
      const finish = () => { clearTimeout(watchdog); if (port === current) port = null; try { current.disconnect(); } catch { /* document gone */ } };
      current.onDisconnect.addListener(() => { void api.runtime.lastError; if (port === current) { port = null; blocked = true; clearTimeout(watchdog); update(messageFor('UNAVAILABLE')); } });
      current.onMessage.addListener(message => {
        if (port !== current || message.id !== id || ticket !== generation) return;
        if (!eligibleDOM() || !capture?.adapter.current(capture.snapshot)) { stop(); capture = null; edits = []; queue(); update(messageFor('STALE')); return; }
        if (message.type === 'result') {
          finish(); if (!Array.isArray(message.edits)) { blocked = true; update(messageFor('INVALID_OUTPUT')); return; }
          edits = message.edits; update(edits.length ? `${edits.length} suggestion${edits.length === 1 ? '' : 's'}. Review before accepting.` : 'No corrections suggested.');
          clearTimeout(expiry); expiry = setTimeout(drop, 5 * 60 * 1000);
        } else if (message.type === 'error') {
          finish(); const retryable = ['AUTO_WAIT', 'BUSY', 'QUEUE_FULL', 'PROVIDER_RATE_LIMITED'].includes(message.code);
          if (retryable && automatic) { lastKey = null; nextAt = Date.now() + Math.max(1000, Math.min(60000, message.retryAfterMs || (message.code === 'PROVIDER_RATE_LIMITED' ? 60000 : 5000))); queue(nextAt - Date.now()); }
          else blocked = message.code !== 'CANCELLED';
          update(messageFor(message.code));
        }
      });
      watchdog = setTimeout(() => { stop(); blocked = true; update(messageFor('PROVIDER_TIMEOUT')); }, 65000);
      current.postMessage({type: 'start', id, text: capture.text, mode: 'proofread', kind: automatic ? 'automatic' : 'manual'});
    } catch { stop(); blocked = true; update(messageFor('UNAVAILABLE')); }
  }
  function accept(edit) {
    if (!capture || !eligibleDOM()) return;
    stop(); applying = true;
    let result;
    try { result = capture.adapter.apply(capture.snapshot, {...edit, start: capture.offset + edit.start, end: capture.offset + edit.end}); }
    finally { applying = false; }
    undo = result?.status === 'applied'; edits = undo ? [] : [edit]; copyOnly = !undo;
    update(undo ? 'Applied. You can undo this edit before other typing.' : result?.restored ? `Original text restored. Use Copy.${result.stateUncertain ? ' Site state could not be verified.' : ''}` : 'Safe replacement is unavailable. Use the manual panel to preview and copy.');
    if (!undo) { blocked = true; view.open(); return; }
    capture = null; view.capture = null;
    try { pendingKey = keyFor(captureParagraph(field, adapter)); } catch { pendingKey = null; }
    queue(); view.open();
  }
  function undoEdit() {
    applying = true; let result;
    try { result = adapter?.undo(); } finally { applying = false; }
    undo = false; edits = []; capture = null; lastKey = null;
    update(result?.status === 'undone' ? 'Undone. Your original text is restored.' : result?.restored ? 'Original text restored. Further edits use Copy.' : 'Undo unavailable after other edits. Use the editor’s undo control.');
  }
  const changed = event => {
    if (applying || !field || !(event.target === field || field.contains(event.target))) return;
    stop(); capture = null; edits = []; undo = false; copyOnly = false; dirty = event.isTrusted === true;
    try { pendingKey = dirty ? keyFor(captureParagraph(field, adapter)) : null; } catch { pendingKey = null; }
    update('Text changed. Checking after a pause.'); queue();
  };
  document.addEventListener('focusin', event => { if (event.target !== view?.host) choose(event.target); }, true);
  document.addEventListener('input', event => { if (!field) choose(event.target); changed(event); }, true);
  document.addEventListener('compositionstart', event => { compositions.add(editorOf(event.target) ?? event.target); if (field && (event.target === field || field.contains(event.target))) { composing = true; changed(event); } }, true);
  document.addEventListener('compositionend', event => { compositions.delete(editorOf(event.target) ?? event.target); if (field && (event.target === field || field.contains(event.target))) { composing = false; changed(event); } }, true);
  document.addEventListener('keydown', trusted(event => {
    if (event.altKey && event.shiftKey && event.code === 'KeyL' && view) { event.preventDefault(); view.open(); }
  }), true);
  const paint = () => { if (!frame) frame = requestAnimationFrame(() => { frame = null; view?.draw(); }); };
  document.addEventListener('scroll', paint, {capture: true, passive: true}); window.addEventListener('resize', paint);
  const poll = setInterval(() => {
    if (!field || applying) return;
    if (!permitted() || !eligibleDOM() || !view?.host.isConnected) { drop(); return; }
    if (capture && !adapter.current(capture.snapshot)) { changed({target: field}); }
    const r = field.getBoundingClientRect(), position = [r.x, r.y, r.width, r.height, field.scrollTop, field.scrollLeft].join(':');
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
