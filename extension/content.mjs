import {deepActive, eventElement, navigationToken, observeNavigation} from './lib/editor-context.mjs';
import {captureSelection, editorOf} from './lib/selection.mjs';
import {validSpan} from '../prototypes/editor/editor-adapter.mjs';
import {messageFor} from './lib/messages.mjs';
import {errorCode, validText, FLAG_LABELS, WATCHDOG} from './lib/policy.mjs';
import tokens from './tokens.css';
import base from './base.css';
import styles from './panel.css';
import {mountInline} from './lib/inline.mjs';
import {icon, iconLabel} from './lib/icons.mjs';
import {categoryLabel, dictionaryWord} from './lib/policy.mjs';

// A button label with an icon in front; the visible text stays the button's name.
const withIcon = (button, glyph, label, iconOnly = false) => { button.replaceChildren(...iconLabel(glyph, label, {iconOnly})); return button; };

export function mountContent(api) {
  mountInline(api);
  let focused = deepActive(), host, root, capture = null, port = null, requestId, edits = [], stale = false;
  let expiry, watchdog, poll, starting = false;
  const composing = new Set();
  const focus = event => { const target = eventElement(event); if (target !== host && !target?.hasAttribute?.('data-lineleaf-inline')) focused = target; };
  document.addEventListener('focusin', focus, true);
  const query = selector => root.querySelector(selector);
  const status = text => { query('#status').textContent = text; };
  function stop() {
    starting = false;
    clearTimeout(watchdog); if (port) { const old = port; port = null; try { old.postMessage({type: 'cancel'}); old.disconnect(); } catch { /* worker restarted */ } }
    if (root) { query('#cancel').hidden = true; query('#check').disabled = !capture; }
  }
  function clear() { stop(); capture?.guard?.dispose(); capture = null; edits = []; clearTimeout(expiry); clearInterval(poll); }
  function close() { clear(); host?.remove(); host = root = null; }
  function markStale() {
    if (stale || !capture) return; stale = true; stop();
    query('#check').disabled = true; status(messageFor('STALE')); render();
  }
  function expire() { clear(); query('#pasted').value = ''; query('#selected').textContent = ''; query('#results').replaceChildren(); query('#undo').hidden = true; status('Selection expired. Select text and reopen Lineleaf.'); }
  function render() {
    const results = query('#results'); results.replaceChildren();
    for (const edit of edits) {
      const card = document.createElement('section'); card.className = 'card';
      const category = document.createElement('p'); category.className = 'category'; category.dataset.category = edit.category; category.textContent = categoryLabel(edit.category);
      const change = document.createElement('div'); change.className = 'change';
      const before = document.createElement('span'); before.className = 'before'; before.textContent = edit.before;
      const after = document.createElement('span'); after.className = 'after'; after.textContent = edit.after || '(remove)';
      const arrow = document.createElement('span'); arrow.className = 'arrow'; arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = ' → ';
      change.append(before, arrow, after);
      const explanation = document.createElement('details'), summary = document.createElement('summary'), reason = document.createElement('p');
      summary.textContent = 'Why this suggestion?'; reason.className = 'explanation'; reason.textContent = edit.explanation; explanation.append(summary, reason);
      const controls = document.createElement('div'); controls.className = 'row';
      const flags = document.createElement('p'); flags.className = 'explanation note warn'; flags.hidden = !edit.flags?.length;
      flags.textContent = edit.flags?.length ? `Check this version: it changes ${edit.flags.map(flag => FLAG_LABELS[flag]).join(', ')}.` : '';
      const fullEdit = {...edit, start: edit.start + (capture?.offset ?? 0), end: edit.end + (capture?.offset ?? 0)};
      const canApply = !stale && capture?.adapter?.current(capture.snapshot) && validSpan(capture.snapshot.source, fullEdit);
      const accept = withIcon(document.createElement('button'), 'check', 'Accept'); accept.className = 'primary'; accept.disabled = !canApply;
      accept.addEventListener('click', event => {
        if (!event.isTrusted || !capture) return;
        const selected = capture, openedRoot = root;
        const result = capture.adapter?.apply(capture.snapshot, fullEdit);
        if (root !== openedRoot || capture !== selected) return;
        if (result?.status === 'applied') {
          stop(); edits = []; stale = true; query('#results').replaceChildren();
          query('#selected').textContent = ''; query('#check').disabled = true;
          query('#undo').hidden = false; status('Applied. You can undo this edit. Select text and reopen Lineleaf for another check.');
        } else {
          stale = true;
          status(result?.contextChanged ? 'The editor changed context during this edit. Review its draft and use its own undo; safe restoration is unavailable.' : result?.restored ? `Original text restored. This editor rejected the change; use Copy.${result.stateUncertain ? ' Its internal state could not be verified.' : ''}`
            : 'Safe replacement is unavailable. Copy the suggestion below.');
          render();
        }
      });
      const dismiss = document.createElement('button'); dismiss.textContent = 'Dismiss';
      dismiss.addEventListener('click', event => { if (!event.isTrusted) return; edits = edits.filter(x => x !== edit); render(); if (!edits.length) status('Suggestions dismissed. Your text is unchanged.'); });
      const copy = withIcon(document.createElement('button'), 'copy', 'Copy'); copy.className = 'quiet';
      const manual = document.createElement('textarea'); manual.readOnly = true; manual.hidden = true; manual.setAttribute('aria-label', 'Suggestion to copy');
      copy.addEventListener('click', async event => {
        if (!event.isTrusted) return;
        try { await navigator.clipboard.writeText(edit.after); status('Suggestion copied.'); }
        catch { manual.value = edit.after; manual.hidden = false; manual.focus(); manual.select(); status('Copy the selected suggestion with your keyboard.'); }
      });
      controls.append(accept, dismiss, copy); card.append(category, change, flags, explanation, controls, manual);
      if (edit.category === 'spelling' && dictionaryWord(edit.before)) {
        const add = withIcon(document.createElement('button'), 'plus', 'Add to dictionary'); add.className = 'quiet';
        add.addEventListener('click', async event => {
          if (!event.isTrusted) return;
          try { const result = await api.runtime.sendMessage({type: 'add-word', payload: {word: edit.before}}); if (root) status(result.ok ? 'Word added. Reopen Lineleaf for a new check.' : messageFor(result.code)); }
          catch { if (root) status(messageFor('UNAVAILABLE')); }
        }); controls.append(add);
      }
      if (!canApply) { const fallback = document.createElement('p'); fallback.className = 'note'; fallback.textContent = 'Preview and copy only for this selection.'; card.append(fallback); }
      results.append(card);
    }
  }
  function create() {
    host = document.createElement('div'); host.dataset.lineleafRoot = ''; root = host.attachShadow({mode: 'closed'});
    const sheet = new CSSStyleSheet(); sheet.replaceSync(tokens + base + styles); root.adoptedStyleSheets = [sheet];
    const node = (tag, text = '', attrs = {}, children = []) => {
      const element = document.createElement(tag); element.textContent = text;
      for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
      element.append(...children); return element;
    };
    const logo = node('span', '', {class: 'logo', 'aria-hidden': 'true'}); logo.append(icon('leaf', {size: 18}));
    const closeButton = node('button', '', {class: 'icon quiet', id: 'close', 'aria-label': 'Close Lineleaf'}); withIcon(closeButton, 'close', '✕', true);
    root.append(node('aside', '', {class: 'panel', 'aria-label': 'Lineleaf writing assistant'}, [
      node('header', '', {}, [logo, node('div', '', {class: 'titles'}, [node('h2', 'Lineleaf'), node('p', 'Clearer writing. Still your words.', {class: 'tagline'})]), closeButton]),
      node('div', '', {class: 'scroll'}, [
        node('label', 'Your selection'), node('blockquote', '', {id: 'selected'}),
        node('p', 'Only this selection goes through Seatline to your selected provider when you press Check. Drafts are not saved.', {class: 'muted'}),
        node('section', '', {id: 'paste-section'}, [node('label', 'Or paste text for preview and copy', {for: 'pasted'}),
          node('textarea', '', {id: 'pasted', maxlength: '2000', 'aria-label': 'Text to check without editing the page'}),
          node('button', 'Use pasted text', {id: 'use-pasted'}), node('p', 'For editors that cannot expose a safe selection, copy text yourself and paste it here. Lineleaf will only offer a preview and Copy.', {class: 'muted'})]),
        node('label', 'What would you like to do?', {for: 'mode'}),
        node('select', '', {id: 'mode'}, [['proofread', 'Proofread · keep my voice'], ['improve', 'Rewrite · improve it'], ['paraphrase', 'Rewrite · paraphrase'], ['clearer', 'Rewrite · clearer'], ['shorter', 'Rewrite · shorter'],
          ['formal', 'Rewrite · more formal'], ['friendly', 'Rewrite · friendlier']].map(([value, label]) => node('option', label, {value}))),
        node('div', '', {class: 'row'}, [node('button', 'Check selection', {id: 'check', class: 'primary'}), node('button', 'Cancel', {id: 'cancel', hidden: ''}), node('button', 'Undo last edit', {id: 'undo', hidden: ''}), node('button', 'Pause Lineleaf', {id: 'pause', class: 'quiet'})]),
        node('p', '', {id: 'status', role: 'status', 'aria-live': 'polite'}), node('div', '', {id: 'results'})
      ])
    ]));
    document.documentElement.append(host);
    query('#close').addEventListener('click', event => { if (event.isTrusted) close(); });
    query('#cancel').addEventListener('click', event => { if (event.isTrusted) { stop(); status(messageFor('CANCELLED')); } });
    query('#undo').addEventListener('click', event => {
      if (!event.isTrusted) return; const selected = capture, openedRoot = root, result = capture?.adapter?.undo();
      if (root !== openedRoot || capture !== selected) return;
      query('#undo').hidden = true;
      status(result?.contextChanged ? 'The editor changed context during undo. Review its draft; safe restoration is unavailable.' : result?.status === 'undone' ? 'Undone. Your original text is restored.' : result?.restored
        ? 'Original text restored. This editor could not confirm native undo; further edits use copy only.'
        : 'Undo is unavailable after other edits. Use the editor’s own undo control.');
    });
    query('#check').addEventListener('click', event => { if (event.isTrusted) void run(); });
    query('#pasted').addEventListener('input', markStale);
    query('#use-pasted').addEventListener('click', event => {
      if (!event.isTrusted) return;
      const text = query('#pasted').value;
      if (!validText(text)) { status('Paste 1–2,000 characters of text to check.'); return; }
      clear(); stale = false;
      const route = navigationToken(), paste = query('#pasted');
      capture = {text, adapter: null, snapshot: null, offset: 0, field: null,
        valid: () => host?.isConnected && paste.value === text && navigationToken() === route};
      query('#selected').textContent = text; query('#results').replaceChildren(); query('#undo').hidden = true;
      query('#check').disabled = false; status('Ready to check pasted text. Suggestions offer preview and copy only.');
      expiry = setTimeout(expire, 5 * 60 * 1000);
    });
    query('#pause').addEventListener('click', async event => {
      if (!event.isTrusted) return;
      try { const result = await api.runtime.sendMessage({type: 'pause', payload: null}); if (root) { clear(); query('#pasted').value = ''; query('#selected').textContent = ''; query('#results').replaceChildren(); query('#undo').hidden = true; status(messageFor(result.ok ? 'PAUSED' : result.code)); } }
      catch { if (root) status(messageFor('UNAVAILABLE')); }
    });
    root.addEventListener('keydown', event => { if (event.key === 'Escape' && event.isTrusted) close(); });
  }
  async function siteState() {
    try { return await api.runtime.sendMessage({type: 'site-state', payload: null}); }
    catch { return {ok: false, code: 'UNAVAILABLE'}; }
  }
  async function open() {
    // Capture while the original field still holds its selection, before focusing panel controls.
    let next, failure;
    try {
      if (composing.size) throw new Error();
      next = captureSelection(editorOf(deepActive()) ? deepActive() : focused);
    } catch (error) { failure = errorCode(error) === 'UNAVAILABLE' ? 'INVALID_REQUEST' : errorCode(error); }
    clear(); if (!host?.isConnected) create(); stale = false; capture = next ?? null;
    query('#undo').hidden = true; query('#results').replaceChildren(); query('#selected').textContent = capture?.text ?? '';
    query('#pasted').value = ''; query('#paste-section').hidden = Boolean(capture?.adapter);
    query('#check').disabled = !capture; status(failure ? messageFor(failure) : capture?.adapter ? 'Ready to check your selection.' : 'This surface offers preview and copy only.');
    expiry = setTimeout(expire, 5 * 60 * 1000);
    poll = setInterval(() => {
      navigated(); if (!host?.isConnected) { close(); return; }
      if (!stale && capture && !capture.valid()) markStale();
    }, 500);
    const openedRoot = root, selected = capture, state = await siteState();
    if (root !== openedRoot || capture !== selected) return;
    if (!state?.ok) { stop(); status(messageFor(state?.code ?? 'SITE_DISABLED')); query('#check').disabled = true; }
    else try { void Promise.resolve(api.runtime.sendMessage({type: 'prepare', payload: null})).catch(() => {}); } catch { /* worker restarted */ } // The user is about to check: get the provider ready. No text goes with it.
    query('#mode').focus();
  }
  async function run() {
    if (!capture || port || starting) return;
    if (stale || !capture.valid()) { markStale(); return; }
    starting = true; query('#check').disabled = true;
    const selected = capture;
    const state = await siteState();
    if (!starting || capture !== selected || stale || !root) return;
    if (!state?.ok) { starting = false; status(messageFor(state?.code ?? 'SITE_DISABLED')); return; }
    edits = []; render(); query('#check').disabled = true; query('#cancel').hidden = false;
    const id = crypto.randomUUID(); requestId = id;
    try {
      const current = api.runtime.connect({name: 'lineleaf-writing-v1'}); port = current;
      current.onDisconnect.addListener(() => { void api.runtime.lastError; if (port === current) { stop(); status(messageFor('UNAVAILABLE')); } });
      current.onMessage.addListener(message => {
        if (port !== current || message.id !== requestId) return;
        if (message.type === 'progress') status(message.stage === 'connecting' ? 'Connecting to Seatline…' : 'Checking your text… You can keep typing.');
        else if (message.type === 'error') { stop(); status(messageFor(message.code)); }
        else if (message.type === 'result') {
          stop();
          if (capture && !capture.valid()) { markStale(); return; }
          if (!Array.isArray(message.edits)) { status(messageFor('INVALID_OUTPUT')); return; }
          edits = message.edits; render(); status(edits.length ? 'Review each suggestion before accepting.' : query('#mode').value === 'proofread' ? 'No corrections suggested.' : 'No change suggested. This already reads well.');
        }
      });
      watchdog = setTimeout(() => { stop(); status(messageFor('PROVIDER_TIMEOUT')); }, WATCHDOG.manual); // The panel only makes explicit requests.
      current.postMessage({type: 'start', id, text: capture.text, mode: query('#mode').value});
    } catch { stop(); status(messageFor('UNAVAILABLE')); }
  }
  const input = event => { const target = eventElement(event); if (capture?.field && (target === capture.field || capture.field.contains(target))) markStale(); };
  document.addEventListener('input', input, true);
  document.addEventListener('compositionstart', event => { composing.add(eventElement(event)); input(event); }, true);
  document.addEventListener('compositionend', event => { composing.delete(eventElement(event)); }, true);
  document.addEventListener('mouseup', event => {
    const target = eventElement(event); if (target !== host && !target?.hasAttribute?.('data-lineleaf-inline')) focused = editorOf(deepActive()) ? deepActive() : target;
  }, true);
  api.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== api.runtime.id) return;
    if (message.type === 'lineleaf-open') void open();
    if (message.type === 'lineleaf-policy-changed') { clear(); if (root) { query('#pasted').value = ''; query('#selected').textContent = ''; query('#results').replaceChildren(); query('#undo').hidden = true; status('Settings changed. Reopen Lineleaf to check a new selection.'); } }
  });
  let route = navigationToken();
  const navigated = () => { const next = navigationToken(); if (next !== route) { route = next; focused = null; close(); } };
  observeNavigation(navigated);
  window.addEventListener('pagehide', close);
  return {open, close};
}
if (typeof chrome !== 'undefined' && chrome.runtime?.id && !globalThis.__lineleafMounted) {
  globalThis.__lineleafMounted = true; mountContent(chrome);
}
