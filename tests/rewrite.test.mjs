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
    const file = files.get(path) ?? (['controller.mjs', 'native-seatline.mjs', 'policy.mjs', 'candidates.mjs', 'turkish-negation.mjs', 'turkish-verbs.mjs', 'editor-policy.mjs', 'check-timing.mjs'].some(x => path === `/lib/${x}`) ? `../dist/lineleaf${path}` : './fixtures/rich.html');
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
const label = () => inline.locator('.badge').evaluate(el => el.getAttribute('aria-label'));
const text = host => page.locator(host).innerText().then(value => value.replace(/ /g, ' '));
// The paragraph under test, without the spacing and trailing break an editor's markup adds to innerText.
const line = host => text(host).then(value => value.split('\n').find(row => row.startsWith('He ')));

test('a Turkish inline rewrite warns about negation, stays advisory, and preserves Replace and Undo for an unchanged negative clause', async () => {
  for (const [source, flipped, preserved] of [
    ['Ben gelmedim.', 'Ben geldim.', 'Ben gelmedim!'],
    ['Ne yağmur yağdı, ne kar.', 'Yağmur ve kar yağdı.', 'Ne yağmur yağdı, ne kar!']
  ]) {
    await load();
    await page.evaluate(() => fixture.worker.rpc('save-settings', {changes: {variant: 'TR'}, expected: {variant: 'US'}, dictionary: {add: [], remove: []}}));
    await rewriteAnswer(flipped); await useTextarea(source); await openCard();
    assert.equal(await inline.locator('[data-rewrite]').count(), 6);
    await press('Improve it'); await suggested();
    assert.match(await inline.locator('.warn').textContent(), /a negation/);
    assert.equal(await page.locator('#textarea').inputValue(), source);
    assert.match((await page.evaluate(() => fixture.worker.turns))[0].params.system, /Turkish verbal negation/);
    await press('Back');
    // Back closes the card when there are no proofreading suggestions to restore.
    await rewriteAnswer(preserved); await openCard(); await press('Improve it'); await suggested();
    assert.equal(await inline.locator('.warn').count(), 0);
    await press('Replace'); await inline.button('Undo last edit').waitFor();
    assert.equal(await page.locator('#textarea').inputValue(), preserved);
    await press('Undo last edit'); assert.equal(await page.locator('#textarea').inputValue(), source);
  }
});
// Put the field in focus with its caret at the end (or a selection) the way a user would.
async function useTextarea(value, selection = null) {
  await page.evaluate(([value, selection]) => {
    const t = document.querySelector('#textarea'); t.value = value; t.focus();
    if (selection) t.setSelectionRange(...selection); else t.setSelectionRange(value.length, value.length);
  }, [value, selection]);
  await inline.locator('.badge').waitFor();
}
// Type at the end of the text field. The caret is placed through the selection API because the End key scrolls the page on macOS,
// which takes a field below the fold out of view, and a field that is out of view is not checked.
async function typeAtEnd(text) {
  await page.evaluate(() => { const t = document.querySelector('#textarea'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); });
  await page.keyboard.type(text);
}
async function placeSelection(host, needle) {
  await page.evaluate(([host, needle]) => {
    const root = document.querySelector(host), walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let found; for (let n; (n = walker.nextNode());) if (n.data.includes(needle)) { found = n; break; }
    (root.closest('[contenteditable]') ?? root).focus();
    const range = document.createRange(); range.setStart(found, found.data.indexOf(needle)); range.setEnd(found, found.data.indexOf(needle) + needle.length);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  }, [host, needle]);
}
async function selectIn(host, needle) { await placeSelection(host, needle); await inline.locator('.badge').waitFor(); }
async function placeCaret(host, needle) {
  await page.evaluate(([host, needle]) => {
    const root = document.querySelector(host), walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let found; for (let n; (n = walker.nextNode());) if (n.data.includes(needle)) { found = n; break; }
    (root.closest('[contenteditable]') ?? root).focus();
    const range = document.createRange(); range.setStart(found, found.data.indexOf(needle) + needle.length); range.collapse(true);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  }, [host, needle]);
}
async function caretAfter(host, needle) { await placeCaret(host, needle); await inline.locator('.badge').waitFor(); }

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
  assert.match(await inline.locator('.warn').textContent(), /Check this version: it changes a number or date, a name or capitalised word, mention or link, a negation\./);
  await rewriteAnswer('Yesterday Maya settled $1,250 on Monday.');
  await press('Try again'); await inline.locator('.suggested').waitFor(el => el.textContent === 'Yesterday Maya settled $1,250 on Monday.');
  assert.equal(await inline.locator('.warn').count(), 0);
});

test('"already reads well" shows no preview and keeps the proofreading suggestions; Back restores them too', async () => {
  await load(); await proofreadAnswer();
  await useTextarea('He go to work.'); await typeAtEnd(' ');
  await page.waitForFunction(() => fixture.worker.turns.length > 0, null, {timeout: 8000}); await inline.locator('.underline').waitFor();
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

// X's composer is Draft.js: React owns the text leaf and later updates only that node. Replacing all of a leaf's text in one command
// makes the browser remove it, and the editor then edits a model the page no longer shows (text that cannot be typed over or deleted).
for (const [how, prepare] of [['the caret paragraph', () => caretAfter('#owned-draft', 'late.')], ['a select-all selection', async () => { await placeSelection('#owned-draft', 'He go to work and they was late.'); await inline.locator('.badge').waitFor(); }]]) {
  test(`a whole-text rewrite (${how}) leaves an editor's own text node in place, so typing and deleting still reach the page`, async () => {
    await load(); await rewriteAnswer('He goes to work and they were late.');
    await prepare(); await openCard(); await press('Paraphrase'); await suggested();
    await press('Replace'); await inline.locator('.badge').waitFor(el => /^Applied\./.test(el.getAttribute('aria-label')));
    assert.match(await label(), /two presses/); // The edit is two steps in the editor's history.
    const shown = () => text('#owned-draft'), model = () => page.evaluate(() => ownedDraft.model.text);
    assert.equal(await shown(), 'He goes to work and they were late.'); assert.equal(await model(), await shown());
    assert.equal(await page.evaluate(() => ownedDraft.alive()), true, "the editor's leaf is still in the page");
    if (how === 'the caret paragraph') {
      await page.keyboard.type('!'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
      assert.equal(await shown(), 'He goes to work and they were late'); assert.equal(await model(), await shown()); // Typing and deleting land where the caret was.
    }
    await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.press('Backspace'); // Select all is Cmd+A on macOS, where Ctrl+A moves to the line start.
    assert.equal(await shown(), ''); assert.equal(await model(), ''); // Deleting everything empties the page as well as the model.
  });
}

// A whole-text rewrite is two edits. If the second cannot happen the draft must not be left as original + rewrite.
test('a rewrite with spacing the editor would collapse is refused before anything changes', async () => {
  await load(); await rewriteAnswer('He goes to work  and they were late.'); // two spaces
  await page.evaluate(() => { ownedDraft.leaf.style.whiteSpace = 'normal'; }); // this editor collapses them: it renders (and the text map reads) one
  await caretAfter('#owned-draft', 'late.'); await openCard(); await press('Paraphrase'); await suggested();
  await press('Replace'); await inline.locator('#status').waitFor(el => /only copy/.test(el.textContent));
  assert.equal(await text('#owned-draft'), 'He go to work and they was late.'); assert.equal(await page.evaluate(() => ownedDraft.model.text), 'He go to work and they was late.');
  assert.equal(await page.evaluate(() => ownedDraft.alive()), true);
  assert.equal(await inline.button('Copy').count(), 1); // The suggestion can still be copied.
});
test('when the second step of a whole-text rewrite is refused, the first is taken back out', async () => {
  await load(); await rewriteAnswer('He goes to work and they were late.');
  await caretAfter('#owned-draft', 'late.'); await openCard(); await press('Paraphrase'); await suggested();
  await page.evaluate(() => { ownedDraft.refuseDeletes = 1; }); // the deletion of the old text is refused once; taking the new text back out is not
  await press('Replace'); await inline.locator('#status').waitFor(el => /copy-only|did not apply/.test(el.textContent));
  assert.equal(await text('#owned-draft'), 'He go to work and they was late.'); assert.equal(await page.evaluate(() => ownedDraft.model.text), 'He go to work and they was late.');
  assert.equal(await page.evaluate(() => ownedDraft.alive()), true);
});

test('a rewrite the field refuses is rolled back and its preview stays available to copy after the next poll', async () => {
  await load(); await rewriteAnswer('He goes to work and they were late.');
  await useTextarea('He go to work.'); await page.locator('#textarea').evaluate(el => { el.maxLength = 15; el.setSelectionRange(14, 14); });
  await openCard(); await press('Improve it'); await suggested(); await press('Replace');
  await inline.locator('#status').waitFor(el => /Original text restored/.test(el.textContent));
  assert.equal(await page.locator('#textarea').inputValue(), 'He go to work.');
  await page.waitForTimeout(700); // The poll used to clear the card about 250 ms after a refused edit.
  assert.match(await inline.locator('#status').textContent(), /Original text restored/);
  assert.equal(await inline.locator('.suggested').textContent(), 'He goes to work and they were late.');
  assert.equal(await inline.button('Copy').count(), 1); assert.equal(await inline.button('Replace').isDisabled(), true);
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

// Failures of an explicit rewrite are not failed checks: the proofreading suggestions set aside for it come back, automatic
// checking keeps working, and the card shows the reason.
for (const [fault, expected] of [['the worker goes away', 'Lineleaf could not complete this action.'], ['no connection can be made', 'Lineleaf could not complete this action.'], ['the provider never answers', 'The provider did not answer in time']]) {
  test(`a rewrite fails cleanly when ${fault}: suggestions come back and automatic checking stays on`, async () => {
    await load(); await proofreadAnswer();
    await useTextarea('He go to work.'); await openCard(); await press('Check now'); await inline.locator('.underline').waitFor();
    await rewriteAnswer('He goes to work.');
    await page.evaluate(fault => {
      if (fault === 'the worker goes away') fixture.faults.drop = true;
      else if (fault === 'no connection can be made') fixture.faults.connect = true;
      else { fixture.worker.hold = true; const real = window.setTimeout; window.setTimeout = (fn, ms, ...args) => real(fn, ms === 125000 ? 50 : ms, ...args); } // shorten only the watchdog
    }, fault);
    await openCard(); await press('Improve it');
    await inline.locator('#status').waitFor((el, text) => el.textContent.startsWith(text), expected);
    assert.equal(await inline.locator('.underline').count(), 1); // the set-aside correction is back
    assert.equal(await inline.locator('.suggested').count(), 0);
    await page.evaluate(() => { fixture.worker.hold = false; fixture.worker.answer = '{"corrections":[]}'; fixture.checks.length = 0; });
    await typeAtEnd(' ');
    await page.waitForFunction(() => fixture.checks.some(x => x.kind === 'automatic'), null, {timeout: 8000}); // not blocked
  });
}

test('Lineleaf’s Undo survives the follow-up proofreading check until the text is edited', async () => {
  await load(); await rewriteAnswer('He goes to work.');
  await useTextarea('He go to work.');
  await openCard(); await press('Improve it'); await suggested(); await press('Replace'); await inline.button('Undo last edit').waitFor();
  await page.evaluate(() => { fixture.worker.answer = '{"corrections":[]}'; });
  await page.keyboard.press('Escape'); // back to the field, as a user would
  await page.waitForFunction(() => fixture.checks.some(x => x.kind === 'automatic'), null, {timeout: 8000});
  await inline.locator('.badge').waitFor(el => /No corrections suggested/.test(el.getAttribute('aria-label')));
  await openCard(); await press('Undo last edit'); await inline.locator('.badge').waitFor(el => /Undone/.test(el.getAttribute('aria-label')));
  assert.equal(await page.locator('#textarea').inputValue(), 'He go to work.');
  await load(); await rewriteAnswer('He goes to work.');
  await useTextarea('He go to work.');
  await openCard(); await press('Improve it'); await suggested(); await press('Replace'); await inline.button('Undo last edit').waitFor();
  await page.locator('#textarea').focus(); await page.keyboard.type('!'); // real typing does end it
  await inline.locator('.badge').waitFor(el => /Text changed/.test(el.getAttribute('aria-label')));
  await openCard(); assert.equal(await inline.button('Undo last edit').count(), 0);
});

test('a selection Lineleaf cannot use is refused, never widened to the paragraph', async () => {
  await load(); await rewriteAnswer('x');
  await selectIn('#prose', '.'); // punctuation only: no letters to rewrite
  await openCard(); await press('Improve it');
  await inline.locator('#status').waitFor(el => /Rewrites need 1–2,000 characters of text with letters inside one paragraph/.test(el.textContent));
  await page.evaluate(() => { // from the first paragraph into the second
    const [first, second] = document.querySelectorAll('#prose p'); (first.closest('[contenteditable]')).focus();
    const range = document.createRange(); range.setStart(first.firstChild, 6); range.setEnd(second.firstChild, 5);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  await openCard(); await press('Paraphrase');
  await inline.locator('#status').waitFor(el => /Rewrites need 1–2,000 characters of text with letters inside one paragraph/.test(el.textContent));
  assert.deepEqual(await requests(), []);
  await caretAfter('#prose', 'work.'); await openCard(); await press('Improve it'); await suggested(); // an empty selection still means the paragraph
  assert.deepEqual(await requests(), [{mode: 'improve', kind: 'manual', text: 'He go to work.'}]);
});

for (const [host, model] of [['#model-slate', 'modelSlate'], ['#model-draft', 'modelDraft']]) {
  test(`${host}: a selection rewrite in an editor that rebuilds its blocks is replaced and verified, and stays replaceable`, async () => {
    await load(); await rewriteAnswer('goes to work');
    await selectIn(host, 'go to work'); await openCard(); await press('Paraphrase'); await suggested();
    await press('Replace'); await inline.locator('.badge').waitFor(el => /^Applied\./.test(el.getAttribute('aria-label')));
    assert.deepEqual(await page.evaluate(model => window[model].lines, model), ['Intro paragraph.', 'He goes to work.']);
    assert.equal(await text(host), 'Intro paragraph.\nHe goes to work.');
    await rewriteAnswer('He works.'); // the editor was not marked unsafe: the next rewrite can still be replaced
    await caretAfter(host, 'work.'); await openCard(); await press('Improve it'); await suggested();
    assert.equal(await inline.button('Replace').count(), 1); assert.equal(await inline.button('Replace').isDisabled(), false);
  });
}

test('a selection replacement whose surroundings the editor changes is detected, even when the selected words are right', async () => {
  await load(); await rewriteAnswer('goes to work');
  await selectIn('#mangling', 'go to work'); await openCard(); await press('Paraphrase'); await suggested();
  await press('Replace');
  // Which message the failure shows (did not apply, not what Lineleaf expected, reverted) depends on timing and the overlay's poll
  // replaces it within a fraction of a second, so assert the stable outcome: the editor is left as it made itself, and from here on
  // it is copy-only. The rebuilt paragraph detaches the checked one, which the overlay reports once the apply has finished.
  await page.waitForFunction(() => document.querySelector('#mangling').textContent.includes('work!'));
  await inline.locator('.badge').waitFor(el => /The editor changed/.test(el.getAttribute('aria-label')));
  assert.ok((await text('#mangling')).includes('He goes to work!'));
  await rewriteAnswer('He works!'); await caretAfter('#mangling', 'work!'); await openCard(); await press('Improve it'); await suggested();
  assert.equal(await inline.button('Replace').count(), 0); assert.match(await inline.locator('.note').textContent(), /Copy-only editor/);
});

test('a selection rewrite in a verified rich editor is proofread again as the whole paragraph', async () => {
  await load(); await rewriteAnswer('goes to work');
  await selectIn('#prose', 'go to work'); await openCard(); await press('Paraphrase'); await suggested();
  await page.evaluate(() => { fixture.worker.answer = '{"corrections":[]}'; fixture.checks.length = 0; });
  await press('Replace'); await inline.locator('.badge').waitFor(el => /^Applied\./.test(el.getAttribute('aria-label')));
  await page.waitForFunction(() => fixture.checks.some(x => x.kind === 'automatic'), null, {timeout: 8000});
  assert.deepEqual((await requests()).filter(x => x.kind === 'automatic'), [{mode: 'proofread', kind: 'automatic', text: 'He goes to work.'}]);
});

// F-03: explicit rewrites do not need the automatic opt-in. On an enabled, unpaused site the card is built only when the user presses
// Alt Shift L in a field; nothing is read or sent until an action inside it names the text.
const MANUAL = 'https://rewrite.lineleaf.test/compose';
async function focusTextarea(value, selection) {
  await page.evaluate(([value, selection]) => { const t = document.querySelector('#textarea'); t.value = value; t.focus(); t.setSelectionRange(...selection); }, [value, selection]);
}
const inlineHosts = () => page.locator('[data-lineleaf-inline]').count();

test('with automatic checking off nothing is built, read or sent until Alt Shift L, and then only the explicit action sends', async () => {
  await load(MANUAL); await rewriteAnswer('He goes to work.');
  await focusTextarea('Intro. He go to work. Bye.', [26, 26]); await page.keyboard.type(' still typing');
  await page.waitForTimeout(2300); // longer than the automatic idle window
  assert.deepEqual(await requests(), []); assert.equal(await inlineHosts(), 0);
  await focusTextarea('Intro. He go to work. Bye.', [7, 21]); // "He go to work."
  await openCard();
  assert.deepEqual(await requests(), []); // opening the card reads and sends nothing
  assert.match(await inline.locator('#status').textContent(), /Automatic checking is off, so nothing is sent until you choose/);
  await press('Improve it'); await suggested();
  assert.deepEqual(await requests(), [{mode: 'improve', kind: 'manual', text: 'He go to work.'}]);
  assert.match(await inline.locator('.category').textContent(), /Selected text/);
  await press('Replace'); await inline.button('Undo last edit').waitFor();
  assert.equal(await page.locator('#textarea').inputValue(), 'Intro. He goes to work. Bye.');
  await page.waitForTimeout(2300); assert.equal((await requests()).length, 1); // the replacement queues no proofreading check
  await press('Undo last edit'); await inline.locator('.badge').waitFor(el => /Undone/.test(el.getAttribute('aria-label')));
  assert.equal(await page.locator('#textarea').inputValue(), 'Intro. He go to work. Bye.');
});

test('with automatic checking off, typing after the card is open says the text changed and sends nothing', async () => {
  await load(MANUAL); await rewriteAnswer('He goes to work.');
  await focusTextarea('He go to work.', [14, 14]); await openCard(); await press('✕');
  await page.locator('#textarea').focus(); await page.keyboard.type('!');
  await inline.locator('.badge').waitFor(el => /The text changed\. Choose Check now or a rewrite/.test(el.getAttribute('aria-label')));
  await page.waitForTimeout(2300);
  assert.deepEqual(await requests(), []);
});

test('Check now with automatic checking off is one explicit proofreading request', async () => {
  await load(MANUAL); await proofreadAnswer();
  await focusTextarea('He go to work.', [14, 14]); await openCard(); await press('Check now'); await inline.locator('.underline').waitFor();
  assert.deepEqual(await requests(), [{mode: 'proofread', kind: 'manual', text: 'He go to work.'}]);
});

test('on demand in rich editors: a verified editor replaces through its own path, a copy-only host only copies', async () => {
  await load(MANUAL); await rewriteAnswer('He goes to work.');
  await placeCaret('#prose', 'work.'); assert.equal(await inlineHosts(), 0);
  await openCard(); await press('Improve it'); await suggested();
  assert.equal(await inline.button('Replace').isDisabled(), false);
  await press('Replace'); await inline.locator('.badge').waitFor(el => /^Applied\./.test(el.getAttribute('aria-label')));
  assert.equal(await line('#prose'), 'He goes to work.');
  await load('https://mail.google.com/mail/u/0/'); await rewriteAnswer('He goes to work.');
  await placeCaret('#prose', 'work.'); await openCard(); await press('Improve it'); await suggested();
  assert.equal(await inline.button('Replace').count(), 0); assert.match(await inline.locator('.note').textContent(), /Copy-only editor/);
  assert.equal(await line('#prose'), 'He go to work.');
});

// Counts every card host added to the page, so a card that is built and torn down within one poll is still seen.
const watchHosts = () => page.evaluate(() => {
  window.__hostsBuilt = 0;
  new MutationObserver(records => { for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1 && n.hasAttribute('data-lineleaf-inline')) window.__hostsBuilt++; }).observe(document.documentElement, {childList: true});
});
const hostsBuilt = () => page.evaluate(() => window.__hostsBuilt);

test('pausing Lineleaf removes the on-demand card, and the shortcut builds nothing while paused', async () => {
  await load(MANUAL);
  await focusTextarea('He go to work.', [0, 14]); await openCard(); await press('Pause Lineleaf');
  await page.waitForFunction(() => document.querySelectorAll('[data-lineleaf-inline]').length === 0);
  await watchHosts(); await focusTextarea('He go to work.', [0, 14]); await page.keyboard.press('Alt+Shift+l'); await page.waitForTimeout(600);
  assert.equal(await hostsBuilt(), 0); assert.deepEqual(await requests(), []);
});

test('the shortcut builds nothing in a field Lineleaf excludes, even with automatic checking off', async () => {
  await load(MANUAL); await watchHosts();
  await page.evaluate(() => document.querySelector('#secret').focus()); await page.keyboard.press('Alt+Shift+l'); await page.waitForTimeout(600);
  assert.equal(await hostsBuilt(), 0); assert.deepEqual(await requests(), []);
});

// The promise is literal: until an action names what to check, the field's text is not read, by opening the card or by typing.
test('with automatic checking off the field is not read by opening the card or by typing, only by the action that names the text', async () => {
  await load(MANUAL); await proofreadAnswer();
  await page.evaluate(() => {
    window.__reads = 0; const real = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    Object.defineProperty(HTMLTextAreaElement.prototype, 'value', {...real, get() { if (this.id === 'textarea') window.__reads++; return real.get.call(this); }});
  });
  const reads = () => page.evaluate(() => window.__reads), full = 'Intro paragraph. He go to work. Bye.';
  await focusTextarea(full, [full.length, full.length]); await page.keyboard.type(' typing'); assert.equal(await reads(), 0);
  await focusTextarea(full, [17, 31]); await openCard(); assert.equal(await reads(), 0); // opening the card
  await press('✕'); await focusTextarea(full, [full.length, full.length]); await page.keyboard.type('!'); assert.equal(await reads(), 0); // editing after it opened
  await openCard(); await press('Check now'); await inline.locator('.underline').waitFor(); assert.ok(await reads() > 0); // the action reads
});

test('with automatic checking off, typing in a rich editor reads nothing more and says the text changed', async () => {
  await load(MANUAL);
  await page.evaluate(() => {
    window.__reads = 0; const real = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
    Object.defineProperty(Node.prototype, 'textContent', {...real, get() { if (this.id === 'prose') window.__reads++; return real.get.call(this); }});
  });
  const reads = () => page.evaluate(() => window.__reads);
  await placeCaret('#prose', 'work.'); await openCard(); await press('✕'); const opened = await reads();
  await page.keyboard.type('!'); await page.keyboard.type('?');
  await inline.locator('.badge').waitFor(el => /The text changed\. Choose Check now or a rewrite/.test(el.getAttribute('aria-label')));
  assert.equal(await reads(), opened); assert.deepEqual(await requests(), []);
});

// Live report: a slow provider made the card vanish while "working", reappear with a timeout, and look dead. An explicit action
// keeps the card open with progress and Cancel, always says why it did not happen, and works again afterwards.
test('while a request runs the card stays open with progress, the actions are disabled and Cancel check stops it', async () => {
  await load(); await proofreadAnswer(); await useTextarea('He go to work.');
  await page.evaluate(() => { fixture.worker.hold = true; });
  await openCard(); await press('Improve it');
  await inline.locator('#status').waitFor(el => /^Working on “Improve it” with your provider/.test(el.textContent));
  await inline.locator('[data-elapsed]').waitFor(el => /^Waiting for the provider… \d+ s\. Choose Cancel check to stop\.$/.test(el.textContent));
  assert.equal(await inline.button('Improve it').isDisabled(), true); assert.equal(await inline.button('Check now').isDisabled(), true);
  assert.equal(await inline.button('Cancel check').isDisabled(), false);
  await press('Cancel check'); await inline.locator('#status').waitFor(el => /^Cancelled/.test(el.textContent));
  assert.equal(await inline.button('Improve it').isDisabled(), false); assert.equal(await inline.locator('[data-elapsed]').count(), 0);
  await page.evaluate(() => { fixture.worker.hold = false; fixture.worker.answer = '{"rewrite":"He goes to work."}'; });
  await press('Improve it'); await suggested();
});

test('an action Lineleaf refuses says why instead of doing nothing, and works once the reason is gone', async () => {
  await load(); await proofreadAnswer(); await useTextarea('He go to work.');
  await page.locator('#textarea').evaluate(el => el.dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true})));
  await openCard(); await press('Check now');
  await inline.locator('#status').waitFor(el => /^Finish the text you are composing/.test(el.textContent));
  assert.deepEqual(await requests(), []);
  await page.locator('#textarea').evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', {bubbles: true})));
  await openCard(); await press('Check now'); await inline.locator('.underline').waitFor();
});

test('a Check now that times out reopens the card with the reason, and the next click works', async () => {
  await load(); await proofreadAnswer(); await useTextarea('He go to work.');
  await page.evaluate(() => { fixture.worker.hold = true; const real = window.setTimeout; window.setTimeout = (fn, ms, ...args) => real(fn, ms === 125000 ? 50 : ms, ...args); }); // shorten only the explicit watchdog
  await openCard(); await press('Check now');
  await inline.locator('#status').waitFor(el => el.textContent.startsWith('The provider did not answer in time'));
  assert.equal(await inline.button('Check now').isDisabled(), false); assert.equal(await inline.button('Improve it').isDisabled(), false);
  await page.evaluate(() => { fixture.worker.hold = false; });
  await press('Check now'); await inline.locator('.underline').waitFor();
});

// The hold that follows a provider timeout is temporary: an editor refused during it must try again by itself afterwards.
test('an automatic check refused during the provider hold is retried after it, instead of leaving the editor blocked', async () => {
  await load(); await proofreadAnswer(); await useTextarea('He go to work.');
  await page.evaluate(() => { // the worker's 90-second turn limit becomes 50 ms; retries that would wait minutes wait three seconds
    fixture.worker.hold = true; const real = window.setTimeout;
    window.setTimeout = (fn, ms, ...args) => real(fn, ms === 90000 ? 50 : ms >= 250000 && ms < 300000 ? 3000 : ms, ...args);
  });
  await openCard(); await press('Check now');
  await inline.locator('#status').waitFor(el => el.textContent.startsWith('The provider did not answer in time')); // sets the hold
  await page.evaluate(() => { fixture.worker.hold = false; });
  await press('Cancel check'); await typeAtEnd(' '); // unblocked; the next automatic check is refused by the hold
  await inline.locator('.badge').waitFor(el => /Automatic checking is paused/.test(el.getAttribute('aria-label')));
  await page.evaluate(() => { const real = Date.now; Date.now = () => real.call(Date) + 301000; }); // the five minutes pass
  await inline.locator('.underline').waitFor(); // retried by itself and answered
  assert.deepEqual((await requests()).map(x => x.kind), ['manual', 'automatic', 'automatic']);
});
