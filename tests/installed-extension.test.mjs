import assert from 'node:assert/strict';
import {before, after, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {panelFor} from './fixtures/panel-driver.mjs';
let context, worker, options;
const id = 'lnbkadelggojehiapgnhonicnfonobal';
before(async () => {
  const path = fileURLToPath(new URL('../dist/lineleaf', import.meta.url));
  context = await chromium.launchPersistentContext('', {channel: 'chromium', headless: true,
    executablePath: process.env.LINELEAF_CHROMIUM_PATH || undefined,
    args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`], ignoreDefaultArgs: ['--disable-extensions']});
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', {timeout: 15000});
  options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
  await options.waitForFunction(() => document.querySelector('#authorize').textContent.includes('seatline-companion'));
});
after(async () => { await context?.close(); });
test('built MV3 extension loads with the stable ID and settings persist across pages', async () => {
  assert.equal(new URL(worker.url()).host, id);
  assert.equal((await worker.evaluate(() => chrome.runtime.getManifest())).version, '0.1.0');
  assert.equal(await options.locator('#automatic').isChecked(), false);
  assert.equal(await options.locator('#dictionary').inputValue(), '');
  await options.locator('#variant').selectOption('UK'); await options.locator('#model').fill('test-model');
  await options.locator('#automatic').check(); await options.locator('#dictionary').fill('Seatline\nLineleaf');
  await options.getByRole('button', {name: 'Save preferences'}).click();
  await options.waitForFunction(() => document.querySelector('#status').textContent === 'Preferences saved.');
  await options.reload(); await options.waitForFunction(() => document.querySelector('#variant').value === 'UK');
  assert.equal(await options.locator('#model').inputValue(), 'test-model');
  assert.equal(await options.locator('#automatic').isChecked(), true);
  assert.equal(await options.locator('#dictionary').inputValue(), 'seatline\nlineleaf');
  const permissions = await worker.evaluate(() => chrome.permissions.getAll()); assert.deepEqual(permissions.origins ?? [], []);
});
test('missing native host produces a fixed diagnostic in the actual extension', async () => {
  await options.getByRole('button', {name: 'Check Seatline'}).click();
  await options.waitForFunction(() => document.querySelector('#status').textContent.includes('Seatline is unavailable.'));
  assert.equal(await options.locator('#connection').isEnabled(), true);
});
test('explicit optional permission enables only the chosen site, panel opens, disabling unregisters access', async () => {
  // Preapprove only the synthetic host through Chromium's extension-management API.
  // Runtime permissions.request still activates the real optional grant; no native UI prompt is automated.
  const management = await context.newPage(); await management.goto('chrome://extensions/');
  await management.evaluate(async id => { await chrome.developerPrivate.addHostPermission(id, 'https://writing.test/*'); }, id);
  await management.close();
  await options.evaluate(() => {
    const button = document.createElement('button'); button.textContent = 'Grant fixture site';
    button.onclick = async () => { window.granted = await chrome.permissions.request({origins: ['https://writing.test/*']}); };
    document.body.append(button);
  });
  await options.getByRole('button', {name: 'Grant fixture site'}).click();
  await options.waitForFunction(() => window.granted === true);
  const result = await options.evaluate(() => chrome.runtime.sendMessage({type: 'set-site', payload: {origin: 'https://writing.test', enabled: true}}));
  assert.equal(result.ok, true);
  await context.route('https://writing.test/**', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><html lang="en"><title>Writing fixture</title><textarea id="draft">He go to work.</textarea></html>'}));
  const writing = await context.newPage(); await writing.goto('https://writing.test/');
  await writing.locator('#draft').evaluate(el => { el.focus(); el.setSelectionRange(0, el.value.length); });
  const opened = await options.evaluate(async () => {
    const [tab] = await chrome.tabs.query({url: 'https://writing.test/*'});
    return chrome.runtime.sendMessage({type: 'open-panel', payload: {tabId: tab.id}});
  });
  assert.equal(opened.ok, true);
  const panel = panelFor(writing);
  await panel.button('Check selection').waitFor();
  assert.equal(await panel.locator('#selected').textContent(), 'He go to work.');
  assert.equal(await writing.locator('[data-lineleaf-root]').evaluate(el => el.shadowRoot), null);
  await options.evaluate(() => chrome.runtime.sendMessage({type: 'set-site', payload: {origin: 'https://writing.test', enabled: false}}));
  await panel.locator('#check').waitFor(el => el.disabled);
  assert.equal(await worker.evaluate(() => chrome.permissions.contains({origins: ['https://writing.test/*']})), false);
  await options.getByRole('button', {name: 'Reset preferences and site access'}).click();
  await options.waitForFunction(() => document.querySelector('#status').textContent.includes('reset'));
});
test('installed automatic flow stays idle on focus, reports missing host after typing, and pause clears it', async () => {
  const management = await context.newPage(); await management.goto('chrome://extensions/');
  await management.evaluate(async id => chrome.developerPrivate.addHostPermission(id, 'https://writing.test/*'), id); await management.close();
  await options.evaluate(() => { window.granted = null; }); await options.getByRole('button', {name: 'Grant fixture site'}).click();
  await options.waitForFunction(() => window.granted === true);
  await options.locator('#automatic').check(); await options.getByRole('button', {name: 'Save preferences'}).click();
  await options.waitForFunction(() => document.querySelector('#status').textContent === 'Preferences saved.');
  assert.equal((await options.evaluate(() => chrome.runtime.sendMessage({type: 'set-site', payload: {origin: 'https://writing.test', enabled: true}}))).ok, true);
  await options.waitForFunction(async () => (await chrome.scripting.getRegisteredContentScripts()).some(x => x.id === 'lineleaf-sites'));
  const writing = await context.newPage(); await writing.goto('https://writing.test/automatic'); await writing.locator('#draft').focus();
  await writing.waitForSelector('[data-lineleaf-inline]', {state: 'attached'});
  const inline = panelFor(writing, {attribute: 'data-lineleaf-inline'});
  await writing.waitForTimeout(1700);
  assert.match(await inline.locator('.badge').evaluate(el => el.getAttribute('aria-label')), /after you pause typing/);
  await writing.keyboard.press('End'); await writing.keyboard.type(' Again.');
  await inline.locator('.badge').waitFor(el => el.getAttribute('aria-label').includes('Seatline is unavailable.'));
  assert.equal(await writing.locator('#draft').inputValue(), 'He go to work. Again.');
  await writing.keyboard.press('Alt+Shift+l'); await inline.button('Pause Lineleaf').click();
  await writing.waitForSelector('[data-lineleaf-inline]', {state: 'detached'});
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('preferences')).preferences.paused), true);
  await options.getByRole('button', {name: 'Reset preferences and site access'}).click();
  await options.waitForFunction(() => document.querySelector('#status').textContent.includes('reset'));
  assert.equal(await options.locator('#automatic').isChecked(), false); assert.equal(await options.locator('#dictionary').inputValue(), '');
});
test('installed matching frames target the focused document; opaque and cross-origin frames are refused', async () => {
  const management = await context.newPage(); await management.goto('chrome://extensions/');
  await management.evaluate(async id => chrome.developerPrivate.addHostPermission(id, 'https://writing.test/*'), id); await management.close();
  await options.evaluate(() => { window.granted = null; }); await options.getByRole('button', {name: 'Grant fixture site'}).click();
  await options.waitForFunction(() => window.granted === true);
  assert.equal((await options.evaluate(() => chrome.runtime.sendMessage({type: 'set-site', payload: {origin: 'https://writing.test', enabled: true}}))).ok, true);
  await options.waitForFunction(async () => (await chrome.scripting.getRegisteredContentScripts()).some(x => x.id === 'lineleaf-sites' && x.allFrames));
  await context.route('https://writing.test/frames', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Synthetic frames</title><textarea id="top">Unrelated top draft.</textarea><iframe id="child" name="child" src="/frame-draft"></iframe><iframe id="opaque" sandbox="allow-scripts" src="/frame-draft"></iframe><iframe id="blank" srcdoc="<textarea>Unrelated opaque draft.</textarea>"></iframe><iframe id="cross" src="https://other.test/frame"></iframe>'}));
  await context.route('https://writing.test/frame-draft', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Synthetic frame draft</title><textarea id="draft">He go to work.</textarea>'}));
  await context.route('https://other.test/frame', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Unrelated origin</title><textarea id="draft">Unrelated private draft.</textarea>'}));
  const writing = await context.newPage(); await writing.goto('https://writing.test/frames');
  const child = writing.frame({name: 'child'});
  await writing.frameLocator('#child').locator('#draft').evaluate(el => { el.focus(); el.setSelectionRange(0, el.value.length); });
  const open = () => options.evaluate(async () => {
    const [tab] = await chrome.tabs.query({url: 'https://writing.test/frames'});
    return chrome.runtime.sendMessage({type: 'open-panel', payload: {tabId: tab.id}});
  });
  assert.equal((await open()).ok, true);
  await child.waitForSelector('[data-lineleaf-root]', {state: 'attached'});
  assert.equal(await writing.locator('[data-lineleaf-root]').count(), 0);
  const framePanel = panelFor(writing); assert.equal(await framePanel.locator('#selected').textContent(), 'He go to work.');
  assert.equal(await writing.frameLocator('#child').locator('#draft').inputValue(), 'He go to work.');
  // A sandboxed document may receive a URL-matching script but eligibility refuses its opaque top access.
  await writing.frameLocator('#opaque').locator('#draft').evaluate(el => { el.focus(); el.setSelectionRange(0, el.value.length); });
  assert.equal((await open()).ok, false);
  await writing.frameLocator('#blank').locator('textarea').focus(); assert.equal((await open()).ok, false);
  await writing.frameLocator('#cross').locator('#draft').focus(); assert.equal((await open()).ok, false);
  // Revocation broadcasts to the already-open child document; any retained preview loses eligibility.
  await options.evaluate(() => chrome.runtime.sendMessage({type: 'set-site', payload: {origin: 'https://writing.test', enabled: false}}));
  await framePanel.locator('#check').waitFor(el => el.disabled);
  assert.equal(await framePanel.locator('#selected').textContent(), '');
  const state = await worker.evaluate(async () => chrome.permissions.contains({origins: ['https://writing.test/*']})); assert.equal(state, false);
  await options.getByRole('button', {name: 'Reset preferences and site access'}).click();
  await options.waitForFunction(() => document.querySelector('#status').textContent.includes('reset'));
  await writing.close();
});
test('two options pages preserve newer pause/consent/dictionary and reject same-field conflicts', async () => {
  await options.reload(); await options.waitForFunction(() => document.querySelector('#authorize').textContent.includes('seatline-companion'));
  const other = await context.newPage(); await other.goto(`chrome-extension://${id}/options.html`);
  await other.waitForFunction(() => document.querySelector('#authorize').textContent.includes('seatline-companion'));
  await other.locator('#paused').check();
  await other.waitForFunction(() => document.querySelector('#status').textContent.includes('Lineleaf is paused'));
  await other.locator('#automatic').check(); await other.locator('#dictionary').fill('Seatline');
  await other.getByRole('button', {name: 'Save preferences'}).click();
  await other.waitForFunction(() => document.querySelector('#status').textContent === 'Preferences saved.');
  // The original tab still shows the old defaults; changing just the model must preserve other edits.
  assert.equal(await options.locator('#paused').isChecked(), false);
  await options.locator('#model').fill('new-model'); await options.getByRole('button', {name: 'Save preferences'}).click();
  await options.waitForFunction(() => document.querySelector('#status').textContent === 'Preferences saved.');
  let preferences = await worker.evaluate(async () => (await chrome.storage.local.get('preferences')).preferences);
  assert.equal(preferences.paused, true); assert.equal(preferences.automatic, true); assert.deepEqual(preferences.dictionary, ['seatline']);
  assert.equal(await options.locator('#paused').isChecked(), true);
  await other.locator('#dictionary').fill('Seatline\nCompanion'); await other.getByRole('button', {name: 'Save preferences'}).click();
  await other.waitForFunction(() => document.querySelector('#status').textContent === 'Preferences saved.' && document.querySelector('#dictionary').value.includes('companion'));
  await options.locator('#dictionary').fill('Lineleaf'); await options.getByRole('button', {name: 'Save preferences'}).click();
  await options.waitForFunction(() => document.querySelector('#status').textContent === 'Preferences saved.' && document.querySelector('#dictionary').value.includes('companion'));
  preferences = await worker.evaluate(async () => (await chrome.storage.local.get('preferences')).preferences);
  assert.deepEqual(preferences.dictionary, ['companion', 'lineleaf']);
  await options.locator('#model').fill('latest-model'); await options.getByRole('button', {name: 'Save preferences'}).click();
  await options.waitForFunction(() => document.querySelector('#status').textContent === 'Preferences saved.' && document.querySelector('#model').value === 'latest-model');
  await other.locator('#model').fill('stale-model'); await other.getByRole('button', {name: 'Save preferences'}).click();
  await other.waitForFunction(() => document.querySelector('#status').textContent.includes('Preferences changed elsewhere'));
  preferences = await worker.evaluate(async () => (await chrome.storage.local.get('preferences')).preferences);
  assert.equal(preferences.model, 'latest-model'); assert.equal(preferences.paused, true); assert.equal(preferences.automatic, true);
  assert.deepEqual(preferences.dictionary, ['companion', 'lineleaf']);
  await other.close(); await options.getByRole('button', {name: 'Reset preferences and site access'}).click();
  await options.waitForFunction(() => document.querySelector('#status').textContent.includes('reset'));
});
test('the language setting offers Türkçe, enables opted-in clearer wording, and survives a reload', async () => {
  await options.reload(); await options.waitForFunction(() => document.querySelector('#variant').value === 'US' && document.querySelector('#status').textContent === '');
  assert.deepEqual(await options.locator('#variant option').evaluateAll(list => list.map(option => [option.value, option.textContent])), [['US', 'English · US'], ['UK', 'English · UK'], ['TR', 'Türkçe']]);
  const save = async () => {
    await options.getByRole('button', {name: 'Save preferences'}).click();
    await options.waitForFunction(() => document.querySelector('#status').textContent === 'Preferences saved.');
  };
  const stored = () => worker.evaluate(async () => (await chrome.storage.local.get('preferences')).preferences);
  // A direct click: the fixed save bar can cover a switch near the bottom of the window, which would swallow a pointer click.
  const toggle = id => options.locator(id).evaluate(el => el.click());
  await toggle('#automatic'); await toggle('#clarity'); await save();
  assert.equal((await stored()).clarity, true);
  await options.locator('#variant').selectOption('TR');
  assert.equal(await options.locator('#clarity').isDisabled(), false); assert.equal(await options.locator('#clarity').isChecked(), true); // offered after the automatic opt-in
  await save(); await options.reload(); await options.waitForFunction(() => document.querySelector('#variant').value === 'TR');
  assert.equal(await options.locator('#clarity').isDisabled(), false); assert.equal(await options.locator('#clarity').isChecked(), true);
  assert.deepEqual([(await stored()).variant, (await stored()).clarity], ['TR', true]);
  // Dictionary words typed under Türkçe are cased the Turkish way (capital I is dotless), which is also what the provider receives.
  await options.locator('#dictionary').fill('Işık\nAnkara'); await save();
  assert.deepEqual((await stored()).dictionary, ['ışık', 'ankara']); assert.equal(await options.locator('#dictionary').inputValue(), 'ışık\nankara');
  await options.locator('#variant').selectOption('US'); // back to English: the choice is still there and can be changed
  assert.equal(await options.locator('#clarity').isDisabled(), false); assert.equal(await options.locator('#clarity').isChecked(), true);
  await options.getByRole('button', {name: 'Reset preferences and site access'}).click();
  await options.waitForFunction(() => document.querySelector('#status').textContent.includes('reset'));
});
