// Which supported language a text is written in, decided here from the text itself. Nothing is sent anywhere to decide it, and the
// answer only chooses between prompts and guards that all exist already: a wrong answer costs a warning or a clumsier prompt, never a leak.
//
//   en       English evidence and (almost) no Turkish evidence
//   tr       Turkish evidence and (almost) no English evidence
//   mixed    both languages are present, as when a writer switches inside one paragraph
//   unknown  too little to tell (a heading, a name, a number)
//
// English and Turkish are told apart by Turkish-only letters, by common function words in each language and by the Turkish present-tense
// ending -(I)yor. Words are matched in their diacritic-free spelling as well, because Turkish is often typed that way. To add a language,
// give it a letter test, a function-word list and an entry in LANGUAGES, and a prompt and guard in policy.mjs and candidates.mjs.
export const LANGUAGES = ['en', 'tr', 'mixed', 'unknown'];

const TOKEN = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
const TURKISH_LETTER = /[çğışÇĞİŞ]/u;   // Specific enough to count on their own, though a lone one is often just a name.
const SHARED_LETTER = /[öüÖÜ]/u;        // Also German, Swedish and others: a weaker hint.
// Function words that are not also common English words (so not "on", "at", "an", "o"), each in accented and ASCII-typed spelling.
const TURKISH_WORD = /^(?:ve|bir|bu|şu|ben|sen|biz|siz|onlar|bana|sana|bize|size|onu|ona|bunu|buna|şunu|burada|orada|ama|fakat|ancak|çünkü|cunku|eğer|eger|için|icin|ile|gibi|kadar|daha|çok|cok|değil|degil|yok|var|mı|mu|mü|mi|ne|nasıl|nasil|neden|niçin|nicin|evet|hayır|hayir|bugün|bugun|yarın|yarin|dün|dun|şimdi|simdi|sonra|önce|her|hiç|hic|bütün|butun|bile|ise|veya|olarak|olan|oldu|olur|ki|tamam|lütfen|lutfen|merhaba|selam|teşekkürler|tesekkurler|iyi|güzel|guzel)$/u;
const ENGLISH_WORD = /^(?:the|and|is|are|was|were|be|been|to|of|in|that|it|its|for|you|your|with|this|these|those|have|has|had|not|but|from|they|their|we|our|my|i|me|he|she|will|would|can|could|should|about|there|what|which|who|so|if|just|do|does|did|as|by|or|all|any|more|some|yes|hi|hello|thanks|please|also|then|than|when|where|how|why|here|very|really|think|know|like|get|got|going|because|never|nothing|nobody|nowhere|neither|nor|none|cannot|without)$/u;
const ENGLISH_CONTRACTION = /n['’]t$|['’](?:re|ll|ve|m|d)$/u;
const TURKISH_PRESENT = /^[\p{L}\p{M}]{2,}[ıiuü]yor(?:um|sun|uz|sunuz|lar)?$/u;   // gidiyorum, bilmiyorsun
const TURKISH_PAST = /^[\p{L}\p{M}]{2,}[dt][ıiuü](?:m|n|k|nız|niz|nuz|nüz|lar|ler)?$/u; // geldi, yaptık: weak (Audi, Wi-Fi)

// Points per token, capped so that one long word cannot decide a text.
function turkishPoints(token, word) {
  let points = 0;
  if (TURKISH_LETTER.test(token)) points += 2; else if (SHARED_LETTER.test(token)) points += 1;
  if (TURKISH_WORD.test(word)) points += 4;
  if (TURKISH_PRESENT.test(word)) points += 4; else if (TURKISH_PAST.test(word)) points += 1;
  return Math.min(points, 6);
}
const englishPoints = (token, word) => ENGLISH_WORD.test(word) || ENGLISH_CONTRACTION.test(token.toLowerCase()) ? 4 : 0;

// How much evidence each language has in the text, as points.
function evidence(text) {
  let turkish = 0, english = 0;
  for (const match of String(text ?? '').normalize('NFC').matchAll(TOKEN)) {
    const token = match[0], base = token.split(/['’]/u)[0];
    // Lowercase the dotted capital İ to a plain i, not to i plus a combining dot, so "İÇİN" is "için".
    const word = base.toLowerCase().replace(/i\u0307/gu, 'i');
    turkish += turkishPoints(base, word); english += englishPoints(token, word);
  }
  return {turkish, english};
}

// The label for a text, which picks the prompt.
export function detectLanguage(text) {
  const {turkish, english} = evidence(text);
  if (turkish + english < 4) return 'unknown'; // One weak hint is not evidence.
  const share = turkish / (turkish + english);
  return share >= 0.7 ? 'tr' : share <= 0.2 ? 'en' : 'mixed';
}

// The label a caller has fixed (tests, the evaluation tools, whoever already knows) or, failing that, the text's own.
export const languageOf = (settings, text) => LANGUAGES.includes(settings?.language) ? settings.language : detectLanguage(text);

// Which languages' rules apply to a text: the ones with ANY evidence in it, however weak, and both when there is none. The label picks the
// prompt, but the rules that guard meaning must not depend on which language wins: an English sentence around a Turkish "gelmedim" still
// has a Turkish negation in it. Applying a language's rules to text that is not in it costs at most a spurious warning.
export function languagesIn(settings, text) {
  if (LANGUAGES.includes(settings?.language)) {
    const label = settings.language;
    return {turkish: label !== 'en', english: label !== 'tr'};
  }
  const {turkish, english} = evidence(text);
  return turkish + english === 0 ? {turkish: true, english: true} : {turkish: turkish > 0, english: english > 0};
}
