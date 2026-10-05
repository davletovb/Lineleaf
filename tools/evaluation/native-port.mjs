// Development-only adapter for the existing companion's framed stdio bridge.
import {spawn} from 'node:child_process';
import {strictJSON} from '../../extension/lib/candidates.mjs';
const event = () => { const listeners = new Set(); return {addListener: fn => listeners.add(fn), emit: value => { for (const fn of listeners) fn(value); }}; };
export function nativePort(command, args = ['connect', 'lineleaf'], env = undefined) {
  const process = spawn(command, args, {stdio: ['pipe', 'pipe', 'ignore'], shell: false, env});
  let buffer = Buffer.alloc(0), closed = false, reap;
  const port = {onMessage: event(), onDisconnect: event(),
    postMessage(value) {
      if (closed) throw new Error('NATIVE_UNAVAILABLE');
      const data = Buffer.from(JSON.stringify(value)); if (data.length > 1048576) throw new Error('PROTOCOL_ERROR');
      const size = Buffer.alloc(4); size.writeUInt32LE(data.length); process.stdin.write(Buffer.concat([size, data]));
    },
    disconnect() {
      if (closed) return; closed = true; buffer = Buffer.alloc(0); process.stdin.destroy();
      if (process.exitCode === null && process.signalCode === null) {
        process.kill(); reap = setTimeout(() => process.kill('SIGKILL'), 2000); reap.unref();
      }
      port.onDisconnect.emit();
    }};
  process.stdout.on('data', data => {
    if (closed) return;
    try {
      buffer = Buffer.concat([buffer, data]); if (buffer.length > 2 * 1048576) throw new Error();
      while (buffer.length >= 4) {
        const length = buffer.readUInt32LE(); if (!length || length > 1048576) throw new Error();
        if (buffer.length < length + 4) break;
        const text = new TextDecoder('utf-8', {fatal: true}).decode(buffer.subarray(4, length + 4));
        buffer = buffer.subarray(length + 4); port.onMessage.emit(strictJSON(text));
      }
    } catch { port.disconnect(); }
  });
  process.on('error', () => port.disconnect()); process.on('exit', () => { clearTimeout(reap); port.disconnect(); });
  process.stdin.on('error', () => port.disconnect());
  return port;
}
