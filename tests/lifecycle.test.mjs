import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, cp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const id = 'lnbkadelggojehiapgnhonicnfonobal';
test('installed profile restart/update preserves identity, preferences, grants and opt-out behavior', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lineleaf-lifecycle-')), source = join(root, 'extension'), profile = join(root, 'profile'); let context;
  const launch = () => chromium.launchPersistentContext(profile, {channel: 'chromium', headless: true, executablePath: process.env.LINELEAF_CHROMIUM_PATH || undefined,
    args: [`--disable-extensions-except=${source}`, `--load-extension=${source}`], ignoreDefaultArgs: ['--disable-extensions']});
  const workerFor = async context => context.serviceWorkers()[0] ?? context.waitForEvent('serviceworker', {timeout: 15000});
  try {
    await cp(fileURLToPath(new URL('../dist/lineleaf', import.meta.url)), source, {recursive: true});
    context = await launch(); let worker = await workerFor(context);
    const options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
    await options.waitForFunction(() => document.querySelector('#authorize').textContent.includes('seatline-companion'));
    await options.locator('#variant').selectOption('UK'); await options.locator('#dictionary').fill('Lineleaf');
    await options.getByRole('button', {name: 'Save preferences'}).click(); await options.waitForFunction(() => document.querySelector('#status').textContent === 'Preferences saved.');
    const management = await context.newPage(); await management.goto('chrome://extensions/');
    await management.evaluate(async id => chrome.developerPrivate.addHostPermission(id, 'https://lifecycle.test/*'), id); await management.close();
    await options.evaluate(() => {
      const button = document.createElement('button'); button.textContent = 'Grant lifecycle fixture';
      button.onclick = async () => { window.granted = await chrome.permissions.request({origins: ['https://lifecycle.test/*']}); }; document.body.append(button);
    });
    await options.getByRole('button', {name: 'Grant lifecycle fixture'}).click(); await options.waitForFunction(() => window.granted === true);
    assert.equal((await options.evaluate(() => chrome.runtime.sendMessage({type: 'set-site', payload: {origin: 'https://lifecycle.test', enabled: true}}))).ok, true);
    await options.waitForFunction(async () => (await chrome.scripting.getRegisteredContentScripts()).some(x => x.id === 'lineleaf-sites'));
    await context.close(); context = null;
    const manifestPath = join(source, 'manifest.json'), original = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(manifestPath, JSON.stringify({...original, version: '0.1.1'})); // Test copy only; the shipped version stays 0.1.0.
    context = await launch(); worker = await workerFor(context);
    assert.equal(new URL(worker.url()).host, id);
    assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().version), '0.1.1');
    const reopened = await context.newPage(); await reopened.goto(`chrome-extension://${id}/options.html`);
    await reopened.waitForFunction(() => document.querySelector('#variant').value === 'UK');
    assert.equal(await reopened.locator('#dictionary').inputValue(), 'lineleaf'); assert.equal(await reopened.locator('#automatic').isChecked(), false);
    assert.equal(await worker.evaluate(() => chrome.permissions.contains({origins: ['https://lifecycle.test/*']})), true);
    await reopened.waitForFunction(async () => (await chrome.scripting.getRegisteredContentScripts()).some(x => x.id === 'lineleaf-sites' && x.allFrames));
    assert.equal((await reopened.evaluate(() => chrome.runtime.sendMessage({type: 'set-site', payload: {origin: 'https://lifecycle.test', enabled: false}}))).ok, true);
    await reopened.waitForFunction(async () => !(await chrome.permissions.contains({origins: ['https://lifecycle.test/*']})));
    await reopened.getByRole('button', {name: 'Reset preferences and site access'}).click(); await reopened.waitForFunction(() => document.querySelector('#status').textContent.includes('reset'));
    await context.close(); context = null;
    context = await launch(); worker = await workerFor(context);
    assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get('preferences')).preferences ?? null), null);
    assert.equal(await worker.evaluate(() => chrome.permissions.contains({origins: ['https://lifecycle.test/*']})), false);
    assert.deepEqual(await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts()), []);
    // Native permission prompts and uninstall remain explicitly human-device acceptance work.
  } finally { await context?.close(); await rm(root, {recursive: true, force: true}); }
});
