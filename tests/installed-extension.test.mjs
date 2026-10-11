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
const stored = () => worker.evaluate(async () => (await chrome.storage.local.get('preferences')).preferences);
async function settles(check) { for (let tries = 0; tries < 100; tries++) { const preferences = await stored(); if (check(preferences)) return preferences; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('preferences did not settle'); }
const advanced = page => page.evaluate(() => { document.querySelector('#advanced').open = true; }); // the model lives under Advanced
test('built MV3 extension loads with the stable ID and settings persist across pages', async () => {
  assert.equal(new URL(worker.url()).host, id);
  assert.equal((await worker.evaluate(() => chrome.runtime.getManifest())).version, '0.1.0');
  assert.equal(await options.locator('#automatic').isChecked(), false);
  assert.equal(await options.locator('#dictionary').inputValue(), '');
  await options.locator('#variant').selectOption('UK'); await options.locator('#automatic').check(); await options.locator('#dictionary').fill('Seatline\nLineleaf'); // these save as they are changed
  await advanced(options); await options.locator('#model').fill('test-model'); await options.getByRole('button', {name: 'Save'}).click(); // the provider has its own Save
  await options.waitForFunction(() => document.querySelector('#status').textContent === 'Provider saved.');
  await settles(saved => saved.variant === 'UK' && saved.automatic === true && saved.dictionary.includes('lineleaf') && saved.model === 'test-model');
  await options.reload(); await options.waitForFunction(() => document.querySelector('#variant').value === 'UK');
  assert.equal(await options.locator('#model').inputValue(), 'test-model');
  assert.equal(await options.locator('#automatic').isChecked(), true);
  assert.equal(await options.locator('#dictionary').inputValue(), 'seatline\nlineleaf');
  const permissions = await worker.evaluate(() => chrome.permissions.getAll()); assert.deepEqual(permissions.origins ?? [], []);
});
test('missing native host produces a fixed diagnostic in the actual extension', async () => {
  await options.getByRole('button', {name: 'Check Seatline'}).click();
  await options.waitForFunction(() => document.querySelector('#seatline-note').textContent.includes('Seatline is unavailable.'));
  assert.equal(await options.locator('#connection').isEnabled(), true); assert.equal(await options.locator('#seatline-dot').getAttribute('data-state'), 'problem');
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
  await panel.button('Proofread').waitFor();
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
  await options.locator('#automatic').check(); await settles(saved => saved.automatic === true); // saved as it is changed
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
  await writing.keyboard.press('Alt+Shift+l'); await inline.button('More options').click(); await inline.button('Pause Lineleaf').click();
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
  await other.locator('#automatic').check(); await other.locator('#dictionary').fill('Seatline'); // saved as they are changed
  await settles(saved => saved.automatic === true && saved.dictionary.join() === 'seatline');
  // The original tab still shows the old defaults; changing just the model must preserve other edits.
  assert.equal(await options.locator('#paused').isChecked(), false);
  await advanced(options); await options.locator('#model').fill('new-model'); await options.getByRole('button', {name: 'Save'}).click();
  await options.waitForFunction(() => document.querySelector('#status').textContent === 'Provider saved.');
  let preferences = await stored();
  assert.equal(preferences.paused, true); assert.equal(preferences.automatic, true); assert.deepEqual(preferences.dictionary, ['seatline']); assert.equal(preferences.model, 'new-model');
  assert.equal(await options.locator('#paused').isChecked(), true);
  // A tab that removes a word it knew while another tab adds one keeps both changes.
  await options.reload(); await options.waitForFunction(() => document.querySelector('#dictionary').value === 'seatline');
  await other.locator('#dictionary').fill('Seatline\nCompanion'); await settles(saved => saved.dictionary.includes('companion'));
  await options.locator('#dictionary').fill('Lineleaf'); preferences = await settles(saved => saved.dictionary.includes('lineleaf'));
  assert.deepEqual(preferences.dictionary, ['companion', 'lineleaf']);
  await options.reload(); await advanced(options); await options.locator('#model').fill('latest-model'); await options.getByRole('button', {name: 'Save'}).click();
  await options.waitForFunction(() => document.querySelector('#status').textContent === 'Provider saved.' && document.querySelector('#model').value === 'latest-model');
  await advanced(other); await other.locator('#model').fill('stale-model'); await other.getByRole('button', {name: 'Save'}).click();
  await other.waitForFunction(() => document.querySelector('#status').textContent.includes('Preferences changed elsewhere'));
  preferences = await stored();
  assert.equal(preferences.model, 'latest-model'); assert.equal(preferences.paused, true); assert.equal(preferences.automatic, true);
  assert.deepEqual(preferences.dictionary, ['companion', 'lineleaf']);
  await other.close(); await options.getByRole('button', {name: 'Reset preferences and site access'}).click();
  await options.waitForFunction(() => document.querySelector('#status').textContent.includes('reset'));
});
test('the settings choose only the English spelling: no language to pick, a stored Turkish choice reads as US, and dictionary words keep Turkish casing', async () => {
  await options.reload(); await options.waitForFunction(() => document.querySelector('#variant').value === 'US' && document.querySelector('#status').textContent === '');
  assert.equal(await options.locator('label[for="variant"]').textContent(), 'English spelling');
  assert.deepEqual(await options.locator('#variant option').evaluateAll(list => list.map(option => [option.value, option.textContent])), [['US', 'English · US'], ['UK', 'English · UK']]);
  assert.match(await options.locator('#writing').textContent(), /detects English or Turkish itself, so there is nothing to switch/);
  // A direct click: it reaches a switch wherever the page is scrolled to. Each choice is saved as it is made.
  const toggle = id => options.locator(id).evaluate(el => el.click());
  await toggle('#automatic'); await toggle('#clarity'); await settles(saved => saved.clarity === true);
  const disclosure = await options.locator('label[for="clarity"] .muted').textContent();
  assert.match(disclosure, /English and Turkish/); assert.doesNotMatch(disclosure, /English setting/);
  // A "TR" saved while Turkish was a setting reads as US: the page shows US, and a change from it works.
  await worker.evaluate(async () => { const { preferences } = await chrome.storage.local.get('preferences'); await chrome.storage.local.set({preferences: {...preferences, variant: 'TR'}}); });
  await options.reload(); await options.waitForFunction(() => document.querySelector('#variant').value === 'US' && document.querySelector('#status').textContent === '');
  await options.locator('#variant').selectOption('UK'); assert.equal((await settles(saved => saved.variant === 'UK')).variant, 'UK');
  // Dictionary words with Turkish letters are cased the Turkish way (capital I is dotless), which is also what the provider receives.
  await options.locator('#dictionary').fill('Işık\nAnkara'); await options.locator('#variant').focus(); // leaving the box saves it and tidies what it shows
  await settles(saved => saved.dictionary.includes('ankara'));
  assert.deepEqual((await stored()).dictionary, ['ışık', 'ankara']); await options.waitForFunction(() => document.querySelector('#dictionary').value === 'ışık\nankara');
  assert.equal(await options.locator('#clarity').isChecked(), true); // the clearer-wording choice is not tied to a language
  await options.getByRole('button', {name: 'Reset preferences and site access'}).click();
  await options.waitForFunction(() => document.querySelector('#status').textContent.includes('reset'));
});

