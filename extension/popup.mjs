import {command} from './lib/ui-api.mjs';
import {originOf, sitePattern, errorCode} from './lib/policy.mjs';
import {messageFor, connectionSummary} from './lib/messages.mjs';
const query = x => document.querySelector(x), show = x => { query('#status').textContent = x; };
let tab, origin, settings;
async function load() {
  [tab] = await chrome.tabs.query({active: true, currentWindow: true}); origin = originOf(tab?.url);
  settings = await command('get-settings');
  query('#site').textContent = origin || 'This page is unavailable.';
  query('#avatar').textContent = origin ? new URL(origin).hostname.replace(/^www\./u, '').charAt(0) || '·' : '!';
  const state = !origin || tab.incognito ? 'off' : settings.paused ? 'paused' : settings.sites.includes(origin) ? 'on' : 'off';
  query('#state').dataset.state = state; query('#state').textContent = !origin || tab.incognito ? 'Unavailable' : {on: 'On here', paused: 'Paused', off: 'Off here'}[state];
  query('#enabled').checked = settings.sites.includes(origin);
  query('#paused').checked = settings.paused;
  query('#enabled').disabled = !origin || tab.incognito;
  query('#open').disabled = !origin || tab.incognito || settings.paused || !settings.sites.includes(origin);
  if (settings.paused) show(messageFor('PAUSED'));
}
query('#paused').addEventListener('change', async () => {
  try { settings = await command('set-pause', {paused: query('#paused').checked}); await load(); show(settings.paused ? messageFor('PAUSED') : 'Lineleaf resumed on enabled sites.'); }
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
  try { const state = await command('check-connection'); show(connectionSummary(state)); }
  catch (error) { show(messageFor(errorCode(error))); }
  finally { query('#connection').disabled = false; }
});
query('#settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
// First open only: say why the writing panel is unavailable instead of leaving a dimmed button unexplained.
function hint() {
  if (query('#status').textContent) return;
  if (!origin || tab.incognito) show('Lineleaf cannot run on this page.');
  else if (!settings.sites.includes(origin)) show('Turn on “Check my writing here” to use Lineleaf on this site.');
}
// Opening the menu on a site Lineleaf is on for is the likeliest moment before a check: get the provider ready. The worker declines unless it is
// worth doing, and nothing here waits for it or shows its result.
const prepare = () => { if (query('#state').dataset.state === 'on') command('prepare', {tabId: tab.id}).catch(() => {}); };
load().then(() => { hint(); prepare(); }).catch(() => show(messageFor('UNAVAILABLE')));
