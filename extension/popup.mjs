import {command} from './lib/ui-api.mjs';
import {originOf, sitePattern, errorCode} from './lib/policy.mjs';
import {messageFor} from './lib/messages.mjs';
const query = x => document.querySelector(x), show = x => { query('#status').textContent = x; };
let tab, origin, settings;
async function load() {
  [tab] = await chrome.tabs.query({active: true, currentWindow: true}); origin = originOf(tab?.url);
  settings = await command('get-settings');
  query('#site').textContent = origin || 'This page is unavailable.';
  query('#enabled').checked = settings.sites.includes(origin);
  query('#paused').checked = settings.paused;
  query('#enabled').disabled = !origin || tab.incognito;
  query('#open').disabled = !origin || tab.incognito || settings.paused || !settings.sites.includes(origin);
  if (settings.paused) show(messageFor('PAUSED'));
}
query('#paused').addEventListener('change', async () => {
  try { settings = await command('save-settings', {model: settings.model, variant: settings.variant, paused: query('#paused').checked, automatic: settings.automatic, dictionary: settings.dictionary}); await load(); show(settings.paused ? messageFor('PAUSED') : 'Lineleaf resumed on enabled sites.'); }
  catch (error) { show(messageFor(errorCode(error))); }
});
query('#enabled').addEventListener('change', async () => {
  const enabled = query('#enabled').checked; query('#enabled').disabled = true;
  try {
    if (enabled && !await chrome.permissions.request({origins: [sitePattern(origin)]})) { show('Site permission was not granted.'); return; }
    settings = await command('set-site', {origin, enabled}); show(enabled ? 'Site enabled. Select text to check.' : 'Site disabled.');
  } catch (error) { show(messageFor(errorCode(error))); }
  finally { await load().catch(() => show(messageFor('UNAVAILABLE'))); }
});
query('#open').addEventListener('click', async () => {
  query('#open').disabled = true;
  try { await command('open-panel', {tabId: tab.id}); window.close(); }
  catch (error) { show(messageFor(errorCode(error))); query('#open').disabled = false; }
});
query('#connection').addEventListener('click', async () => {
  query('#connection').disabled = true; show('Checking Seatline…');
  try { const state = await command('check-connection'); show(`Codex: ${state.availability}, ${state.authentication}, ${state.sign_in}. No-tools requests: ${state.tool_isolation ? 'supported' : 'unavailable'}.`); }
  catch (error) { show(messageFor(errorCode(error))); }
  finally { query('#connection').disabled = false; }
});
query('#settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
load().catch(() => show(messageFor('UNAVAILABLE')));
