import assert from 'node:assert/strict';
import {test, before, after, beforeEach} from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {panelFor} from './fixtures/panel-driver.mjs';
let browser, page, panel;
before(async () => {
  browser = await chromium.launch({executablePath: process.env.LINELEAF_CHROMIUM_PATH || undefined,
    args: process.env.LINELEAF_CHROMIUM_SINGLE_PROCESS === '1' ? ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--single-process'] : []});
  page = await browser.newPage();
  panel = panelFor(page);
  await page.route('https://selection.lineleaf.test/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    const files = new Map([['/content.js', '../dist/lineleaf/content.js'], ['/controller-bridge.mjs', './fixtures/controller-bridge.mjs'], ['/test-api.mjs', './fixtures/extension-api.mjs']]);
    const file = files.get(path) ?? (['controller.mjs', 'native-seatline.mjs', 'policy.mjs', 'candidates.mjs', 'editor-policy.mjs', 'check-timing.mjs'].some(x => path === `/lib/${x}`) ? `../dist/lineleaf${path}` : './fixtures/selection.html');
    let body = await readFile(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    if (url.searchParams.has('controller')) body = body.replace('<script src="/content.js"></script>', '<script type="module" src="/controller-bridge.mjs"></script>');
    await route.fulfill({body, contentType: /\.m?js$/.test(file) ? 'text/javascript' : 'text/html',
      headers: route.request().url().includes('?strict') ? {'Content-Security-Policy': "require-trusted-types-for 'script'; style-src 'none'"} : {}});
  });
});
after(async () => { await browser?.close(); });
beforeEach(async () => { await page.goto('https://selection.lineleaf.test/'); });
async function open(id = 'textarea', start = 0, end = 14) {
  await page.evaluate(({id, start, end}) => {
    const element = document.getElementById(id); element.focus();
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) element.setSelectionRange(start, end);
    else {
      const range = document.createRange(); range.selectNodeContents(element); const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    }
    fixture.runtimeMessages.emit({type: 'lineleaf-open'}, {id: chrome.runtime.id});
  }, {id, start, end});
  await waitForPanel();
}
async function waitForPanel() {
  await page.waitForSelector('[data-lineleaf-root]', {state: 'attached'});
  await panel.locator('#status').waitFor(el => el.textContent.length > 0);
}
const status = () => panel.locator('#status').textContent();
async function check() {
  await panel.button('Check selection').click();
  await panel.button('Accept').waitFor();
}
for (const id of ['textarea', 'input', 'controlled', 'editable']) {
  test(`selection panel: ${id} previews, accepts and undoes with site state intact`, async () => {
    await open(id); await check();
    assert.equal(await page.locator(`#${id}`).evaluate(el => el.value ?? el.textContent), 'He go to work.');
    await panel.button('Accept').click();
    assert.equal(await page.locator(`#${id}`).evaluate(el => el.value ?? el.textContent), 'He goes to work.');
    if (id === 'controlled') assert.equal(await page.evaluate(() => controlledState), 'He goes to work.');
    if (id === 'editable') assert.equal(await page.locator('#editable strong').textContent(), 'goes');
    await panel.button('Undo last edit').click();
    assert.equal(await page.locator(`#${id}`).evaluate(el => el.value ?? el.textContent), 'He go to work.');
  });
}
test('only selected text is sent; absolute edit mapping preserves surrounding content', async () => {
  await page.locator('#textarea').fill('PREFIX He go to work. SUFFIX');
  await open('textarea', 7, 21); await check();
  assert.equal(await page.evaluate(() => fixture.checks[0].text), 'He go to work.');
  await panel.button('Accept').click();
  assert.equal(await page.locator('#textarea').inputValue(), 'PREFIX He goes to work. SUFFIX');
});
test('real drag selection released outside a text control keeps the active field', async () => {
  for (const id of ['textarea', 'input']) {
    await page.goto('https://selection.lineleaf.test/');
    const box = await page.locator(`#${id}`).boundingBox();
    await page.mouse.move(box.x + 4, box.y + 12); await page.mouse.down();
    await page.mouse.move(box.x + box.width - 8, box.y + 12, {steps: 8});
    await page.mouse.move(box.x + box.width + 40, box.y + 12, {steps: 3});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.mouse.up();
    assert.deepEqual(await page.locator(`#${id}`).evaluate(el => [el.selectionStart, el.selectionEnd, document.activeElement === el]), [0, 14, true]);
    await page.evaluate(() => fixture.runtimeMessages.emit({type: 'lineleaf-open'}, {id: chrome.runtime.id}));
    await waitForPanel(); assert.equal(await panel.locator('#selected').textContent(), 'He go to work.');
    await check(); assert.equal(await page.evaluate(() => fixture.checks[0].text), 'He go to work.');
  }
});
test('selections spanning ignored, hidden, or code descendants never enter preview or a request', async () => {
  for (const markup of ['<span data-lineleaf-ignore>go</span>', '<span aria-hidden="true">go</span>', '<code>go</code>', '<pre>go</pre>']) {
    await page.evaluate(markup => {
      document.getElementById('spanning')?.remove();
      const el = document.createElement('div'); el.id = 'spanning'; el.tabIndex = 0;
      el.innerHTML = `He ${markup} to work.`; document.body.append(el);
    }, markup);
    await open('spanning');
    assert.equal(await panel.button('Check selection').isDisabled(), true);
    assert.equal(await panel.locator('#selected').textContent(), '');
  }
  assert.equal(await page.evaluate(() => fixture.checks.length), 0);
  await page.evaluate(() => { spanning.innerHTML = 'He go to work. <code>unselected code</code>'; });
  await page.locator('#spanning').evaluate(el => {
    el.focus(); const range = document.createRange(); range.setStart(el.firstChild, 0); range.setEnd(el.firstChild, 14);
    getSelection().removeAllRanges(); getSelection().addRange(range); fixture.runtimeMessages.emit({type: 'lineleaf-open'}, {id: chrome.runtime.id});
  });
  await waitForPanel(); await check(); assert.equal(await page.evaluate(() => fixture.checks[0].text), 'He go to work.');
});
test('pause and unavailable diagnostics are preserved both on opening and before checking', async () => {
  await page.evaluate(() => { fixture.code = 'PAUSED'; }); await open();
  assert.equal(await status(), 'Lineleaf is paused. Resume it in settings.');
  assert.equal(await panel.button('Check selection').isDisabled(), true);
  await page.evaluate(() => { fixture.code = null; }); await open();
  await page.evaluate(() => { fixture.code = 'PAUSED'; }); await panel.button('Check selection').click();
  assert.equal(await status(), 'Lineleaf is paused. Resume it in settings.');
  assert.equal(await page.evaluate(() => fixture.checks.length), 0);
  await page.evaluate(() => { fixture.code = 'UNAVAILABLE'; }); await open();
  assert.equal(await status(), 'Lineleaf could not complete this action. Reopen the extension and try again.');
});
test('page scripts cannot read or change the panel through its closed shadow root', async () => {
  await open(); await check();
  assert.deepEqual(await page.locator('[data-lineleaf-root]').evaluate(el => ({root: el.shadowRoot, suggestion: el.querySelector('.after')})), {root: null, suggestion: null});
  assert.equal(await panel.locator('.after').textContent(), 'goes');
  await panel.button('Accept').click(); assert.equal(await page.locator('#textarea').inputValue(), 'He goes to work.');
});
test('bundled panel exchanges a complete check/result with the production worker and transport', async () => {
  await page.goto('https://selection.lineleaf.test/?controller'); await page.waitForFunction(() => window.__lineleafMounted);
  await open(); await check();
  assert.equal(await panel.locator('.after').textContent(), 'goes');
  const sends = await page.evaluate(() => fixture.worker.turns);
  assert.equal(sends.length, 1); assert.deepEqual(sends[0].params.messages, [{role: 'user', text: JSON.stringify({text: 'He go to work.'})}]);
  assert.equal(sends[0].params.session, 'ephemeral'); assert.equal(sends[0].params.tools, 'none');
  await panel.button('Accept').click(); assert.equal(await page.locator('#textarea').inputValue(), 'He goes to work.');
  await panel.button('Undo last edit').click(); assert.equal(await page.locator('#textarea').inputValue(), 'He go to work.');
  assert.equal(await page.evaluate(() => JSON.stringify(fixture.worker.data).includes('He go')), false);
});
test('the panel offers Improve it and Paraphrase through the production worker, flags silent changes and reports "no change"', async () => {
  await page.goto('https://selection.lineleaf.test/?controller'); await page.waitForFunction(() => window.__lineleafMounted);
  await page.locator('#textarea').fill('Maya paid $1,250 on Monday.');
  const modes = await open('textarea', 0, 27).then(() => panel.locator('#mode').evaluate(el => [...el.options].map(option => option.value)));
  assert.deepEqual(modes, ['proofread', 'improve', 'paraphrase', 'clearer', 'shorter', 'formal', 'friendly']);
  await page.evaluate(() => { fixture.worker.answer = JSON.stringify({rewrite: 'Maya settled $2,500 on Monday.'}); });
  await panel.locator('#mode').selectOption('paraphrase'); await check();
  assert.equal(await panel.locator('.category').textContent(), 'Optional style');
  assert.match(await panel.locator('.explanation').evaluate((_, __, all) => all.map(el => el.textContent).join('|')), /Check this version: it changes a number or date\./);
  const sends = await page.evaluate(() => fixture.worker.turns);
  assert.match(sends.at(-1).params.system, /different words/); assert.equal(await page.locator('#textarea').inputValue(), 'Maya paid $1,250 on Monday.');
  await page.evaluate(() => { fixture.worker.answer = JSON.stringify({rewrite: 'Maya paid $1,250 on Monday.'}); });
  await panel.locator('#mode').selectOption('improve'); await panel.button('Check selection').click();
  await panel.locator('#status').waitFor(el => /No change suggested/.test(el.textContent));
  assert.equal(await panel.button('Accept').count(), 0);
});
test('typing and ABA changes cancel work and discard a late response', async () => {
  await page.evaluate(() => { fixture.hold = true; }); await open();
  await panel.button('Check selection').click();
  await page.waitForFunction(() => fixture.checks.length === 1);
  await page.evaluate(() => { textarea.value = 'Changed'; textarea.dispatchEvent(new InputEvent('input')); textarea.value = 'He go to work.'; textarea.dispatchEvent(new InputEvent('input')); fixture.ports[0].result(); });
  assert.match(await status(), /selection changed/i); assert.equal(await panel.button('Accept').count(), 0);
  assert.equal(await page.evaluate(() => fixture.ports[0].closed), true);
});
test('dismiss and explicit cancel never change the field', async () => {
  await open(); await check(); await panel.button('Dismiss').click();
  assert.equal(await page.locator('#textarea').inputValue(), 'He go to work.');
  await page.evaluate(() => { fixture.hold = true; }); await open();
  await panel.button('Check selection').click();
  await panel.button('Cancel').click();
  assert.match(await status(), /Cancelled/); assert.equal(await page.locator('#textarea').inputValue(), 'He go to work.');
});
test('complex editor offers copy fallback and optional rewrite is visibly labeled', async () => {
  await open('complex'); await panel.locator('#mode').selectOption('formal'); await check();
  assert.equal(await panel.button('Accept').isDisabled(), true);
  assert.equal(await panel.locator('.category').textContent(), 'Optional style');
  assert.equal(await page.locator('#complex').innerHTML(), '<p>He go to work.</p>');
});
test('cross-format rewrites refuse replacement without changing markup', async () => {
  await open('editable'); await panel.locator('#mode').selectOption('clearer'); await check();
  await panel.button('Accept').click();
  assert.match(await status(), /Copy the suggestion/); assert.equal(await page.locator('#editable').innerHTML(), 'He <strong>go</strong> to work.');
});
test('sensitive fields, active composition and disabled sites issue no writing request', async () => {
  for (const id of ['password', 'card']) { await open(id, 0, 5); assert.equal(await panel.button('Check selection').isDisabled(), true); }
  await page.evaluate(() => { textarea.dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true})); });
  await open(); assert.equal(await panel.button('Check selection').isDisabled(), true);
  await page.evaluate(() => { textarea.dispatchEvent(new CompositionEvent('compositionend', {bubbles: true})); fixture.enabled = false; });
  await open(); await panel.locator('#check').waitFor(el => el.disabled);
  assert.equal(await page.evaluate(() => fixture.checks.length), 0);
});
test('markup in replacements stays literal; contenteditable normalization restores the original', async () => {
  await page.evaluate(() => { fixture.after = '<img src=x onerror=alert(1)>'; }); await open(); await check();
  assert.equal(await panel.locator('.after img').count(), 0);
  await panel.button('Accept').click();
  assert.equal(await page.locator('#textarea').inputValue(), 'He <img src=x onerror=alert(1)> to work.');
  await open('editable'); await check();
  await panel.button('Accept').click();
  assert.equal(await page.locator('#editable img').count(), 0);
  const value = await page.locator('#editable').textContent();
  if (value === 'He go to work.') {
    assert.match(await status(), /Original text restored/);
    assert.equal(await page.locator('#editable').innerHTML(), 'He <strong>go</strong> to work.');
  } else assert.equal(value, 'He <img src=x onerror=alert(1)> to work.');
});
test('panel works under Trusted Types and blocked inline styles; synthetic clicks cannot submit', async () => {
  await page.goto('https://selection.lineleaf.test/?strict'); await open();
  await panel.locator('#check').evaluate(el => el.click());
  assert.equal(await page.evaluate(() => fixture.checks.length), 0);
  await check(); assert.equal(await panel.locator('.panel').evaluate(el => getComputedStyle(el).position), 'fixed');
  await panel.button('Accept').click(); assert.equal(await page.locator('#textarea').inputValue(), 'He goes to work.');
});
test('controlled normalization on acceptance restores text and site state before copy fallback', async () => {
  await page.evaluate(() => controlled.addEventListener('input', () => {
    if (controlled.value.includes('goes')) controlled.value = controlled.value.toUpperCase();
    window.controlledState = controlled.value;
  }));
  await open('controlled'); await check(); await panel.button('Accept').click();
  assert.equal(await page.locator('#controlled').inputValue(), 'He go to work.');
  assert.equal(await page.evaluate(() => controlledState), 'He go to work.'); assert.match(await status(), /Original text restored/);
  await open('controlled'); await check(); assert.equal(await panel.button('Accept').isDisabled(), true);
});
test('partial maxlength insertion is rolled back rather than left in the field', async () => {
  await page.locator('#input').evaluate(el => { el.maxLength = 15; }); await open('input'); await check();
  await panel.button('Accept').click(); assert.equal(await page.locator('#input').inputValue(), 'He go to work.');
  assert.match(await status(), /Original text restored/);
});
test('a site handler that removes formatting is rolled back to the original inline nodes', async () => {
  await page.locator('#editable').evaluate(el => {
    el.innerHTML = 'He <!--kept--><strong>go</strong> to work.';
    el.addEventListener('input', () => { el.textContent = el.textContent; });
  });
  await open('editable'); await check(); await panel.button('Accept').click();
  assert.equal(await page.locator('#editable').innerHTML(), 'He <!--kept--><strong>go</strong> to work.'); assert.match(await status(), /Original text restored/);
});
test('opening the panel prepares the provider with no text, and asking for a check reuses that connection', async () => {
  await page.goto('https://selection.lineleaf.test/?controller'); await page.waitForFunction(() => window.__lineleafMounted);
  await open();
  await page.waitForFunction(() => fixture.worker.calls.some(x => x.method === 'prepare'));
  const prepared = await page.evaluate(() => fixture.worker.calls.filter(x => x.method === 'prepare'));
  assert.equal(prepared.length, 1); assert.deepEqual(prepared[0].params, {mode: 'cached', max_age_ms: 30000});
  assert.equal(JSON.stringify(prepared).includes('He go'), false);
  await check();
  assert.deepEqual(await page.evaluate(() => fixture.worker.calls.filter(x => x.method).map(x => x.method)), ['prepare', 'readiness', 'send_ready_with_policy']);
  assert.equal(await page.evaluate(() => fixture.worker.ports.length), 1);
});
