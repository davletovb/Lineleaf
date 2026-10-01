import {MAX_OUTPUT, LineleafError, safeReason, isObject, exactKeys} from './policy.mjs';
const TYPES = new Set(['launched', 'started', 'activity', 'delta', 'session', 'session_lost', 'usage', 'source', 'status', 'completed', 'stopped', 'failed']);
const TERMINAL = new Set(['completed', 'stopped', 'failed']);

export class NativeSeatline {
  constructor(connectNative, {readyTimeout = 10000, drainTimeout = 3000} = {}) {
    this.connectNative = connectNative; this.readyTimeout = readyTimeout; this.drainTimeout = drainTimeout;
    this.pending = new Map(); this.ignored = new Set(); this.ready = null; this.port = null;
  }
  connect() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve; this.readyReject = reject;
      this.readyTimer = setTimeout(() => this.close('NATIVE_UNAVAILABLE'), this.readyTimeout);
    });
    try {
      const port = this.connectNative('com.seatline.host'); this.port = port;
      port.onMessage.addListener(message => { if (this.port === port) this.receive(message); });
      port.onDisconnect.addListener(() => { if (this.port === port) this.close('NATIVE_UNAVAILABLE'); });
    } catch { this.close('NATIVE_UNAVAILABLE'); }
    return this.ready;
  }
  receive(frame) {
    try {
      if (!isObject(frame) || new TextEncoder().encode(JSON.stringify(frame)).length > 1048576) throw new Error();
      if (this.readyResolve) {
        if (!exactKeys(frame, ['type', 'version']) || frame.type !== 'ready' || frame.version !== 1) throw new Error();
        clearTimeout(this.readyTimer); const resolve = this.readyResolve;
        this.readyResolve = this.readyReject = null; resolve(); return;
      }
      if (!exactKeys(frame, ['id', 'event']) || typeof frame.id !== 'string' || !isObject(frame.event) || !TYPES.has(frame.event.type)) throw new Error();
      if (this.ignored.has(frame.id)) { if (TERMINAL.has(frame.event.type)) this.ignored.delete(frame.id); return; }
      const item = this.pending.get(frame.id); if (!item || ++item.events > 4096) throw new Error();
      const event = frame.event;
      if (item.cancelled) {
        if (TERMINAL.has(event.type)) this.finish(frame.id, new LineleafError(item.cancelled));
        return;
      }
      if (event.type === 'delta') {
        if (item.method !== 'send' || typeof event.text !== 'string' || !event.text.isWellFormed()) throw new Error();
        item.bytes += new TextEncoder().encode(event.text).length;
        if (item.bytes > MAX_OUTPUT) throw new Error(); item.output += event.text;
      } else if (event.type === 'status') {
        if (item.method !== 'status' || !isObject(event.status) || item.status !== null) throw new Error();
        item.status = event.status;
      } else if (event.type === 'session' || event.type === 'session_lost') {
        // Writing is ephemeral: receiving a persistent session is a contract violation.
        throw new Error();
      } else if (TERMINAL.has(event.type)) {
        if (event.type === 'failed') this.finish(frame.id, new LineleafError(safeReason(event.reason)));
        else if (event.type === 'stopped') this.finish(frame.id, new LineleafError('CANCELLED'));
        else if (item.method === 'status' && item.status === null) throw new Error();
        else this.finish(frame.id, null, item.method === 'status' ? item.status : item.output);
      }
    } catch { this.close('PROTOCOL_ERROR'); }
  }
  async request(method, params = null, {signal, timeout = 30000} = {}) {
    if (signal?.aborted) throw new LineleafError('CANCELLED');
    const abortReady = () => this.close('CANCELLED');
    signal?.addEventListener('abort', abortReady, {once: true});
    try { await this.connect(); }
    finally { signal?.removeEventListener('abort', abortReady); }
    if (signal?.aborted) throw new LineleafError('CANCELLED');
    if (!this.port) throw new LineleafError('NATIVE_UNAVAILABLE');
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const item = {method, resolve, reject, signal, output: '', bytes: 0, events: 0, status: null, cancelled: null};
      item.abort = () => this.cancel(id, 'CANCELLED');
      item.timer = setTimeout(() => this.cancel(id, 'PROVIDER_TIMEOUT'), timeout);
      this.pending.set(id, item); signal?.addEventListener('abort', item.abort, {once: true});
      try { this.port.postMessage({id, provider: 'codex', method, params}); }
      catch { this.close('NATIVE_UNAVAILABLE'); }
    });
  }
  cancel(id, reason) {
    const item = this.pending.get(id); if (!item || item.cancelled) return;
    item.cancelled = reason; item.output = ''; clearTimeout(item.timer);
    const cancelId = crypto.randomUUID(); this.ignored.add(cancelId);
    item.timer = setTimeout(() => this.close(reason), this.drainTimeout);
    try { this.port.postMessage({id: cancelId, provider: 'codex', method: 'cancel', target: id, params: null}); }
    catch { this.close(reason); }
  }
  finish(id, error, result) {
    const item = this.pending.get(id); if (!item) return;
    clearTimeout(item.timer); item.signal?.removeEventListener('abort', item.abort); this.pending.delete(id);
    item.output = ''; error ? item.reject(error) : item.resolve(result);
  }
  close(code = 'CANCELLED') {
    const port = this.port; this.port = null; clearTimeout(this.readyTimer);
    this.readyReject?.(new LineleafError(code)); this.readyResolve = this.readyReject = null; this.ready = null;
    for (const [id, item] of this.pending) this.finish(id, new LineleafError(item.cancelled || code));
    this.ignored.clear(); try { port?.disconnect(); } catch { /* already disconnected */ }
  }
}
