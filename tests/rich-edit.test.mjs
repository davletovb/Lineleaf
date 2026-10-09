import assert from 'node:assert/strict';
import {test, before, after} from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {isPackagedLibraryModule} from '../tools/evaluation/browser-fixtures.mjs';
import {panelFor} from './fixtures/panel-driver.mjs';
// Accept in rich editors. The edit must reach the editor as an ordinary edit (so its model, DOM and history agree), the caret and
// the other suggestions must survive, and any editor that misbehaves must end up copy-only. Fixtures mirror each family's DOM;
// the model-owned ones also keep their own text, log and undo stack. The real libraries are exercised in uncommitted local runs.
let browser, page, inline;
before(async () => {
  browser = await chromium.launch({executablePath: process.env.LINELEAF_CHROMIUM_PATH || undefined,
    args: process.env.LINELEAF_CHROMIUM_SINGLE_PROCESS === '1' ? ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--single-process'] : []});
  page = await browser.newPage(); inline = panelFor(page, {attribute: 'data-lineleaf-inline'});
  await page.route('**/*', async route => {
    const path = new URL(route.request().url()).pathname;
    const files = new Map([['/content.js', '../dist/lineleaf/content.js'], ['/controller-bridge.mjs', './fixtures/controller-bridge.mjs'], ['/test-api.mjs', './fixtures/extension-api.mjs']]);
    const file = files.get(path) ?? (await isPackagedLibraryModule(path) ? `../dist/lineleaf${path}` : './fixtures/rich.html');
    let body = await readFile(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    if (file.endsWith('.html')) body = body.replace('<script src="/content.js"></script>', '<script type="module" src="/controller-bridge.mjs"></script>');
    await route.fulfill({body, contentType: /\.m?js$/.test(file) ? 'text/javascript' : 'text/html'});
  });
});
after(async () => { await browser?.close(); });
const URL_AUTOMATIC = 'https://rich.lineleaf.test/compose?automatic';
async function load(url = URL_AUTOMATIC) { await page.goto(url); await page.waitForFunction(() => window.__lineleafMounted); }
const sends = () => page.evaluate(() => fixture.worker.turns);
const answer = corrections => page.evaluate(corrections => { fixture.worker.answer = JSON.stringify({corrections}); }, corrections.map(c => ({category: 'grammar', explanation: 'Synthetic', ...c})));
async function caretAfter(host, needle) {
  await page.evaluate(([host, needle]) => {
    const root = document.querySelector(host), walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let found;
    for (let n; (n = walker.nextNode());) if (n.data.includes(needle)) { found = n; break; }
    const editor = root.closest('[contenteditable]') ?? root; editor.focus();
    const range = document.createRange(); range.setStart(found, found.data.indexOf(needle) + needle.length); range.collapse(true);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  }, [host, needle]);
}
async function checked(host, needle) {
  await caretAfter(host, needle); await page.keyboard.type(' ');
  await page.waitForFunction(() => fixture.worker.turns.length > 0, null, {timeout: 8000});
  await inline.locator('.underline').waitFor();
}
const wordBox = (host, context, word) => page.evaluate(([host, context, word]) => {
  const walker = document.createTreeWalker(document.querySelector(host), NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    const at = n.data.indexOf(context); if (at < 0) continue;
    const start = at + context.indexOf(word), range = document.createRange(); range.setStart(n, start); range.setEnd(n, start + word.length);
    const r = range.getBoundingClientRect(); return {left: r.left, right: r.right};
  }
  return null;
}, [host, context, word]);
const underlines = () => inline.locator('.underline').evaluate((_, __, all) => all.map(el => { const r = el.getBoundingClientRect(); return {left: r.left, right: r.right}; }));
const close = (a, b, tolerance = 1.5) => Math.abs(a - b) <= tolerance;
async function press(name) { await inline.button(name).evaluate(el => el.focus()); await page.keyboard.press('Enter'); }
const openCard = async () => { await page.keyboard.press('Alt+Shift+l'); await inline.locator('#card-title').waitFor(); };
const label = () => inline.locator('.badge').evaluate(el => el.getAttribute('aria-label'));
let previous = '';
const accept = async () => { await openCard(); previous = await label(); await press('Accept'); };
// A fresh announcement: several accepts in a row each end with their own "Applied." message.
const applied = () => inline.locator('.badge').waitFor((el, was) => /^Applied\./.test(el.getAttribute('aria-label')) && el.getAttribute('aria-label') !== was, previous);
const text = async host => (await page.locator(host).innerText()).replace(/ /g, ' ');
const checkedLine = async host => (await text(host)).split('\n').find(line => line.startsWith('He '));
const focused = host => page.evaluate(host => { const root = document.querySelector(host); return root === document.activeElement || root.contains(document.activeElement); }, host);
const record = () => page.evaluate(() => { window.__events = []; for (const type of ['beforeinput', 'input']) document.addEventListener(type, e => window.__events.push(`${type}:${e.inputType}${e.isTrusted ? '' : ':synthetic'}`), true); });
const events = () => page.evaluate(() => window.__events);

const FAMILIES = [
  {name: 'Draft.js (X/Twitter)', host: '#draft', needle: 'work.'}, {name: 'Lexical', host: '#lexical', needle: 'He go to work.'},
  {name: 'Slate', host: '#slate', needle: 'He go to work.'}, {name: 'ProseMirror', host: '#prose', needle: 'He go to work.'},
  {name: 'Quill', host: '#quill', needle: 'He go to work.'}
];
for (const family of FAMILIES) {
  test(`${family.name}: Accept replaces the word as one ordinary edit, keeps the caret, the other paragraph and the suggestion state`, async () => {
    await load(); await checked(family.host, family.needle); await record();
    assert.equal((await checkedLine(family.host)).trim(), 'He go to work.');
    await accept(); await applied();
    const lines = (await text(family.host)).split('\n');
    assert.equal(await checkedLine(family.host), 'He goes to work. '); assert.equal(lines[0], 'Intro paragraph.');
    assert.deepEqual(await events(), ['beforeinput:insertText:synthetic', 'input:insertText']); // one edit, delivered like typing
    assert.equal(await focused(family.host), true);
    assert.match(await label(), /Press Ctrl\/⌘ Z to undo/); assert.equal(await inline.button('Undo last edit').count(), 0);
    await page.keyboard.type('Z'); assert.equal(await checkedLine(family.host), 'He goes to work. Z'); // the caret stayed where it was
    await page.waitForTimeout(1900); assert.equal((await sends()).length, 1); // Applying is not typing, and the new text is not re-sent
  });
}

test('a Slate-like editor that only trusts beforeinput takes the edit itself: model, DOM and undo agree', async () => {
  await load(); await checked('#model-slate', 'work.'); await record();
  const start = await page.evaluate(() => modelSlate.log.length);
  await accept(); await applied();
  assert.deepEqual(await page.evaluate(() => modelSlate.lines), ['Intro paragraph.', 'He goes to work. ']);
  assert.equal(await text('#model-slate'), 'Intro paragraph.\nHe goes to work. ');
  assert.deepEqual(await page.evaluate(n => modelSlate.log.slice(n), start), ['insertText:synthetic']); // taken by the editor, never a native edit
  assert.deepEqual(await events(), ['beforeinput:insertText:synthetic']);
  await page.keyboard.type('Z'); assert.equal(await page.evaluate(() => modelSlate.lines[1]), 'He goes to work. Z');
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); // the editor's own undo reverses Z, then the replacement
  assert.deepEqual(await page.evaluate(() => modelSlate.lines), ['Intro paragraph.', 'He go to work. ']);
  assert.equal(await text('#model-slate'), 'Intro paragraph.\nHe go to work. ');
});

test('a Draft.js-like editor that reconciles native edits and re-renders keeps its model, caret and undo', async () => {
  await load(); await checked('#model-draft', 'work.');
  await page.evaluate(() => { window.__text = document.querySelector('#model-draft').lastElementChild.querySelector('[data-text]').firstChild; });
  const start = await page.evaluate(() => modelDraft.log.length);
  await accept(); await applied();
  assert.deepEqual(await page.evaluate(() => modelDraft.lines), ['Intro paragraph.', 'He goes to work. ']);
  assert.equal(await text('#model-draft'), 'Intro paragraph.\nHe goes to work. ');
  assert.deepEqual(await page.evaluate(n => modelDraft.log.slice(n), start), ['insertText']);
  assert.equal(await page.evaluate(() => window.__text.isConnected), false); // The editor replaced the text node; the overlay still tracks it.
  await page.keyboard.type('Z'); assert.equal(await page.evaluate(() => modelDraft.lines[1]), 'He goes to work. Z');
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
  assert.deepEqual(await page.evaluate(() => modelDraft.lines), ['Intro paragraph.', 'He go to work. ']);
});

test('the caret is restored when the edit is earlier in the paragraph than the caret', async () => {
  await load();
  await caretAfter('#prose', 'He go to'); await page.keyboard.type(' ');
  await page.waitForFunction(() => fixture.worker.turns.length > 0, null, {timeout: 8000}); await inline.locator('.underline').waitFor();
  await accept(); await applied();
  assert.equal(await checkedLine('#prose'), 'He goes to  work.');
  await page.keyboard.type('Z'); assert.equal(await checkedLine('#prose'), 'He goes to Z work.');
});

test('removals and several suggestions: the others move with the text and stay aligned', async () => {
  await load();
  await answer([{before: 'go', after: 'goes', left: 'He ', right: ' to'}, {before: ' and', after: '', left: 'work', right: ' they'}, {before: 'was', after: 'were', left: 'they ', right: ' late'}]);
  await checked('#multi', 'late.');
  assert.equal((await underlines()).length, 3);
  await accept(); await applied();
  assert.equal(await checkedLine('#multi'), 'He goes to work and they was late. ');
  const aligned = async (context, word) => { const w = await wordBox('#multi', context, word); return (await underlines()).some(u => close(u.left, w.left) && close(u.right, w.right)); };
  assert.equal((await underlines()).length, 2); assert.equal(await aligned('they was late', 'was'), true);
  await accept(); await applied(); // the removal
  assert.equal(await checkedLine('#multi'), 'He goes to work they was late. ');
  assert.equal((await underlines()).length, 1); assert.equal(await aligned('they was late', 'was'), true);
  await accept(); await applied();
  assert.equal(await checkedLine('#multi'), 'He goes to work they were late. ');
  assert.equal(await inline.locator('.underline').count(), 0);
});

test('an edit that spans formatting can only be copied and leaves the editor untouched', async () => {
  await load();
  await answer([{before: 'go to', after: 'goes to', left: 'He ', right: ' work'}]);
  await checked('#spans', 'work.');
  const html = await page.locator('#spans').innerHTML();
  await openCard();
  assert.equal(await inline.button('Accept').isDisabled(), true); assert.match(await inline.locator('.note').textContent(), /spans formatting or a mention/);
  assert.equal(await page.locator('#spans').innerHTML(), html);
});

test('an editor that cancels the edit stays unchanged and becomes copy-only, without affecting other editors', async () => {
  await load(); await checked('#rejecting', 'work.');
  const html = await page.locator('#rejecting').innerHTML();
  await accept();
  await inline.locator('#status').waitFor(el => /did not apply/.test(el.textContent));
  assert.equal(await page.locator('#rejecting').innerHTML(), html);
  assert.equal(await inline.button('Accept').isDisabled(), true); assert.match(await inline.locator('.note').textContent(), /did not take the change/);
  await press('Check now'); await inline.locator('.underline').waitFor();
  await openCard(); assert.equal(await inline.button('Accept').count(), 0); assert.match(await inline.locator('.note').textContent(), /Copy-only editor/);
  await page.keyboard.press('Escape');
  // Another editor on the same page keeps working.
  await caretAfter('#prose', 'work.'); await openCard(); await press('Check now'); await inline.locator('.underline').waitFor();
  await openCard(); assert.equal(await inline.button('Accept').count(), 1);
});

test('an editor that re-renders the old text after the edit is detected and becomes copy-only', async () => {
  await load(); await checked('#reverting', 'work.');
  await accept();
  // Whether the editor reverts before the first check, between the checks or after them changes only the message (reverted, did not
  // apply, or not what Lineleaf expected), and the poll replaces it within a fraction of a second. The guarantees are the residual
  // state and the copy-only fallback, so wait for the apply to finish (the badge stops announcing suggestions) and assert those.
  await page.waitForFunction(() => window.reverted >= 1);
  await inline.locator('.badge').waitFor(el => !/suggestion/.test(el.getAttribute('aria-label')));
  assert.equal((await checkedLine('#reverting')).trim(), 'He go to work.');
  // The reset detached the checked paragraph, so the overlay drops the old suggestions and its card on its next poll. Wait for that
  // rather than racing it; then the next check on this editor is copy-only.
  await inline.locator('.badge').waitFor(el => /The editor changed/.test(el.getAttribute('aria-label')));
  await caretAfter('#reverting', 'work.'); await openCard(); await press('Check now'); await inline.locator('.underline').waitFor();
  await openCard(); assert.equal(await inline.button('Accept').count(), 0); assert.match(await inline.locator('.note').textContent(), /Copy-only editor/);
});

test('typing while the edit settles is the user\u2019s typing, not an editor revert, and keeps Accept available', async () => {
  await load(); await checked('#prose', 'work.');
  await accept();
  await page.waitForFunction(() => document.querySelector('#prose').textContent.includes('goes')); // the edit is in; the recheck is still pending
  await page.keyboard.type('Z');
  await applied();
  const line = await checkedLine('#prose');
  assert.ok(line.includes('goes') && line.includes('Z'), line); // both the correction and the typing survive
  // The editor was not disabled: the next check still offers Accept.
  await answer([{before: 'work', after: 'job', left: 'to ', right: '.'}]);
  await caretAfter('#prose', 'work.'); await openCard(); await press('Check now'); await inline.locator('.underline').waitFor();
  await openCard(); assert.equal(await inline.button('Accept').count(), 1);
});

test('moving to another field while the edit settles hands off to it instead of pulling focus back', async () => {
  await load(); await checked('#prose', 'work.');
  await accept();
  await page.waitForFunction(() => document.querySelector('#prose').textContent.includes('goes'));
  await page.evaluate(() => document.querySelector('#textarea').focus());
  await page.waitForTimeout(900); // longer than the settle window
  assert.equal(await page.evaluate(() => document.activeElement.id), 'textarea');
  assert.equal(await checkedLine('#prose'), 'He goes to work. ');
  assert.equal(await page.locator('#textarea').inputValue(), 'He go to work.');
});

test('priority composers and unlisted editors stay copy-only even when they carry a family marker', async () => {
  await load('https://mail.google.com/mail/u/0/?automatic'); await checked('#prose', 'work.');
  await openCard(); assert.equal(await inline.button('Accept').count(), 0); assert.match(await inline.locator('.note').textContent(), /Copy-only editor/);
  await load(); await checked('#gmail', 'late.');
  await openCard(); assert.equal(await inline.button('Accept').count(), 0);
});
