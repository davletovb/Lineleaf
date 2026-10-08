import {TURKISH_VERB_STEMS} from './turkish-verbs.mjs';

const normalize = text => text.normalize('NFC').toLocaleLowerCase('tr').replaceAll('’', "'");
const WORDS = /\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*/gu;
const REFERENCES = /https?:\/\/\S+|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}|[@#][\p{L}\p{N}_]+/gu;
// Full words, not JS \b (which treats ş/ı/ğ as boundaries). Proper-name suffixes and URLs are never verb roots.
const LEXICAL = /^(?:değil(?:(?:im|sin|iz|siniz|ler|di|miş|se|dir)\p{L}*|ken)?|yok(?:(?:um|sun|uz|sunuz|lar|tu|muş|sa|tur)\p{L}*|ken)?|hayır|asla|hiç|hiçbir\p{L}*|hiçkimse\p{L}*|kimse(?:yi|ye|nin|den|yle)?|yoklu[kğ]\p{L}*|yoksun\p{L}*)$/u;
// -mA is negative only after a verb stem and before a possible verbal continuation. Bare -mA and the
// first-person aorist are also nominalizations ("çalışma", "gelmem"): keep them as ambiguous review signals.
// Reject the infinitive homonym's -k: ye-mek, de-mek are positive, ye-me-mek, de-me-mek are negative.
const NEGATIVE_END = /^(?:m[ae](?:|m|y[ıi]z|z\p{L}*|d[ıi]\p{L}*|m[ıi]ş\p{L}*|y[ae]\p{L}*|y[ıi]\p{L}*|s[ıi]n\p{L}*|s[ae]\p{L}*|m[ae]\p{L}*|d[ae]n|ks[ıi]z[ıi]n)|m[ıiuü]yor\p{L}*)$/u;
// Productive voice/ability extensions before negation, checked back to a dictionary verb. Depth is bounded;
// this is deliberately a conservative recognizer, not Zemberek's full state machine or a tense checker.
const EXTENSIONS = /^(?:[ıiuü]?[lnş]|[dt][ıiuü]r|[aeıiuü]r|[ıiuü]t|t|[ıiuü]z|y?[ae]bil|y?[ae])$/u;
function verbStem(stem, depth = 0) {
  if (TURKISH_VERB_STEMS.has(stem)) return true;
  if (depth === 4 || stem.length < 3) return false;
  // Try all suffix lengths: the shorter final -l may obscure the ability suffix -ebil.
  for (let from = Math.max(1, stem.length - 5); from < stem.length; from++) {
    if (EXTENSIONS.test(stem.slice(from)) && verbStem(stem.slice(0, from), depth + 1)) return true;
  }
  return false;
}
function negative(word) {
  if (word.includes("'") || word.includes('’')) return false;
  if (LEXICAL.test(word)) return true;
  for (let at = 1; at < word.length; at++) {
    if (word[at] !== 'm') continue;
    const stem = word.slice(0, at), ending = word.slice(at), vowel = stem.match(/[aeıioöuü]/gu)?.at(-1);
    const low = /[aıou]/u.test(vowel ?? '') ? 'a' : 'e';
    const high = /[aı]/u.test(vowel ?? '') ? 'ı' : /[ei]/u.test(vowel ?? '') ? 'i' : /[ou]/u.test(vowel ?? '') ? 'u' : 'ü';
    // Vowel harmony rules out sin(e)-ma: "sinema" is a noun, not a negative form of sinmek.
    if (vowel && (ending[1] === low || ending[1] === high) && NEGATIVE_END.test(ending) && verbStem(stem)) return true;
  }
  // -sIz (without/lacking) is productive on nouns. Keep the full word and its clause: no suffix-count-only equivalence.
  return /^\p{L}{2,}s[ıiuü]z(?:|l[ıiuü][kğ]\p{L}*|c[ae]|[dt][ıiuü]\p{L}*|m[ıiuü]ş\p{L}*|s[ae]\p{L}*|ken|[ıiuü]m|s[ıiuü]n\p{L}*|[ıiuü]z|l[ae]r\p{L}*|[aeıiuü])$/u.test(word);
}

// Bind each signal to its clause, so keeping one "değil" or one "gelmedi" while moving it to another
// subject/predicate is still reported. Punctuation/casing/canonical Unicode are ignored, wording is not.
// Valid paraphrases inside a negative clause may therefore warn (or be dropped for automatic clarity).
// Unlisted roots, stress-dependent readings and implicit pragmatics still require human review.
export function turkishNegationSignals(text) {
  const signals = [];
  for (const clause of normalize(text).replace(REFERENCES, ' ').split(/[.!?…;,:\n\r]+/u)) {
    const words = Array.from(clause.matchAll(WORDS), match => match[0]);
    if (words.some(negative) || words.filter(word => word === 'ne').length >= 2) signals.push(words.join(' '));
  }
  return signals;
}
export function turkishNegationChanged(source, rewrite) {
  const a = turkishNegationSignals(source), b = turkishNegationSignals(rewrite);
  return a.length !== b.length || a.some((signal, index) => signal !== b[index]);
}
