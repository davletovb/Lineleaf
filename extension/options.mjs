import {command} from './lib/ui-api.mjs';
import {errorCode} from './lib/policy.mjs';
import {messageFor} from './lib/messages.mjs';
const query = x => document.querySelector(x), show = text => { query('#status').textContent = text; };
async function load() {
  const settings = await command('get-settings'); query('#variant').value = settings.variant;
  query('#model').value = settings.model; query('#paused').checked = settings.paused;
  query('#authorize').textContent = `seatline-companion authorize lineleaf codex chrome-extension://${chrome.runtime.id}/`;
  query('#sites').replaceChildren();
  for (const origin of settings.sites) {
    const item = document.createElement('li'); item.append(document.createTextNode(origin));
    const disable = document.createElement('button'); disable.textContent = 'Disable'; disable.setAttribute('aria-label', `Disable ${origin}`);
    disable.addEventListener('click', async () => { try { await command('set-site', {origin, enabled: false}); await load(); show('Site disabled.'); } catch (error) { show(messageFor(errorCode(error))); } });
    item.append(disable); query('#sites').append(item);
  }
  if (!settings.sites.length) { const item = document.createElement('li'); item.textContent = 'No sites enabled.'; query('#sites').append(item); }
}
query('#preferences').addEventListener('submit', async event => {
  event.preventDefault();
  try { await command('save-settings', {model: query('#model').value.trim(), variant: query('#variant').value, paused: query('#paused').checked}); show('Preferences saved.'); }
  catch (error) { show(messageFor(errorCode(error))); }
});
query('#connection').addEventListener('click', async () => {
  query('#connection').disabled = true; show('Checking Seatline…');
  try { const s = await command('check-connection'); show(`Codex: ${s.availability}, ${s.authentication}, ${s.sign_in}. No-tools requests: ${s.tool_isolation ? 'supported' : 'unavailable'}.`); }
  catch (error) { show(messageFor(errorCode(error))); }
  finally { query('#connection').disabled = false; }
});
query('#reset').addEventListener('click', async () => { try { await command('reset'); await load(); show('Preferences and site access reset.'); } catch (error) { show(messageFor(errorCode(error))); } });
load().catch(() => show(messageFor('UNAVAILABLE')));
