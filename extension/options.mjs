import {command} from './lib/ui-api.mjs';
import {errorCode, dictionaryWord} from './lib/policy.mjs';
import {messageFor, connectionSummary} from './lib/messages.mjs';
const query = x => document.querySelector(x), show = text => { query('#status').textContent = text; };
let loaded, lastTiming;
async function loadTiming() {
  lastTiming = await command('get-check-timing');
  query('#timing-phases').replaceChildren(); query('#copy-timing').disabled = !lastTiming;
  query('#timing-summary').textContent = lastTiming
    ? `${lastTiming.kind} ${lastTiming.mode} · ${lastTiming.requested_model ?? 'provider default model'} · ${lastTiming.reasoning_effort ?? 'provider default effort'} · ${lastTiming.outcome}`
    : 'No manual check recorded in this browser session.';
  if (!lastTiming) return;
  for (const [key, label] of [['readiness_ms', 'Readiness'], ['launch_wait_ms', 'Wait for launch'], ['provider_init_ms', 'Startup'], ['answer_ms', 'Answer'], ['finish_ms', 'Completion'], ['validation_ms', 'Validation'], ['total_ms', 'Total']]) {
    const row = document.createElement('tr'), name = document.createElement('th'), value = document.createElement('td');
    name.scope = 'row'; name.textContent = label;
    value.textContent = Number.isFinite(lastTiming[key]) ? `${(lastTiming[key] / 1000).toFixed(2)} s` : 'Unavailable';
    row.append(name, value); query('#timing-phases').append(row);
  }
}
async function load() {
  const settings = await command('get-settings'); loaded = settings; query('#variant').value = settings.variant;
  query('#model').value = settings.model; query('#effort').value = settings.effort; query('#paused').checked = settings.paused;
  query('#automatic').checked = settings.automatic; query('#clarity').checked = settings.clarity; query('#clarity').disabled = !settings.automatic;
  query('#dictionary').value = settings.dictionary.join('\n');
  query('#authorize').textContent = `seatline-companion authorize lineleaf codex chrome-extension://${chrome.runtime.id}/`;
  query('#sites').replaceChildren();
  for (const origin of settings.sites) {
    const item = document.createElement('li'), avatar = document.createElement('span'), name = document.createElement('span');
    avatar.className = 'avatar'; avatar.setAttribute('aria-hidden', 'true'); avatar.textContent = new URL(origin).hostname.replace(/^www\./u, '').charAt(0) || '·';
    name.className = 'origin'; name.textContent = origin; item.append(avatar, name);
    const disable = document.createElement('button'); disable.textContent = 'Disable'; disable.className = 'small'; disable.setAttribute('aria-label', `Disable ${origin}`);
    disable.addEventListener('click', async () => { try { await command('set-site', {origin, enabled: false}); await load(); show('Site disabled.'); } catch (error) { show(messageFor(errorCode(error))); } });
    item.append(disable); query('#sites').append(item);
  }
  if (!settings.sites.length) { const item = document.createElement('li'); item.className = 'empty'; item.textContent = 'No sites enabled yet. Open the Lineleaf popup on a page and turn on “Check my writing here”.'; query('#sites').append(item); }
}
query('#preferences').addEventListener('submit', async event => {
  event.preventDefault();
  const dictionary = query('#dictionary').value.split(/\r?\n/u).map(x => x.trim()).filter(Boolean);
  if (dictionary.length > 500 || dictionary.some(word => !dictionaryWord(word))) { show('Use one word per line, up to 500 words of at most 64 characters.'); return; }
  if (!loaded) return;
  const values = {model: query('#model').value.trim(), effort: query('#effort').value, variant: query('#variant').value, automatic: query('#automatic').checked, clarity: query('#automatic').checked && query('#clarity').checked};
  const changes = {}, expected = {};
  for (const key of Object.keys(values)) if (values[key] !== loaded[key]) { changes[key] = values[key]; expected[key] = loaded[key]; }
  const words = [...new Set(dictionary.map(dictionaryWord))];
  const delta = {add: words.filter(word => !loaded.dictionary.includes(word)), remove: loaded.dictionary.filter(word => !words.includes(word))};
  show('Saving preferences…');
  try { await command('save-settings', {changes, expected, dictionary: delta}); await load(); show('Preferences saved.'); }
  catch (error) { show(messageFor(errorCode(error))); }
});
query('#automatic').addEventListener('change', () => { query('#clarity').disabled = !query('#automatic').checked; if (!query('#automatic').checked) query('#clarity').checked = false; });
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
  try { const s = await command('check-connection'); show(connectionSummary(s)); }
  catch (error) { show(messageFor(errorCode(error))); }
  finally { query('#connection').disabled = false; }
});
query('#reset').addEventListener('click', async () => { try { await command('reset'); await load(); await loadTiming(); show('Preferences and site access reset.'); } catch (error) { show(messageFor(errorCode(error))); } });
query('#refresh-timing').addEventListener('click', () => loadTiming().catch(() => show(messageFor('UNAVAILABLE'))));
query('#copy-timing').addEventListener('click', async () => {
  if (!lastTiming) return;
  try { await navigator.clipboard.writeText(JSON.stringify(lastTiming, null, 2)); show('Timing copied.'); }
  catch { show('Could not copy timing.'); }
});
query('#copy-command').addEventListener('click', async () => {
  const command = query('#authorize').textContent;
  try { await navigator.clipboard.writeText(command); show('Command copied.'); }
  catch { const range = document.createRange(); range.selectNodeContents(query('#authorize')); getSelection().removeAllRanges(); getSelection().addRange(range); show('Press Ctrl/⌘ C to copy the selected command.'); }
});
// The side navigation marks the section being read.
const links = [...document.querySelectorAll('.nav a')], sections = links.map(link => document.querySelector(link.getAttribute('href')));
const mark = () => {
  // At the very bottom the last section is the one being read, even when it is too short to reach the reading line.
  const atEnd = innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
  const current = atEnd ? sections.at(-1) : sections.filter(section => section.getBoundingClientRect().top <= innerHeight * 0.35).pop() ?? sections[0];
  links.forEach((link, index) => link.setAttribute('aria-current', String(sections[index] === current)));
};
addEventListener('scroll', mark, {passive: true}); mark();
load().catch(() => show(messageFor('UNAVAILABLE')));
loadTiming().catch(() => {});
