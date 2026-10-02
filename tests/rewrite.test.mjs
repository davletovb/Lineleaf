import assert from 'node:assert/strict';
import {test, before, after} from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {panelFor} from './fixtures/panel-driver.mjs';
// Explicit "Improve it" / "Paraphrase" and the tone rewrites in the inline card: scope (selection or paragraph), the request, the
// before/after preview, preservation flags, and replacing through the existing apply paths (adapter or verified rich editor).
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
const URL_AUTOMATIC = 'https://rewrite.lineleaf.test/compose?automatic';
async function load(url = URL_AUTOMATIC) { await page.goto(url); await page.waitForFunction(() => window.__lineleafMounted); }
const rewriteAnswer = text => page.evaluate(text => { fixture.worker.answer = JSON.stringify({rewrite: text}); }, text);
const proofreadAnswer = () => page.evaluate(() => { fixture.worker.answer = '{"corrections":[{"before":"go","after":"goes","left":"He ","right":" to","category":"grammar","explanation":"Subject agreement"}]}'; });
const requests = () => page.evaluate(() => fixture.checks.map(x => ({mode: x.mode, kind: x.kind, text: x.text})));
async function press(name) { await inline.button(name).evaluate(el => el.focus()); await page.keyboard.press('Enter'); }
const openCard = async () => { await page.keyboard.press('Alt+Shift+l'); await inline.locator('#card-title').waitFor(); };
const suggested = () => inline.locator('.suggested').waitFor();
const text = host => page.locator(host).innerText().then(value => value.replace(/ /g, ' '));
// The paragraph under test, without the spacing and trailing break an editor's markup adds to innerText.
const line = host => text(host).then(value => value.split('\n').find(row => row.startsWith('He ')));
// Put the field in focus with its caret at the end (or a selection) the way a user would.
async function useTextarea(value, selection = null) {
  await page.evaluate(([value, selection]) => {
    const t = document.querySelector('#textarea'); t.value = value; t.focus();
    if (selection) t.setSelectionRange(...selection); else t.setSelectionRange(value.length, value.length);
  }, [value, selection]);
  await inline.locator('.badge').waitFor();
}
async function selectIn(host, needle, whole = false) {
  await page.evaluate(([host, needle]) => {
    const root = document.querySelector(host), walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let found; for (let n; (n = walker.nextNode());) if (n.data.includes(needle)) { found = n; break; }
    (root.closest('[contenteditable]') ?? root).focus();
    const range = document.createRange(); range.setStart(found, found.data.indexOf(needle)); range.setEnd(found, found.data.indexOf(needle) + needle.length);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  }, [host, needle]);
  await inline.locator('.badge').waitFor();
}
async function caretAfter(host, needle) {
  await page.evaluate(([host, needle]) => {
    const root = document.querySelector(host), walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let found; for (let n; (n = walker.nextNode());) if (n.data.includes(needle)) { found = n; break; }
    (root.closest('[contenteditable]') ?? root).focus();
    const range = document.createRange(); range.setStart(found, found.data.indexOf(needle) + needle.length); range.collapse(true);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  }, [host, needle]);
  await inline.locator('.badge').waitFor();
}

test('Improve it rewrites the caret paragraph of a text field: explicit request, before/after preview, Replace and native undo', async () => {
  await load(); await rewriteAnswer('He goes to work.');
  await useTextarea('Intro paragraph.\nHe go to work.');
  await openCard(); await press('Improve it'); await suggested();
  assert.deepEqual(await requests(), [{mode: 'improve', kind: 'manual', text: 'He go to work.'}]); // only the caret paragraph, as an explicit request
  assert.equal(await inline.locator('.text').count(), 2);
  assert.equal(await inline.locator('.suggested').textContent(), 'He goes to work.');
  assert.match(await inline.locator('.category').textContent(), /This paragraph · Optional style/);
  assert.equal(await inline.locator('.underline').count(), 0); // a rewrite is a preview, never a whole-paragraph underline
  assert.equal(await page.locator('#textarea').inputValue(), 'Intro paragraph.\nHe go to work.'); // nothing changes until Replace
  await press('Replace'); await inline.button('Undo last edit').waitFor();
  assert.equal(await page.locator('#textarea').inputValue(), 'Intro paragraph.\nHe goes to work.');
  await press('Undo last edit'); await inline.locator('.badge').waitFor(el => /Undone/.test(el.getAttribute('aria-label')));
  assert.equal(await page.locator('#textarea').inputValue(), 'Intro paragraph.\nHe go to work.');
});

test('a selection is the scope when there is one; the text around it is untouched', async () => {
  await load(); await rewriteAnswer('He goes to work.');
  await useTextarea('Intro paragraph. He go to work. Bye.', [17, 31]);
  await openCard(); await press('Paraphrase'); await suggested();
  assert.deepEqual(await requests(), [{mode: 'paraphrase', kind: 'manual', text: 'He go to work.'}]);
  assert.match(await inline.locator('.category').textContent(), /Selected text/);
  await press('Replace'); await inline.button('Undo last edit').waitFor();
  assert.equal(await page.locator('#textarea').inputValue(), 'Intro paragraph. He goes to work. Bye.');
});

test('each mode sends its own request, and rewrites do not run automatically', async () => {
  await load(); await rewriteAnswer('Fine.');
  await useTextarea('He go to work.');
  for (const [name, mode] of [['Clearer', 'clearer'], ['Shorter', 'shorter'], ['More formal', 'formal'], ['Friendlier', 'friendly']]) {
    await openCard(); await press(name); await suggested(); await press('Back');
    assert.equal((await requests()).at(-1).mode, mode);
  }
  assert.ok((await requests()).every(x => x.kind === 'manual'));
});

test('a rewrite that changes a number, a name or a negation says so', async () => {
  await load(); await rewriteAnswer('Yesterday Priya did not pay $2,500 on Monday.');
  await useTextarea('Yesterday Maya paid $1,250 on Monday.');
  await openCard(); await press('Shorter'); await suggested();
  assert.match(await inline.locator('.warn').textContent(), /Check this version: it changes a number or date, a name, mention or link, a negation\./);
  await rewriteAnswer('Yesterday Maya settled $1,250 on Monday.');
  await press('Try again'); await inline.locator('.suggested').waitFor(el => el.textContent === 'Yesterday Maya settled $1,250 on Monday.');
  assert.equal(await inline.locator('.warn').count(), 0);
});

test('"already reads well" shows no preview and keeps the proofreading suggestions; Back restores them too', async () => {
  await load(); await proofreadAnswer();
  await useTextarea('He go to work.'); await page.keyboard.press('End'); await page.keyboard.type(' ');
  await page.waitForFunction(() => fixture.worker.calls.some(x => x.method === 'send'), null, {timeout: 8000}); await inline.locator('.underline').waitFor();
  await rewriteAnswer('He go to work. '.trimEnd() + ' ');
  await openCard(); await press('Improve it');
  await inline.locator('#status').waitFor(el => /no change suggested/.test(el.textContent));
  assert.equal(await inline.locator('.suggested').count(), 0); assert.equal(await inline.locator('.underline').count(), 1); // the suggestion is back
  await rewriteAnswer('He goes to work.'); await press('Improve it'); await suggested();
  assert.equal(await inline.locator('.underline').count(), 0); await press('Back');
  assert.equal(await inline.locator('.underline').count(), 1); assert.equal(await page.locator('#textarea').inputValue(), 'He go to work. ');
});

test('typing while a rewrite is shown discards it; the field is never changed by Back or by typing', async () => {
  await load(); await rewriteAnswer('He goes to work.');
  await useTextarea('He go to work.');
  await openCard(); await press('Improve it'); await suggested();
  await page.locator('#textarea').focus(); await page.keyboard.type('!');
  await inline.locator('.badge').waitFor(el => /Text changed/.test(el.getAttribute('aria-label')));
  await openCard(); assert.equal(await inline.locator('.suggested').count(), 0);
  assert.equal(await page.locator('#textarea').inputValue(), 'He go to work.!');
});

test('a verified rich editor replaces the rewritten paragraph or selection through its own input path', async () => {
  await load(); await rewriteAnswer('He goes to work.');
  await caretAfter('#prose', 'work.'); await openCard(); await press('Improve it'); await suggested();
  assert.deepEqual((await requests()).at(-1), {mode: 'improve', kind: 'manual', text: 'He go to work.'});
  assert.equal(await inline.button('Replace').isDisabled(), false);
  await press('Replace'); await inline.locator('.badge').waitFor(el => /^Applied\./.test(el.getAttribute('aria-label')));
  assert.equal(await line('#prose'), 'He goes to work.');
  await load(); await rewriteAnswer('goes to work');
  await selectIn('#prose', 'go to work'); await openCard(); await press('Paraphrase'); await suggested();
  assert.deepEqual((await requests()).at(-1), {mode: 'paraphrase', kind: 'manual', text: 'go to work'});
  await press('Replace'); await inline.locator('.badge').waitFor(el => /^Applied\./.test(el.getAttribute('aria-label')));
  assert.equal(await line('#prose'), 'He goes to work.'); assert.ok((await text('#prose')).startsWith('Intro paragraph.'));
});

test('a Slate-like editor that only trusts beforeinput takes a whole-paragraph rewrite itself', async () => {
  await load(); await rewriteAnswer('He goes to work.');
  await caretAfter('#model-slate', 'work.'); await openCard(); await press('Improve it'); await suggested();
  await press('Replace'); await inline.locator('.badge').waitFor(el => /^Applied\./.test(el.getAttribute('aria-label')));
  assert.deepEqual(await page.evaluate(() => modelSlate.lines), ['Intro paragraph.', 'He goes to work.']);
  assert.equal(await text('#model-slate'), 'Intro paragraph.\nHe goes to work.');
});

test('rewrites across formatting and in copy-only editors can be previewed and copied, never replaced', async () => {
  await load(); await rewriteAnswer('He goes to work.');
  await caretAfter('#spans', 'work.'); await openCard(); await press('Improve it'); await suggested();
  assert.equal(await inline.button('Replace').isDisabled(), true); assert.match(await inline.locator('.note').textContent(), /spans formatting or a mention/);
  assert.equal(await page.locator('#spans').innerHTML(), '<p>Intro paragraph.</p><p>He <b>go</b> to work.</p>');
  await load('https://mail.google.com/mail/u/0/?automatic'); await rewriteAnswer('He goes to work.');
  await caretAfter('#prose', 'work.'); await openCard(); await press('Improve it'); await suggested();
  assert.equal(await inline.button('Replace').count(), 0); assert.equal(await inline.button('Copy').count(), 1);
  assert.match(await inline.locator('.note').textContent(), /Copy-only editor/);
  assert.equal(await line('#prose'), 'He go to work.');
});

test('rewrites are refused where nothing eligible is selected', async () => {
  await load(); await rewriteAnswer('x');
  await useTextarea('1234 5678');
  await openCard(); await press('Improve it');
  await inline.locator('#status').waitFor(el => /Rewrites need 1–2,000 characters of text with letters/.test(el.textContent));
  assert.deepEqual(await requests(), []);
});
