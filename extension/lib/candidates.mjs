import {exactKeys, validText, MAX_OUTPUT, MAY_STAY_SAME, LineleafError} from './policy.mjs';

// Bounded recursive JSON parser: JSON.parse alone silently accepts duplicate keys.
export function strictJSON(source) {
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > MAX_OUTPUT) throw new LineleafError('INVALID_OUTPUT');
  let at = 0, nodes = 0;
  const bad = () => { throw new LineleafError('INVALID_OUTPUT'); };
  const space = () => { while (/\s/u.test(source[at] ?? '') && at < source.length) { if (!/[ \t\r\n]/.test(source[at])) bad(); at++; } };
  function string() {
    const start = at++;
    while (at < source.length) {
      const c = source[at++];
      if (c === '"') { try { return JSON.parse(source.slice(start, at)); } catch { bad(); } }
      if (c === '\\') at++;
    }
    bad();
  }
  function value(depth = 0) {
    if (depth > 12 || ++nodes > 1024) bad();
    space(); const c = source[at];
    if (c === '"') return string();
    if (c === '{') {
      at++; space(); const result = Object.create(null), keys = new Set();
      if (source[at] === '}') { at++; return result; }
      for (;;) {
        space(); if (source[at] !== '"') bad(); const key = string();
        if (keys.has(key)) bad(); keys.add(key); space(); if (source[at++] !== ':') bad();
        result[key] = value(depth + 1); space(); const next = source[at++];
        if (next === '}') return result; if (next !== ',') bad();
      }
    }
    if (c === '[') {
      at++; space(); const result = [];
      if (source[at] === ']') { at++; return result; }
      for (;;) { result.push(value(depth + 1)); space(); const next = source[at++]; if (next === ']') return result; if (next !== ',') bad(); }
    }
    const match = /^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(at));
    if (!match) bad(); at += match[0].length; const result = JSON.parse(match[0]);
    if (typeof result === 'number' && !Number.isFinite(result)) bad(); return result;
  }
  const result = value(); space(); if (at !== source.length) bad(); return result;
}
export function boundaries(text) {
  return new Set([text.length, ...Array.from(new Intl.Segmenter('en', {granularity: 'grapheme'}).segment(text), x => x.index)]);
}
// Deterministic guard for rewrites: what must not change silently. Numbers and dates, names (capitalised words away from a
// sentence start, @mentions, #tags, links, e-mail addresses) and negations are compared between the source and the rewrite.
// A difference is not a rejection (shortening may drop a number on purpose); it is reported so the user is asked to check it.
// Spelled-out numbers and names that begin a sentence are not tracked.
const NUMBERS = /\p{N}+(?:[.,:/-]\p{N}+)*%?/gu;
const HANDLES = /[@#][\p{L}\p{N}_]+|https?:\/\/[^\s)]+|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;
const NEGATIONS = /\b(?:not|no|never|none|nobody|nothing|nowhere|neither|nor|cannot|without)\b|n['’]t\b/giu;
const WORDS = /\p{Lu}[\p{L}\p{M}'’-]*/gu;
const tally = (text, pattern) => { const counts = new Map(); for (const [token] of text.matchAll(pattern)) counts.set(token, (counts.get(token) ?? 0) + 1); return counts; };
const sameCounts = (a, b) => a.size === b.size && [...a].every(([key, count]) => b.get(key) === count);
function midSentenceNames(text) {
  const names = new Set();
  for (const match of text.matchAll(WORDS)) {
    const before = text.slice(0, match.index);
    if (match[0] === 'I' || /^I['’]/.test(match[0]) || before.trim() === '' || /[.!?…:]["'”’)\]]*\s+$/u.test(before) || /\n\s*$/.test(before)) continue;
    names.add(match[0]);
  }
  return names;
}
export function preservationFlags(source, rewrite) {
  const flags = [];
  if (!sameCounts(tally(source, NUMBERS), tally(rewrite, NUMBERS))) flags.push('number');
  const kept = new Set(Array.from(rewrite.matchAll(WORDS), m => m[0]));
  const lost = [...midSentenceNames(source)].some(name => !kept.has(name)), added = [...midSentenceNames(rewrite)].some(name => !new Set(Array.from(source.matchAll(WORDS), m => m[0])).has(name));
  if (lost || added || !sameCounts(tally(source, HANDLES), tally(rewrite, HANDLES))) flags.push('name');
  const negations = text => { const counts = tally(text.toLowerCase(), NEGATIONS); return [...counts.values()].reduce((sum, n) => sum + n, 0); };
  if (negations(source) !== negations(rewrite)) flags.push('negation');
  return flags;
}
const EXPLANATIONS = {
  improve: 'Optional improvement for clarity and flow. Review facts and meaning before accepting.',
  paraphrase: 'Optional paraphrase in different words. Review facts and meaning before accepting.'
};
export function candidates(answer, source, mode) {
  const data = strictJSON(answer), points = boundaries(source), edits = [];
  const bad = () => { throw new LineleafError('INVALID_OUTPUT'); };
  if (mode !== 'proofread') {
    if (!exactKeys(data, ['rewrite']) || !validText(data.rewrite)) bad();
    if (data.rewrite === source) { if (MAY_STAY_SAME.includes(mode)) return []; bad(); }
    return [{start: 0, end: source.length, before: source, after: data.rewrite, category: 'style', rewrite: mode, flags: preservationFlags(source, data.rewrite),
      explanation: EXPLANATIONS[mode] ?? 'Optional rewrite. Review facts and meaning before accepting.'}];
  }
  if (!exactKeys(data, ['corrections']) || !Array.isArray(data.corrections) || data.corrections.length > 32) bad();
  for (const item of data.corrections) {
    if (!exactKeys(item, ['before', 'after', 'left', 'right', 'category', 'explanation'])
        || !validText(item.before) || typeof item.after !== 'string' || item.after.length > 2000 || !item.after.isWellFormed()
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(item.after) || item.before === item.after
        || !['grammar', 'spelling', 'punctuation'].includes(item.category)
        || !validText(item.explanation, 280)
        || !['left', 'right'].every(k => typeof item[k] === 'string' && item[k].length <= 120 && item[k].isWellFormed())) bad();
    const matches = [];
    for (let from = 0, start; (start = source.indexOf(item.before, from)) !== -1; from = start + 1) {
      const end = start + item.before.length;
      if (source.slice(0, start).endsWith(item.left) && source.slice(end).startsWith(item.right)) matches.push({start, end});
    }
    if (matches.length !== 1) bad();
    const {start, end} = matches[0];
    if (!points.has(start) || !points.has(end) || edits.some(x => start < x.end && x.start < end)) bad();
    edits.push({...item, start, end});
  }
  return edits.sort((a, b) => a.start - b.start);
}
