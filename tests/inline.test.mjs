import assert from 'node:assert/strict';
import {test, before, after, beforeEach} from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {panelFor} from './fixtures/panel-driver.mjs';
let browser, page, inline;
before(async () => {
  browser = await chromium.launch({executablePath: process.env.LINELEAF_CHROMIUM_PATH || undefined,
    args: process.env.LINELEAF_CHROMIUM_SINGLE_PROCESS === '1' ? ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--single-process'] : []});
  page = await browser.newPage(); inline = panelFor(page, {attribute: 'data-lineleaf-inline'});
  await page.route('https://inline.lineleaf.test/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    const files = new Map([['/content.js', '../dist/lineleaf/content.js'], ['/controller-bridge.mjs', './fixtures/controller-bridge.mjs'], ['/test-api.mjs', './fixtures/extension-api.mjs']]);
    const file = files.get(path) ?? (['controller.mjs', 'native-seatline.mjs', 'policy.mjs', 'candidates.mjs', 'editor-policy.mjs'].some(x => path === `/lib/${x}`) ? `../dist/lineleaf${path}` : './fixtures/selection.html');
    let body = await readFile(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    if (file.endsWith('.html')) body = body.replace('<script src="/content.js"></script>', '<script type="module" src="/controller-bridge.mjs"></script>');
    await route.fulfill({body, contentType: /\.m?js$/.test(file) ? 'text/javascript' : 'text/html'});
  });
});
after(async () => { await browser?.close(); });
beforeEach(async () => { await page.context().setOffline(false); await page.goto('https://inline.lineleaf.test/?automatic'); await page.waitForFunction(() => window.__lineleafMounted); });
const sends = () => page.evaluate(() => fixture.worker.turns);
const settings = patch => page.evaluate(async patch => {
  const p = fixture.worker.data.preferences;
  const expected = Object.fromEntries(Object.keys(patch).map(key => [key, p[key]]));
  return fixture.worker.rpc('save-settings', {changes: patch, expected, dictionary: {add: [], remove: []}});
}, patch);
async function type(id = 'textarea', value = 'He go to work.') { await page.locator(`#${id}`).fill(value); }
async function result() { await page.waitForFunction(() => fixture.worker.turns.length > 0); await inline.locator('.underline').waitFor(); }
async function open() { await page.keyboard.press('Alt+Shift+l'); await inline.locator('#card-title').waitFor(); }
const idle = () => page.waitForTimeout(1700);
test('automatic mode is opt-in and focusing prefilled text alone never sends a request', async () => {
  await page.locator('#textarea').focus(); await idle(); assert.equal((await sends()).length, 0);
  await settings({automatic: false}); await type(); await idle(); assert.equal((await sends()).length, 0);
  assert.equal(await page.locator('[data-lineleaf-inline]').count(), 0);
});
test('idle debounce coalesces typing and sends only the latest active paragraph', async () => {
  await type('textarea', 'He go to work'); await page.waitForTimeout(700); await page.keyboard.type('.');
  assert.equal((await sends()).length, 0); await page.waitForTimeout(700); assert.equal((await sends()).length, 0);
  await result(); const requests = await sends(); assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0].params.messages[0].text), {text: 'He go to work.'});
  assert.equal(await page.locator('#textarea').inputValue(), 'He go to work.');
  await page.keyboard.press('ArrowLeft'); await idle(); assert.equal((await sends()).length, 1);
});
for (const id of ['textarea', 'input', 'controlled', 'editable']) {
  test(`inline ${id}: keyboard review/accept, formatting/state and native undo`, async () => {
    if (id === 'editable') { await page.locator('#editable').evaluate(el => el.firstChild.textContent = 'He '); await page.locator('#editable').focus(); await page.keyboard.press('End'); await page.keyboard.type(' '); }
    else await type(id);
    const original = await page.locator(`#${id}`).evaluate(el => el.value ?? el.textContent);
    await result(); await open();
    assert.equal(await inline.locator('.category').textContent(), 'Grammar');
    assert.equal(await inline.locator('.explanation').textContent(), 'Subject agreement');
    assert.equal(await page.locator('[data-lineleaf-inline]').evaluate(el => el.shadowRoot), null);
    await inline.button('Accept').evaluate(el => el.focus()); await page.keyboard.press('Enter');
    const value = await page.locator(`#${id}`).evaluate(el => el.value ?? el.textContent); assert.match(value, /He goes to work\./);
    if (id === 'controlled') assert.equal(await page.evaluate(() => controlledState), value);
    if (id === 'editable') assert.equal(await page.locator('#editable strong').textContent(), 'goes');
    await inline.button('Undo last edit').click(); assert.equal(await page.locator(`#${id}`).evaluate(el => el.value ?? el.textContent), original);
  });
}
test('IME composition prevents a check, and final typing restarts the idle window', async () => {
  await page.locator('#textarea').focus();
  await page.locator('#textarea').evaluate(el => el.dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true})));
  await type(); await idle(); assert.equal((await sends()).length, 0);
  await page.locator('#textarea').evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', {bubbles: true})));
  await page.keyboard.type(' '); await result(); assert.equal((await sends()).length, 1);
});
test('sensitive/excluded/read-only fields and oversized paragraphs never reach the provider', async () => {
  for (const id of ['password', 'card']) { await page.locator(`#${id}`).fill('He go to work.'); }
  await page.locator('#editable').evaluate(el => { el.innerHTML = 'He <span data-lineleaf-ignore>go</span> to work.'; });
  await page.locator('#editable').focus(); await page.keyboard.press('End'); await page.keyboard.type(' ');
  await type('textarea', 'a'.repeat(2001)); await idle(); assert.equal((await sends()).length, 0);
  await page.locator('#textarea').evaluate(el => { el.readOnly = true; el.value = 'He go to work.'; el.dispatchEvent(new InputEvent('input', {bubbles: true})); });
  await idle(); assert.equal((await sends()).length, 0);
});
test('synthetic page input cannot start an automatic request', async () => {
  await page.locator('#textarea').focus();
  await page.locator('#textarea').evaluate(el => { el.value = 'He go to work.'; el.dispatchEvent(new InputEvent('input', {bubbles: true})); });
  await idle(); assert.equal((await sends()).length, 0);
});
test('typing cancels in-flight work, drops late output, and explicit retry uses the latest source', async () => {
  await page.evaluate(() => { fixture.worker.hold = true; }); await type();
  await page.waitForFunction(() => fixture.worker.turns.length > 0);
  await page.keyboard.type(' Now.'); await page.waitForFunction(() => fixture.worker.calls.some(x => x.method === 'cancel'));
  await page.evaluate(() => { const p = fixture.worker.ports[0], request = p.sent.find(x => x.method === 'send' || x.method === 'send_ready_with_policy'); p.reply(request.id, {type: 'delta', text: '{"corrections":[]}'}); p.reply(request.id, {type: 'completed'}); fixture.worker.hold = false; });
  assert.equal(await inline.locator('.underline').count(), 0);
  await open(); await inline.button('Check now').click(); await result();
  assert.deepEqual(JSON.parse((await sends()).at(-1).params.messages[0].text), {text: 'He go to work. Now.'});
});
test('dictionary, UK variant, global pause and reset change the production checking path', async () => {
  await page.evaluate(() => { fixture.worker.answer = '{"corrections":[{"before":"go","after":"goes","left":"He ","right":" to","category":"spelling","explanation":"Synthetic spelling example"}]}'; });
  await type(); await result(); await open(); await inline.button('Add to dictionary').click();
  await page.waitForFunction(() => fixture.worker.data.preferences.dictionary.includes('go'));
  await settings({variant: 'UK'}); await type('textarea', 'He go to work. Again.');
  await page.waitForSelector('[data-lineleaf-inline]', {state: 'attached'}); await open(); await inline.button('Check now').click();
  await page.waitForFunction(() => fixture.worker.turns.length === 2);
  await inline.locator('.badge').waitFor(el => el.getAttribute('aria-label').includes('No corrections'));
  assert.equal(await inline.locator('.underline').count(), 0); assert.match((await sends()).at(-1).params.system, /British/);
  await open(); await inline.button('Pause Lineleaf').click(); await page.waitForFunction(() => fixture.worker.data.preferences.paused);
  assert.equal(await page.locator('[data-lineleaf-inline]').count(), 0);
  await page.evaluate(() => fixture.worker.rpc('reset')); await type(); await idle(); assert.equal((await sends()).length, 2);
  assert.deepEqual(await page.evaluate(() => fixture.worker.data), {});
});
test('underlines follow textarea scrolling and layout shifts without editing its DOM', async () => {
  await page.locator('#textarea').evaluate(el => { el.value = 'Unrelated first line.\nHe go to work.\n' + 'Other line.\n'.repeat(20); el.style.height = '100px'; el.focus(); const caret = el.value.indexOf('He go') + 'He go to work.'.length; el.setSelectionRange(caret, caret); });
  await page.keyboard.type(' '); await result();
  assert.match(JSON.parse((await sends())[0].params.messages[0].text).text, /^He go to work/);
  await page.locator('#textarea').evaluate(el => { el.scrollTop = 0; });
  await page.waitForTimeout(300); // Wait for scroll layout/overlay paint after the browser's caret auto-scroll.
  const before = await inline.locator('.underline').evaluate(el => el.getBoundingClientRect().top);
  await page.locator('#textarea').evaluate(el => { el.scrollTop = 10; });
  assert.equal(await page.locator('#textarea').evaluate(el => el.scrollTop), 10);
  await inline.locator('.underline').waitFor((el, before) => el.getBoundingClientRect().top < before - 5, before);
  const after = await inline.locator('.underline').evaluate(el => el.getBoundingClientRect().top);
  assert.ok(after < before); assert.equal(await page.locator('#textarea').evaluate(el => el.childNodes.length), 1);
  await page.locator('#textarea').evaluate(el => { el.style.marginTop = '120px'; });
  await inline.locator('.underline').waitFor((el, after) => el.getBoundingClientRect().top > after + 100, after);
  assert.equal((await sends()).length, 1); // Layout-only changes retain the exact source and suggestion.
  await open(); assert.equal(await inline.button('Accept').isDisabled(), false);
});
test('moving the caret to an unrelated paragraph before idle sends neither paragraph', async () => {
  await type('textarea', 'He go to work.\nOther paragraph.');
  await page.locator('#textarea').evaluate(el => el.setSelectionRange(0, 0));
  await idle(); assert.equal((await sends()).length, 0);
});
test('keyboard Tab/Escape controls and accessibility tree expose the suggestion and actions', async () => {
  await type(); await result(); await open();
  const cdp = await page.context().newCDPSession(page), tree = await cdp.send('Accessibility.getFullAXTree');
  assert.ok(tree.nodes.some(x => x.role?.value === 'button' && x.name?.value === 'Accept suggestion: goes'));
  assert.ok(tree.nodes.some(x => x.role?.value === 'region' && x.name?.value === 'Lineleaf suggestions'));
  await page.keyboard.press('Tab'); // Close.
  await page.keyboard.press('Tab'); // Accept: the primary action follows the heading, the explanation disclosure comes after the buttons.
  assert.equal(await inline.button('Accept').evaluate(el => el.getRootNode().activeElement === el), true);
  for (const name of ['Dismiss', 'Copy']) { await page.keyboard.press('Tab'); assert.equal(await inline.button(name).evaluate(el => el.getRootNode().activeElement === el), true, name); }
  await page.keyboard.press('Tab'); assert.equal(await inline.locator('summary').evaluate(el => el.getRootNode().activeElement === el), true); // Why this suggestion?
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab');
  assert.equal(await inline.button('Accept').evaluate(el => el.getRootNode().activeElement === el), true);
  await page.keyboard.press('Enter'); assert.equal(await page.locator('#textarea').inputValue(), 'He goes to work.');
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#textarea').evaluate(el => document.activeElement === el), true);
  await cdp.detach();
});
test('the manual panel keeps the selected field when an inline card holds focus', async () => {
  await type(); await result(); await open();
  await page.locator('#textarea').evaluate(el => el.setSelectionRange(0, el.value.length));
  assert.equal(await page.locator('[data-lineleaf-inline]').evaluate(el => document.activeElement === el), true);
  await page.evaluate(() => fixture.runtimeMessages.emit({type: 'lineleaf-open'}, {id: chrome.runtime.id}));
  const panel = panelFor(page); await panel.button('Check selection').waitFor();
  assert.equal(await panel.locator('#selected').textContent(), 'He go to work.');
  await panel.button('Check selection').click(); await panel.button('Accept').waitFor();
  assert.equal((await sends()).length, 2);
});
test('typing announces a repeated idle message once and still announces state transitions', async () => {
  await page.locator('#textarea').focus(); await inline.locator('.badge').waitFor();
  await inline.locator('.sr').evaluate(el => {
    globalThis.__announcements = [];
    new MutationObserver(() => globalThis.__announcements.push(el.textContent)).observe(el, {childList: true, characterData: true, subtree: true});
  });
  await page.keyboard.press('End'); await page.keyboard.type(' Fifteen letters');
  assert.deepEqual(await page.evaluate(() => globalThis.__announcements), ['Text changed. Checking after a pause.']);
  await result();
  assert.deepEqual(await page.evaluate(() => globalThis.__announcements), ['Text changed. Checking after a pause.', 'Checking with Codex… You can keep typing.', '1 suggestion. Review before accepting.']);
});
test('disabled site, revoked permission and removed field cancel work and remove all previews', async () => {
  for (const change of ['disable', 'revoke', 'remove']) {
    await page.goto('https://inline.lineleaf.test/?automatic'); await page.waitForFunction(() => window.__lineleafMounted);
    await page.evaluate(() => { fixture.worker.hold = true; }); await type(); await page.waitForFunction(() => fixture.worker.turns.length > 0);
    await page.evaluate(async change => {
      if (change === 'disable') await fixture.worker.rpc('set-site', {origin: location.origin, enabled: false});
      else if (change === 'revoke') await fixture.worker.api.permissions.remove({origins: [`${location.protocol}//${location.hostname}/*`]});
      else textarea.remove();
    }, change);
    await page.waitForFunction(() => fixture.worker.calls.some(x => x.method === 'cancel'));
    await page.waitForSelector('[data-lineleaf-inline]', {state: 'detached'}); assert.equal((await sends()).length, 1);
  }
});
test('offline flow cancels work, offers a fixed error, and makes no automatic retry on reconnect', async () => {
  await page.evaluate(() => { fixture.worker.hold = true; }); await type(); await page.waitForFunction(() => fixture.worker.turns.length > 0);
  await page.context().setOffline(true); await page.waitForFunction(() => fixture.worker.calls.some(x => x.method === 'cancel'));
  await open(); assert.match(await inline.locator('#status').textContent(), /offline/);
  await page.context().setOffline(false); await idle(); assert.equal((await sends()).length, 1);
});
test('authentication failure stops automatic retries until an explicit check', async () => {
  await page.evaluate(() => { fixture.worker.state.authentication = 'unauthenticated'; }); await type();
  await inline.locator('.badge').waitFor(el => el.getAttribute('aria-label').includes('Sign in'));
  assert.equal((await sends()).length, 0);
  await page.keyboard.type(' Again.'); await idle();
  assert.equal(await page.evaluate(() => fixture.worker.calls.filter(x => x.method === 'status' || x.method === 'readiness').length), 1);
  await page.evaluate(() => { fixture.worker.state.authentication = 'authenticated'; });
  await open(); await inline.button('Check now').click(); await result(); assert.equal((await sends()).length, 1);
});
test('inline editing failure restores the source and keeps the candidate available to copy', async () => {
  await page.locator('#input').evaluate(el => { el.maxLength = 15; }); await type('input'); await result(); await open();
  await inline.button('Accept').click(); assert.equal(await page.locator('#input').inputValue(), 'He go to work.');
  assert.match(await inline.locator('#status').textContent(), /Original text restored/);
  assert.equal(await inline.button('Accept').isDisabled(), true); assert.equal(await inline.button('Copy').count(), 1);
  // The candidate stays after the next poll tick (it used to be cleared about 250 ms later), and goes only when the text changes.
  await page.waitForTimeout(700);
  assert.match(await inline.locator('#status').textContent(), /Original text restored/); assert.equal(await inline.button('Copy').count(), 1);
  assert.equal(await inline.locator('.underline').count(), 1);
  await page.locator('#input').evaluate(el => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }); await page.keyboard.press('Backspace');
  await inline.locator('.badge').waitFor(el => /changed/i.test(el.getAttribute('aria-label')));
  assert.equal(await inline.locator('.underline').count(), 0);
});

const prepares = () => page.evaluate(() => fixture.worker.calls.filter(x => x.method === 'prepare'));
test('an editor Lineleaf may check prepares the provider once, with no text, however often focus moves', async () => {
  await page.locator('#textarea').focus();
  await page.waitForFunction(() => fixture.worker.calls.some(x => x.method === 'prepare'));
  await page.locator('#input').focus(); await page.locator('#textarea').focus(); await idle();
  const calls = await prepares(); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, {mode: 'cached', max_age_ms: 30000});
  assert.equal(JSON.stringify(calls).includes('He go'), false); assert.equal((await sends()).length, 0);
});
test('with automatic checking off nothing is prepared on focus; asking for the card does', async () => {
  await settings({automatic: false}); await page.locator('#textarea').focus(); await idle();
  assert.equal((await prepares()).length, 0, 'focus alone does nothing without the opt-in');
  await open(); await page.waitForFunction(() => fixture.worker.calls.some(x => x.method === 'prepare'));
  assert.equal((await prepares()).length, 1); assert.equal((await sends()).length, 0);
});
test('sensitive and read-only fields and a paused Lineleaf prepare nothing', async () => {
  for (const id of ['password', 'card']) await page.locator(`#${id}`).focus();
  await page.locator('#textarea').evaluate(el => { el.readOnly = true; }); await page.locator('#textarea').focus(); await idle();
  assert.equal((await prepares()).length, 0);
  await page.evaluate(() => fixture.worker.rpc('set-pause', {paused: true}));
  await page.locator('#input').focus(); await idle(); assert.equal((await prepares()).length, 0);
});
