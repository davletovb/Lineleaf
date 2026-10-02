import assert from 'node:assert/strict';
import {test, before, after} from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {panelFor} from './fixtures/panel-driver.mjs';
// Copy-only inline preview for rich editors. Fixtures mirror the rendered DOM of Draft.js (X/Twitter), Lexical, Slate,
// ProseMirror, Quill and Gmail-style composers; none of those libraries is loaded.
let browser, page, inline;
before(async () => {
  browser = await chromium.launch({executablePath: process.env.LINELEAF_CHROMIUM_PATH || undefined,
    args: process.env.LINELEAF_CHROMIUM_SINGLE_PROCESS === '1' ? ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--single-process'] : []});
  page = await browser.newPage(); inline = panelFor(page, {attribute: 'data-lineleaf-inline'});
  await page.route('**/*', async route => {
    const path = new URL(route.request().url()).pathname;
    const files = new Map([['/content.js', '../dist/lineleaf/content.js'], ['/controller-bridge.mjs', './fixtures/controller-bridge.mjs'], ['/test-api.mjs', './fixtures/extension-api.mjs']]);
    const file = files.get(path) ?? (['controller.mjs', 'native-seatline.mjs', 'policy.mjs', 'candidates.mjs', 'editor-policy.mjs'].some(x => path === `/lib/${x}`) ? `../dist/lineleaf${path}` : './fixtures/rich.html');
    let body = await readFile(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    if (file.endsWith('.html')) body = body.replace('<script src="/content.js"></script>', '<script type="module" src="/controller-bridge.mjs"></script>');
    await route.fulfill({body, contentType: /\.m?js$/.test(file) ? 'text/javascript' : 'text/html'});
  });
});
after(async () => { await browser?.close(); });
const URL_AUTOMATIC = 'https://rich.lineleaf.test/compose?automatic';
async function load(url = URL_AUTOMATIC) { await page.goto(url); await page.waitForFunction(() => window.__lineleafMounted); }
const sends = () => page.evaluate(() => fixture.worker.calls.filter(x => x.method === 'send'));
const requestTexts = async () => (await sends()).map(x => JSON.parse(x.params.messages[0].text).text);
const idle = () => page.waitForTimeout(1900);
// Put the caret right after `needle` inside the editor, as a user clicking there would.
async function caretAfter(host, needle) {
  await page.evaluate(([host, needle]) => {
    const root = document.querySelector(host), walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let found;
    for (let n; (n = walker.nextNode());) if (n.data.includes(needle)) { found = n; break; }
    const editor = root.closest('[contenteditable]') ?? root; editor.focus();
    if ('value' in editor) { const at = editor.value.indexOf(needle) + needle.length; editor.setSelectionRange(at, at); return; }
    const range = document.createRange(); range.setStart(found, found.data.indexOf(needle) + needle.length); range.collapse(true);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  }, [host, needle]);
}
async function typeAfter(host, needle, text = ' ') { await caretAfter(host, needle); await page.keyboard.type(text); }
async function checked(host, needle) {
  await typeAfter(host, needle);
  await page.waitForFunction(() => fixture.worker.calls.some(x => x.method === 'send'), null, {timeout: 8000});
  await inline.locator('.underline').waitFor();
}
// Viewport box of `word` inside the text node that contains `context`.
const wordBox = (host, context, word) => page.evaluate(([host, context, word]) => {
  const walker = document.createTreeWalker(document.querySelector(host), NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    const at = n.data.indexOf(context); if (at < 0) continue;
    const start = at + context.indexOf(word), range = document.createRange(); range.setStart(n, start); range.setEnd(n, start + word.length);
    const r = range.getBoundingClientRect(); return {left: r.left, right: r.right};
  }
  return null;
}, [host, context, word]);
const underlines = () => inline.locator('.underline').evaluate((_, __, all) => all.map(el => { const r = el.getBoundingClientRect(); return {left: r.left, right: r.right, top: r.top}; }));
const close = (a, b, tolerance = 1.5) => Math.abs(a - b) <= tolerance;
// Keyboard activation is immune to the card repositioning itself between measuring and clicking.
async function press(name) { await inline.button(name).evaluate(el => el.focus()); await page.keyboard.press('Enter'); }

const FAMILIES = [
  {name: 'Draft.js (X/Twitter)', host: '#draft', needle: 'work.', context: 'He go to work.', expected: 'He go to work.'},
  {name: 'Lexical', host: '#lexical', needle: 'He go to work.', context: 'He go to work.', expected: 'He go to work.'},
  {name: 'Slate', host: '#slate', needle: 'He go to work.', context: 'He go to work.', expected: 'He go to work.'},
  {name: 'ProseMirror', host: '#prose', needle: 'He go to work.', context: 'He go to work.', expected: 'He go to work.'},
  {name: 'Quill (Slack/LinkedIn)', host: '#quill', needle: 'He go to work.', context: 'He go to work.', expected: 'He go to work.'},
  {name: '<br>-separated lines', host: '#brlines', needle: 'He go to work.', context: 'He go to work.', expected: 'He go to work.'},
  {name: 'raw newlines in pre-wrap text', host: '#prewrap', needle: 'He go to work.', context: 'He go to work.', expected: 'He go to work.'}
];
for (const family of FAMILIES) {
  test(`${family.name}: automatic check sends only the caret paragraph and previews without touching the editor`, async () => {
    await load();
    await page.waitForTimeout(100);
    await checked(family.host, family.needle);
    const texts = await requestTexts();
    assert.equal(texts.length, 1); assert.equal(texts[0].trim(), family.expected);
    for (const other of ['Intro paragraph', 'First line', 'Third line']) assert.equal(texts[0].includes(other), false);
    const word = await wordBox(family.host, family.context, 'go'), [first] = await underlines();
    assert.ok(close(first.left, word.left) && close(first.right, word.right), `underline ${JSON.stringify(first)} vs word ${JSON.stringify(word)}`);
    const before = await page.locator(family.host).innerHTML();
    await page.evaluate(host => { window.__records = []; window.__observer = new MutationObserver(r => window.__records.push(...r));
      window.__observer.observe(document.querySelector(host), {subtree: true, childList: true, characterData: true, attributes: true}); }, family.host);
    await page.keyboard.press('Alt+Shift+l'); await inline.locator('#card-title').waitFor();
    assert.equal(await inline.button('Accept').count(), 0); assert.equal(await inline.button('Undo last edit').count(), 0);
    assert.match(await inline.locator('.note').textContent(), /Copy-only editor/);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await press('Copy'); await inline.locator('#status').waitFor(el => el.textContent === 'Suggestion copied.');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'goes');
    await press('Dismiss'); assert.match(await inline.locator('.badge').evaluate(el => el.getAttribute('aria-label')), /Suggestions dismissed/);
    const focusInEditor = () => page.evaluate(host => { const root = document.querySelector(host); return root === document.activeElement || root.contains(document.activeElement); }, family.host);
    assert.equal(await focusInEditor(), true); // Dismissing the last suggestion returns focus to the editor.
    await page.keyboard.press('Alt+Shift+l'); await inline.locator('#card-title').waitFor(); await page.keyboard.press('Escape');
    assert.equal(await focusInEditor(), true);
    assert.equal(await page.evaluate(() => window.__records.length), 0);
    assert.equal(await page.locator(family.host).innerHTML(), before);
  });
}
test('a state-owning editor that cancels beforeinput and re-renders its text nodes is detected and stays aligned', async () => {
  await load();
  await checked('#controlled-editor', 'work.');
  assert.equal(await page.evaluate(() => window.nativeInputEvents), 0); // The scenario really has no native input event.
  assert.deepEqual((await requestTexts()).map(x => x.trim()), ['He go to work.']);
  const aligned = async () => { const [u] = await underlines(), w = await wordBox('#controlled-editor', 'He go to work.', 'go'); return close(u.left, w.left) && close(u.right, w.right); };
  assert.equal(await aligned(), true);
  // The framework replaces every text node without changing text: the overlay is recomputed from live nodes.
  await page.evaluate(() => { const caret = mini.lines[1].length; mini.render(); mini.place(1, caret); });
  await page.waitForTimeout(600);
  assert.equal(await inline.locator('.underline').count(), 1); assert.equal(await aligned(), true);
  // A change elsewhere does not disturb it; a change to the checked paragraph removes it.
  await page.evaluate(() => { mini.lines[0] = 'Intro changed.'; mini.render(); });
  await page.waitForTimeout(600); assert.equal(await inline.locator('.underline').count(), 1);
  await page.evaluate(() => { mini.lines[1] = 'Replaced by the site.'; mini.render(); });
  await inline.locator('.underline').waitFor((_, __, all) => all.length === 0);
  await page.waitForTimeout(1900); assert.equal((await sends()).length, 1); // A site-driven change is not typing.
});
test('Backspace and Enter in a state-owning editor also arm a check of the paragraph the caret is in', async () => {
  await load();
  await caretAfter('#controlled-editor', 'work.'); await page.keyboard.press('Backspace'); await page.keyboard.type('. ');
  await page.waitForFunction(() => fixture.worker.calls.some(x => x.method === 'send'), null, {timeout: 8000});
  assert.deepEqual((await requestTexts()).map(x => x.trim()), ['He go to work.']);
});
test('focusing text, moving the caret, or leaving the typed paragraph before the pause sends nothing', async () => {
  await load();
  await caretAfter('#draft', 'work.'); await page.keyboard.press('ArrowUp'); await caretAfter('#draft', 'Intro paragraph.'); await idle();
  assert.equal((await sends()).length, 0); assert.equal(await inline.locator('.underline').count().catch(() => 0), 0);
  // Type in the first paragraph, then move into the second before the idle window ends: neither is sent.
  await page.keyboard.type(' '); await page.keyboard.press('ArrowDown'); await idle();
  assert.equal((await sends()).length, 0);
  await caretAfter('#draft', 'work.'); await page.keyboard.type(' ');
  await page.waitForFunction(() => fixture.worker.calls.some(x => x.method === 'send'), null, {timeout: 8000});
  assert.deepEqual((await requestTexts()).map(x => x.trim()), ['He go to work.']);
});
test('only the active <br>-delimited line is sent, and mid-line carets use that line', async () => {
  await load(); await caretAfter('#brlines', 'First'); await page.keyboard.type('x'); await page.waitForFunction(() => fixture.worker.calls.some(x => x.method === 'send'), null, {timeout: 8000});
  assert.deepEqual((await requestTexts()), ['Firstx line.']);
});
test('zero-width placeholders and non-breaking spaces are normalised in the request and underline mapping', async () => {
  await load(); await checked('#nbsp', 'work.');
  const [text] = await requestTexts(); assert.equal(/[ ​﻿]/.test(text), false); assert.equal(text.trim(), 'He go to work.');
  const [u] = await underlines(), w = await wordBox('#nbsp', 'He go to', 'go');
  assert.ok(close(u.left, w.left) && close(u.right, w.right));
});
test('non-editable inline islands keep their visible text and do not break the mapping', async () => {
  await load(); await checked('#island', 'today.');
  const [text] = await requestTexts(); assert.equal(text.trim(), 'He go to work with @maya today.');
  const [u] = await underlines(), w = await wordBox('#island', 'He go to work', 'go');
  assert.ok(close(u.left, w.left) && close(u.right, w.right));
});
test('inline code or pre blocks only withhold their own paragraph, not the whole editor', async () => {
  await load();
  await typeAfter('#mixed', 'now.'); await idle(); assert.equal((await sends()).length, 0); // Caret paragraph contains <code>.
  await typeAfter('#mixed pre', 'pre block.'); await idle(); assert.equal((await sends()).length, 0); // Caret is in <pre>.
  await typeAfter('#mixed p:nth-of-type(2)', 'work.');
  await page.waitForFunction(() => fixture.worker.calls.some(x => x.method === 'send'), null, {timeout: 8000});
  assert.deepEqual((await requestTexts()).map(x => x.trim()), ['He go to work.']);
});
test('formatting boundaries: a Gmail-style composer underlines text spanning bold and plain runs', async () => {
  await load('https://mail.google.com/mail/u/0/?automatic');
  await page.evaluate(() => { fixture.worker.answer = JSON.stringify({corrections: [{before: 'to work', after: 'to the work', left: 'He go ', right: ', and they', category: 'grammar', explanation: 'Missing article'}]}); });
  await checked('#gmail', 'late.');
  const [text] = await requestTexts(); assert.equal(text.trim(), 'He go to work, and they was late.');
  const box = await page.evaluate(() => {
    const bold = document.querySelector('#gmail b').firstChild, after = document.querySelector('#gmail b').nextSibling;
    const range = document.createRange(); range.setStart(bold, 0); range.setEnd(after, ' work'.length);
    const rects = [...range.getClientRects()]; return {left: Math.min(...rects.map(r => r.left)), right: Math.max(...rects.map(r => r.right))};
  });
  const lines = await underlines();
  assert.ok(close(Math.min(...lines.map(l => l.left)), box.left) && close(Math.max(...lines.map(l => l.right)), box.right));
  assert.equal(await inline.button('Accept').count(), 0);
  assert.equal(await page.locator('#gmail').innerHTML(), '<div>Intro paragraph.</div><div><br></div><div>He go <b>to</b> work, and <i>they</i> was late.&nbsp;</div>');
});
test('excluded surfaces never reach the provider even though they are rich editors', async () => {
  for (const id of ['ignored-field', 'hidden-field', 'monaco-field', 'ace-field', 'secret']) {
    await load(); await typeAfter(`#${id}`, 'work.'); await idle();
    assert.equal((await sends()).length, 0, id); assert.equal(await page.locator('[data-lineleaf-inline]').count(), 0, id);
  }
});
test('Google Docs is never checked automatically, even in a plain contenteditable', async () => {
  await load('https://docs.google.com/document/d/synthetic/edit?automatic');
  await typeAfter('#lexical', 'work.'); await typeAfter('#gmail', 'late.'); await idle();
  assert.equal((await sends()).length, 0); assert.equal(await page.locator('[data-lineleaf-inline]').count(), 0);
});
test('automatic checking stays off until the separate opt-in, then applies to rich editors', async () => {
  await load('https://rich.lineleaf.test/compose'); await typeAfter('#draft', 'work.'); await idle();
  assert.equal((await sends()).length, 0); assert.equal(await page.locator('[data-lineleaf-inline]').count(), 0);
});
test('IME composition in a rich editor defers the check until the composition ends', async () => {
  await load(); await caretAfter('#draft', 'work.');
  await page.locator('#draft').evaluate(el => el.dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true})));
  await page.keyboard.type(' '); await idle(); assert.equal((await sends()).length, 0);
  await page.locator('#draft').evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', {bubbles: true})));
  await page.keyboard.type(' '); // The synthetic event cannot authorise a check; final trusted typing restarts the window.
  await page.waitForFunction(() => fixture.worker.calls.some(x => x.method === 'send'), null, {timeout: 8000}); assert.equal((await sends()).length, 1);
});
test('plain text controls keep Accept while rich editors in the same page get copy-only previews', async () => {
  await load();
  await checked('#textarea', 'work.');
  await page.keyboard.press('Alt+Shift+l'); await inline.locator('#card-title').waitFor();
  assert.equal(await inline.button('Accept').count(), 1); await page.keyboard.press('Escape');
  // The shared ten-second automatic interval applies, so use the explicit check for the second editor.
  await caretAfter('#prose', 'work.'); await page.keyboard.press('Alt+Shift+l'); await inline.locator('#card-title').waitFor();
  await inline.button('Check now').click(); await inline.locator('.underline').waitFor();
  await page.keyboard.press('Alt+Shift+l'); await inline.locator('#card-title').waitFor();
  assert.equal(await inline.button('Accept').count(), 0); assert.equal(await page.locator('#textarea').inputValue(), 'He go to work. ');
  assert.equal(await page.locator('#prose').innerHTML(), '<p>Intro paragraph.</p><p>He go to work.<br class="ProseMirror-trailingBreak"></p>');
});
test('underlines follow a scrolling ancestor and keep the editor unchanged', async () => {
  await load();
  await page.evaluate(() => {
    const wrap = document.createElement('section'); wrap.id = 'scroller'; wrap.style.cssText = 'overflow:auto;height:140px;width:430px';
    const editor = document.querySelector('#prose'); editor.before(wrap); wrap.append(editor);
    const filler = document.createElement('div'); filler.style.height = '400px'; wrap.append(filler);
  });
  await checked('#prose', 'work.');
  const [before] = await underlines();
  await page.locator('#scroller').evaluate(el => { el.scrollTop = 12; });
  await inline.locator('.underline').waitFor((el, top) => el.getBoundingClientRect().top < top - 8, before.top);
  const [after] = await underlines(); assert.ok(after.top < before.top - 8);
  const word = await wordBox('#prose', 'He go to work.', 'go'); assert.ok(close(after.left, word.left));
});
test('suggestions disappear when the checked paragraph changes by typing; an explicit check uses the new text', async () => {
  await load(); await checked('#quill', 'work.');
  await page.keyboard.type('!'); await inline.locator('.underline').waitFor((_, __, all) => all.length === 0);
  assert.equal((await sends()).length, 1); // The shared ten-second automatic interval applies; nothing is resent early.
  await page.keyboard.press('Alt+Shift+l'); await inline.locator('#card-title').waitFor(); await inline.button('Check now').click();
  await page.waitForFunction(() => fixture.worker.calls.filter(x => x.method === 'send').length === 2, null, {timeout: 8000});
  assert.deepEqual((await requestTexts()).map(x => x.trim()), ['He go to work.', 'He go to work. !']);
});
test('closing the card restores the caret in editors that clear the DOM selection on blur (Draft.js)', async () => {
  await load();
  await page.evaluate(() => document.querySelector('#draft').addEventListener('blur', () => getSelection().removeAllRanges()));
  await checked('#draft', 'work.');
  await page.keyboard.press('Alt+Shift+l'); await inline.locator('#card-title').waitFor();
  assert.equal(await page.evaluate(() => getSelection().rangeCount), 0); // The editor really did drop its selection.
  await page.keyboard.press('Escape'); await page.keyboard.type('X');
  assert.equal(await page.locator('#draft').innerText(), 'Intro paragraph.\nHe go to work. X');
});

// --- Review follow-ups -------------------------------------------------------------------------------------------------
const wrapInCode = host => page.evaluate(host => {
  const paragraph = document.querySelector(host), code = document.createElement('code'); code.append(...paragraph.childNodes); paragraph.append(code);
}, host);
test('a descendant exclusion added after capture removes the preview without changing the text', async () => {
  await load(); await checked('#quill', 'work.');
  await wrapInCode('#quill p:nth-of-type(2)');
  await inline.locator('.underline').waitFor((_, __, all) => all.length === 0);
  assert.equal((await sends()).length, 1);
});
test('a descendant exclusion added while the provider request is pending discards its result', async () => {
  await load(); await page.evaluate(() => { fixture.worker.hold = true; });
  await typeAfter('#quill', 'work.');
  await page.waitForFunction(() => fixture.worker.calls.some(x => x.method === 'send'), null, {timeout: 8000});
  await wrapInCode('#quill p:nth-of-type(2)');
  await page.evaluate(() => {
    const port = fixture.worker.ports[0], request = port.sent.find(x => x.method === 'send');
    port.reply(request.id, {type: 'delta', text: '{"corrections":[{"before":"go","after":"goes","left":"He ","right":" to","category":"grammar","explanation":"Subject agreement"}]}'});
    port.reply(request.id, {type: 'completed'});
  });
  await page.waitForTimeout(600);
  assert.equal(await inline.locator('.underline').count(), 0);
  assert.match(await inline.locator('.badge').evaluate(el => el.getAttribute('aria-label')), /selection changed|editor changed|Select text/i);
});
test('a keystroke the editor rejects does not arm a check of the unchanged paragraph', async () => {
  await load();
  await page.evaluate(() => document.querySelector('#draft').addEventListener('beforeinput', event => event.preventDefault(), {capture: true, once: false, passive: false}));
  await typeAfter('#draft', 'work.'); await page.keyboard.type('x'); await idle();
  assert.equal((await sends()).length, 0); assert.equal(await page.locator('#draft').innerText(), 'Intro paragraph.\nHe go to work.');
});
test('a rejected keystroke leaves an already armed check in place', async () => {
  await load();
  await typeAfter('#draft', 'work.'); // Accepted: arms the check.
  await page.evaluate(() => document.querySelector('#draft').addEventListener('beforeinput', event => event.preventDefault(), true));
  await page.keyboard.type('x'); // Rejected within the idle window.
  await page.waitForFunction(() => fixture.worker.calls.some(x => x.method === 'send'), null, {timeout: 8000});
  assert.deepEqual((await requestTexts()).map(x => x.trim()), ['He go to work.']);
});
test('Check now uses the remembered caret when the editor cleared its selection on blur, whether the card opened by key or mouse', async () => {
  for (const how of ['keyboard', 'mouse']) {
    await load();
    await page.evaluate(() => document.querySelector('#draft').addEventListener('blur', () => getSelection().removeAllRanges()));
    await checked('#draft', 'work.');
    if (how === 'mouse') await inline.locator('.badge').click(); else await page.keyboard.press('Alt+Shift+l');
    await inline.locator('#card-title').waitFor();
    assert.equal(await page.evaluate(() => getSelection().rangeCount), 0, how); // The editor really did drop its selection.
    await press('Check now');
    await page.waitForFunction(() => fixture.worker.calls.filter(x => x.method === 'send').length === 2, null, {timeout: 8000});
    assert.deepEqual((await requestTexts()).map(x => x.trim()), ['He go to work.', 'He go to work.'], how);
  }
});
test('the request carries the rendered text for whitespace-only inline content and pretty-printed or collapsible whitespace', async () => {
  for (const [host, needle, expected, answer] of [
    ['#inlinews', 'work.', 'He go to work.', null],
    ['#prettyspans', ' .', 'Alpha beta gamma .', {before: 'beta', left: 'Alpha ', right: ' gamma'}],
    ['#runs', 'three', 'One two three', {before: 'two', left: 'One ', right: ' three'}]
  ]) {
    await load();
    if (answer) await page.evaluate(a => { fixture.worker.answer = JSON.stringify({corrections: [{...a, after: 'X', category: 'grammar', explanation: 'Synthetic'}]}); }, answer);
    await checked(host, needle);
    const [text] = await requestTexts(); assert.equal(text.trim(), expected, host);
    assert.equal(text.trim(), await page.locator(`${host} p`).evaluate(el => el.innerText.replace(/ /g, ' ').trim()), host); // The browser agrees.
    const [u] = await underlines(), w = await wordBox(host, answer ? answer.before : 'He go', answer ? answer.before : 'go');
    assert.ok(close(u.left, w.left) && close(u.right, w.right), `${host}: ${JSON.stringify(u)} vs ${JSON.stringify(w)}`);
  }
});
