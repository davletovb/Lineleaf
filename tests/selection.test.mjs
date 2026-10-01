import assert from 'node:assert/strict';
import {test, before, after, beforeEach} from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
let browser, page;
before(async () => {
  browser = await chromium.launch({executablePath: process.env.LINELEAF_CHROMIUM_PATH || undefined,
    args: process.env.LINELEAF_CHROMIUM_SINGLE_PROCESS === '1' ? ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--single-process'] : []});
  page = await browser.newPage();
  await page.route('https://selection.lineleaf.test/**', async route => {
    const file = new URL(route.request().url()).pathname === '/content.js' ? '../dist/lineleaf/content.js' : './fixtures/selection.html';
    await route.fulfill({body: await readFile(fileURLToPath(new URL(file, import.meta.url))), contentType: file.endsWith('.js') ? 'text/javascript' : 'text/html',
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
  await page.waitForSelector('[data-lineleaf-root]', {state: 'attached'});
  await page.waitForFunction(() => document.querySelector('[data-lineleaf-root]').shadowRoot.querySelector('#status').textContent.length > 0);
}
const status = () => page.locator('[data-lineleaf-root] #status').textContent();
async function check() {
  await page.getByRole('button', {name: 'Check selection', exact: true}).click();
  await page.getByRole('button', {name: 'Accept', exact: true}).waitFor();
}
for (const id of ['textarea', 'input', 'controlled', 'editable']) {
  test(`selection panel: ${id} previews, accepts and undoes with site state intact`, async () => {
    await open(id); await check();
    assert.equal(await page.locator(`#${id}`).evaluate(el => el.value ?? el.textContent), 'He go to work.');
    await page.getByRole('button', {name: 'Accept', exact: true}).click();
    assert.equal(await page.locator(`#${id}`).evaluate(el => el.value ?? el.textContent), 'He goes to work.');
    if (id === 'controlled') assert.equal(await page.evaluate(() => controlledState), 'He goes to work.');
    if (id === 'editable') assert.equal(await page.locator('#editable strong').textContent(), 'goes');
    await page.getByRole('button', {name: 'Undo last edit', exact: true}).click();
    assert.equal(await page.locator(`#${id}`).evaluate(el => el.value ?? el.textContent), 'He go to work.');
  });
}
test('only selected text is sent; absolute edit mapping preserves surrounding content', async () => {
  await page.locator('#textarea').fill('PREFIX He go to work. SUFFIX');
  await open('textarea', 7, 21); await check();
  assert.equal(await page.evaluate(() => fixture.checks[0].text), 'He go to work.');
  await page.getByRole('button', {name: 'Accept', exact: true}).click();
  assert.equal(await page.locator('#textarea').inputValue(), 'PREFIX He goes to work. SUFFIX');
});
test('typing and ABA changes cancel work and discard a late response', async () => {
  await page.evaluate(() => { fixture.hold = true; }); await open();
  await page.getByRole('button', {name: 'Check selection', exact: true}).click();
  await page.waitForFunction(() => fixture.checks.length === 1);
  await page.evaluate(() => { textarea.value = 'Changed'; textarea.dispatchEvent(new InputEvent('input')); textarea.value = 'He go to work.'; textarea.dispatchEvent(new InputEvent('input')); fixture.ports[0].result(); });
  assert.match(await status(), /selection changed/i); assert.equal(await page.getByRole('button', {name: 'Accept', exact: true}).count(), 0);
  assert.equal(await page.evaluate(() => fixture.ports[0].closed), true);
});
test('dismiss and explicit cancel never change the field', async () => {
  await open(); await check(); await page.getByRole('button', {name: 'Dismiss', exact: true}).click();
  assert.equal(await page.locator('#textarea').inputValue(), 'He go to work.');
  await page.evaluate(() => { fixture.hold = true; }); await open();
  await page.getByRole('button', {name: 'Check selection', exact: true}).click();
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  assert.match(await status(), /Cancelled/); assert.equal(await page.locator('#textarea').inputValue(), 'He go to work.');
});
test('complex editor offers copy fallback and optional rewrite is visibly labeled', async () => {
  await open('complex'); await page.locator('[data-lineleaf-root] #mode').selectOption('formal'); await check();
  assert.equal(await page.getByRole('button', {name: 'Accept', exact: true}).isDisabled(), true);
  assert.equal(await page.locator('[data-lineleaf-root] .category').textContent(), 'Optional style');
  assert.equal(await page.locator('#complex').innerHTML(), '<p>He go to work.</p>');
});
test('cross-format rewrites refuse replacement without changing markup', async () => {
  await open('editable'); await page.locator('[data-lineleaf-root] #mode').selectOption('clearer'); await check();
  await page.getByRole('button', {name: 'Accept', exact: true}).click();
  assert.match(await status(), /Copy the suggestion/); assert.equal(await page.locator('#editable').innerHTML(), 'He <strong>go</strong> to work.');
});
test('sensitive fields, active composition and disabled sites issue no writing request', async () => {
  for (const id of ['password', 'card']) { await open(id, 0, 5); assert.equal(await page.getByRole('button', {name: 'Check selection', exact: true}).isDisabled(), true); }
  await page.evaluate(() => { textarea.dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true})); });
  await open(); assert.equal(await page.getByRole('button', {name: 'Check selection', exact: true}).isDisabled(), true);
  await page.evaluate(() => { textarea.dispatchEvent(new CompositionEvent('compositionend', {bubbles: true})); fixture.enabled = false; });
  await open(); await page.waitForFunction(() => document.querySelector('[data-lineleaf-root]').shadowRoot.querySelector('#check').disabled);
  assert.equal(await page.evaluate(() => fixture.checks.length), 0);
});
test('markup in replacements stays literal; contenteditable normalization restores the original', async () => {
  await page.evaluate(() => { fixture.after = '<img src=x onerror=alert(1)>'; }); await open(); await check();
  assert.equal(await page.locator('[data-lineleaf-root] .after img').count(), 0);
  await page.getByRole('button', {name: 'Accept', exact: true}).click();
  assert.equal(await page.locator('#textarea').inputValue(), 'He <img src=x onerror=alert(1)> to work.');
  await open('editable'); await check();
  await page.getByRole('button', {name: 'Accept', exact: true}).click();
  assert.equal(await page.locator('#editable img').count(), 0);
  const value = await page.locator('#editable').textContent();
  if (value === 'He go to work.') {
    assert.match(await status(), /Original text restored/);
    assert.equal(await page.locator('#editable').innerHTML(), 'He <strong>go</strong> to work.');
  } else assert.equal(value, 'He <img src=x onerror=alert(1)> to work.');
});
test('panel works under Trusted Types and blocked inline styles; synthetic clicks cannot submit', async () => {
  await page.goto('https://selection.lineleaf.test/?strict'); await open();
  await page.evaluate(() => document.querySelector('[data-lineleaf-root]').shadowRoot.querySelector('#check').click());
  assert.equal(await page.evaluate(() => fixture.checks.length), 0);
  await check(); assert.equal(await page.locator('[data-lineleaf-root] .panel').evaluate(el => getComputedStyle(el).position), 'fixed');
  await page.getByRole('button', {name: 'Accept', exact: true}).click(); assert.equal(await page.locator('#textarea').inputValue(), 'He goes to work.');
});
test('controlled normalization on acceptance restores text and site state before copy fallback', async () => {
  await page.evaluate(() => controlled.addEventListener('input', () => {
    if (controlled.value.includes('goes')) controlled.value = controlled.value.toUpperCase();
    window.controlledState = controlled.value;
  }));
  await open('controlled'); await check(); await page.getByRole('button', {name: 'Accept', exact: true}).click();
  assert.equal(await page.locator('#controlled').inputValue(), 'He go to work.');
  assert.equal(await page.evaluate(() => controlledState), 'He go to work.'); assert.match(await status(), /Original text restored/);
  await open('controlled'); await check(); assert.equal(await page.getByRole('button', {name: 'Accept', exact: true}).isDisabled(), true);
});
test('partial maxlength insertion is rolled back rather than left in the field', async () => {
  await page.locator('#input').evaluate(el => { el.maxLength = 15; }); await open('input'); await check();
  await page.getByRole('button', {name: 'Accept', exact: true}).click(); assert.equal(await page.locator('#input').inputValue(), 'He go to work.');
  assert.match(await status(), /Original text restored/);
});
test('a site handler that removes formatting is rolled back to the original inline nodes', async () => {
  await page.locator('#editable').evaluate(el => {
    el.innerHTML = 'He <!--kept--><strong>go</strong> to work.';
    el.addEventListener('input', () => { el.textContent = el.textContent; });
  });
  await open('editable'); await check(); await page.getByRole('button', {name: 'Accept', exact: true}).click();
  assert.equal(await page.locator('#editable').innerHTML(), 'He <!--kept--><strong>go</strong> to work.'); assert.match(await status(), /Original text restored/);
});
