import {NativeSeatline} from './native-seatline.mjs';
import {allowed, originOf, sitePattern, preferences, writingTurn, requireReady, statusView, errorCode, LineleafError, exactKeys, validText, MODES, AUTOMATIC_MODES, AUTO_INTERVAL, AUTOMATIC_HOLD, REQUEST_TIMEOUT, PHASES, READINESS, READINESS_REFUSALS, LINK_IDLE, PREPARE_INTERVAL, dictionaryWord, filterDictionary} from './policy.mjs';
import {candidates} from './candidates.mjs';
import {EXCLUDED} from './editor-policy.mjs';

export function installController(api, {now = Date.now} = {}) {
  let active = null, diagnostic = false, backoffUntil = 0, automaticHold = 0; // automaticHold: no background requests after the provider failed to answer in time
  const peers = new Set();
  const read = async () => preferences((await api.storage.local.get('preferences')).preferences);
  // One native connection serves every request until it has been idle for LINK_IDLE, so a check pays for neither a new companion process nor,
  // usually, a new provider probe. `readinessApi` is what the companion at the other end has shown: Seatline's readiness API (true), a
  // companion that predates it (false), or not yet known (null). It is forgotten whenever the connection closes, so an updated companion is noticed.
  let link = null, linkTimer = 0, readinessApi = null, warming = false, warmedAt = -Infinity;
  const native = () => link ??= new NativeSeatline(host => {
    const port = api.runtime.connectNative(host);
    port.onDisconnect.addListener(() => { void api.runtime.lastError; });
    return port;
  }, {onClose: () => { readinessApi = null; clearTimeout(linkTimer); }});
  const idleLink = () => {
    clearTimeout(linkTimer);
    if (!link?.port) return;
    linkTimer = setTimeout(() => { if (active || diagnostic || warming) idleLink(); else link?.close(); }, LINK_IDLE);
  };
  // The provider's readiness: from Seatline's cache when `freshness` allows, or, for a companion without the readiness API, a status probe.
  async function readiness(connection, signal, freshness) {
    if (readinessApi !== false) {
      try { const status = await connection.request('readiness', freshness, {signal, timeout: PHASES.status}); readinessApi = true; return {status, modern: true}; }
      catch (error) { if (readinessApi === true || errorCode(error) !== 'INVALID_REQUEST') throw error; readinessApi = false; }
    }
    return {status: await connection.request('status', null, {signal, timeout: PHASES.status}), modern: false};
  }
  // Gets the provider ready ahead of a request the user is likely to make: a readiness check, with no text and no model turn. It never
  // reports a failure (nobody asked), and it leaves a provider that is busy, rate-limited or slow to answer alone.
  async function prepare() {
    if (active || diagnostic || warming || readinessApi === false || now() < backoffUntil || now() < automaticHold || now() - warmedAt < PREPARE_INTERVAL) return 'skipped';
    warming = true; warmedAt = now();
    try { await native().request('prepare', READINESS.cached, {timeout: PHASES.status}); readinessApi = true; return 'prepared'; }
    catch (error) { if (readinessApi !== true && errorCode(error) === 'INVALID_REQUEST') readinessApi = false; return 'skipped'; }
    finally { warming = false; idleLink(); }
  }
  const initialized = Promise.all([api.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}), api.storage.session.get(['providerBackoff', 'automaticHold'])])
    .then(([, saved]) => {
      if (Number.isFinite(saved.providerBackoff) && saved.providerBackoff > now()) backoffUntil = Math.min(saved.providerBackoff, now() + 60000);
      if (Number.isFinite(saved.automaticHold) && saved.automaticHold > now()) automaticHold = Math.min(saved.automaticHold, now() + AUTOMATIC_HOLD);
    });
  const ui = sender => sender.id === api.runtime.id && !sender.incognito && !sender.tab?.incognito
    && [`chrome-extension://${api.runtime.id}/popup.html`, `chrome-extension://${api.runtime.id}/options.html`].includes(sender.url);
  const send = (port, message) => { try { port.postMessage(message); } catch { /* document closed */ } };
  async function eligible(sender, allowPaused = false) {
    if (sender.id !== api.runtime.id || !Number.isInteger(sender.tab?.id) || (!Number.isInteger(sender.frameId) || sender.frameId < 0)
        || sender.tab.incognito || !sender.documentId) throw new LineleafError('RESTRICTED_PAGE');
    const origin = originOf(sender.url), current = await api.tabs.get(sender.tab.id);
    if (!origin || current.incognito || originOf(current.url) !== origin) throw new LineleafError('RESTRICTED_PAGE');
    let documents;
    try {
      documents = await api.scripting.executeScript({target: {tabId: sender.tab.id, documentIds: [sender.documentId]},
        args: [EXCLUDED], func: exclusions => { try {
          for (let current = window; current !== current.top; current = current.parent) {
            const frame = current.frameElement;
            if (!frame || frame.hasAttribute('sandbox') || !frame.getClientRects().length) return null;
            for (let node = frame; node; node = node.assignedSlot ?? node.parentElement ?? node.getRootNode().host) {
              if (node.matches(exclusions) || current.parent.getComputedStyle(node).visibility !== 'visible') return null;
            }
          }
          return {url: location.href, topOrigin: window.top.location.origin};
        } catch { return null; } }});
    } catch { throw new LineleafError('STALE_DOCUMENT'); }
    const matching = documents?.find(item => item.documentId === sender.documentId && item.frameId === sender.frameId);
    if (!matching) throw new LineleafError('STALE_DOCUMENT');
    const document = matching.result;
    if (!document || document.topOrigin !== origin) throw new LineleafError('RESTRICTED_PAGE');
    if (document.url !== sender.url) throw new LineleafError('STALE_DOCUMENT');
    const settings = await read();
    if (settings.paused && !allowPaused) throw new LineleafError('PAUSED');
    if (!settings.sites.includes(origin) || !await api.permissions.contains({origins: [sitePattern(origin)]})) throw new LineleafError('SITE_DISABLED');
    return {settings, origin};
  }
  function cancelPeer(peer) { peer.abort?.abort(); }
  const waiting = (code, retryAfterMs) => Object.assign(new LineleafError(code), {retryAfterMs, local: true});
  async function automaticBudget() {
    const stored = (await api.storage.session.get('automaticBudget')).automaticBudget;
    const time = now(), attempts = Array.isArray(stored) ? stored.filter(x => Number.isFinite(x) && x > time - 60000 && x <= time + 60000).slice(-6) : [];
    const delay = Math.max(0, attempts.length ? attempts.at(-1) + AUTO_INTERVAL - time : 0, attempts.length >= 6 ? attempts[0] + 60000 - time : 0);
    if (delay > 0) throw waiting('AUTO_WAIT', Math.min(delay, 60000));
    await api.storage.session.set({automaticBudget: [...attempts, time]});
  }
  async function writing(peer, request) {
    if (peer.running) { send(peer.port, {type: 'error', id: request?.id, code: 'BUSY'}); return; }
    const automatic = request?.kind === 'automatic';
    if (!(exactKeys(request, ['type', 'id', 'text', 'mode']) || (exactKeys(request, ['type', 'id', 'text', 'mode', 'kind']) && ['automatic', 'manual'].includes(request.kind))) || request.type !== 'start'
        || typeof request.id !== 'string' || !/^[a-f0-9-]{36}$/.test(request.id) || !validText(request.text) || !MODES.includes(request.mode)) {
      send(peer.port, {type: 'error', id: request?.id, code: 'INVALID_REQUEST'}); return;
    }
    // Only the correctness and clearer-wording checks may run unasked, and clearer wording is never requested by hand (Improve it is the explicit form).
    if (automatic ? !AUTOMATIC_MODES.includes(request.mode) : request.mode === 'clarity') { send(peer.port, {type: 'error', id: request.id, code: 'INVALID_REQUEST'}); return; }
    peer.running = true; peer.automatic = automatic; peer.done = new Promise(resolve => { peer.finish = resolve; });
    peer.abort = new AbortController(); const signal = peer.abort.signal;
    let connection;
    try {
      await initialized; const {settings} = await eligible(peer.sender);
      if (signal.aborted) throw new LineleafError('CANCELLED');
      if (automatic && !settings.automatic) throw new LineleafError('AUTOMATIC_DISABLED');
      if (request.mode === 'clarity' && !settings.clarity) throw new LineleafError('CLARITY_DISABLED');
      if (!automatic && active?.automatic) { const previous = active; cancelPeer(previous); await previous.done; await eligible(peer.sender); }
      if (active || diagnostic) throw new LineleafError('BUSY');
      if (now() < backoffUntil) throw waiting('PROVIDER_RATE_LIMITED', backoffUntil - now());
      // A provider that just failed to answer in time is not given more background work (each turn is a process on the user's machine).
      if (automatic && now() < automaticHold) throw waiting('AUTO_PAUSED', Math.min(automaticHold - now(), AUTOMATIC_HOLD));
      active = peer;
      if (automatic) await automaticBudget();
      if (signal.aborted) throw new LineleafError('CANCELLED');
      connection = native(); peer.connection = connection;
      send(peer.port, {type: 'progress', id: request.id, stage: 'connecting'});
      let verification = READINESS.cached, answer;
      for (let attempt = 0; ; attempt++) {
        // Lineleaf's own policy (subscription sign-in, no-tools requests) is enforced here, from Seatline's readiness, before anything is sent.
        const {status, modern} = await readiness(connection, signal, verification);
        requireReady(status);
        // Permissions/settings may have changed while readiness was being checked.
        const latest = await eligible(peer.sender);
        if (signal.aborted) throw new LineleafError('CANCELLED');
        if (automatic && !latest.settings.automatic) throw new LineleafError('AUTOMATIC_DISABLED');
        if (request.mode === 'clarity' && !latest.settings.clarity) throw new LineleafError('CLARITY_DISABLED');
        send(peer.port, {type: 'progress', id: request.id, stage: 'checking'});
        const turn = writingTurn(request.text, request.mode, latest.settings, {checkSignIn: !modern}), timeout = REQUEST_TIMEOUT[automatic ? 'automatic' : 'manual'];
        try {
          // `send_ready_with_policy` is sent under the readiness just checked, so Seatline repeats no probe; it refuses, without starting a turn, if that
          // evidence has changed or lapsed, and the status it reports is checked again as it arrives.
          if (!modern) throw new LineleafError('COMPANION_UPDATE_REQUIRED');
          answer = await connection.request('send_ready_with_policy', {turn, freshness: READINESS.cached, allowed_sign_in: ['subscription']}, {signal, timeout, onStatus: requireReady});
          break;
        } catch (error) {
          if (modern && ['INVALID_REQUEST', 'READINESS_UNSUPPORTED'].includes(errorCode(error))) throw new LineleafError('COMPANION_UPDATE_REQUIRED');
          // Nothing was started, so one more attempt is safe: from a fresh readiness, which the send then reuses (it is the cached evidence now).
          if (modern && attempt === 0 && READINESS_REFUSALS.has(errorCode(error))) { verification = READINESS.fresh; continue; }
          throw error;
        }
      }
      const final = await eligible(peer.sender);
      if (signal.aborted) throw new LineleafError('CANCELLED');
      const edits = filterDictionary(candidates(answer, request.text, request.mode), final.settings);
      send(peer.port, {type: 'result', id: request.id, edits});
      if (automaticHold) { automaticHold = 0; await api.storage.session.set({automaticHold: 0}).catch(() => {}); } // It answered, so background checks may resume.
    } catch (error) {
      const code = errorCode(error);
      if (code === 'PROVIDER_TIMEOUT') { automaticHold = now() + AUTOMATIC_HOLD; await api.storage.session.set({automaticHold}).catch(() => {}); }
      if (code === 'PROVIDER_RATE_LIMITED' && !error.local) backoffUntil = now() + 60000;
      else if (code === 'QUEUE_FULL') backoffUntil = now() + 5000;
      if (backoffUntil > now()) await api.storage.session.set({providerBackoff: backoffUntil}).catch(() => {});
      send(peer.port, {type: 'error', id: request.id, code, retryAfterMs: error.retryAfterMs ?? Math.max(0, backoffUntil - now())});
    } finally {
      if (connection) idleLink(); // The connection stays for the next request; a closed or failed one reconnects by itself.
      peer.connection = null; peer.running = false; peer.abort = null;
      if (active === peer) active = null;
      peer.finish?.();
      request.text = ''; // Drafts/results exist only for this in-memory request.
    }
  }
  api.runtime.onConnect.addListener(port => {
    if (port.name !== 'lineleaf-writing-v1' || peers.size >= 32 || port.sender?.id !== api.runtime.id
        || !Number.isInteger(port.sender.tab?.id) || (!Number.isInteger(port.sender.frameId) || port.sender.frameId < 0) || port.sender.tab.incognito
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
    if (settings.paused || !settings.sites.length) link?.close(); // Paused, reset or no site enabled: no companion process is kept.
    for (const site of settings.sites) if (!settings.paused && await api.permissions.contains({origins: [sitePattern(site)]})) matches.push(sitePattern(site));
    await api.scripting.unregisterContentScripts({ids: ['lineleaf-sites']}).catch(() => {});
    if (matches.length) await api.scripting.registerContentScripts([{id: 'lineleaf-sites', matches: [...new Set(matches)], js: ['content.js'], runAt: 'document_idle', allFrames: true, persistAcrossSessions: false}]);
    for (const peer of peers) {
      const origin = originOf(peer.sender.url);
      if (!allowed(settings, origin) || !await api.permissions.contains({origins: [sitePattern(origin)]})) cancelPeer(peer);
    }
    const tabs = await api.tabs.query({});
    for (const tab of tabs) if (!tab.incognito) api.tabs.sendMessage(tab.id, {type: 'lineleaf-policy-changed'}).catch(() => {});
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
    if (message.type === 'set-pause' && exactKeys(p, ['paused']) && typeof p.paused === 'boolean') {
      const next = {...settings, paused: p.paused}; await api.storage.local.set({preferences: next}); return next;
    }
    if (message.type === 'save-settings' && exactKeys(p, ['changes', 'expected', 'dictionary'])) {
      const fields = ['model', 'variant', 'automatic', 'clarity'];
      if (!p.changes || !exactKeys(p.expected, Object.keys(p.changes)) || !exactKeys(p.changes, Object.keys(p.expected))
          || !Object.keys(p.changes).every(key => fields.includes(key)) || !exactKeys(p.dictionary, ['add', 'remove'])
          || !['add', 'remove'].every(key => Array.isArray(p.dictionary[key]) && p.dictionary[key].length <= 500 && Array.from(p.dictionary[key]).every(word => dictionaryWord(word)))) throw new LineleafError('INVALID_REQUEST');
      for (const values of [p.changes, p.expected]) {
        const validated = preferences({...settings, ...values});
        if (!Object.keys(values).every(key => validated[key] === values[key])) throw new LineleafError('INVALID_REQUEST');
      }
      // Compare only deliberately edited fields; dictionary deltas merge with current words.
      if (!Object.keys(p.changes).every(key => settings[key] === p.expected[key])) throw new LineleafError('SETTINGS_CHANGED');
      const remove = new Set(p.dictionary.remove.map(dictionaryWord));
      const dictionary = [...new Set([...settings.dictionary.filter(word => !remove.has(word)), ...p.dictionary.add.map(dictionaryWord)])];
      if (dictionary.length > 500) throw new LineleafError('INVALID_REQUEST');
      const next = {...settings, ...p.changes, dictionary}; next.clarity = next.automatic && next.clarity; // Turning automatic checking off turns clearer wording off with it.
      if (JSON.stringify(next) !== JSON.stringify(settings)) await api.storage.local.set({preferences: next});
      return next;
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
      // Query only focus metadata. Never read another frame's selection or draft.
      const frames = await api.scripting.executeScript({target: {tabId: tab.id, allFrames: true}, func: () => {
        try {
          if (!['http:', 'https:'].includes(location.protocol) || location.origin !== window.top.location.origin) return false;
          let current = window;
          while (current !== current.top) {
            if (!current.frameElement || current.frameElement.hasAttribute('sandbox') || current.parent.document.activeElement !== current.frameElement) return false;
            current = current.parent;
          }
          return !['IFRAME', 'FRAME'].includes(document.activeElement?.tagName);
        } catch { return false; }
      }});
      const focused = frames.filter(frame => frame.result === true);
      if (focused.length !== 1 || !focused[0].documentId) throw new LineleafError('RESTRICTED_PAGE');
      const documentId = focused[0].documentId;
      await api.scripting.executeScript({target: {tabId: tab.id, documentIds: [documentId]}, files: ['content.js']});
      await api.tabs.sendMessage(tab.id, {type: 'lineleaf-open'}, {documentId}); return true;
    }
    if (message.type === 'site-state' && p === null) return {enabled: allowed(settings, originOf(sender.url))};
    if (message.type === 'prepare' && exactKeys(p, ['tabId']) && Number.isInteger(p.tabId)) {
      const tab = await api.tabs.get(p.tabId), origin = originOf(tab.url);
      if (!origin || tab.incognito || !allowed(settings, origin) || !await api.permissions.contains({origins: [sitePattern(origin)]})) throw new LineleafError('SITE_DISABLED');
      return prepare();
    }
    if (message.type === 'check-connection' && p === null) {
      if (active || diagnostic) throw new LineleafError('BUSY'); diagnostic = true;
      try { return statusView((await readiness(native(), undefined, READINESS.fresh)).status); } // The user asked: always a fresh probe, which later checks may then reuse.
      finally { diagnostic = false; idleLink(); }
    }
    throw new LineleafError('INVALID_REQUEST');
  }
  let mutations = Promise.resolve();
  const changeFromContent = (message, sender) => {
    const operation = mutations.catch(() => {}).then(async () => {
      const {settings} = await eligible(sender, true), p = message.payload;
      if (message.type === 'add-word' && exactKeys(p, ['word']) && dictionaryWord(p.word)) {
        const dictionary = [...new Set([...settings.dictionary, dictionaryWord(p.word)])];
        if (dictionary.length > 500) throw new LineleafError('INVALID_REQUEST');
        await api.storage.local.set({preferences: {...settings, dictionary}}); return true;
      }
      if (message.type === 'pause' && p === null) {
        await api.storage.local.set({preferences: {...settings, paused: true}}); return true;
      }
      if (message.type === 'open-settings' && p === null) { await api.runtime.openOptionsPage(); return true; }
      throw new LineleafError('INVALID_REQUEST');
    });
    mutations = operation; return operation;
  };
  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type === 'site-state' && exactKeys(message, ['type', 'payload']) && message.payload === null) {
      eligible(sender).then(({settings}) => respond({ok: true, value: {enabled: true, automatic: settings.automatic, clarity: settings.clarity, variant: settings.variant}}), error => respond({ok: false, code: errorCode(error)}));
    } else if (message?.type === 'prepare' && exactKeys(message, ['type', 'payload']) && message.payload === null) {
      eligible(sender).then(prepare).then(value => respond({ok: true, value}), error => respond({ok: false, code: errorCode(error)}));
    } else if (exactKeys(message, ['type', 'payload']) && ['add-word', 'pause', 'open-settings'].includes(message.type)) {
      changeFromContent(message, sender).then(value => respond({ok: true, value}), error => respond({ok: false, code: errorCode(error)}));
    } else {
      const mutating = ['save-settings', 'set-pause', 'set-site', 'reset'].includes(message?.type);
      const operation = mutating ? mutations.catch(() => {}).then(() => handle(message, sender)) : handle(message, sender);
      if (mutating) mutations = operation;
      operation.then(value => respond({ok: true, value}), error => respond({ok: false, code: errorCode(error)}));
    }
    return true;
  });
  schedule();
  return {read, reconcile, get active() { return active; }};
}
