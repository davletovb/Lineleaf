// Human review/evidence files are larger than a model response but remain bounded and reject duplicate keys.
import {readFile, stat} from 'node:fs/promises';
export function parseData(source) {
  const bad = () => { throw new Error('INVALID_EVALUATION_JSON'); };
  if (typeof source !== 'string' || Buffer.byteLength(source) > 8 * 1048576) bad();
  let at = 0, nodes = 0;
  const space = () => { while (/[ \t\r\n]/.test(source[at] ?? '') && at < source.length) at++; };
  const string = () => {
    const start = at++;
    while (at < source.length) {
      const c = source[at++];
      if (c === '"') { try { return JSON.parse(source.slice(start, at)); } catch { bad(); } }
      if (c === '\\') at++;
    }
    bad();
  };
  function value(depth = 0) {
    if (depth > 20 || ++nodes > 200000) bad();
    space(); const c = source[at];
    if (c === '"') return string();
    if (c === '{') {
      at++; space(); const result = Object.create(null), keys = new Set();
      if (source[at] === '}') { at++; return result; }
      for (;;) {
        space(); if (source[at] !== '"') bad(); const key = string(); if (keys.has(key)) bad(); keys.add(key);
        space(); if (source[at++] !== ':') bad(); result[key] = value(depth + 1); space(); const next = source[at++];
        if (next === '}') return result; if (next !== ',') bad();
      }
    }
    if (c === '[') {
      at++; space(); const result = []; if (source[at] === ']') { at++; return result; }
      for (;;) { result.push(value(depth + 1)); space(); const next = source[at++]; if (next === ']') return result; if (next !== ',') bad(); }
    }
    const match = /^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(at));
    if (!match) bad(); at += match[0].length; const result = JSON.parse(match[0]); if (typeof result === 'number' && !Number.isFinite(result)) bad(); return result;
  }
  const result = value(); space(); if (at !== source.length) bad(); return result;
}
export async function readData(path) {
  const info = await stat(path); if (!info.isFile() || info.size > 8 * 1048576) throw new Error('EVIDENCE_SIZE_LIMIT');
  return parseData(await readFile(path, 'utf8'));
}
