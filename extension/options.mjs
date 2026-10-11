import {command} from './lib/ui-api.mjs';
import {errorCode, dictionaryWord, PROVIDER_LABELS, preferences} from './lib/policy.mjs';
import {messageFor, connectionSummary, connectionReady} from './lib/messages.mjs';
const query = x => document.querySelector(x);
// The pill at the top reads "All changes saved" until there is something to say; `warn` marks a message that needs attention.
const show = (text, tone = 'info') => { query('#status').textContent = text; query('#status').dataset.tone = tone; };
const PROFILE_KEYS = ['model', 'effort', 'speed', 'allowCloud'];
let loaded, lastTiming, profiles, selectedProvider;
// Clearer wording spends the automatic budget and requires its opt-in for either writing language.
const syncClarity = () => { query('#clarity').disabled = !query('#automatic').checked; };
// The saved provider's name, wherever the page says where text goes.
const syncNames = () => { for (const name of document.querySelectorAll('[data-provider]')) name.textContent = PROVIDER_LABELS[loaded.provider] ?? 'your provider'; };

// ---------- Provider: saved with its own Save, because switching it changes what the setup command and Seatline grant ----------
function renderProvider(provider) {
  const values = profiles[provider]; selectedProvider = provider; query('#provider').value = provider;
  query('#model').value = values.model; query('#effort').value = values.effort; query('#speed').value = values.speed;
  query('#effort').disabled = query('#speed').disabled = provider !== 'codex'; query('#effort-field').hidden = query('#speed-field').hidden = provider !== 'codex'; // only Codex has them
  query('#allow-cloud').checked = values.allowCloud; query('#cloud-setting').hidden = provider !== 'gemini';
}
const formProfile = () => ({model: query('#model').value.trim(), effort: query('#effort').value, speed: query('#speed').value, allowCloud: query('#allow-cloud').checked});
// What the provider form differs in from what is saved, in the shape the worker's save-settings takes (with what it expects to find, so a change made elsewhere is refused).
function providerDelta() {
  if (!loaded) return null;
  const now = formProfile(), bank = {...profiles, [selectedProvider]: now};
  const values = {provider: selectedProvider, allowCloud: selectedProvider === 'gemini' && now.allowCloud, model: now.model, effort: now.effort, speed: now.speed};
  const changes = {}, expected = {};
  for (const key of Object.keys(values)) if (values[key] !== loaded[key] || (values.provider !== loaded.provider && PROFILE_KEYS.includes(key))) { changes[key] = values[key]; expected[key] = loaded[key]; }
  const patches = Object.fromEntries(Object.entries(bank).filter(([id, profile]) => PROFILE_KEYS.some(key => profile[key] !== loaded.providerSettings[id][key])));
  if (Object.keys(patches).length || Object.keys(changes).some(key => ['provider', ...PROFILE_KEYS].includes(key))) expected.provider = loaded.provider;
  if (values.provider !== loaded.provider || Object.keys(patches).length) expected.providerSettings = loaded.providerSettings;
  return {changes, expected, patches, dirty: Object.keys(changes).length > 0 || Object.keys(patches).length > 0};
}
const syncBar = () => { query('#provider-bar').hidden = !providerDelta()?.dirty; };
query('#provider').addEventListener('change', () => { profiles[selectedProvider] = formProfile(); renderProvider(query('#provider').value); syncBar(); });
query('#preferences').addEventListener('input', syncBar); query('#preferences').addEventListener('change', syncBar);
query('#preferences').addEventListener('submit', async event => {
  event.preventDefault(); const delta = providerDelta(); if (!delta?.dirty) return;
  show('Saving…');
  try {
    const next = preferences(await command('save-settings', {changes: delta.changes, expected: delta.expected, dictionary: {add: [], remove: []}, ...(Object.keys(delta.patches).length ? {profiles: delta.patches} : {})}));
    // Only the provider's own values move the baseline. The writing controls on this page still show what they showed, so a later save of them must compare
    // with that, never with a word another tab has added since.
    loaded = {...loaded, provider: next.provider, model: next.model, effort: next.effort, speed: next.speed, allowCloud: next.allowCloud, providerSettings: next.providerSettings};
    query('#paused').checked = next.paused; // an action, not a setting being edited, so it can show the truth
    profiles = structuredClone(next.providerSettings); renderProvider(next.provider); syncNames(); showCommand(); syncBar(); show('Provider saved.');
  } catch (error) { show(messageFor(errorCode(error)), 'warn'); }
});
query('#discard').addEventListener('click', () => { profiles = structuredClone(loaded.providerSettings); renderProvider(loaded.provider); syncBar(); show(''); });
const showCommand = () => { query('#authorize').textContent = `seatline-companion authorize lineleaf ${loaded.provider} chrome-extension://${chrome.runtime.id}/`; };

// ---------- Writing: saved as you change it ----------
let saving = Promise.resolve(), dictionaryTimer;
async function saveWritingNow() {
  if (!loaded) return;
  const dictionary = query('#dictionary').value.split(/\r?\n/u).map(x => x.trim()).filter(Boolean);
  if (dictionary.length > 500 || dictionary.some(word => !dictionaryWord(word))) { show('Not saved. Use one word per line, up to 500 words of at most 64 characters.', 'warn'); return; }
  const automatic = query('#automatic').checked, values = {variant: query('#variant').value, automatic, clarity: automatic && query('#clarity').checked};
  const changes = {}, expected = {};
  for (const key of Object.keys(values)) if (values[key] !== loaded[key]) { changes[key] = values[key]; expected[key] = loaded[key]; }
  const words = [...new Set(dictionary.map(dictionaryWord))];
  if (document.activeElement !== query('#dictionary')) query('#dictionary').value = words.join('\n'); // tidied (Turkish casing, no repeats) once the box is left, never while typing
  const delta = {add: words.filter(word => !loaded.dictionary.includes(word)), remove: loaded.dictionary.filter(word => !words.includes(word))};
  if (!Object.keys(changes).length && !delta.add.length && !delta.remove.length) return;
  show('Saving…');
  try {
    const next = preferences(await command('save-settings', {changes, expected, dictionary: delta}));
    // The baseline is what this page showed and submitted, not the stored list: a word another tab added is not in the box, so it must not read as removed here later.
    // The provider form's own baseline is not touched.
    loaded = {...loaded, variant: next.variant, automatic: next.automatic, clarity: next.clarity, dictionary: words}; show('');
  } catch (error) { show(messageFor(errorCode(error)), 'warn'); }
}
const saveWriting = () => { clearTimeout(dictionaryTimer); saving = saving.then(saveWritingNow, saveWritingNow); return saving; };
query('#automatic').addEventListener('change', () => { syncClarity(); if (!query('#automatic').checked) query('#clarity').checked = false; void saveWriting(); });
query('#clarity').addEventListener('change', () => void saveWriting());
query('#variant').addEventListener('change', () => void saveWriting());
query('#dictionary').addEventListener('input', () => { clearTimeout(dictionaryTimer); dictionaryTimer = setTimeout(() => void saveWriting(), 800); });
query('#dictionary').addEventListener('change', () => void saveWriting());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void saveWriting(); }); // leaving the page keeps what was just typed
query('#paused').addEventListener('change', async () => {
  const previous = !query('#paused').checked;
  query('#paused').disabled = true;
  try { const settings = await command('set-pause', {paused: query('#paused').checked}); query('#paused').checked = settings.paused; show(settings.paused ? messageFor('PAUSED') : 'Lineleaf resumed on enabled sites.'); }
  catch (error) {
    try { query('#paused').checked = (await command('get-settings')).paused; } catch { query('#paused').checked = previous; }
    show(messageFor(errorCode(error)), 'warn');
  }
  finally { query('#paused').disabled = false; }
});

// ---------- Seatline ----------
const seatline = (state, title, note) => { query('#seatline-dot').dataset.state = state; query('#seatline-state').textContent = title; query('#seatline-note').textContent = note; };
query('#connection').addEventListener('click', async () => {
  query('#connection').disabled = true; seatline('unknown', 'Checking Seatline…', ''); show('');
  try {
    const state = await command('check-connection');
    if (connectionReady(state)) seatline('ready', 'Seatline ready', `${PROVIDER_LABELS[state.provider ?? loaded?.provider] ?? 'Your provider'} is ready.`);
    else { seatline('problem', 'Seatline needs attention', connectionSummary(state)); query('#setup').open = true; }
  } catch (error) { seatline('problem', 'Seatline needs attention', messageFor(errorCode(error))); if (errorCode(error) !== 'BUSY') query('#setup').open = true; }
  finally { query('#connection').disabled = false; }
});
query('#copy-command').addEventListener('click', async () => {
  const command = query('#authorize').textContent;
  try { await navigator.clipboard.writeText(command); show('Command copied.'); }
  catch { const range = document.createRange(); range.selectNodeContents(query('#authorize')); getSelection().removeAllRanges(); getSelection().addRange(range); show('Press Ctrl/⌘ C to copy the selected command.'); }
});

// ---------- Data ----------
async function loadTiming() {
  lastTiming = await command('get-check-timing');
  query('#timing-phases').replaceChildren(); query('#copy-timing').disabled = !lastTiming;
  const speed = lastTiming?.requested_service_tier ? `requested ${lastTiming.requested_service_tier} speed`
    : Object.hasOwn(lastTiming ?? {}, 'requested_service_tier') && lastTiming.attempts > 0 ? 'provider default speed' : 'speed unavailable';
  query('#timing-summary').textContent = lastTiming
    ? `${PROVIDER_LABELS[lastTiming.requested_provider] ?? 'provider unavailable'} · ${lastTiming.kind} ${lastTiming.mode} · ${lastTiming.requested_model ?? 'provider default model'} · ${lastTiming.reasoning_effort ?? 'provider default effort'} · ${speed} · ${lastTiming.outcome}`
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
  const settings = preferences(await command('get-settings')); loaded = settings; profiles = structuredClone(settings.providerSettings); renderProvider(settings.provider); query('#variant').value = settings.variant;
  query('#paused').checked = settings.paused;
  query('#automatic').checked = settings.automatic; query('#clarity').checked = settings.clarity; syncClarity();
  query('#dictionary').value = settings.dictionary.join('\n');
  syncNames(); showCommand(); syncBar();
  query('#sites').replaceChildren();
  for (const origin of settings.sites) {
    const item = document.createElement('li'), avatar = document.createElement('span'), name = document.createElement('span');
    avatar.className = 'avatar'; avatar.setAttribute('aria-hidden', 'true'); avatar.textContent = new URL(origin).hostname.replace(/^www\./u, '').charAt(0) || '·';
    name.className = 'origin'; name.textContent = origin; item.append(avatar, name);
    const disable = document.createElement('button'); disable.textContent = 'Disable'; disable.className = 'small'; disable.setAttribute('aria-label', `Disable ${origin}`);
    disable.addEventListener('click', async () => { try { await command('set-site', {origin, enabled: false}); await load(); show('Site disabled.'); } catch (error) { show(messageFor(errorCode(error)), 'warn'); } });
    item.append(disable); query('#sites').append(item);
  }
  if (!settings.sites.length) { const item = document.createElement('li'); item.className = 'empty'; item.textContent = 'No sites yet. Turn one on from the Lineleaf popup.'; query('#sites').append(item); }
}
query('#reset').addEventListener('click', async () => { try { await command('reset'); await load(); await loadTiming(); show('Preferences and site access reset.'); } catch (error) { show(messageFor(errorCode(error)), 'warn'); } });
query('#refresh-timing').addEventListener('click', () => loadTiming().catch(() => show(messageFor('UNAVAILABLE'), 'warn')));
query('#copy-timing').addEventListener('click', async () => {
  if (!lastTiming) return;
  try { await navigator.clipboard.writeText(JSON.stringify(lastTiming, null, 2)); show('Timing copied.'); }
  catch { show('Could not copy timing.', 'warn'); }
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
load().catch(() => show(messageFor('UNAVAILABLE'), 'warn'));
loadTiming().catch(() => {});
