import test from 'node:test';
import assert from 'node:assert/strict';
import {candidates, preservationFlags} from '../extension/lib/candidates.mjs';
import {turkishNegationSignals, turkishNegationChanged, turkishVerbForm} from '../extension/lib/turkish-negation.mjs';
import {REWRITE_MODES} from '../extension/lib/policy.mjs';

// The language is normally detected from the text; these tests fix it so each guard is tested on its own.
const tr = {variant: 'US', language: 'tr'};
const pairs = [
  ['gelmedi', 'geldi'], ['gelmedim', 'geldim'], ['gelmiyor', 'geliyor'], ['gitmiyorum', 'gidiyorum'],
  ['okumuyor', 'okuyor'], ['görmüyor', 'görüyor'], ['gelmeyecek', 'gelecek'], ['gelmeyeceğim', 'geleceğim'],
  ['gelmemiş', 'gelmiş'], ['gelmez', 'gelir'], ['gelmem', 'gelirim'], ['gelmeyiz', 'geliriz'],
  ['gelme', 'gel'], ['gelmeyin', 'gelin'], ['gelmesin', 'gelsin'], ['gelmeseydi', 'gelseydi'],
  ['gelmeden', 'gelerek'], ['gelmeyen', 'gelen'], ['gelmediğini', 'geldiğini'], ['gelmemek', 'gelmek'],
  ['yapamam', 'yapabilirim'], ['yapamayacak', 'yapabilecek'], ['yapamıyor', 'yapabiliyor'],
  ['gidemiyor', 'gidebiliyor'], ['gelememiş', 'gelebilmiş'], ['yapamayabilirim', 'yapabilirim'],
  ['yapabilmiyor', 'yapabiliyor'], ['çalıştırılmadı', 'çalıştırıldı'], ['ettirilmedi', 'ettirildi'],
  ['değil', 'uygun'], ['değilim', 'hazırım'], ['değildir', 'uygundur'], ['değildi', 'uygundu'], ['değillerdi', 'uygundular'],
  ['yok', 'var'], ['yoktu', 'vardı'], ['yokmuş', 'varmış'], ['yoksunuz', 'varsınız'],
  ['asla kabul etmem', 'kabul ederim'], ['hiç gelmedi', 'geldi'], ['hiçbir sorun yok', 'sorun var'],
  ['hayır', 'evet'], ['kimse gelmedi', 'herkes geldi'], ['izinsiz', 'izinli'], ['izinsizdi', 'izinliydi'], ['umutsuzluk', 'umut'],
  ['ne ali ne ayşe geldi', 'ali ve ayşe geldi'],
  ['ne yağmur yağdı, ne kar', 'yağmur ve kar yağdı'],
  ['ne yağmur yağdı; ne kar', 'yağmur ve kar yağdı'],
  ['ne yağmur yağdı: ne kar', 'yağmur ve kar yağdı'],
  ['ne yağmur, ne kar, ne dolu yağdı', 'yağmur, kar ve dolu yağdı'],
  ['bu uygun degil', 'bu uygun'], ['hayir', 'evet'], ['hic gelmedi', 'geldi'],
  ['anlamiyorum', 'anliyorum'], ['calismiyor', 'calisiyor'], ['gormuyor', 'goruyor'], ['istemiyorum', 'istiyorum'],
  ['calistirilmadi', 'calistirildi'], ['bugün gelmicem', 'bugün geleceğim'], ['gelmiycem', 'geleceğim'],
  ['bilmiyom', 'biliyom'], ['gelmiyo', 'geliyo'], ['gelmiyoz', 'geliyoz'], ['yapmıycam', 'yapacam'],
  ["Ali'siz geldim.", "Ali'yle geldim."], ['Ali’sizdi.', 'Ali’yleydi.'], ["Arzu'suz geldim.", "Arzu'yla geldim."],
  ['Param yoksa borç alabilir mi?', 'Param varsa borç alabilir mi?'],
  ['Ne Ali ne Ayşe geldi?', 'Ali ve Ayşe geldi?'], ['Ne yağmur yağdı, ne kar?', 'Yağmur ve kar yağdı?'],
  ['Ali geldi,,,,,,,,,,,, Ayşe gelmedi.', 'Ali geldi,,,,,,,,,,,, Ayşe geldi.']
];
test('Turkish verbal, lexical, inability and privative negations flag removals and additions in every rewrite mode', () => {
  for (const [negative, positive] of pairs) {
    for (const [source, rewrite] of [[negative, positive], [positive, negative]]) {
      assert.ok(turkishNegationChanged(source, rewrite), `${source} → ${rewrite}`);
      for (const mode of REWRITE_MODES) {
        const edit = candidates(JSON.stringify({rewrite}), source, mode, tr)[0];
        assert.ok(edit.flags.some(flag => ['negation', 'possible-negation'].includes(flag)), `${mode}: ${source} → ${rewrite}`);
      }
    }
  }
});
test('paired ne spans coordinated clauses, preserves scope and stops at sentence boundaries', () => {
  const source = 'Ne yağmur yağdı, ne kar.';
  assert.deepEqual(turkishNegationSignals(source), ['ne yağmur yağdı ne kar']);
  for (const rewrite of ['Ne yağmur yağdı; ne kar!', 'ne yağmur yağdı ne kar']) {
    assert.equal(turkishNegationChanged(source, rewrite), false, rewrite);
  }
  for (const rewrite of ['Yağmur yağdı, ne kar.', 'Ne yağmur yağdı, kar yağdı.',
    'Ne yağmur yağdı, ne dolu.', 'Yağmur yağdı, kar yağdı. Ne dolu yağdı, ne sis.']) {
    assert.equal(turkishNegationChanged(source, rewrite), true, rewrite);
  }
  for (const text of ['Ne zaman geldi?', 'Ne zaman geldi? Ne getirdi?', 'Ne getirdi. Ne zaman geldi.',
    'Ne getirdi\nNe zaman geldi', '@ne geldi, #ne getirdi']) {
    assert.deepEqual(turkishNegationSignals(text), [], text);
  }
});
test('negation stays attached to its clause, even when the negative word and total count are unchanged', () => {
  for (const [source, rewrite] of [
    ['Ali gelmedi, Ayşe geldi.', 'Ali geldi, Ayşe gelmedi.'],
    ['Bu uygun değil; o uygun.', 'Bu uygun; o uygun değil.'],
    ['Ali gelmedi ve Ayşe geldi.', 'Ali geldi ve Ayşe gelmedi.'],
    ['Ali gelmedi.', 'Ali gelmedi, Ali gelmedi.'],
    ['Ali gelmedi, Ayşe gitmedi.', 'Ali geldi, Ayşe gitmedi.'],
    ['Bu mümkün değil.', 'Bu imkânsız değil.']
  ]) assert.ok(preservationFlags(source, rewrite, tr).includes('negation'), `${source} → ${rewrite}`);
});
test('ordinary words and positive infinitives do not become negations just because they contain ma/me/m', () => {
  for (const word of ['elma', 'elmalar', 'kelime', 'kelimeler', 'malzeme', 'malzemem', 'firma', 'sinema', 'meme',
    'yemek', 'demek', 'ekmek', 'yapmak', 'gelmek', 'çalışmak', 'ama', 'İsmail', "Yılmaz'ın", 'mevsim', 'merhaba',
    '@gelmedi', '#gelmedi', 'https://a.test/gelmedi', 'gelmedi@example.test']) {
    assert.deepEqual(turkishNegationSignals(word), [], word);
  }
  assert.deepEqual(preservationFlags('Ben elma ve yemek aldım.', 'Elma ve yemek aldım.', tr), []);
  assert.equal(turkishNegationChanged('Ali yemek yedi.', 'Ali yiyecek yedi.'), false);
  // Nominalization/imperative ambiguity needs review: the guard does not pretend to infer stress or intent.
  assert.equal(turkishNegationChanged('çalışma', 'iş'), true);
});
test('Turkish casing, canonical accents and whitespace preserve the same negation signal', () => {
  for (const source of ['GELMEDİ', 'GİTMİYORUM', 'DEĞİLİM', 'YOK', 'ÇALIŞTIRILMADI', 'GÖRMÜYOR']) {
    const lower = source.toLocaleLowerCase('tr');
    assert.equal(turkishNegationChanged(source, lower), false);
    assert.equal(turkishNegationChanged(source.normalize('NFD'), lower), false);
  }
  assert.equal(turkishNegationChanged('Ben  gelmedim!', 'ben gelmedim.'), false);
  assert.equal(turkishNegationChanged("Ali'ye gelmedim.", 'Ali’ye gelmedim.'), false);
  assert.equal(turkishNegationChanged('yoklama', 'yoklama'), false);
});
test('Turkish names use apostrophe bases and canonical Unicode while retaining counts, numbers and links', () => {
  assert.deepEqual(preservationFlags("Ben Ankara'dan geldim.", 'Ankara’ya geldim.', tr), []);
  assert.deepEqual(preservationFlags("Ben Ankara'dan geldim.", "Ben İstanbul'dan geldim.", tr), ['name']);
  assert.deepEqual(preservationFlags('Çağla geldi.', 'Çağla geldi.'.normalize('NFD'), tr), []);
  assert.deepEqual(preservationFlags("Ali'nin notunu Ali'ye verdim.", "Ali'nin notunu ona verdim.", tr), ['name']);
  assert.deepEqual(preservationFlags("Ankara'da 3 kişi var.", "Ankara'da 2 kişi var.", tr), ['number']);
  assert.deepEqual(preservationFlags('Ben @ali ile görüştüm.', 'Ben @veli ile görüştüm.', tr), ['name']);
});
const suggestion = (before, after, left = '', right = '') => ({before, after, left, right, explanation: 'Daha kısa ifade.'});
test('positive nominal inflections, clear questions and surname contexts do not claim changed negation', () => {
  for (const [source, rewrite] of [
    ['Ödeme alındı', 'Ödeme tahsil edildi'], ['Yapmayı seviyorum', 'Yapmaktan hoşlanıyorum'],
    ['Onun gelmesini istedim', 'Onun gelişini istedim'], ['Kitap okumayı severim', 'Kitap okumaya bayılırım'],
    ['Sayın Ahmet Yılmaz yarın gelecek.', 'Sayın Ahmet Yılmaz yarın burada olacak.'],
    ['Ayşe Durmaz ile görüştüm.', 'Ayşe Durmaz ile konuştum.'], ['Mehmet Sönmez burada.', 'Mehmet Sönmez geldi.'],
    ['Yarın gelecek misin yoksa evde mi kalacaksın?', 'Yarın gelecek misin ya da evde mi kalacaksın?'],
    ['Evde kimse var mı?', 'Evde biri var mı?'], ['Hiç Ankara’ya gittin mi?', 'Ankara’ya hiç gittin mi?'],
    ['Ne istiyorsun, ne arıyorsun?', 'Ne arıyorsun, ne istiyorsun?'],
    ['Not defterimi getir.', 'Defterimi getir.'], ['No: 5 numaralı oda.', '5 numaralı oda.']
  ]) assert.equal(turkishNegationChanged(source, rewrite), false, `${source} → ${rewrite}`);
  const source = 'Bu çalışma çok önemli ve acil bir şekilde tamamlanmalı.';
  const edits = candidates(JSON.stringify({suggestions: [suggestion('acil bir şekilde', 'acilen', 've ', ' tamamlanmalı.')]}), source, 'clarity', tr);
  assert.equal(edits.length, 1);
  assert.equal(candidates(JSON.stringify({rewrite: 'iş'}), 'çalışma', 'improve', tr)[0].flags.includes('possible-negation'), true);
  // Ambiguity is not permission to silently remove a possible prohibition.
  assert.deepEqual(candidates(JSON.stringify({suggestions: [suggestion('gelme', 'gel')]}), 'gelme', 'clarity', tr), []);
  for (const [source, rewrite] of [['Ben Gelmedim.', 'Ben Geldim.'], ['Ali gelmez.', 'Ali gelir.'],
    ['Param yoksa giderim.', 'Param varsa giderim.'], ['Hiç gelmedi mi?', 'Hiç geldi mi?'],
    ['Ne Ali ne Ayşe geldi mi?', 'Ali ve Ayşe geldi mi?'], ['Onun gelmemesini istedim.', 'Onun gelmesini istedim.']]) {
    assert.equal(turkishNegationChanged(source, rewrite), true, source);
  }
});
test('Turkish percentage signs are facts, in both directions and all style modes', () => {
  for (const [source, rewrite] of [['%50 indirim var', '50 indirim var'], ['50 indirim var', '%50 indirim var'],
    ['50% indirim var', '50 indirim var']]) {
    assert.ok(preservationFlags(source, rewrite, tr).includes('number'));
    for (const mode of REWRITE_MODES) assert.ok(candidates(JSON.stringify({rewrite}), source, mode, tr)[0].flags.includes('number'));
    assert.deepEqual(candidates(JSON.stringify({suggestions: [suggestion(source, rewrite)]}), source, 'clarity', tr), []);
  }
});
test('currency symbols are part of the amount, on either side, in both directions and all style modes', () => {
  for (const [source, rewrite] of [['Fiyat ₺100', 'Fiyat 100'], ['Fiyat 100₺', 'Fiyat 100'], ['Fiyat 100', 'Fiyat ₺100'], ['Fiyat ₺100', 'Fiyat $100'], ['Fiyat 12,50₺', 'Fiyat 12,50']]) {
    assert.ok(preservationFlags(source, rewrite, tr).includes('number'), `${source} -> ${rewrite}`);
    for (const mode of REWRITE_MODES) assert.ok(candidates(JSON.stringify({rewrite}), source, mode, tr)[0].flags.includes('number'), mode);
    assert.deepEqual(candidates(JSON.stringify({suggestions: [suggestion(source, rewrite)]}), source, 'clarity', tr), []);
  }
  // The symbol kept, or the amount moved with it, is no change.
  assert.deepEqual(preservationFlags('Fiyat ₺100 oldu', 'Fiyat ₺100 tutarında', tr), []);
  assert.deepEqual(preservationFlags('₺100 ödedim', 'Ödedim: ₺100', tr).filter(flag => flag === 'number'), []);
});
test('a capitalised sentence opener that is only a verb form is not a name, and real names still are', () => {
  // The opener is capitalised for its place. Only the negation changes, so only the negation is reported.
  assert.deepEqual(preservationFlags('Anlamiyorum', 'Anliyorum', tr), ['negation']);
  assert.deepEqual(preservationFlags('Anlamıyorum.', 'Anlıyorum.', tr), ['negation']);
  for (const [source, rewrite] of [['Geldim.', 'Geliyorum.'], ['Okuyor.', 'Okudu.'], ['Gidecek.', 'Gitti.'], ['Bilmiş.', 'Biliyor.'], ['Çalışıyorlar.', 'Çalıştılar.'],
    ['Bekliyorum.', 'Bekledim.'], ['Başlıyor.', 'Başladı.'], ['Oynuyor.', 'Oynadı.']]) { // the last three lose their final stem vowel before -ıyor
    assert.deepEqual(preservationFlags(source, rewrite, tr), [], `${source} -> ${rewrite}`);
  }
  assert.ok(turkishVerbForm('Anlıyorum') && turkishVerbForm('Anliyorum') && turkishVerbForm('Gelmedim') && turkishVerbForm('Geldim') && turkishVerbForm('Bekliyorum'));
  for (const noun of ['Bekçi', 'Başlık']) assert.equal(turkishVerbForm(noun), false, noun);
  // Names are not mistaken for verbs, at the start of a sentence or in the middle of one.
  for (const name of ['Ahmet', 'Ankara', 'Ayşe', 'Barış', 'Deniz', 'Kaan', 'Mert', 'Sevgi', 'Yağmur', 'Zeynep']) assert.equal(turkishVerbForm(name), false, name);
  assert.ok(preservationFlags('Ahmet geldi.', 'Ali geldi.', tr).includes('name'));
  assert.ok(preservationFlags('Kaan gelmedi.', 'Mert gelmedi.', tr).includes('name'));
  assert.ok(preservationFlags('Dün Ayşe geldi.', 'Dün Zeynep geldi.', tr).includes('name'));
  assert.ok(preservationFlags('Geldim. Ayşe de geldi.', 'Geldim. Zeynep de geldi.', tr).includes('name'));
});
test('automatic Turkish clarity drops polarity/scope changes and keeps an independent valid edit', () => {
  const source = 'Ben gelmedim. Yardım etmek amacıyla aradım.';
  const edits = candidates(JSON.stringify({suggestions: [suggestion('gelmedim', 'geldim', 'Ben ', '.'),
    suggestion('etmek amacıyla', 'etmek için', 'Yardım ', ' aradım.')]}), source, 'clarity', tr);
  assert.deepEqual(edits.map(edit => edit.after), ['etmek için']);
  for (const [before, after] of pairs) {
    if (before.length < 240 && after.length < 240) assert.deepEqual(candidates(JSON.stringify({suggestions: [suggestion(before, after)]}), before, 'clarity', tr), [], before);
  }
  const shifted = 'Ali geldi, Ayşe gelmedi.';
  assert.deepEqual(candidates(JSON.stringify({suggestions: [suggestion('geldi, Ayşe gelmedi', 'gelmedi, Ayşe geldi', 'Ali ', '.')]}), shifted, 'clarity', tr), []);
  const paired = 'Ne yağmur yağdı, ne kar. Yardım etmek amacıyla aradım.';
  const pairedEdits = candidates(JSON.stringify({suggestions: [
    suggestion('Ne yağmur yağdı, ne kar', 'Yağmur ve kar yağdı', '', '.'),
    suggestion('etmek amacıyla', 'etmek için', 'Yardım ', ' aradım.')]}), paired, 'clarity', tr);
  assert.deepEqual(pairedEdits.map(edit => edit.after), ['etmek için']);
  assert.deepEqual(candidates(JSON.stringify({suggestions: [suggestion('ne ', '', 'yağmur yağdı, ', 'kar.')]}),
    'Ne yağmur yağdı, ne kar.', 'clarity', tr), []);
  // Check the entire source, including when the model changes only a suffix inside the negative verb.
  assert.deepEqual(candidates(JSON.stringify({suggestions: [suggestion('me', '', 'Ben gel', 'dim.')]}), 'Ben gelmedim.', 'clarity', tr), []);
});
test('the language is required; English behavior and Turkish proofreading source matching remain intact', () => {
  for (const settings of [undefined, {}, {variant: 'FR'}, {variant: 'tr'}]) {
    assert.throws(() => preservationFlags('ben gelmedim', 'ben geldim', settings), /INVALID_REQUEST/);
    assert.throws(() => candidates('{"rewrite":"ben geldim"}', 'ben gelmedim', 'improve', settings), /INVALID_REQUEST/);
    assert.throws(() => candidates('{"corrections":[]}', 'ben gelmedim', 'proofread', settings), /INVALID_REQUEST/);
  }
  // Turkish text is recognised as Turkish whatever the English spelling, so the Turkish guard answers; the English guard alone would miss it.
  assert.deepEqual(preservationFlags('ben gelmedim', 'ben geldim', {variant: 'US'}), ['negation']);
  assert.deepEqual(preservationFlags('ben gelmedim', 'ben geldim', {variant: 'US', language: 'en'}), []);
  assert.deepEqual(preservationFlags('I do not agree.', 'I disagree.', {variant: 'US'}), ['negation']);
  assert.deepEqual(preservationFlags('John did not agree.', 'John agreed.', tr), []);
  assert.deepEqual(preservationFlags('Not defterimi getir.', 'Defterimi getir.', tr), []);
  assert.deepEqual(preservationFlags('No: 5 numaralı oda.', '5 numaralı oda.', tr), []);
  const edit = {before: 'Bugun', after: 'Bugün', left: '', right: ' gelmedim.', category: 'spelling', explanation: 'Türkçe karakter.'};
  assert.equal(candidates(JSON.stringify({corrections: [edit]}), 'Bugun gelmedim.', 'proofread', tr)[0].after, 'Bugün');
});
