import assert from 'node:assert/strict';
import {test, before, after} from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {panelFor} from './fixtures/panel-driver.mjs';
let browser, page, panel, inline;
before(async () => {
  browser = await chromium.launch({executablePath: process.env.LINELEAF_CHROMIUM_PATH || undefined,
    args: process.env.LINELEAF_CHROMIUM_SINGLE_PROCESS === '1' ? ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--single-process'] : []});
  page = await browser.newPage(); panel = panelFor(page); inline = panelFor(page, {attribute: 'data-lineleaf-inline'});
  await page.route('**/*', async route => {
    const path = new URL(route.request().url()).pathname;
    const files = new Map([['/content.js', '../dist/lineleaf/content.js'], ['/controller-bridge.mjs', './fixtures/controller-bridge.mjs'], ['/test-api.mjs', './fixtures/extension-api.mjs']]);
    const file = files.get(path) ?? (['controller.mjs', 'native-seatline.mjs', 'policy.mjs', 'candidates.mjs'].some(x => path === `/lib/${x}`) ? `../dist/lineleaf${path}` : './fixtures/selection.html');
    let body = await readFile(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    if (file.endsWith('.html')) body = body.replace('<script src="/content.js"></script>', '<script type="module" src="/controller-bridge.mjs"></script>');
    await route.fulfill({body, contentType: /\.m?js$/.test(file) ? 'text/javascript' : 'text/html'});
  });
});
after(async () => { await browser?.close(); });
async function load(url = 'https://dynamic.lineleaf.test/compose?automatic') { await page.goto(url); await page.waitForFunction(() => window.__lineleafMounted); }
async function open(id = 'textarea') {
  await page.locator(`#${id}`).evaluate(el => {
    el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.setSelectionRange(0, el.value.length);
    else { const range = document.createRange(); range.selectNodeContents(el); const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range); }
    fixture.runtimeMessages.emit({type: 'lineleaf-open'}, {id: chrome.runtime.id});
  });
  await panel.button('Check selection').waitFor();
}
async function check() { await panel.button('Check selection').click(); await panel.button('Accept').waitFor(); }
async function automatic(id = 'textarea') {
  await page.locator(`#${id}`).fill('He go to work.'); await inline.locator('.underline').waitFor();
}
const sends = () => page.evaluate(() => fixture.worker.calls.filter(x => x.method === 'send'));
for (const [name, url, id, canApply] of [
  ['Gmail compose boundary', 'https://mail.google.com/mail/u/0/?automatic', 'editable', false],
  ['GitHub comment textarea boundary', 'https://github.com/example/synthetic/issues/1?automatic', 'textarea', true],
  ['LinkedIn post boundary', 'https://www.linkedin.com/feed/?automatic', 'editable', false],
  ['Slack compose boundary', 'https://app.slack.com/client/synthetic?automatic', 'editable', false]
]) {
  test(`synthetic priority matrix: ${name} uses the declared replacement/copy policy`, async () => {
    await load(url); await open(id); await check();
    assert.equal(await panel.button('Accept').isDisabled(), !canApply);
    if (canApply) { await panel.button('Accept').click(); await panel.button('Undo last edit').click(); }
    else {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await panel.button('Copy').click(); await panel.locator('#status').waitFor(el => el.textContent === 'Suggestion copied.'); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'goes');
    }
    assert.equal(await page.locator(`#${id}`).evaluate(el => el.value ?? el.textContent), 'He go to work.');
    if (id === 'editable') assert.equal(await page.locator('#editable strong').textContent(), 'go');
    await panel.button('✕').click(); await page.locator(`#${id}`).focus(); await page.keyboard.press('End'); await page.keyboard.type(' ');
    if (!canApply) { await page.waitForTimeout(1700); assert.equal((await sends()).length, 1); assert.equal(await page.locator('[data-lineleaf-inline]').count(), 0); }
  });
}
test('Google Docs input proxy is copy-only; canvas-only documents use explicit pasted-text fallback', async () => {
  await load('https://docs.google.com/document/d/synthetic/edit?automatic');
  await page.locator('#textarea').fill('He go to work.'); await page.waitForTimeout(1700); assert.equal((await sends()).length, 0);
  await open(); await check(); assert.equal(await panel.button('Accept').isDisabled(), true);
  await panel.button('✕').click();
  await page.locator('#textarea').evaluate(el => { el.remove(); document.getSelection().removeAllRanges(); fixture.runtimeMessages.emit({type: 'lineleaf-open'}, {id: chrome.runtime.id}); });
  await panel.locator('#pasted').evaluate(el => el.focus()); await page.keyboard.type('He go to work.');
  await panel.button('Use pasted text').click(); assert.equal((await sends()).length, 1);
  await check(); assert.equal(await panel.button('Accept').isDisabled(), true);
  assert.deepEqual(JSON.parse((await sends()).at(-1).params.messages[0].text), {text: 'He go to work.'});
  await panel.locator('#pasted').evaluate(el => el.focus()); await page.keyboard.type(' Changed.');
  assert.equal(await panel.button('Check selection').isDisabled(), true); assert.equal((await sends()).length, 2);
});
for (const marker of ['class="ProseMirror"', 'class="ql-editor"', 'class="public-DraftEditor-content"', 'data-slate-editor="true"', 'data-lexical-editor="true"']) {
  test(`complex editor ${marker} remains copy-only even with a flat DOM`, async () => {
    await load(); await page.locator('#editable').evaluate((el, marker) => {
      const [name, value] = marker.split('='); el.setAttribute(name, value.slice(1, -1));
    }, marker);
    await open('editable'); await check(); assert.equal(await panel.button('Accept').isDisabled(), true);
    assert.equal(await page.locator('#editable').textContent(), 'He go to work.');
  });
}
test('SPA push/replace/ABA/hash navigation cancels old drafts and removes previews', async () => {
  for (const kind of ['push', 'replace', 'ABA', 'hash']) {
    await load(); await page.evaluate(() => { fixture.worker.hold = true; }); await open(); await panel.button('Check selection').click();
    await page.waitForFunction(() => fixture.worker.calls.some(x => x.method === 'send'));
    await page.evaluate(kind => {
      const old = location.href;
      if (kind === 'hash') location.hash = 'another-draft';
      else if (kind === 'replace') history.replaceState({}, '', '/another-draft');
      else { history.pushState({}, '', '/another-draft'); if (kind === 'ABA') history.pushState({}, '', old); }
    }, kind);
    await page.waitForSelector('[data-lineleaf-root]', {state: 'detached'});
    await page.waitForFunction(() => fixture.worker.calls.some(x => x.method === 'cancel'));
    assert.equal(await page.locator('#textarea').inputValue(), 'He go to work.');
  }
});
test('inline SPA navigation cancels the old request, ignores late output and stays idle until a new explicit check', async () => {
  await load(); await page.evaluate(() => { fixture.worker.hold = true; }); await page.locator('#textarea').fill('He go to work.');
  await page.waitForFunction(() => fixture.worker.calls.some(x => x.method === 'send'));
  await page.evaluate(() => history.pushState({}, '', '/new-compose?automatic'));
  await page.waitForFunction(() => fixture.worker.calls.some(x => x.method === 'cancel'));
  await page.evaluate(() => {
    const port = fixture.worker.ports[0], request = port.sent.find(x => x.method === 'send');
    port.reply(request.id, {type: 'delta', text: '{"corrections":[]}'}); port.reply(request.id, {type: 'completed'}); fixture.worker.hold = false;
  });
  await page.waitForTimeout(1700); assert.equal((await sends()).length, 1);
  assert.equal(await inline.locator('.underline').count(), 0);
  await page.keyboard.press('Alt+Shift+l'); await inline.button('Check now').click(); await inline.locator('.underline').waitFor();
  assert.equal((await sends()).length, 2); assert.equal(await page.locator('#textarea').inputValue(), 'He go to work.');
});
test('replaced field with identical text cannot receive a late response or the old edit', async () => {
  await load(); await page.evaluate(() => { fixture.worker.hold = true; }); await open(); await panel.button('Check selection').click();
  await page.waitForFunction(() => fixture.worker.calls.some(x => x.method === 'send'));
  await page.locator('#textarea').evaluate(el => { const next = el.cloneNode(true); next.value = el.value; el.replaceWith(next); });
  await panel.locator('#status').waitFor(el => /changed/.test(el.textContent));
  assert.equal((await sends()).length, 1); assert.equal(await page.locator('#textarea').inputValue(), 'He go to work.');
  assert.equal(await panel.button('Accept').count(), 0);
});
test('reparent/remove-and-reinsert ABA refuses acceptance before the polling timer', async () => {
  await load(); await open(); await check();
  await page.locator('#textarea').evaluate(el => { const parent = el.parentNode, next = el.nextSibling; el.remove(); parent.insertBefore(el, next); });
  await panel.button('Accept').click(); assert.equal(await page.locator('#textarea').inputValue(), 'He go to work.');
  assert.match(await panel.locator('#status').textContent(), /replacement|changed/);
});
test('a site switching drafts during insertion, undo or failed-edit recovery never receives restored old text', async () => {
  for (const operation of ['insert', 'undo', 'recovery']) {
    await load(); await open(); await check();
    if (operation === 'undo') await panel.button('Accept').click();
    await page.locator('#textarea').evaluate((el, operation) => {
      el.addEventListener('input', event => {
        if (operation === 'recovery' && event.inputType === 'insertText') { el.value = 'Rejected insertion.'; return; }
        if (event.inputType === (operation === 'insert' ? 'insertText' : 'historyUndo')) {
          history.pushState({}, '', '/new-draft?automatic'); el.value = 'Another draft. Do not restore old text here.';
        }
      });
    }, operation);
    await panel.button(operation === 'undo' ? 'Undo last edit' : 'Accept').click();
    assert.equal(await page.locator('#textarea').inputValue(), 'Another draft. Do not restore old text here.');
    assert.equal(await page.locator('[data-lineleaf-root]').count(), 0);
  }
});
test('inline acceptance survives a site navigation handler without restoring or mutating the next draft', async () => {
  await load(); await automatic(); await page.keyboard.press('Alt+Shift+l');
  await page.locator('#textarea').evaluate(el => el.addEventListener('input', event => {
    if (event.inputType === 'insertText') { history.pushState({}, '', '/new-draft?automatic'); el.value = 'Another draft. Keep this text.'; }
  }));
  await inline.button('Accept').click(); assert.equal(await page.locator('#textarea').inputValue(), 'Another draft. Keep this text.');
  assert.equal((await sends()).length, 1);
});
test('ancestor exclusion changed after capture prevents direct edits and automatic work', async () => {
  await load(); await page.locator('#textarea').evaluate(el => { const wrapper = document.createElement('section'); el.before(wrapper); wrapper.append(el); });
  await open(); await check(); await page.locator('#textarea').evaluate(el => el.parentElement.setAttribute('data-lineleaf-ignore', ''));
  await panel.button('Accept').click(); assert.equal(await page.locator('#textarea').inputValue(), 'He go to work.');
  await page.locator('#textarea').fill('He go to work. Again.'); await page.waitForTimeout(1700); assert.equal((await sends()).length, 1);
});
test('open shadow textarea keeps native apply/undo and ancestor privacy exclusions', async () => {
  await load(); await page.evaluate(() => {
    const host = document.createElement('section'); host.id = 'shadow'; document.body.prepend(host);
    const root = host.attachShadow({mode: 'open'}), el = document.createElement('textarea'); el.id = 'shadow-input'; el.value = 'He go to work.'; root.append(el);
  });
  await open('shadow-input'); await check(); assert.equal(await panel.button('Accept').isDisabled(), false);
  await panel.button('Accept').click(); assert.equal(await page.locator('#shadow-input').inputValue(), 'He goes to work.');
  await panel.button('Undo last edit').click(); assert.equal(await page.locator('#shadow-input').inputValue(), 'He go to work.');
  await panel.button('✕').click(); await automatic('shadow-input');
  await page.keyboard.press('Alt+Shift+l'); await inline.button('Accept').click(); assert.equal(await page.locator('#shadow-input').inputValue(), 'He goes to work.');
  await inline.button('Undo last edit').click(); assert.equal(await page.locator('#shadow-input').inputValue(), 'He go to work.');
  await page.locator('#shadow').evaluate(el => el.setAttribute('data-lineleaf-ignore', ''));
  await page.locator('#shadow-input').fill('He go to work. Again.'); await page.waitForTimeout(1700); assert.equal((await sends()).length, 2);
});
test('open shadow basic contenteditable selection maps only its text and preserves formatting', async () => {
  await load(); await page.evaluate(() => {
    const host = document.createElement('section'); document.body.prepend(host); const root = host.attachShadow({mode: 'open'});
    const el = document.createElement('div'); el.id = 'shadow-editable'; el.contentEditable = 'true';
    const bold = document.createElement('strong'); bold.textContent = 'go'; el.append('He ', bold, ' to work.'); root.append(el);
  });
  await open('shadow-editable'); await check(); assert.equal(await panel.locator('#selected').textContent(), 'He go to work.');
  await panel.button('Accept').click(); assert.equal(await page.locator('#shadow-editable strong').textContent(), 'goes');
  await panel.button('Undo last edit').click(); assert.equal(await page.locator('#shadow-editable strong').textContent(), 'go');
});
test('legacy open-shadow selection and composition are bounded without getComposedRanges', async () => {
  await load(); await page.evaluate(() => {
    Selection.prototype.getComposedRanges = undefined;
    const host = document.createElement('section'); document.body.prepend(host); const root = host.attachShadow({mode: 'open'});
    const el = document.createElement('textarea'); el.id = 'legacy-shadow'; el.value = 'He go to work.'; root.append(el);
  });
  await open('legacy-shadow'); await check(); await panel.button('Accept').click();
  assert.equal(await page.locator('#legacy-shadow').inputValue(), 'He goes to work.');
  await panel.button('Undo last edit').click(); await panel.button('✕').click();
  await page.locator('#legacy-shadow').evaluate(el => el.dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true, composed: true})));
  await page.locator('#legacy-shadow').fill('He go to work. Again.'); await page.waitForTimeout(1700); assert.equal((await sends()).length, 1);
  await page.locator('#legacy-shadow').evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', {bubbles: true, composed: true})));
  await page.keyboard.type(' '); await inline.locator('.underline').waitFor(); assert.equal((await sends()).length, 2);
});
test('closed shadow fields never trigger an automatic request or expose their text to the panel', async () => {
  await load(); await page.evaluate(() => {
    const host = document.createElement('section'); host.id = 'closed'; document.body.prepend(host);
    const root = host.attachShadow({mode: 'closed'}), el = document.createElement('textarea'); el.value = 'Private closed-root text.';
    root.append(el); el.focus(); el.setSelectionRange(0, el.value.length);
  });
  await page.keyboard.type('He go to work.'); await page.waitForTimeout(1700); assert.equal((await sends()).length, 0);
  await page.evaluate(() => fixture.runtimeMessages.emit({type: 'lineleaf-open'}, {id: chrome.runtime.id}));
  await panel.button('Use pasted text').waitFor(); assert.equal(await panel.locator('#selected').textContent(), '');
  assert.equal(await panel.button('Check selection').isDisabled(), true);
});
test('clipboard denial exposes a selected manual-copy value without editing the source', async () => {
  await load('https://app.slack.com/client/synthetic?automatic'); await open('editable'); await check();
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('denied'); }; });
  await panel.button('Copy').click(); await panel.locator('#status').waitFor(el => /keyboard/.test(el.textContent));
  assert.equal(await panel.locator('textarea[aria-label="Suggestion to copy"]').evaluate(el => el.value), 'goes');
  assert.equal(await page.locator('#editable').textContent(), 'He go to work.');
});
test('nested scroll clipping, container resize and unsupported transforms do not leave misplaced underlines', async () => {
  await load(); await page.locator('#textarea').evaluate(el => {
    const wrap = document.createElement('section'); wrap.id = 'scroller'; wrap.style.cssText = 'overflow:auto;height:90px;width:350px;position:relative';
    el.before(wrap); wrap.append(el); el.style.cssText = 'height:160px;margin:0;flex-shrink:0';
    const filler = document.createElement('div'); filler.style.height = '300px'; wrap.append(filler);
  });
  await automatic();
  const initial = await inline.locator('.underline').evaluate(el => { const r = el.getBoundingClientRect(); return {x: r.x, y: r.y}; });
  await page.locator('#scroller').evaluate(el => { el.style.marginLeft = '80px'; el.style.width = '240px'; });
  await inline.locator('.underline').waitFor((el, initial) => Math.abs(el.getBoundingClientRect().x - initial.x) > 50, initial);
  const bounds = await page.locator('#scroller').boundingBox();
  assert.equal(await inline.locator('.underline').evaluate((_, bounds, lines) => lines.every(line => {
    const r = line.getBoundingClientRect(); return r.left >= bounds.x && r.right <= bounds.x + bounds.width + 1 && r.bottom <= bounds.y + bounds.height;
  }), bounds), true);
  await page.locator('#scroller').evaluate(el => { el.scrollTop = 190; });
  await page.waitForSelector('[data-lineleaf-inline]', {state: 'detached'});
  await page.locator('#scroller').evaluate(el => { el.scrollTop = 0; el.style.transform = 'rotate(180deg)'; });
  await page.locator('#textarea').fill('He go to work. Again.'); await page.waitForTimeout(1700); assert.equal((await sends()).length, 1);
  assert.equal(await page.locator('#textarea').inputValue(), 'He go to work. Again.');
});
test('same-origin frame inherits parent navigation, hidden/excluded embedding and sandbox guards', async () => {
  await load(); await page.evaluate(() => {
    const frame = document.createElement('iframe'); frame.name = 'child'; frame.id = 'child'; frame.style.cssText = 'width:600px;height:500px'; frame.src = '/child?automatic'; document.body.prepend(frame);
  });
  await page.waitForFunction(() => document.querySelector('#child')?.contentDocument?.querySelector('#textarea'));
  const frame = page.frame({name: 'child'});
  await frame.waitForFunction(() => window.__lineleafMounted);
  await page.frameLocator('#child').locator('#textarea').fill('He go to work.');
  const framePanel = panelFor(page, {attribute: 'data-lineleaf-inline'}); await framePanel.locator('.underline').waitFor();
  await page.evaluate(() => history.pushState({}, '', '/other-parent?automatic'));
  await framePanel.locator('.underline').waitFor((_, __, lines) => lines.length === 0);
  await frame.waitForTimeout(1700); assert.equal(await frame.evaluate(() => fixture.worker.calls.filter(x => x.method === 'send').length), 1);
  await page.locator('#child').evaluate(el => el.setAttribute('aria-hidden', 'true'));
  await page.frameLocator('#child').locator('#textarea').fill('He go to work. Again.');
  await frame.waitForTimeout(1700); assert.equal(await frame.evaluate(() => fixture.worker.calls.filter(x => x.method === 'send').length), 1);
  await page.locator('#child').evaluate(el => { el.removeAttribute('aria-hidden'); el.style.display = 'none'; });
  await frame.evaluate(() => { fixture.runtimeMessages.emit({type: 'lineleaf-open'}, {id: chrome.runtime.id}); });
  assert.equal(await panelFor(page).locator('#selected').textContent(), '');
  await page.locator('#child').evaluate(el => { el.style.display = ''; el.setAttribute('sandbox', 'allow-scripts allow-same-origin'); });
  await frame.evaluate(() => fixture.runtimeMessages.emit({type: 'lineleaf-open'}, {id: chrome.runtime.id}));
  assert.equal(await panelFor(page).locator('#selected').textContent(), '');
});
