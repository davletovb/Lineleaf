import {TURKISH_VERB_STEMS} from './turkish-verbs.mjs';

const normalize = text => text.normalize('NFC').toLocaleLowerCase('tr').replaceAll('’', "'");
const ASCII = {ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u'};
// Recognition also tries the keyboard spelling; signatures retain the actual normalized words.
export const foldTurkish = text => text.replace(/[çğıöşü]/gu, letter => ASCII[letter]);
const FOLDED_STEMS = new Set([...TURKISH_VERB_STEMS].map(foldTurkish));
const WORDS = /\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*/gu;
const REFERENCES = /https?:\/\/\S+|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}|[@#][\p{L}\p{N}_]+/gu;
// Full words, not JS \b (which treats ş/ı/ğ as boundaries). Proper-name suffixes and URLs are never verb roots.
const LEXICAL = /^(?:değil(?:(?:im|sin|iz|siniz|ler|di|miş|se|dir)\p{L}*|ken)?|yok(?:(?:um|sun|uz|sunuz|lar|tu|muş|sa|tur)\p{L}*|ken)?|hayır|asla|hiç|hiçbir\p{L}*|hiçkimse\p{L}*|kimse(?:yi|ye|nin|den|yle)?|yoklu[kğ]\p{L}*|yoksun\p{L}*)$/u;
// -mA is negative only after a verb stem and before a possible verbal continuation. Bare -mA and the
// first-person aorist are also nominalizations ("çalışma", "gelmem"): keep them as ambiguous review signals.
// Reject the infinitive homonym's -k: ye-mek, de-mek are positive, ye-me-mek, de-me-mek are negative.
const NEGATIVE_END = /^(?:m[ae](?:|m|y[ıi]z|z\p{L}*|d[ıi]\p{L}*|m[ıi]ş\p{L}*|y[ae]\p{L}*|y[ıi]\p{L}*|s[ıi]n\p{L}*|s[ae]\p{L}*|m[ae]\p{L}*|d[ae]n|ks[ıi]z[ıi]n)|m[ıiuü](?:yor\p{L}*|yo\p{L}*|y?c[ae]\p{L}*))$/u;
const NOMINAL_END = /^m[ae](?:y[ıi]|y[ae]|s[ıi](?:n[ıi]n|n[ıi]|n[ae]|nd[ae]n|nd[ae])?)$/u;
const AMBIGUOUS_END = /^m[ae]m?$/u;
const PRIVATIVE = /^\p{L}{2,}'?s[ıiuü]z(?:|l[ıiuü][kğ]\p{L}*|c[ae]|[dt][ıiuü]\p{L}*|m[ıiuü]ş\p{L}*|s[ae]\p{L}*|ken|[ıiuü]m|s[ıiuü]n\p{L}*|[ıiuü]z|l[ae]r\p{L}*|[aeıiuü])$/u;
// Productive voice/ability extensions before negation, checked back to a dictionary verb. Depth is bounded;
// this is deliberately a conservative recognizer, not Zemberek's full state machine or a tense checker.
const EXTENSIONS = /^(?:[ıiuü]?[lnş]|[dt][ıiuü]r|[aeıiuü]r|[ıiuü]t|t|[ıiuü]z|y?[ae]bil|y?[ae])$/u;
const foldedPattern = regex => new RegExp(foldTurkish(regex.source), regex.flags);
const PATTERNS = [
  {lexical: LEXICAL, ending: NEGATIVE_END, nominal: NOMINAL_END, ambiguous: AMBIGUOUS_END, privative: PRIVATIVE, extensions: EXTENSIONS, stems: TURKISH_VERB_STEMS},
  {lexical: foldedPattern(LEXICAL), ending: foldedPattern(NEGATIVE_END), nominal: foldedPattern(NOMINAL_END), ambiguous: foldedPattern(AMBIGUOUS_END), privative: foldedPattern(PRIVATIVE), extensions: foldedPattern(EXTENSIONS), stems: FOLDED_STEMS}
];
function verbStem(stem, patterns, depth = 0) {
  if (patterns.stems.has(stem)) return true;
  if (depth === 4 || stem.length < 3) return false;
  // Try all suffix lengths: the shorter final -l may obscure the ability suffix -ebil.
  for (let from = Math.max(1, stem.length - 5); from < stem.length; from++) {
    if (patterns.extensions.test(stem.slice(from)) && verbStem(stem.slice(0, from), patterns, depth + 1)) return true;
  }
  return false;
}
// 0: no signal, 1: nominal/imperative ambiguity, 2: recognized negative form.
function classify(word, folded, skipVerb, privative = true) {
  const patterns = PATTERNS[folded ? 1 : 0];
  if (privative && patterns.privative.test(word)) return 2; // Ali'siz must be checked before excluding proper-name verb roots.
  if (word.includes("'")) return 0;
  if (patterns.lexical.test(word)) return 2;
  if (skipVerb) return 0;
  for (let at = 1; at < word.length; at++) {
    if (word[at] !== 'm') continue;
    const stem = word.slice(0, at), ending = word.slice(at), vowel = stem.match(/[aeıioöuü]/gu)?.at(-1);
    const low = /[aıou]/u.test(vowel ?? '') ? 'a' : 'e';
    const high = /[aı]/u.test(vowel ?? '') ? 'ı' : /[ei]/u.test(vowel ?? '') ? 'i' : /[ou]/u.test(vowel ?? '') ? 'u' : 'ü';
    // Vowel harmony rules out sin(e)-ma: "sinema" is a noun, not a negative form of sinmek.
    if (vowel && (ending[1] === low || ending[1] === high || (folded && (/[iu]/u.test(ending[1]) || (/[iou]/u.test(vowel) && /[ae]/u.test(ending[1])))))
        && patterns.ending.test(ending) && !patterns.nominal.test(ending) && verbStem(stem, patterns)) {
      return patterns.ambiguous.test(ending) ? 1 : 2;
    }
  }
  return 0;
}
// A finite verb form that no name shares: a dictionary verb (with its voice and ability extensions) followed by a progressive, definite-past or
// future marker and an optional person ending, or a negative form the negation recognizer reads. It exists so that a capitalised sentence opener
// that is only a verb ("Anlıyorum", "Geldim") is not counted as a name. Stems that lose their final vowel before -ıyor (anla → anlıyor) are tried
// with it restored. Left out because names look like them: the aorist (Güler, Sever), the imperative (Dursun), the reported past (Durmuş,
// Satılmış), the second person of the definite past (Aydın) and every negative aorist (Yılmaz, Korkmaz). A doubtful opener stays a name, which
// at worst adds a warning.
const FINITE_END = /^(?:[ıiuü]yor|yor|[dt][ıiuü]|y?[ae]c[ae][kğ])(?:m|k|nız|niz|nuz|nüz|lar|ler|sın|sin|sun|sün|ız|iz|uz|üz|sınız|siniz|sunuz|sünüz|ım|im|um|üm)?$/u;
const FINITE = [FINITE_END, foldedPattern(FINITE_END)];
const AORIST_NEGATIVE = /m[ae]z/u;
export function turkishVerbForm(word) {
  const lower = String(word).normalize('NFC').toLocaleLowerCase('tr');
  return [false, true].some(folded => {
    const text = folded ? foldTurkish(lower) : lower, patterns = PATTERNS[folded ? 1 : 0];
    if (!text.includes("'") && !AORIST_NEGATIVE.test(text) && classify(text, folded, false) > 0) return true;
    for (let at = 2; at < text.length; at++) {
      if (FINITE[folded ? 1 : 0].test(text.slice(at)) && [text.slice(0, at), text.slice(0, at) + 'a', text.slice(0, at) + 'e'].some(stem => verbStem(stem, patterns))) return true;
    }
    return false;
  });
}
// Whether a text holds a Turkish negator or a negated dictionary verb, possibly or certainly. Bare -siz words do not count: English has them
// ("emphasize", "resize"). The language detector cannot see these words when they stand alone in English text, so the guard asks for them directly.
export function hasTurkishNegation(text) {
  const words = Array.from(String(text).normalize('NFC').replace(REFERENCES, ' ').matchAll(WORDS), match => normalize(match[0]));
  return words.some(word => classify(word, false, false, false) > 0 || classify(foldTurkish(word), true, false, false) > 0);
}
const NOT_NAME_PREFIX = new Set('ben sen o biz siz onlar bu şu bunlar şunlar bir ve ama fakat ancak çünkü eğer hem ya veya ne nasıl neden kim hangi lütfen bugün yarın dün şimdi sonra önce'.split(' ').map(foldTurkish));
const titleCase = word => /^\p{Lu}\p{Ll}+$/u.test(word);
function surname(words, at) {
  return at > 0 && titleCase(words[at].raw) && /m[ae]z$/u.test(words[at].text) && titleCase(words[at - 1].raw)
    && !NOT_NAME_PREFIX.has(foldTurkish(words[at - 1].text));
}
const questionParticle = word => /^(?:mi|mu)(?:s(?:in|un)(?:iz|uz)?|y(?:di|du|mis|mus)\p{L}*)?$/u.test(foldTurkish(word));
const indefinite = word => /^(?:hic|kimse(?:yi|ye|nin|den|yle)?)$/u.test(foldTurkish(word));
const whPredicate = word => /^(?:istiyor|ariyor)(?:um|sun|uz|sunuz|lar)?$/u.test(foldTurkish(word));

// Bind each signal to its clause, so keeping one "değil" or one "gelmedi" while moving it to another
// subject/predicate is still reported. Punctuation/casing/canonical Unicode are ignored, wording is not.
// Valid paraphrases inside a negative clause may therefore warn (or be dropped for automatic clarity).
// Unlisted roots, stress-dependent readings and implicit pragmatics still require human review.
function signals(text) {
  const certain = [], ambiguous = [];
  for (const sentence of text.normalize('NFC').replace(REFERENCES, ' ').split(/(?<=[.!?…])|[\n\r]+/u)) {
    const words = Array.from(sentence.matchAll(WORDS), match => ({raw: match[0], text: normalize(match[0]), at: match.index}));
    const question = sentence.trimEnd().endsWith('?'), particle = words.some(word => questionParticle(word.text));
    const kinds = words.map((word, at) => Math.max(classify(word.text, false, surname(words, at)), classify(foldTurkish(word.text), true, surname(words, at))));
    const strong = words.some((word, at) => kinds[at] === 2 && !indefinite(word.text) && word.text !== 'yoksa');
    for (let at = 0; at < words.length; at++) {
      // Disjunctive yoksa follows an earlier question ("gelecek misin yoksa ...?"). A later
      // particle alone must not erase conditional absence ("param yoksa ... mi?").
      if (question && particle && ((indefinite(words[at].text) && !strong)
          || (words[at].text === 'yoksa' && words.slice(0, at).some(word => questionParticle(word.text))))) kinds[at] = 0;
    }
    // Paired ne coordinates clauses even across commas/semicolons. Bind the whole sentence before
    // splitting those clauses; a lone interrogative ne must not pair with one in another sentence.
    const paired = words.flatMap((word, at) => word.text === 'ne' ? [at] : []);
    // Narrow repeated WH questions to recognizable predicates. A question mark alone must
    // not silence paired negation such as "Ne Ali ne Ayşe geldi?".
    const whQuestion = question && !particle && !strong && paired.every(at => words[at + 1] && whPredicate(words[at + 1].text));
    if (paired.length >= 2 && !whQuestion) {
      certain.push(words.map(word => word.text).join(' '));
      continue;
    }
    for (const {0: clause, index: from} of sentence.matchAll(/[^;,:]+/gu)) {
      const indexes = words.flatMap((word, at) => word.at >= from && word.at < from + clause.length ? [at] : []);
      if (indexes.some(at => kinds[at] === 2)) certain.push(indexes.map(at => words[at].text).join(' '));
      else for (const at of indexes) {
        // Keep the possible prohibition and its preceding subject/context, not unrelated words after it.
        if (kinds[at] === 1) ambiguous.push(indexes.filter(index => index <= at).map(index => words[index].text).join(' '));
      }
    }
  }
  return {certain, ambiguous};
}
export function turkishNegationSignals(text) { const found = signals(text); return [...found.certain, ...found.ambiguous]; }
const different = (a, b) => a.length !== b.length || a.some((signal, index) => signal !== b[index]);
export function turkishNegationChanges(source, rewrite) {
  const a = signals(source), b = signals(rewrite);
  return {certain: different(a.certain, b.certain), ambiguous: different(a.ambiguous, b.ambiguous)};
}
export function turkishNegationChanged(source, rewrite) {
  const changes = turkishNegationChanges(source, rewrite);
  return changes.certain || changes.ambiguous;
}
