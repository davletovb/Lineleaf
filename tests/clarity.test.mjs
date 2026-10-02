import assert from 'node:assert/strict';
import {test, before, after} from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {panelFor} from './fixtures/panel-driver.mjs';
// F-02: optional clearer-wording suggestions. A second automatic request for the same paragraph, after the corrections and on the
// shared interval, shown as separately labelled underlines. Off unless its own setting (and automatic checking) is on.
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
const WORDING = 'https://clarity.lineleaf.test/compose?automatic&clarity', CORRECTIONS_ONLY = 'https://clarity.lineleaf.test/compose?automatic';
const TEXT = 'He go to work in order to earn money.';
async function load(url = WORDING) { await page.goto(url); await page.waitForFunction(() => window.__lineleafMounted); }
const correction = {before: 'go', after: 'goes', left: 'He ', right: ' to work', category: 'grammar', explanation: 'Subject agreement'};
const wording = (...items) => items.map(([before, after, left, right]) => ({before, after, left, right, explanation: 'Shorter and clearer.'}));
// One fake provider that answers by request: the clearer-wording prompt gets `suggestions`, everything else gets `corrections`.
const answers = (suggestions, corrections = [correction]) => page.evaluate(([suggestions, corrections]) => {
  fixture.worker.answer = params => params.system.includes('"suggestions"') ? suggestions : corrections;
}, [JSON.stringify({suggestions}), JSON.stringify({corrections})]);
const requests = () => page.evaluate(() => fixture.checks.map(x => ({mode: x.mode, kind: x.kind, text: x.text})));
async function typeInField(value) {
  await page.evaluate(value => { const t = document.querySelector('#textarea'); t.value = value; t.focus(); t.setSelectionRange(value.length, value.length); }, value);
  await inline.locator('.badge').waitFor(); await page.keyboard.type(' ');
}
// The shared automatic interval is ten seconds. Move the clock past it instead of waiting, then re-focus so the pending check re-arms.
const skipInterval = () => page.evaluate(() => {
  const real = Date.now; Date.now = () => real.call(Date) + 10000;
  const el = document.activeElement, selection = getSelection(), range = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  el.blur(); el.focus(); // the focus handler re-arms the pending check; the caret goes back before that timer runs
  if (range && !(el instanceof HTMLTextAreaElement)) { selection.removeAllRanges(); selection.addRange(range); }
});
const underlines = category => inline.locator(category ? `.underline[data-category="${category}"]` : '.underline').count();
async function press(name) { await inline.button(name).evaluate(el => el.focus()); await page.keyboard.press('Enter'); }
const openCard = async () => { await page.keyboard.press('Alt+Shift+l'); await inline.locator('#card-title').waitFor(); };
const underlineCount = n => inline.locator('.layer').waitFor((el, count) => el.querySelectorAll('.underline').length === count, n);

test('off by default: with only automatic checking on, a paragraph gets corrections and never a wording request', async () => {
  await load(CORRECTIONS_ONLY); await answers(wording(['in order to', 'to', 'work ', ' earn']));
  await typeInField(TEXT); await underlineCount(1);
  await skipInterval(); await page.waitForTimeout(2300);
  assert.deepEqual((await requests()).map(x => x.mode), ['proofread']); assert.equal(await underlines('clarity'), 0);
});

test('with clearer wording on, the corrections come first, then one separate wording request for the same paragraph, shown apart', async () => {
  await load(); await answers(wording(['in order to', 'to', 'work ', ' earn']));
  await typeInField(TEXT); await underlineCount(1);
  assert.deepEqual(await requests(), [{mode: 'proofread', kind: 'automatic', text: TEXT + ' '}]); // wording waits for the shared interval
  assert.equal(await underlines('grammar'), 1); assert.equal(await underlines('clarity'), 0);
  await skipInterval(); await underlineCount(2);
  assert.deepEqual(await requests(), [{mode: 'proofread', kind: 'automatic', text: TEXT + ' '}, {mode: 'clarity', kind: 'automatic', text: TEXT + ' '}]);
  assert.equal(await underlines('grammar'), 1); assert.equal(await underlines('clarity'), 1);
  assert.equal(await page.locator('#textarea').inputValue(), TEXT + ' '); // suggestions change nothing
  await inline.locator('.badge').waitFor(el => /2 suggestions \(1 clearer wording\)/.test(el.getAttribute('aria-label')));
  await openCard(); await press('Next');
  assert.match(await inline.locator('.category').textContent(), /Clearer wording · Optional style/);
  assert.match(await inline.locator('.change').textContent(), /in order to → to/);
  await press('Accept'); await inline.button('Undo last edit').waitFor();
  assert.equal(await page.locator('#textarea').inputValue(), 'He go to work to earn money. ');
});

test('a wording suggestion that overlaps a correction is not shown', async () => {
  await load(); await answers(wording(['go to work', 'work', 'He ', ' in order'], ['in order to', 'to', 'work ', ' earn']));
  await typeInField(TEXT); await underlineCount(1); await skipInterval(); await underlineCount(2);
  assert.equal(await underlines('grammar'), 1); assert.equal(await underlines('clarity'), 1);
});

test('typing before the wording check discards it; the changed paragraph gets corrections first again', async () => {
  await load(); await answers(wording(['in order to', 'to', 'work ', ' earn']));
  await typeInField(TEXT); await underlineCount(1);
  await page.keyboard.type('x'); await skipInterval();
  await page.waitForFunction(() => fixture.checks.length === 2, null, {timeout: 8000});
  assert.deepEqual((await requests()).map(x => x.mode), ['proofread', 'proofread']); // the new text is corrected before it is reworded
  assert.equal(await underlines('clarity'), 0);
});

test('a failed wording request keeps the corrections and does not pause automatic checking', async () => {
  await load();
  await page.evaluate(() => { fixture.worker.answer = params => params.system.includes('"suggestions"') ? '{"nope":[]}' : '{"corrections":[{"before":"go","after":"goes","left":"He ","right":" to work","category":"grammar","explanation":"Subject agreement"}]}'; });
  await typeInField(TEXT); await underlineCount(1); await skipInterval();
  await page.waitForFunction(() => fixture.checks.length === 2, null, {timeout: 8000});
  await inline.locator('.badge').waitFor(el => /could not be safely matched/.test(el.getAttribute('aria-label')));
  assert.equal(await underlines('grammar'), 1); // the correction is still on screen
  await page.keyboard.type('x'); await skipInterval(); // typing starts a new correction check: automatic checking was not paused
  await page.waitForFunction(() => fixture.checks.length === 3, null, {timeout: 8000});
  assert.deepEqual((await requests()).map(x => x.mode), ['proofread', 'clarity', 'proofread']);
});

test('clearer wording never runs when automatic checking is off, whatever else is set', async () => {
  await load('https://clarity.lineleaf.test/compose?clarity'); await answers(wording(['in order to', 'to', 'work ', ' earn']));
  await page.evaluate(value => { const t = document.querySelector('#textarea'); t.value = value; t.focus(); t.setSelectionRange(value.length, value.length); }, TEXT);
  await page.keyboard.type(' '); await skipInterval(); await page.waitForTimeout(2300);
  assert.deepEqual(await requests(), []); assert.equal(await page.locator('[data-lineleaf-inline]').count(), 0);
});

test('in a verified rich editor the wording suggestion is underlined, labelled and accepted through the editor like a correction', async () => {
  await load(); await answers(wording(['to work and', 'to work, and so', 'go ', ' they']));
  await page.evaluate(() => { const editor = document.querySelector('#multi'), text = editor.querySelectorAll('p')[1].firstChild; editor.focus();
    const range = document.createRange(); range.setStart(text, text.data.length); range.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(range); });
  await inline.locator('.badge').waitFor(); await page.keyboard.type(' ');
  await underlineCount(1); await skipInterval(); await underlineCount(2);
  assert.equal(await underlines('grammar'), 1); assert.equal(await underlines('clarity'), 1);
  assert.deepEqual((await requests()).map(x => x.mode), ['proofread', 'clarity']);
  await openCard(); await press('Next'); assert.match(await inline.locator('.category').textContent(), /Clearer wording/);
  await press('Accept'); await inline.locator('.badge').waitFor(el => /^Applied\./.test(el.getAttribute('aria-label')));
  assert.equal(await page.locator('#multi p').nth(1).innerText(), 'He go to work, and so they was late. ');
});

test('a wording request that loses its worker keeps the corrections and does not pause automatic checking', async () => {
  await load(); await answers(wording(['in order to', 'to', 'work ', ' earn']));
  await typeInField(TEXT); await underlineCount(1);
  await page.evaluate(() => { fixture.faults.drop = true; }); await skipInterval();
  await inline.locator('.badge').waitFor(el => /could not complete this action/.test(el.getAttribute('aria-label')));
  assert.equal(await underlines('grammar'), 1); assert.equal(await underlines('clarity'), 0);
  await page.keyboard.type('x'); await skipInterval();
  await page.waitForFunction(() => fixture.checks.length === 3, null, {timeout: 8000});
  assert.deepEqual((await requests()).map(x => x.mode), ['proofread', 'clarity', 'proofread']);
});

test('a change the editor reports without trusted typing ends the pending wording check along with the suggestions', async () => {
  await load(); await answers(wording(['in order to', 'to', 'work ', ' earn']));
  await typeInField(TEXT); await underlineCount(1);
  await page.evaluate(() => document.querySelector('#textarea').dispatchEvent(new Event('input', {bubbles: true}))); // a script, not the user
  await underlineCount(0); await skipInterval(); await page.waitForTimeout(2300);
  assert.deepEqual((await requests()).map(x => x.mode), ['proofread']);
});
