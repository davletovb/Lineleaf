export class Event {
  constructor() { this.listeners = []; }
  addListener(listener) { this.listeners.push(listener); }
  emit(...args) { for (const listener of [...this.listeners]) listener(...args); }
}
export const READY = {availability: 'available', authentication: 'authenticated', sign_in: 'subscription', capabilities: {tool_isolation: true}};
export function fakeNative(handler, ready = {type: 'ready', version: 1}) {
  const port = {onMessage: new Event(), onDisconnect: new Event(), sent: [], closed: false};
  port.postMessage = message => { port.sent.push(message); handler?.(message, port); };
  port.reply = (id, event) => queueMicrotask(() => port.onMessage.emit({id, event}));
  port.disconnect = () => { if (!port.closed) { port.closed = true; port.onDisconnect.emit(); } };
  queueMicrotask(() => { if (ready) port.onMessage.emit(ready); });
  return port;
}
export async function waitFor(predicate) {
  const until = Date.now() + 3000;
  while (!predicate()) { if (Date.now() > until) throw new Error('Timed out waiting for fixture'); await new Promise(resolve => setTimeout(resolve, 5)); }
}
export function fakeChrome({sites = ['https://writing.test'], state = READY, hang = false, automatic = false, dictionary = [], answer = '{"corrections":[{"before":"go","after":"goes","left":"He ","right":" to","category":"grammar","explanation":"Subject agreement"}]}'} = {}) {
  const calls = [], ports = [], grants = new Set(sites.map(s => `${new URL(s).protocol}//${new URL(s).hostname}/*`));
  let data = {preferences: {model: '', variant: 'US', paused: false, automatic, dictionary, sites}}, sessionData = {};
  const api = {
    runtime: {id: 'lnbkadelggojehiapgnhonicnfonobal', onConnect: new Event(), onMessage: new Event(), async openOptionsPage() { calls.push({openedSettings: true}); }, connectNative() {
      const port = fakeNative((m, p) => {
        calls.push(m);
        if (m.method === 'status') { p.reply(m.id, {type: 'status', status: state}); p.reply(m.id, {type: 'completed'}); }
        else if (m.method === 'send' && !hang) { p.reply(m.id, {type: 'delta', text: answer}); p.reply(m.id, {type: 'completed'}); }
        else if (m.method === 'cancel') { p.reply(m.target, {type: 'stopped'}); p.reply(m.id, {type: 'completed'}); }
      }); ports.push(port); return port;
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
  return {api, calls, ports, connect, rpc, sender, state, get data() { return data; }, get sessionData() { return sessionData; }, set answer(value) { answer = value; }, set hold(value) { hang = value; }};
}
