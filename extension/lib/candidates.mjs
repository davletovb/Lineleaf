import {exactKeys, validText, MAX_OUTPUT, MAY_STAY_SAME, CLARITY_MAX, LineleafError, isTurkish, VARIANTS} from './policy.mjs';
import {turkishNegationChanges, foldTurkish} from './turkish-negation.mjs';
import {boundaries} from './boundaries.mjs';

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
// Deterministic guard for rewrites: what must not change silently. Numbers and dates, names (capitalised words, @mentions, #tags,
// links, e-mail addresses) and negations are compared between the source and the rewrite. A difference is not a rejection
// (shortening may drop a number on purpose); it is reported so the user is asked to check it.
// A capitalised word that begins a sentence or the selection counts as a name in the source unless it is a common sentence opener,
// so "Maya paid" becoming "Priya paid" or "The invoice was paid" is caught; the price is an occasional flag when a rewrite drops an
// uncommon first word ("Quickly we left" → "Soon we left"). A new first word in the rewrite is not treated as an added name.
// Spelled-out numbers and shifts of meaning that keep every tracked token are not detected.
const NUMBERS = /%?\p{N}+(?:[.,:/-]\p{N}+)*%?/gu;
const HANDLES = /[@#][\p{L}\p{N}_]+|https?:\/\/[^\s)]+|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;
const NEGATIONS = /\b(?:not|no|never|none|nobody|nothing|nowhere|neither|nor|cannot|without)\b|\b\p{L}*n['’]t\b/giu;
const WORDS = /\p{Lu}[\p{L}\p{M}'’-]*/gu;
const OPENERS = new Set(('A An The This That These Those There Here It Its He She We You They I My Our Your His Her Their Me Us Him Them ' +
  'And But Or So Yet For Nor If When While Because Although Though Since Unless Until As At By In On Of To From With Without About After Before During Over Under ' +
  'Please Thanks Thank Hi Hello Hey Dear Due Yes No Not Also Then Now Today Tomorrow Yesterday However Therefore Finally First Second Third Next Last Maybe Perhaps ' +
  'Just Only Even Still Well Okay OK Sorry Let Do Does Did Is Are Was Were Be Been Am Can Could Will Would Shall Should May Might Must Have Has Had ' +
  'What Why How Who Whom Which Where Whose All Any Some Each Every Both Many Most More Much Few Several Such One Two Another Other Once').split(' '));
const TURKISH_OPENERS = new Set(('Ben Sen O Biz Siz Onlar Bu Şu Bunlar Şunlar Bunu Şunu Böyle Şöyle Bir Ve Ama Fakat Ancak Çünkü Eğer ' +
  'İçin İle Hem Ya Veya Ne Nasıl Neden Niçin Kim Hangi Nerede Lütfen Merhaba Selam Teşekkür Teşekkürler Evet Hayır ' +
  'Değil Yok Asla Hiç Bugün Yarın Dün Şimdi Sonra Önce Bazen Belki Ayrıca Yine Henüz Artık Sadece Çok Daha En Not No').split(' ').map(word => foldTurkish(word.toLocaleLowerCase('tr'))));
const tally = (items) => { const counts = new Map(); for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1); return counts; };
const sameCounts = (a, b) => a.size === b.size && [...a].every(([key, count]) => b.get(key) === count);
// Occurrence counts of capitalised words: `all` every one; `kept` those that count as names (sentence openers and "I" excluded);
// `inner` the kept ones that do not begin a sentence. Counting occurrences means "Maya thanked Maya" → "Maya thanked" is a change.
function capitalised(text, settings) {
  const all = new Map(), kept = new Map(), inner = new Map(), add = (map, word) => map.set(word, (map.get(word) ?? 0) + 1);
  const turkish = isTurkish(settings), openers = turkish ? TURKISH_OPENERS : OPENERS;
  if (turkish) text = text.normalize('NFC');
  for (const match of text.matchAll(WORDS)) {
    const word = match[0].replace(turkish ? /['’].*$/u : /['’]s?$/iu, ''), head = word.replace(/['’].*$/u, '');
    add(all, word);
    if (!turkish && head === 'I') continue;
    const before = text.slice(0, match.index);
    const opening = before.trim() === '' || /[.!?…:]["'”’)\]]*\s+$/u.test(before) || /\n\s*$/.test(before);
    if (opening && openers.has(turkish ? foldTurkish(head.toLocaleLowerCase('tr')) : head)) continue;
    add(kept, word);
    if (!opening) add(inner, word);
  }
  return {all, kept, inner};
}
const negations = text => tally(Array.from(text.toLowerCase().matchAll(NEGATIONS), ([token]) => /n['’]t$|^cannot$/u.test(token) ? 'not' : token));
function requireLanguage(settings) {
  if (!VARIANTS.includes(settings?.variant)) throw new LineleafError('INVALID_REQUEST');
}
export function preservationFlags(source, rewrite, settings) {
  requireLanguage(settings);
  const flags = [], a = capitalised(source, settings), b = capitalised(rewrite, settings);
  if (!sameCounts(tally(source.match(NUMBERS) ?? []), tally(rewrite.match(NUMBERS) ?? []))) flags.push('number');
  if ([...a.kept].some(([word, n]) => (b.all.get(word) ?? 0) < n) || [...b.inner].some(([word, n]) => n > (a.all.get(word) ?? 0))
      || !sameCounts(tally(source.match(HANDLES) ?? []), tally(rewrite.match(HANDLES) ?? []))) flags.push('name');
  if (isTurkish(settings)) {
    const changes = turkishNegationChanges(source, rewrite);
    if (changes.certain) flags.push('negation');
    else if (changes.ambiguous) flags.push('possible-negation');
  } else if (!sameCounts(negations(source), negations(rewrite))) flags.push('negation');
  return flags;
}
const EXPLANATIONS = {
  improve: 'Optional improvement for clarity and flow. Review facts and meaning before accepting.',
  paraphrase: 'Optional paraphrase in different words. Review facts and meaning before accepting.'
};
// Clearer-wording suggestions are optional style, shown automatically as underlines, so they are held to a stricter bar than a
// rewrite the user asked for: the response must follow the contract exactly (any violation rejects it, as for corrections), and
// a well-formed suggestion is still dropped, not merely flagged, when it changes a number, name or negation, or only changes
// spacing, punctuation or capitalisation (that is a correction, not a wording improvement).
const bare = text => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
function clarity(data, source, points, settings) {
  const bad = () => { throw new LineleafError('INVALID_OUTPUT'); };
  if (!exactKeys(data, ['suggestions']) || !Array.isArray(data.suggestions) || data.suggestions.length > CLARITY_MAX) bad();
  const edits = [], spans = [];
  for (const item of data.suggestions) {
    if (!exactKeys(item, ['before', 'after', 'left', 'right', 'explanation'])
        || !validText(item.before, 240) || typeof item.after !== 'string' || item.after.length > 240 || !item.after.isWellFormed()
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(item.after) || item.before === item.after
        || !validText(item.explanation, 280)
        || !['left', 'right'].every(k => typeof item[k] === 'string' && item[k].length <= 120 && item[k].isWellFormed())) bad();
    const matches = [];
    for (let from = 0, start; (start = source.indexOf(item.before, from)) !== -1; from = start + 1) {
      const end = start + item.before.length;
      if (source.slice(0, start).endsWith(item.left) && source.slice(end).startsWith(item.right)) matches.push({start, end});
    }
    if (matches.length !== 1) bad();
    const {start, end} = matches[0];
    if (!points.has(start) || !points.has(end) || spans.some(x => start < x.end && x.start < end)) bad();
    spans.push({start, end});
    // The whole paragraph is compared with and without the edit: an isolated phrase hides the context ("May" → "June" before "6").
    if (bare(item.before) === bare(item.after) || preservationFlags(source, source.slice(0, start) + item.after + source.slice(end), settings).length) continue;
    edits.push({...item, category: 'clarity', start, end});
  }
  return edits.sort((a, b) => a.start - b.start);
}
export function candidates(answer, source, mode, settings) {
  requireLanguage(settings);
  const data = strictJSON(answer), points = boundaries(source), edits = [];
  const bad = () => { throw new LineleafError('INVALID_OUTPUT'); };
  if (mode === 'clarity') return clarity(data, source, points, settings);
  if (mode !== 'proofread') {
    if (!exactKeys(data, ['rewrite']) || !validText(data.rewrite)) bad();
    if (data.rewrite === source) { if (MAY_STAY_SAME.includes(mode)) return []; bad(); }
    return [{start: 0, end: source.length, before: source, after: data.rewrite, category: 'style', rewrite: mode, flags: preservationFlags(source, data.rewrite, settings),
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
