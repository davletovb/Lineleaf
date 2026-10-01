import {NativeSeatline} from './native-seatline.mjs';
import {allowed, originOf, sitePattern, preferences, writingTurn, requireReady, statusView, errorCode, LineleafError, exactKeys, validText, MODES} from './policy.mjs';
import {candidates} from './candidates.mjs';

export function installController(api) {
  let active = null, diagnostic = false, backoffUntil = 0;
  const peers = new Set();
  const read = async () => preferences((await api.storage.local.get('preferences')).preferences);
  const native = () => new NativeSeatline(host => {
    const port = api.runtime.connectNative(host);
    port.onDisconnect.addListener(() => { void api.runtime.lastError; });
    return port;
  });
  const initialized = api.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
  const ui = sender => sender.id === api.runtime.id && !sender.incognito && !sender.tab?.incognito
    && [`chrome-extension://${api.runtime.id}/popup.html`, `chrome-extension://${api.runtime.id}/options.html`].includes(sender.url);
  const send = (port, message) => { try { port.postMessage(message); } catch { /* document closed */ } };
  async function eligible(sender) {
    if (sender.id !== api.runtime.id || !Number.isInteger(sender.tab?.id) || sender.frameId !== 0
        || sender.tab.incognito || !sender.documentId) throw new LineleafError('SITE_DISABLED');
    const origin = originOf(sender.url), current = await api.tabs.get(sender.tab.id);
    if (!origin || originOf(current.url) !== origin) throw new LineleafError('SITE_DISABLED');
    const settings = await read();
    if (settings.paused) throw new LineleafError('PAUSED');
    if (!allowed(settings, origin) || !await api.permissions.contains({origins: [sitePattern(origin)]})) throw new LineleafError('SITE_DISABLED');
    return {settings, origin};
  }
  function cancelPeer(peer) { peer.abort?.abort(); }
  async function writing(peer, request) {
    if (peer.running) { send(peer.port, {type: 'error', id: request?.id, code: 'BUSY'}); return; }
    if (!exactKeys(request, ['type', 'id', 'text', 'mode']) || request.type !== 'start'
        || typeof request.id !== 'string' || !/^[a-f0-9-]{36}$/.test(request.id) || !validText(request.text) || !MODES.includes(request.mode)) {
      send(peer.port, {type: 'error', id: request?.id, code: 'INVALID_REQUEST'}); return;
    }
    peer.running = true; peer.abort = new AbortController(); const signal = peer.abort.signal;
    let connection;
    try {
      await initialized; const {settings} = await eligible(peer.sender);
      if (signal.aborted) throw new LineleafError('CANCELLED');
      if (active || diagnostic) throw new LineleafError('BUSY');
      if (Date.now() < backoffUntil) throw new LineleafError('PROVIDER_RATE_LIMITED');
      active = peer; connection = native(); peer.connection = connection;
      send(peer.port, {type: 'progress', id: request.id, stage: 'connecting'});
      requireReady(await connection.request('status', null, {signal, timeout: 15000}));
      // Permissions/settings may have changed while status was being probed.
      const latest = await eligible(peer.sender);
      if (signal.aborted) throw new LineleafError('CANCELLED');
      send(peer.port, {type: 'progress', id: request.id, stage: 'checking'});
      const answer = await connection.request('send', writingTurn(request.text, request.mode, latest.settings), {signal});
      await eligible(peer.sender);
      if (signal.aborted) throw new LineleafError('CANCELLED');
      const edits = candidates(answer, request.text, request.mode);
      send(peer.port, {type: 'result', id: request.id, edits});
    } catch (error) {
      const code = errorCode(error);
      if (code === 'PROVIDER_RATE_LIMITED') backoffUntil = Date.now() + 60000;
      else if (code === 'QUEUE_FULL') backoffUntil = Date.now() + 5000;
      send(peer.port, {type: 'error', id: request.id, code});
    } finally {
      connection?.close(); peer.connection = null; peer.running = false; peer.abort = null;
      if (active === peer) active = null;
      request.text = ''; // Drafts/results exist only for this in-memory request.
    }
  }
  api.runtime.onConnect.addListener(port => {
    if (port.name !== 'lineleaf-writing-v1' || peers.size >= 32 || port.sender?.id !== api.runtime.id
        || !Number.isInteger(port.sender.tab?.id) || port.sender.frameId !== 0 || port.sender.tab.incognito
        || !port.sender.documentId || !originOf(port.sender.url)) { port.disconnect(); return; }
    const peer = {port, sender: port.sender, running: false}; peers.add(peer);
    port.onMessage.addListener(message => {
      if (exactKeys(message, ['type']) && message.type === 'cancel') cancelPeer(peer);
      else void writing(peer, message);
    });
    port.onDisconnect.addListener(() => { cancelPeer(peer); peers.delete(peer); });
  });
  async function reconcile() {
    await initialized; const settings = await read(), matches = [];
    for (const site of settings.sites) if (!settings.paused && await api.permissions.contains({origins: [sitePattern(site)]})) matches.push(sitePattern(site));
    await api.scripting.unregisterContentScripts({ids: ['lineleaf-sites']}).catch(() => {});
    if (matches.length) await api.scripting.registerContentScripts([{id: 'lineleaf-sites', matches: [...new Set(matches)], js: ['content.js'], runAt: 'document_idle', allFrames: false, persistAcrossSessions: false}]);
    for (const peer of peers) {
      const origin = originOf(peer.sender.url);
      if (!allowed(settings, origin) || !await api.permissions.contains({origins: [sitePattern(origin)]})) cancelPeer(peer);
    }
    const tabs = await api.tabs.query({});
    for (const tab of tabs) if (!tab.incognito) api.tabs.sendMessage(tab.id, {type: 'lineleaf-policy-changed'}, {frameId: 0}).catch(() => {});
  }
  let sync = Promise.resolve();
  const schedule = () => { sync = sync.catch(() => {}).then(reconcile).catch(() => {}); };
  api.storage.onChanged.addListener((_changes, area) => { if (area === 'local') { for (const peer of peers) cancelPeer(peer); schedule(); } });
  api.permissions.onRemoved.addListener(() => { for (const peer of peers) cancelPeer(peer); schedule(); });
  api.tabs.onRemoved.addListener(id => { for (const peer of peers) if (peer.sender.tab?.id === id) cancelPeer(peer); });
  api.tabs.onUpdated.addListener((id, change) => { if (change.status === 'loading' || change.url) for (const peer of peers) if (peer.sender.tab?.id === id) cancelPeer(peer); });
  async function handle(message, sender) {
    await initialized; if (!ui(sender) || !exactKeys(message, ['type', 'payload'])) throw new LineleafError('INVALID_REQUEST');
    const settings = await read(), p = message.payload;
    if (message.type === 'get-settings' && p === null) return settings;
    if (message.type === 'save-settings' && exactKeys(p, ['model', 'variant', 'paused'])) {
      const next = preferences({...settings, ...p});
      if (next.model !== p.model || next.variant !== p.variant || typeof p.paused !== 'boolean') throw new LineleafError('INVALID_REQUEST');
      await api.storage.local.set({preferences: next}); return next;
    }
    if (message.type === 'set-site' && exactKeys(p, ['origin', 'enabled']) && originOf(p.origin) === p.origin && typeof p.enabled === 'boolean') {
      if (p.enabled && !await api.permissions.contains({origins: [sitePattern(p.origin)]})) throw new LineleafError('SITE_DISABLED');
      const sites = settings.sites.filter(s => s !== p.origin); if (p.enabled) sites.push(p.origin);
      if (sites.length > 64) throw new LineleafError('INVALID_REQUEST');
      await api.storage.local.set({preferences: {...settings, sites}});
      if (!p.enabled && !sites.some(s => sitePattern(s) === sitePattern(p.origin))) await api.permissions.remove({origins: [sitePattern(p.origin)]});
      return {...settings, sites};
    }
    if (message.type === 'reset' && p === null) {
      for (const peer of peers) cancelPeer(peer);
      await api.storage.local.clear();
      const origins = ((await api.permissions.getAll()).origins ?? []).filter(o => /^https?:\/\//.test(o));
      if (origins.length) await api.permissions.remove({origins}); return preferences(null);
    }
    if (message.type === 'open-panel' && exactKeys(p, ['tabId']) && Number.isInteger(p.tabId)) {
      const tab = await api.tabs.get(p.tabId), origin = originOf(tab.url);
      if (!origin || tab.incognito) throw new LineleafError('RESTRICTED_PAGE');
      if (!allowed(settings, origin) || !await api.permissions.contains({origins: [sitePattern(origin)]})) throw new LineleafError('SITE_DISABLED');
      await api.scripting.executeScript({target: {tabId: tab.id, frameIds: [0]}, files: ['content.js']});
      await api.tabs.sendMessage(tab.id, {type: 'lineleaf-open'}, {frameId: 0}); return true;
    }
    if (message.type === 'site-state' && p === null) return {enabled: allowed(settings, originOf(sender.url))};
    if (message.type === 'check-connection' && p === null) {
      if (active || diagnostic) throw new LineleafError('BUSY'); diagnostic = true; const connection = native();
      try { return statusView(await connection.request('status', null, {timeout: 15000})); }
      finally { connection.close(); diagnostic = false; }
    }
    throw new LineleafError('INVALID_REQUEST');
  }
  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type === 'site-state' && exactKeys(message, ['type', 'payload']) && message.payload === null) {
      eligible(sender).then(() => respond({ok: true, value: {enabled: true}}), error => respond({ok: false, code: errorCode(error)}));
    } else handle(message, sender).then(value => respond({ok: true, value}), error => respond({ok: false, code: errorCode(error)}));
    return true;
  });
  schedule();
  return {read, reconcile, get active() { return active; }};
}
