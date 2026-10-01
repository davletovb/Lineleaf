import assert from 'node:assert/strict';
import {before, after, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
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
  await options.locator('#variant').selectOption('UK'); await options.locator('#model').fill('test-model');
  await options.getByRole('button', {name: 'Save preferences'}).click();
  await options.waitForFunction(() => document.querySelector('#status').textContent === 'Preferences saved.');
  await options.reload(); await options.waitForFunction(() => document.querySelector('#variant').value === 'UK');
  assert.equal(await options.locator('#model').inputValue(), 'test-model');
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
  await writing.getByRole('button', {name: 'Check selection'}).waitFor();
  assert.equal(await writing.locator('[data-lineleaf-root] #selected').textContent(), 'He go to work.');
  await options.evaluate(() => chrome.runtime.sendMessage({type: 'set-site', payload: {origin: 'https://writing.test', enabled: false}}));
  await writing.waitForFunction(() => document.querySelector('[data-lineleaf-root]').shadowRoot.querySelector('#check').disabled);
  assert.equal(await worker.evaluate(() => chrome.permissions.contains({origins: ['https://writing.test/*']})), false);
  await options.getByRole('button', {name: 'Reset preferences and site access'}).click();
  await options.waitForFunction(() => document.querySelector('#status').textContent.includes('reset'));
});
