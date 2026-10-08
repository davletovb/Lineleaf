export class Event {
  constructor() { this.listeners = []; }
  addListener(listener) { this.listeners.push(listener); }
  emit(...args) { for (const listener of [...this.listeners]) listener(...args); }
}
export const READY = {availability: 'available', authentication: 'authenticated', sign_in: 'subscription', capabilities: {tool_isolation: true, reasoning_effort: true, service_tier: true}};
// A turn reached the companion, by either method; a provider probe did.
export const sent = m => m.method === 'send' || m.method === 'send_ready_with_policy';
export const probed = m => m.method === 'status' || m.method === 'readiness';
export const turnOf = m => m.method === 'send_ready_with_policy' ? m.params.turn : m.params;
// What a companion does with a request. `legacy` is one that predates Seatline's readiness API: it refuses those methods as it would any
// unknown one. `send` is what answers a turn (default: the `answer` text); `state` is the provider's status.
export function broker(m, p, {state = READY, send = null, answer = '{"corrections":[]}', legacy = false, hang = false, fail = null} = {}) {
  if (m.method === 'cancel') { p.reply(m.target, {type: 'stopped'}); return; }
  if (legacy && ['readiness', 'prepare', 'send_ready_with_policy'].includes(m.method)) { p.reply(m.id, {type: 'failed', reason: 'INVALID_REQUEST'}); return; }
  if (['status', 'readiness', 'prepare'].includes(m.method)) { p.reply(m.id, {type: 'status', status: state}); p.reply(m.id, {type: 'completed'}); return; }
  if (!sent(m)) return;
  if (m.method === 'send_ready_with_policy') p.reply(m.id, {type: 'status', status: state}); // A checked send reports the readiness it ran under first.
  if (m.method === 'send_ready_with_policy' && !m.params?.allowed_sign_in?.includes(state.sign_in)) {
    p.reply(m.id, {type: 'failed', reason: 'SIGN_IN_POLICY_DENIED'}); return;
  }
  if (hang) return;
  if (fail) { p.reply(m.id, {type: 'failed', reason: fail}); return; } // The turn itself fails with this reason.
  if (send) { send(m, p, turnOf(m)); return; }
  p.reply(m.id, {type: 'delta', text: typeof answer === 'function' ? answer(turnOf(m)) : answer}); p.reply(m.id, {type: 'completed'});
}
const nativePorts = new Set();
export function closeNativeFixtures() { for (const port of [...nativePorts]) port.disconnect(); }
export function fakeNative(handler, ready = {type: 'ready', version: 1}) {
  const port = {onMessage: new Event(), onDisconnect: new Event(), sent: [], closed: false};
  nativePorts.add(port);
  port.postMessage = message => { port.sent.push(message); handler?.(message, port); };
  port.reply = (id, event) => queueMicrotask(() => port.onMessage.emit({id, event}));
  port.disconnect = () => { if (!port.closed) { port.closed = true; nativePorts.delete(port); port.onDisconnect.emit(); } };
  queueMicrotask(() => { if (ready) port.onMessage.emit(ready); });
  return port;
}
export async function waitFor(predicate) {
  const until = Date.now() + 3000;
  while (!predicate()) { if (Date.now() > until) throw new Error('Timed out waiting for fixture'); await new Promise(resolve => setTimeout(resolve, 5)); }
}
export function fakeChrome({sites = ['https://writing.test'], state = READY, hang = false, fail = null, legacy = false, automatic = false, clarity = false, variant = 'US', dictionary = [], answer = '{"corrections":[{"before":"go","after":"goes","left":"He ","right":" to","category":"grammar","explanation":"Subject agreement"}]}'} = {}) {
  const calls = [], ports = [], grants = new Set(sites.map(s => `${new URL(s).protocol}//${new URL(s).hostname}/*`));
  let data = {preferences: {model: '', variant, paused: false, automatic, clarity, dictionary, sites}}, sessionData = {};
  const api = {
    runtime: {id: 'lnbkadelggojehiapgnhonicnfonobal', onConnect: new Event(), onMessage: new Event(), async openOptionsPage() { calls.push({openedSettings: true}); }, connectNative() {
      const port = fakeNative((m, p) => { calls.push(m); broker(m, p, {state, answer, legacy, hang, fail}); }); ports.push(port); return port;
    }},
    storage: {onChanged: new Event(), session: {async get() { return structuredClone(sessionData); }, async set(next) { sessionData = {...sessionData, ...structuredClone(next)}; }}, local: {
      async get() { return structuredClone(data); }, async setAccessLevel(level) { calls.push({accessLevel: level}); },
      async set(next) { data = {...data, ...structuredClone(next)}; api.storage.onChanged.emit({}, 'local'); },
      async clear() { data = {}; api.storage.onChanged.emit({}, 'local'); }
    }},
    permissions: {onRemoved: new Event(), async contains({origins}) { return origins.every(x => grants.has(x)); },
      async getAll() { return {origins: [...grants]}; }, async remove({origins}) { for (const o of origins) grants.delete(o); api.permissions.onRemoved.emit({origins}); return true; }},
    tabs: {onUpdated: new Event(), onRemoved: new Event(), async get(id) { return {id, url: 'https://writing.test/compose'}; }, async query() { return []; }, async sendMessage() {}},
    scripting: {async unregisterContentScripts() {}, async registerContentScripts() {}, async executeScript({target}) { return target.documentIds ? target.documentIds.map(documentId => ({documentId, frameId: 0, result: {url: 'https://writing.test/compose', topOrigin: 'https://writing.test'}})) : [{documentId: 'document-one', frameId: 0, result: true}]; }},
  };
  const sender = {id: api.runtime.id, tab: {id: 7, incognito: false}, frameId: 0, documentId: 'document-one', url: 'https://writing.test/compose'};
  function connect(overrides = {}) {
    const port = {name: 'lineleaf-writing-v1', sender: {...sender, ...overrides}, onMessage: new Event(), onDisconnect: new Event(), received: [], closed: false};
    port.postMessage = message => port.received.push(message);
    port.disconnect = () => { if (!port.closed) { port.closed = true; port.onDisconnect.emit(); } };
    api.runtime.onConnect.emit(port); return port;
  }
  const rpc = (type, payload = null, from = {id: api.runtime.id, url: `chrome-extension://${api.runtime.id}/options.html`}) => new Promise(resolve => api.runtime.onMessage.emit({type, payload}, from, resolve));
  // The writing turns that reached the companion, whichever method carried them, as the plain turn frame each test reads.
  const turns = () => calls.filter(sent).map(m => m.method === 'send_ready_with_policy' ? {...m, params: m.params.turn} : m);
  return {api, calls, ports, connect, rpc, sender, state, get turns() { return turns(); }, get data() { return data; }, get sessionData() { return sessionData; }, set answer(value) { answer = value; }, set hold(value) { hang = value; }, set fail(value) { fail = value; }, set legacy(value) { legacy = value; }};
}
