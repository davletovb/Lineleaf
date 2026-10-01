import {command} from './lib/ui-api.mjs';
import {errorCode, dictionaryWord} from './lib/policy.mjs';
import {messageFor} from './lib/messages.mjs';
const query = x => document.querySelector(x), show = text => { query('#status').textContent = text; };
let loaded;
async function load() {
  const settings = await command('get-settings'); loaded = settings; query('#variant').value = settings.variant;
  query('#model').value = settings.model; query('#paused').checked = settings.paused;
  query('#automatic').checked = settings.automatic; query('#dictionary').value = settings.dictionary.join('\n');
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
  const dictionary = query('#dictionary').value.split(/\r?\n/u).map(x => x.trim()).filter(Boolean);
  if (dictionary.length > 500 || dictionary.some(word => !dictionaryWord(word))) { show('Use one word per line, up to 500 words of at most 64 characters.'); return; }
  if (!loaded) return;
  const values = {model: query('#model').value.trim(), variant: query('#variant').value, automatic: query('#automatic').checked};
  const changes = {}, expected = {};
  for (const key of Object.keys(values)) if (values[key] !== loaded[key]) { changes[key] = values[key]; expected[key] = loaded[key]; }
  const words = [...new Set(dictionary.map(dictionaryWord))];
  const delta = {add: words.filter(word => !loaded.dictionary.includes(word)), remove: loaded.dictionary.filter(word => !words.includes(word))};
  show('Saving preferences…');
  try { await command('save-settings', {changes, expected, dictionary: delta}); await load(); show('Preferences saved.'); }
  catch (error) { show(messageFor(errorCode(error))); }
});
query('#paused').addEventListener('change', async () => {
  const previous = !query('#paused').checked;
  query('#paused').disabled = true;
  try { const settings = await command('set-pause', {paused: query('#paused').checked}); query('#paused').checked = settings.paused; show(settings.paused ? messageFor('PAUSED') : 'Lineleaf resumed on enabled sites.'); }
  catch (error) {
    try { query('#paused').checked = (await command('get-settings')).paused; } catch { query('#paused').checked = previous; }
    show(messageFor(errorCode(error)));
  }
  finally { query('#paused').disabled = false; }
});
query('#connection').addEventListener('click', async () => {
  query('#connection').disabled = true; show('Checking Seatline…');
  try { const s = await command('check-connection'); show(`Codex: ${s.availability}, ${s.authentication}, ${s.sign_in}. No-tools requests: ${s.tool_isolation ? 'supported' : 'unavailable'}.`); }
  catch (error) { show(messageFor(errorCode(error))); }
  finally { query('#connection').disabled = false; }
});
query('#reset').addEventListener('click', async () => { try { await command('reset'); await load(); show('Preferences and site access reset.'); } catch (error) { show(messageFor(errorCode(error))); } });
load().catch(() => show(messageFor('UNAVAILABLE')));
