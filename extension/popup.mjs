import {command} from './lib/ui-api.mjs';
import {originOf, sitePattern, errorCode, PROVIDER_LABELS} from './lib/policy.mjs';
import {messageFor, connectionSummary, connectionReady} from './lib/messages.mjs';
const query = x => document.querySelector(x);
// `tone` 'warn' makes the message a callout that needs attention; `fix` adds the way to Settings, where Seatline is set up.
function show(text, {tone = 'info', fix = false} = {}) {
  query('#status').textContent = text; query('#alert').hidden = !text; query('#alert').classList.toggle('warn', tone === 'warn'); query('#fix').hidden = !fix;
}
const dot = (state, label) => { query('#dot').dataset.state = state; query('#connection-label').textContent = label; };
const NOTICE_KEY = 'privacyNoticeSeen'; // the one-time note about where checked text goes; "Reset preferences" clears it with the rest
let tab, origin, settings, noticeSeen = true;
const NOTES = {on: 'Lineleaf is on here', off: 'Off here. Turn on to check your writing.', paused: 'Paused on all sites', unavailable: 'Lineleaf can’t run on this page.'};
async function load() {
  [tab] = await chrome.tabs.query({active: true, currentWindow: true}); origin = originOf(tab?.url);
  settings = await command('get-settings');
  // Unset means the note has not been seen; storage that cannot be read means do not nag.
  const stored = chrome.storage?.local ? await chrome.storage.local.get(NOTICE_KEY).catch(() => null) : null;
  noticeSeen = stored ? stored[NOTICE_KEY] === true : true;
  const usable = Boolean(origin) && !tab.incognito, enabled = usable && settings.sites.includes(origin);
  const state = !usable ? 'unavailable' : settings.paused ? 'paused' : enabled ? 'on' : 'off';
  document.body.dataset.state = state;
  query('#site').textContent = origin ? new URL(origin).hostname : 'This page';
  query('#avatar').textContent = origin ? new URL(origin).hostname.replace(/^www\./u, '').charAt(0) || '·' : '!';
  query('#note').textContent = NOTES[state];
  query('#enabled').checked = enabled; query('#enabled').disabled = !usable;
  query('#open').disabled = state !== 'on';
  query('#pause').setAttribute('aria-pressed', String(settings.paused)); query('#pause-label').textContent = settings.paused ? 'Resume' : 'Pause on all sites';
  query('#notice-text').textContent = `Text you check goes to ${PROVIDER_LABELS[settings.provider] ?? 'your provider'} through Seatline. Nothing is saved.`;
  query('#notice').hidden = noticeSeen || state !== 'on';
}
query('#pause').addEventListener('click', async () => {
  try { settings = await command('set-pause', {paused: !settings.paused}); show(''); await load(); }
  catch (error) { show(messageFor(errorCode(error)), {tone: 'warn'}); }
});
query('#enabled').addEventListener('change', async () => {
  const enabled = query('#enabled').checked; query('#enabled').disabled = true; show('');
  try {
    if (enabled && !await chrome.permissions.request({origins: [sitePattern(origin)]})) { show('Site permission was not granted.', {tone: 'warn'}); return; }
    settings = await command('set-site', {origin, enabled});
  } catch (error) { show(messageFor(errorCode(error)), {tone: 'warn'}); }
  finally { await load().catch(() => show(messageFor('UNAVAILABLE'), {tone: 'warn'})); }
});
query('#notice-ok').addEventListener('click', () => { query('#notice').hidden = true; noticeSeen = true; chrome.storage?.local?.set({[NOTICE_KEY]: true}).catch(() => {}); });
query('#open').addEventListener('click', async () => {
  query('#open').disabled = true;
  try { await command('open-panel', {tabId: tab.id}); window.close(); }
  catch (error) { show(messageFor(errorCode(error)), {tone: 'warn'}); query('#open').disabled = false; }
});
// The user asked: a fresh check (the worker always probes). A healthy answer is just the green dot; a problem says what it is and where to fix it.
query('#connection').addEventListener('click', async () => {
  query('#connection').disabled = true; dot('unknown', 'Checking…'); show('');
  try {
    const state = await command('check-connection');
    if (connectionReady(state)) dot('ready', 'Seatline ready'); else { dot('problem', 'Seatline needs attention'); show(connectionSummary(state), {tone: 'warn', fix: true}); }
  } catch (error) { dot('problem', 'Seatline needs attention'); show(messageFor(errorCode(error)), {tone: 'warn', fix: errorCode(error) !== 'BUSY'}); }
  finally { query('#connection').disabled = false; }
});
query('#settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
query('#fix').addEventListener('click', () => chrome.runtime.openOptionsPage());
// Opening the menu on a site Lineleaf is on for is the likeliest moment before a check: get the provider ready. The worker declines unless it is
// worth doing; when it did prepare, the provider answered, which is the one cheap sign that Seatline is ready, so the dot says so. Nothing else waits for it.
const prepare = () => {
  if (document.body.dataset.state === 'on') command('prepare', {tabId: tab.id}).then(result => { if (result === 'prepared' && query('#dot').dataset.state === 'unknown') dot('ready', 'Seatline ready'); }).catch(() => {});
};
load().then(prepare).catch(() => show(messageFor('UNAVAILABLE'), {tone: 'warn'}));
