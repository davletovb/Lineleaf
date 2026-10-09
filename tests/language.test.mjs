import test from 'node:test';
import assert from 'node:assert/strict';
import {detectLanguage, languageOf, languagesIn, LANGUAGES} from '../extension/lib/language.mjs';

// Which language a text is in is worked out from the text itself; there is no setting for it. These cover what the rest of the extension
// leans on: the label that picks the prompt, and the languages whose meaning guards run.
const CASES = [
  // English, by function words and contractions.
  ['I will not be there tomorrow, sorry.', 'en'], ['Thanks!', 'en'], ["We don't have the numbers yet, but they're on the way.", 'en'],
  ['Dear Mr. Müller, thank you for the quick answer.', 'en'], // ü is shared with German: not enough to call it Turkish
  ['Meeting with Ayşe tomorrow about the project', 'en'],    // a Turkish name is not a Turkish sentence
  ['I love İstanbul and the food there', 'en'],
  // Turkish, with its special letters, without them, and in capitals.
  ['Bugün okula gidiyorum ama yarın gelmeyeceğim.', 'tr'], ['bugun okula gidiyorum ama yarin gelmeyecegim', 'tr'],
  ['Bu uygun degil, hic sevmedim.', 'tr'], ['İSTANBUL İÇİN BİR ŞEY YOK', 'tr'], ['Merhaba, ben Ayşe.', 'tr'], ['Teşekkürler, çok güzel olmuş', 'tr'],
  ["Ankara'da yaşıyorum ve İstanbul'a gidiyorum", 'tr'],
  // Mixed: both languages carry real evidence, as when a writer switches inside one paragraph.
  ['Ben never geldim.', 'mixed'], // "never" is English evidence, so the English negation guard is on for it
  ['Nothing works without power', 'en'],
  ['Meeting’e geç kaldım because the train was late', 'mixed'], ['Merhaba, ben Ayşe. I think we should meet tomorrow, değil mi?', 'mixed'],
  // Too little to tell: a heading, a name, a number, a lone brand, a single Turkish-looking verb.
  ['Quarterly revenue grew significantly', 'unknown'], ['ok', 'unknown'], ['2pm', 'unknown'], ['Ahmet geldi', 'unknown'], ['Audi', 'unknown'], ['', 'unknown'], ['😀 😀', 'unknown'],
];
for (const [text, expected] of CASES) test(`detects ${expected}: ${JSON.stringify(text)}`, () => assert.equal(detectLanguage(text), expected));

test('the labels are exactly the supported ones, and odd input never throws', () => {
  assert.deepEqual(LANGUAGES, ['en', 'tr', 'mixed', 'unknown']);
  for (const odd of [undefined, null, 0, {}, [], '\u0000', '\ud800', 'ı'.repeat(5000), 'the '.repeat(2000)]) assert.ok(LANGUAGES.includes(detectLanguage(odd)));
});
test('the answer depends on the characters, not on how they are composed or cased', () => {
  assert.equal(detectLanguage('Bugu\u0308n okula gidiyorum ama yarın gelmeyeceg\u0306im.'), 'tr'); // decomposed ü and ğ
  assert.equal(detectLanguage('BUGÜN OKULA GİDİYORUM AMA YARIN GELMEYECEĞİM'), 'tr');
  assert.equal(detectLanguage('I WILL NOT BE THERE TOMORROW'), 'en');
});
test('a language that is fixed by the caller overrides the text, and nothing else does', () => {
  assert.equal(languageOf({language: 'tr'}, 'I will not be there tomorrow'), 'tr');
  assert.equal(languageOf({language: 'en'}, 'Bugün okula gidiyorum'), 'en');
  for (const bad of [undefined, {}, {language: 'fr'}, {language: 'TR'}, {variant: 'TR'}]) assert.equal(languageOf(bad, 'Bugün okula gidiyorum ama yarın gelmeyeceğim.'), 'tr');
});
test('the meaning guards of a language run whenever that language has any evidence, and both when there is none', () => {
  const rules = text => languagesIn({}, text);
  assert.deepEqual(rules('I will not be there tomorrow'), {turkish: false, english: true});
  assert.deepEqual(rules('Bugün okula gidiyorum ama yarın gelmeyeceğim.'), {turkish: true, english: false});
  // An English sentence around a Turkish verb still has a Turkish negation in it, though English wins the label.
  assert.equal(detectLanguage('Meeting’e gelmedim because the train was late.'), 'en');
  assert.deepEqual(rules('Meeting’e gelmedim because the train was late.'), {turkish: true, english: true});
  assert.deepEqual(rules('Meeting with Ayşe tomorrow about the project'), {turkish: true, english: true});
  assert.deepEqual(rules('Quarterly revenue grew significantly'), {turkish: true, english: true}); // nothing to go by: be careful in both
  assert.deepEqual(languagesIn({language: 'tr'}, 'whatever'), {turkish: true, english: false});
  assert.deepEqual(languagesIn({language: 'en'}, 'whatever'), {turkish: false, english: true});
  assert.deepEqual(languagesIn({language: 'mixed'}, 'whatever'), {turkish: true, english: true});
  assert.deepEqual(languagesIn({language: 'unknown'}, 'whatever'), {turkish: true, english: true});
});
test('classifying a full-length paragraph is fast enough to do on every request', () => {
  const text = ('Bugün okula gidiyorum ama I think the train will be late, değil mi? ').repeat(40).slice(0, 2000);
  const started = performance.now(); for (let i = 0; i < 200; i++) detectLanguage(text);
  assert.ok(performance.now() - started < 1500, 'detection took too long');
});
