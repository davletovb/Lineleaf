import {captureSelection} from './lib/selection.mjs';
import {validSpan} from '../prototypes/editor/editor-adapter.mjs';
import {messageFor} from './lib/messages.mjs';
import {errorCode} from './lib/policy.mjs';
import styles from './panel.css';

export function mountContent(api) {
  let focused = document.activeElement, host, root, capture = null, port = null, requestId, edits = [], stale = false;
  let expiry, watchdog, poll, starting = false;
  const composing = new Set();
  const focus = event => { if (event.target !== host) focused = event.target; };
  document.addEventListener('focusin', focus, true);
  const query = selector => root.querySelector(selector);
  const status = text => { query('#status').textContent = text; };
  function stop() {
    starting = false;
    clearTimeout(watchdog); if (port) { const old = port; port = null; try { old.postMessage({type: 'cancel'}); old.disconnect(); } catch { /* worker restarted */ } }
    if (root) { query('#cancel').hidden = true; query('#check').disabled = !capture; }
  }
  function clear() { stop(); capture?.adapter?.dispose(); capture = null; edits = []; clearTimeout(expiry); clearInterval(poll); }
  function close() { clear(); host?.remove(); host = root = null; }
  function markStale() {
    if (stale || !capture) return; stale = true; stop();
    status(messageFor('STALE')); render();
  }
  function expire() { clear(); query('#selected').textContent = ''; query('#results').replaceChildren(); query('#undo').hidden = true; status('Selection expired. Select text and reopen Lineleaf.'); }
  function render() {
    const results = query('#results'); results.replaceChildren();
    for (const edit of edits) {
      const card = document.createElement('section'); card.className = 'card';
      const category = document.createElement('div'); category.className = 'category'; category.textContent = edit.category === 'style' ? 'Optional style' : edit.category;
      const change = document.createElement('div'); change.className = 'change';
      const before = document.createElement('span'); before.className = 'before'; before.textContent = edit.before;
      const after = document.createElement('span'); after.className = 'after'; after.textContent = edit.after || '(remove)';
      change.append(before, document.createTextNode(' → '), after);
      const explanation = document.createElement('p'); explanation.className = 'explanation'; explanation.textContent = edit.explanation;
      const controls = document.createElement('div'); controls.className = 'row';
      const fullEdit = {...edit, start: edit.start + (capture?.offset ?? 0), end: edit.end + (capture?.offset ?? 0)};
      const canApply = !stale && capture?.adapter?.current(capture.snapshot) && validSpan(capture.snapshot.source, fullEdit);
      const accept = document.createElement('button'); accept.textContent = 'Accept'; accept.className = 'primary'; accept.disabled = !canApply;
      accept.addEventListener('click', event => {
        if (!event.isTrusted || !capture) return;
        const result = capture.adapter?.apply(capture.snapshot, fullEdit);
        if (result?.status === 'applied') {
          stop(); edits = []; stale = true; query('#results').replaceChildren();
          query('#selected').textContent = ''; query('#check').disabled = true;
          query('#undo').hidden = false; status('Applied. You can undo this edit. Select text and reopen Lineleaf for another check.');
        } else { stale = true; status('Safe replacement is unavailable. Copy the suggestion below.'); render(); }
      });
      const dismiss = document.createElement('button'); dismiss.textContent = 'Dismiss';
      dismiss.addEventListener('click', event => { if (!event.isTrusted) return; edits = edits.filter(x => x !== edit); render(); if (!edits.length) status('Suggestions dismissed. Your text is unchanged.'); });
      const copy = document.createElement('button'); copy.textContent = 'Copy';
      const manual = document.createElement('textarea'); manual.readOnly = true; manual.hidden = true; manual.setAttribute('aria-label', 'Suggestion to copy');
      copy.addEventListener('click', async event => {
        if (!event.isTrusted) return;
        try { await navigator.clipboard.writeText(edit.after); status('Suggestion copied.'); }
        catch { manual.value = edit.after; manual.hidden = false; manual.focus(); manual.select(); status('Copy the selected suggestion with your keyboard.'); }
      });
      controls.append(accept, dismiss, copy); card.append(category, change, explanation, controls, manual);
      if (!canApply) { const fallback = document.createElement('p'); fallback.className = 'muted'; fallback.textContent = 'Preview and copy only for this selection.'; card.append(fallback); }
      results.append(card);
    }
  }
  function create() {
    host = document.createElement('div'); host.dataset.lineleafRoot = ''; root = host.attachShadow({mode: 'open'});
    const sheet = new CSSStyleSheet(); sheet.replaceSync(styles); root.adoptedStyleSheets = [sheet];
    const node = (tag, text = '', attrs = {}, children = []) => {
      const element = document.createElement(tag); element.textContent = text;
      for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
      element.append(...children); return element;
    };
    root.append(node('aside', '', {class: 'panel', 'aria-label': 'Lineleaf writing assistant'}, [
      node('header', '', {}, [node('h2', 'Lineleaf ❧'), node('button', '✕', {class: 'quiet', id: 'close', 'aria-label': 'Close Lineleaf'})]),
      node('p', 'Clearer writing. Still your words.', {class: 'tagline'}), node('label', 'Your selection'), node('blockquote', '', {id: 'selected'}),
      node('p', 'Only this selection goes through Seatline to Codex when you press Check. Drafts are not saved.', {class: 'muted'}),
      node('label', 'What would you like to do?', {for: 'mode'}),
      node('select', '', {id: 'mode'}, [['proofread', 'Proofread · keep my voice'], ['clearer', 'Rewrite · clearer'], ['shorter', 'Rewrite · shorter'],
        ['formal', 'Rewrite · more formal'], ['friendly', 'Rewrite · friendlier']].map(([value, label]) => node('option', label, {value}))),
      node('div', '', {class: 'row'}, [node('button', 'Check selection', {id: 'check', class: 'primary'}), node('button', 'Cancel', {id: 'cancel', hidden: ''}), node('button', 'Undo last edit', {id: 'undo', hidden: ''})]),
      node('p', '', {id: 'status', role: 'status', 'aria-live': 'polite'}), node('div', '', {id: 'results'})
    ]));
    document.documentElement.append(host);
    query('#close').addEventListener('click', event => { if (event.isTrusted) close(); });
    query('#cancel').addEventListener('click', event => { if (event.isTrusted) { stop(); status(messageFor('CANCELLED')); } });
    query('#undo').addEventListener('click', event => {
      if (!event.isTrusted) return; const result = capture?.adapter?.undo(); query('#undo').hidden = true;
      status(result?.status === 'undone' ? 'Undone. Your original text is restored.' : 'Undo is unavailable after other edits. Use the editor’s own undo control.');
    });
    query('#check').addEventListener('click', event => { if (event.isTrusted) void run(); });
    root.addEventListener('keydown', event => { if (event.key === 'Escape' && event.isTrusted) close(); });
  }
  async function enabled() {
    try { return (await api.runtime.sendMessage({type: 'site-state', payload: null})).ok; } catch { return false; }
  }
  async function open() {
    // Capture while the original field still holds its selection, before focusing panel controls.
    let next, failure;
    try {
      if (composing.size) throw new Error();
      next = captureSelection(focused);
    } catch (error) { failure = errorCode(error) === 'UNAVAILABLE' ? 'INVALID_REQUEST' : errorCode(error); }
    clear(); if (!host?.isConnected) create(); stale = false; capture = next ?? null;
    query('#undo').hidden = true; query('#results').replaceChildren(); query('#selected').textContent = capture?.text ?? '';
    query('#check').disabled = !capture; status(failure ? messageFor(failure) : capture?.adapter ? 'Ready to check your selection.' : 'This surface offers preview and copy only.');
    expiry = setTimeout(expire, 5 * 60 * 1000);
    poll = setInterval(() => {
      if (!host?.isConnected) { close(); return; }
      if (!stale && capture?.adapter && !capture.adapter.current(capture.snapshot)) markStale();
    }, 500);
    if (!await enabled()) { stop(); status(messageFor('SITE_DISABLED')); query('#check').disabled = true; }
    query('#mode').focus();
  }
  async function run() {
    if (!capture || port || starting) return;
    if (stale || (capture.adapter && !capture.adapter.current(capture.snapshot))) { markStale(); return; }
    starting = true; query('#check').disabled = true;
    const selected = capture;
    if (!await enabled()) { starting = false; status(messageFor('SITE_DISABLED')); return; }
    if (!starting || capture !== selected || stale || !root) return;
    edits = []; render(); query('#check').disabled = true; query('#cancel').hidden = false;
    const id = crypto.randomUUID(); requestId = id;
    try {
      const current = api.runtime.connect({name: 'lineleaf-writing-v1'}); port = current;
      current.onDisconnect.addListener(() => { void api.runtime.lastError; if (port === current) { stop(); status(messageFor('UNAVAILABLE')); } });
      current.onMessage.addListener(message => {
        if (port !== current || message.id !== requestId) return;
        if (message.type === 'progress') status(message.stage === 'connecting' ? 'Connecting to Seatline…' : 'Checking with Codex… You can keep typing.');
        else if (message.type === 'error') { stop(); status(messageFor(message.code)); }
        else if (message.type === 'result') {
          stop();
          if (capture?.adapter && !capture.adapter.current(capture.snapshot)) { markStale(); return; }
          if (!Array.isArray(message.edits)) { status(messageFor('INVALID_OUTPUT')); return; }
          edits = message.edits; render(); status(edits.length ? 'Review each suggestion before accepting.' : 'No corrections suggested.');
        }
      });
      watchdog = setTimeout(() => { stop(); status(messageFor('PROVIDER_TIMEOUT')); }, 65000);
      current.postMessage({type: 'start', id, text: capture.text, mode: query('#mode').value});
    } catch { stop(); status(messageFor('UNAVAILABLE')); }
  }
  const input = event => { if (capture?.field && (event.target === capture.field || capture.field.contains(event.target))) markStale(); };
  document.addEventListener('input', input, true);
  document.addEventListener('compositionstart', event => { composing.add(event.target); input(event); }, true);
  document.addEventListener('compositionend', event => { composing.delete(event.target); }, true);
  document.addEventListener('mouseup', event => { if (event.target !== host && !host?.contains(event.target)) focused = event.target; }, true);
  api.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== api.runtime.id) return;
    if (message.type === 'lineleaf-open') void open();
    if (message.type === 'lineleaf-policy-changed') { clear(); if (root) { query('#selected').textContent = ''; query('#results').replaceChildren(); query('#undo').hidden = true; status('Settings changed. Reopen Lineleaf to check a new selection.'); } }
  });
  window.addEventListener('pagehide', close);
  return {open, close};
}
if (typeof chrome !== 'undefined' && chrome.runtime?.id && !globalThis.__lineleafMounted) {
  globalThis.__lineleafMounted = true; mountContent(chrome);
}
