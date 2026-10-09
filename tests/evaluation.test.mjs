import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sha256, validateCorpus, validateRun, validateLabels, score, reviewTemplates} from '../tools/evaluation/quality.mjs';
import {parseData, readData} from '../tools/evaluation/json.mjs';
import {evaluate, plannedRun, configuration} from '../tools/evaluate-writing.mjs';
import {betaGate, CI_CHECKS, COEXISTENCE_CHECKS, DEVICE_CHECKS} from '../tools/evaluation/beta-gate.mjs';
import {NativeSeatline} from '../extension/lib/native-seatline.mjs';
import {nativePort} from '../tools/evaluation/native-port.mjs';
import {candidates} from '../extension/lib/candidates.mjs';
import {readPackage} from '../tools/evaluation/package.mjs';
import {fakeNative, broker, READY} from './fixtures/extension-api.mjs';
import {LineleafError} from '../extension/lib/policy.mjs';
const corpus = validateCorpus(JSON.parse(await readFile(new URL('../evaluation/writing-corpus.json', import.meta.url), 'utf8')));
const config = {provider: 'codex', model: 'test-model', providerVersion: 'test-cli-1', seatlineRevision: 'd'.repeat(40), engineHash: 'e'.repeat(64), packageHash: 'a'.repeat(64),
  runtime: {platform: 'linux', arch: 'x64', cpu: 'synthetic-test-host', memoryGB: 8}};
const human = {kind: 'human', reviewer: 'test-reviewer', independent: true, reviewedAt: '2026-10-02T00:00:00Z'};
test('package evidence follows the built manifest version and refuses stale or missing archives', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lineleaf-version-'));
  try {
    await mkdir(join(root, 'dist/lineleaf'), {recursive: true});
    const manifest = join(root, 'dist/lineleaf/manifest.json');
    await writeFile(manifest, '{"version":"0.2.0"}'); await writeFile(join(root, 'dist/lineleaf-0.1.0.zip'), 'stale');
    await assert.rejects(readPackage(root));
    await writeFile(join(root, 'dist/lineleaf-0.2.0.zip'), 'current');
    const pack = await readPackage(root); assert.equal(pack.version, '0.2.0'); assert.equal(pack.packageHash, sha256('current'));
    assert.equal(pack.path, join(root, 'dist/lineleaf-0.2.0.zip'));
    await writeFile(manifest, '{"version":"../../stale"}'); await assert.rejects(readPackage(root));
  } finally { await rm(root, {recursive: true, force: true}); }
});
function data() {
  const run = {schema: 1, id: 'test-run', kind: 'live', corpusHash: sha256(corpus), configuration: structuredClone(config), configurationHash: sha256(config), createdAt: '2026-10-02T00:00:00Z', timingBoundary: 'fresh-native-ready-status-send-validation',
    rows: corpus.cases.map(c => ({id: c.id, inputHash: sha256(c.source), status: 'completed', response: JSON.stringify(c.proposal), elapsedMs: 12, code: null}))};
  const templates = reviewTemplates(corpus, run); templates.labels.review = {...human}; templates.judgments.review = {...human};
  templates.labels.cases.forEach(c => { c.decision = 'approved'; });
  templates.acceptance.review = {...human}; templates.acceptance.minimumReferenceRecall = .8;
  for (const row of templates.judgments.cases) { row.meaningPreserved = true; row.suggestions.forEach(x => { x.correct = x.explanationAccurate = true; }); }
  return {run, ...templates}; // In-memory test data, never an attestation of actual human/live results.
}
function reviewed(d) { d.judgments.runHash = sha256(d.run); return score(corpus, d.run, {labels: d.labels, judgments: d.judgments, acceptance: d.acceptance}); }
test('Turkish corpus evaluation, labels, scoring and judgment templates use the case language', async () => {
  const caseOf = (id, source, mode, proposal) => ({id, source, mode, proposal, variant: 'TR', strata: ['negation'], protected: []});
  const tr = validateCorpus({schema: 1, id: 'turkish-fixture', author: 'codex', kind: 'synthetic', cases: [
    caseOf('tr-proofread', 'Bugun gelmedim.', 'proofread', {corrections: [{before: 'Bugun', after: 'Bugün', left: '', right: ' gelmedim.', category: 'spelling', explanation: 'Türkçe karakter.'}]}),
    caseOf('tr-rewrite', 'Ben gelmiyom.', 'improve', {rewrite: 'Ben geliyom.'}),
    caseOf('tr-clarity-unsafe', "Ali'siz geldim.", 'clarity', {suggestions: [{before: "Ali'siz", after: "Ali'yle", left: '', right: ' geldim.', explanation: 'İfade.'}]}),
    caseOf('tr-clarity-safe', 'Bu çalışma acil bir şekilde tamamlanmalı.', 'clarity', {suggestions: [{before: 'acil bir şekilde', after: 'acilen', left: 'çalışma ', right: ' tamamlanmalı.', explanation: 'Kısa ifade.'}]})
  ]});
  assert.throws(() => validateCorpus({...tr, cases: [{...tr.cases[0], variant: 'FR'}]}), /INVALID_EVALUATION_DATA/);
  const {run} = await evaluate(tr, config, {fixture: true});
  assert.ok(run.rows.every(row => row.status === 'completed'));
  const report = score(tr, run); assert.equal(report.completed, 4); assert.deepEqual(report.invalidCaseIds, []);
  assert.equal(report.languages.TR.proofread.emitted, 1); assert.equal(report.languages.TR.clarity.emitted, 1);
  assert.equal(Object.hasOwn(report.languages, 'EN'), false); assert.equal(report.releaseEligible, false);
  const templates = reviewTemplates(tr, run);
  assert.deepEqual(templates.judgments.cases.map(row => row.suggestions.length), [1, 1, 0, 1]);
  templates.labels.review = {...human}; templates.labels.cases.forEach(row => { row.decision = 'approved'; });
  assert.deepEqual(validateLabels(tr, templates.labels).references.get('tr-rewrite')[0].flags, ['negation']);
});
test('English precision cannot mask a failed Turkish precision stratum', () => {
  const tr = {id: 'tr-proofread', source: 'Bugun geldim.', mode: 'proofread', variant: 'TR', strata: ['spelling'], protected: [],
    proposal: {corrections: [{before: 'Bugun', after: 'Bugün', left: '', right: ' geldim.', category: 'spelling', explanation: 'Türkçe karakter.'}]}};
  const mixed = validateCorpus({...structuredClone(corpus), cases: [...structuredClone(corpus.cases), tr]});
  const d = data(); d.run.corpusHash = sha256(mixed);
  d.run.rows.push({id: tr.id, inputHash: sha256(tr.source), status: 'completed', response: JSON.stringify(tr.proposal), elapsedMs: 12, code: null});
  const templates = reviewTemplates(mixed, d.run);
  templates.labels.review = templates.judgments.review = templates.acceptance.review = {...human}; templates.acceptance.minimumReferenceRecall = .8;
  templates.labels.cases.forEach(row => { row.decision = 'approved'; });
  templates.judgments.cases.forEach(row => { row.meaningPreserved = true; row.suggestions.forEach(x => { x.correct = row.id !== tr.id; x.explanationAccurate = true; }); });
  const report = score(mixed, d.run, templates);
  assert.ok(report.metrics.proofread.humanPrecision > .95); assert.equal(report.languages.TR.proofread.humanPrecision, 0);
  assert.equal(report.languages.EN.proofread.humanPrecision, 1); assert.equal(report.releaseEligible, false);
  assert.ok(report.reasons.includes('LANGUAGE_PRECISION_GATE_NOT_MET'));
  templates.judgments.cases.find(row => row.id === tr.id).suggestions[0].correct = true;
  const sparse = score(mixed, d.run, templates);
  assert.equal(sparse.languages.TR.proofread.humanPrecision, 1); assert.equal(sparse.releaseEligible, false);
  assert.ok(sparse.reasons.includes('LANGUAGE_COVERAGE_INCOMPLETE'));
});
test('corpus covers paragraph/multi-edit/variant/boundary inputs and distinct genuinely shorter rewrites', () => {
  const proof = corpus.cases.filter(c => c.mode === 'proofread');
  assert.equal(proof.length, 326);
  const lengths = proof.map(c => c.source.length).sort((a,b) => a-b); assert.ok(lengths[Math.floor(lengths.length / 2)] >= 200);
  assert.ok(proof.filter(c => c.proposal.corrections.length > 1).length >= 30);
  assert.ok(proof.filter(c => c.source.length >= 1800).length >= 4);
  for (let n=1;n<=6;n++) {
    const rows = proof.filter(c => c.id.startsWith(`variant-${String(n).padStart(3,'0')}`));
    assert.equal(rows.length,2); assert.equal(rows[0].source,rows[1].source);
    assert.equal(rows.find(c=>c.variant==='US').proposal.corrections.length,0);
    assert.equal(rows.find(c=>c.variant==='UK').proposal.corrections.length,1);
  }
  const rewrites = corpus.cases.filter(c => !['proofread', 'clarity'].includes(c.mode)); assert.equal(new Set(rewrites.map(c => c.source)).size,36);
  assert.ok(rewrites.filter(c => c.mode === 'shorter').every(c => c.proposal.rewrite.length < c.source.length));
  assert.deepEqual([...new Set(corpus.cases.filter(c => c.mode !== 'proofread').map(c => c.mode))].sort(), ['clarity', 'clearer', 'formal', 'friendly', 'improve', 'paraphrase', 'shorter']);
  assert.equal(new Set(corpus.cases.map(c => c.id)).size, 380);
  const d = data(), templates = reviewTemplates(corpus, d.run);
  assert.equal(templates.labels.review.kind, 'pending'); assert.equal(templates.judgments.cases[0].suggestions[0].correct, null);
  assert.throws(() => score(corpus, d.run, {labels: templates.labels}));
});
test('quality separates precision, exact-reference recall, style, explanations and latency provenance', () => {
  const s = reviewed(data()); assert.equal(s.releaseEligible, true);
  assert.equal(s.metrics.proofread.humanPrecision, 1); assert.equal(s.metrics.proofread.referenceRecall, 1);
  assert.equal(s.metrics.style.cases, 36); assert.equal(s.metrics.style.humanApproved, 36);
  assert.equal(s.latency.kind, 'live'); assert.equal(s.latency.completionP95Ms, 12);
  assert.equal(s.latency.boundary,'fresh-native-ready-status-send-validation'); assert.equal(s.latency.includesBrowserUI,false);
});
test('empty corrections cannot pass by hiding every error even with a human review marker', () => {
  const d = data();
  for (const c of corpus.cases.filter(c => c.mode === 'proofread')) {
    d.run.rows.find(r => r.id === c.id).response = '{"corrections":[]}'; d.judgments.cases.find(r => r.id === c.id).suggestions = [];
  }
  const s = reviewed(d); assert.equal(s.releaseEligible, false); assert.equal(s.metrics.proofread.humanPrecision, null);
  assert.ok(s.reasons.includes('NO_VERIFIED_ERROR_DETECTION')); assert.equal(s.metrics.proofread.referenceRecall, 0);
});
for (const missing of ['formal', 'improve', 'paraphrase']) test(`a fully reviewed run still needs every advertised rewrite mode (${missing})`, () => {
  const reduced = structuredClone(corpus); reduced.cases = reduced.cases.filter(c => c.mode !== missing);
  const d = data(), ids = new Set(reduced.cases.map(c => c.id));
  d.run.corpusHash = d.labels.corpusHash = d.acceptance.corpusHash = sha256(reduced);
  d.run.rows = d.run.rows.filter(r => ids.has(r.id)); d.labels.cases = d.labels.cases.filter(r => ids.has(r.id));
  d.judgments.cases = d.judgments.cases.filter(r => ids.has(r.id)); d.judgments.runHash = sha256(d.run);
  const s = score(reduced, d.run, {labels: d.labels, judgments: d.judgments, acceptance: d.acceptance});
  assert.equal(s.releaseEligible, false); assert.ok(s.reasons.includes('REWRITE_REVIEW_GATE_NOT_MET'));
});
test('human false positives trigger the 95 percent precision gate while recall remains separately visible', () => {
  const d = data();
  for (const c of corpus.cases.filter(c => c.id.startsWith('already_correct-'))) {
    d.run.rows.find(r => r.id === c.id).response = JSON.stringify({corrections: [{before: c.source, after: 'Unnecessary replacement.', left: '', right: '', category: 'grammar', explanation: 'Synthetic false positive.'}]});
    d.judgments.cases.find(r => r.id === c.id).suggestions = [{correct: false, explanationAccurate: true}];
  }
  const s = reviewed(d); assert.ok(s.metrics.proofread.humanPrecision < .95); assert.equal(s.metrics.proofread.falsePositives, 20);
  assert.equal(s.metrics.proofread.referenceRecall, 1); assert.ok(s.reasons.includes('PRECISION_GATE_NOT_MET'));
});
test('protected facts and human meaning/explanation judgments independently fail quality acceptance', () => {
  for (const kind of ['facts', 'meaning', 'explanation']) {
    const d = data(), row = d.run.rows.find(r => r.id === 'clearer-001'), j = d.judgments.cases.find(r => r.id === row.id);
    if (kind === 'facts') row.response = JSON.stringify({rewrite: JSON.parse(row.response).rewrite.replace('$1,250', '$2,500')});
    if (kind === 'meaning') j.meaningPreserved = false;
    if (kind === 'explanation') d.judgments.cases[0].suggestions[0].explanationAccurate = false;
    const s = reviewed(d); assert.equal(s.releaseEligible, false); assert.ok(s.reasons.includes(kind === 'explanation' ? 'EXPLANATION_REVIEW_GATE_NOT_MET' : 'MEANING_PRESERVATION_GATE_NOT_MET'));
  }
});
test('stale hashes, duplicate IDs, incomplete judgments and non-independent reviewers are refused', () => {
  for (const mutate of [d => { d.labels.corpusHash = 'f'.repeat(64); }, d => { d.run.rows[1].id = d.run.rows[0].id; },
    d => { d.judgments.runHash = 'f'.repeat(64); }, d => { d.judgments.cases[0].suggestions = []; },
    d => { d.labels.review.independent = false; }, d => { d.labels.review.reviewer = corpus.author; }]) {
    const d = data(); mutate(d); assert.throws(() => score(corpus, d.run, {labels: d.labels, judgments: d.judgments}));
  }
});
test('fixture identity stays ineligible and cannot be relabeled live without a real configuration', () => {
  const d = data(); d.run.kind = 'fixture'; assert.ok(reviewed(d).reasons.includes('FIXTURE_NOT_QUALITY_EVIDENCE'));
  d.run.kind = 'live'; d.run.configuration.providerVersion = 'fixture'; d.run.configurationHash = sha256(d.run.configuration);
  assert.throws(() => reviewed(d));
});
test('malformed Unicode/overlaps/ambiguous model corrections fail through the production validator', () => {
  const d = data(); d.run.rows[0].response = '{"corrections":[],"corrections":[]}';
  const s = score(corpus, d.run); assert.deepEqual(s.invalidCaseIds, [d.run.rows[0].id]); assert.equal(s.releaseEligible, false);
  const bad = structuredClone(corpus); bad.cases[0].source = '\ud800'; assert.throws(() => validateCorpus(bad));
});
test('runner records malformed answers, continues every remaining case with fresh connections and no retry/tools/continuation', async () => {
  const calls = []; let opened=0, closed=0;
  const connectionFactory=()=>{ const c=corpus.cases[opened++]; return {async request(method, turn) {
    calls.push({method,turn}); if(method==='readiness') return {availability:'available',authentication:'authenticated',sign_in:'subscription',capabilities:{tool_isolation:true,reasoning_effort:true,service_tier:true}};
    return c.id===corpus.cases[3].id ? '```json\n{"corrections":[]}\n```' : JSON.stringify(c.proposal);
  },close(){closed++;}}; };
  const {run} = await evaluate(corpus, config, {connectionFactory}); assert.equal(run.rows.length,380); assert.equal(run.rows[3].code,'INVALID_OUTPUT');
  assert.equal(opened,380); assert.equal(closed,380); assert.equal(calls.filter(c=>c.method==='send_ready_with_policy').length,380);
  const protectedSend = calls.find(c => c.method === 'send_ready_with_policy');
  assert.deepEqual(protectedSend.turn.allowed_sign_in, ['subscription']);
  const send = protectedSend.turn.turn;
  assert.equal(send.tools, 'none'); assert.equal(send.session, 'ephemeral'); assert.equal(send.continuation, null);
  assert.match(send.system, /Preserve facts, names, numbers, dates, negation/); assert.equal(JSON.parse(send.messages[0].text).text, corpus.cases[0].source);
});
test('one human-approved detection fails both quality and beta gates despite perfect emitted precision', async () => {
  const d=data(); let kept=false;
  for (const c of corpus.cases.filter(c=>c.mode==='proofread')) {
    if(!kept && c.proposal.corrections.length) { d.run.rows.find(r=>r.id===c.id).response=JSON.stringify({corrections:[c.proposal.corrections[0]]}); d.judgments.cases.find(r=>r.id===c.id).suggestions=[{correct:true,explanationAccurate:true}]; kept=true; }
    else { d.run.rows.find(r=>r.id===c.id).response='{"corrections":[]}'; d.judgments.cases.find(r=>r.id===c.id).suggestions=[]; }
  }
  const s=reviewed(d); assert.equal(s.metrics.proofread.humanPrecision,1); assert.ok(s.metrics.proofread.referenceRecall<.02);
  assert.ok(s.reasons.includes('RECALL_GATE_NOT_MET')); assert.equal(s.releaseEligible,false);
  assert.equal((await gate(d,acceptedEvidence(d))).releaseReady,false);
  const complete=data(); assert.ok(score(corpus,complete.run,{labels:complete.labels,judgments:complete.judgments}).reasons.includes('APPROVED_RECALL_FLOOR_REQUIRED'));
  for (const mutate of [p=>{p.review.independent=false;},p=>{p.review.reviewedAt='2026-10-03T00:00:00Z';},p=>{p.minimumReferenceRecall=null;},p=>{p.minimumReferenceRecall=0;},p=>{p.configurationHash='f'.repeat(64);},p=>{p.corpusHash='f'.repeat(64);}]) {
    const bad=data(); mutate(bad.acceptance); assert.throws(()=>reviewed(bad));
  }
});
test('policy preparation records no provider responses and cannot qualify as live evidence', () => {
  const run=plannedRun(corpus,config), report=score(corpus,run), templates=reviewTemplates(corpus,run);
  assert.equal(run.kind,'planned'); assert.deepEqual(run.rows,[]); assert.equal(report.releaseEligible,false);
  assert.ok(report.reasons.includes('PLANNED_NOT_QUALITY_EVIDENCE')); assert.equal(templates.acceptance.minimumReferenceRecall,null);
  assert.equal(templates.acceptance.configurationHash,sha256(config));
});
test('review headers alone cannot approve labels; corrected/rejected decisions require consistent references', () => {
  const d=data(), templates=reviewTemplates(corpus,d.run); templates.labels.review={...human};
  assert.throws(()=>score(corpus,d.run,{labels:templates.labels}));
  d.labels.cases[0].decision='corrected'; assert.throws(()=>reviewed(d));
  d.labels.cases[0].reference.corrections[0].explanation='An independently corrected test explanation.'; assert.equal(reviewed(d).releaseEligible,true);
  d.labels.cases[0].decision='approved'; assert.throws(()=>reviewed(d));
  d.labels.cases[0].decision='rejected'; d.labels.cases[0].reference=null;
  const s=reviewed(d); assert.equal(s.releaseEligible,false); assert.ok(s.reasons.includes('LABEL_CASE_REJECTED'));
});
test('invalid and partial runs with reviews report outcome rates and missing cases without treating unavailable output as reviewed', () => {
  for (const kind of ['invalid','partial']) {
    const d=data(); if(kind==='invalid') Object.assign(d.run.rows[3],{status:'failed',code:'INVALID_OUTPUT',response:'not JSON'}); else d.run.rows=d.run.rows.slice(0,4);
    d.judgments=reviewTemplates(corpus,d.run).judgments; d.judgments.review={...human};
    for (const row of d.judgments.cases) if(d.run.rows.some(r=>r.id===row.id && r.status==='completed')) { row.meaningPreserved=true; row.suggestions.forEach(x=>{x.correct=x.explanationAccurate=true;}); }
    const s=reviewed(d); assert.equal(s.releaseEligible,false); assert.ok(s.reasons.includes('INCOMPLETE_OR_INVALID_RESPONSES'));
    assert.equal(s.invalidOutputRate,kind==='invalid'?1/380:0); assert.equal(s.missingCaseIds.length,kind==='partial'?376:0);
    if(kind==='invalid') assert.deepEqual(s.invalidCaseIds,[d.run.rows[3].id]);
  }
});
test('readiness, timeout, provider limits and transport failures stop rather than retry or exhaust the corpus', async () => {
  for(const code of ['PROVIDER_TIMEOUT','PROVIDER_RATE_LIMITED','QUEUE_FULL','NATIVE_UNAVAILABLE','PROTOCOL_ERROR','LOGIN_REQUIRED','SUBSCRIPTION_REQUIRED','TOOL_ISOLATION_UNAVAILABLE']) {
    let opened=0,closed=0,sends=0;
    const connectionFactory=()=>{opened++;return{async request(method){ if(method==='readiness') return{availability:'available',authentication:code==='LOGIN_REQUIRED'?'unauthenticated':'authenticated',sign_in:code==='SUBSCRIPTION_REQUIRED'?'api_key':'subscription',capabilities:{tool_isolation:code!=='TOOL_ISOLATION_UNAVAILABLE',reasoning_effort:true,service_tier:true}};
      if(method==='send_ready_with_policy') sends++; throw new LineleafError(code);},close(){closed++;}};};
    const {run}=await evaluate(corpus,config,{connectionFactory}); assert.equal(run.rows.length,1); assert.equal(opened,1); assert.equal(closed,1); assert.ok(sends<=1);
    assert.equal(run.rows[0].code,code);
  }
});
test('shorter output length and paragraph coverage are quality gates, while overlaps remain production-invalid', () => {
  const d=data(), row=d.run.rows.find(r=>r.id==='shorter-001'); row.response=JSON.stringify({rewrite:corpus.cases.find(c=>c.id===row.id).source+' Please.'});
  assert.ok(reviewed(d).reasons.includes('SHORTER_REWRITE_LENGTH_GATE_NOT_MET'));
  const bad=structuredClone(corpus); bad.cases.find(c=>c.id==='shorter-001').proposal={rewrite:bad.cases.find(c=>c.id==='shorter-001').source}; assert.throws(()=>validateCorpus(bad));
  const overlapping=data(), c=corpus.cases.find(c=>c.id==='paragraph-001-multi');
  const one=c.proposal.corrections[0]; overlapping.run.rows.find(r=>r.id===c.id).response=JSON.stringify({corrections:[one,one]});
  assert.ok(score(corpus,overlapping.run).invalidCaseIds.includes(c.id));
  const reduced=structuredClone(corpus); reduced.cases=reduced.cases.filter(c=>!c.strata.includes('paragraph'));
  const run={...data().run,corpusHash:sha256(reduced),rows:data().run.rows.filter(r=>reduced.cases.some(c=>c.id===r.id))};
  assert.ok(score(reduced,run).reasons.includes('CORPUS_COVERAGE_INCOMPLETE'));
});
test('bounded evaluation JSON rejects duplicate review fields, malformed numbers and excessive nesting', async () => {
  for (const text of ['{"human":false,"human":true}', '{"x":NaN}', '['.repeat(22) + '0' + ']'.repeat(22), '"\ud800']) assert.throws(() => parseData(text));
  assert.equal(parseData('{"x":"Zoë 👩🏽‍💻"}').x, 'Zoë 👩🏽‍💻');
  const directory = await mkdtemp(join(tmpdir(), 'lineleaf-evidence-'));
  try { const file = join(directory, 'oversized.json'); await writeFile(file, ' '.repeat(8 * 1048576 + 1)); await assert.rejects(readData(file)); }
  finally { await rm(directory, {recursive: true, force: true}); }
});
test('Node investigation port transports the real framed fixture through production NativeSeatline', async () => {
  const native = new NativeSeatline(() => nativePort('python3', [new URL('./fixtures/companion.py', import.meta.url).pathname]));
  try {
    assert.equal((await native.request('status')).sign_in, 'subscription');
    const response = await native.request('send', {system: null, messages: [{role: 'user', text: JSON.stringify({text: 'Zoë: He go to work.'})}], model: null, tools: 'none', session: 'ephemeral', continuation: null, cleanup_group: null, check_sign_in: true});
    assert.equal(candidates(response, 'Zoë: He go to work.', 'proofread', {variant: 'US'}).length, 1);
  } finally { native.close(); }
});
function acceptedEvidence(d) {
  const checks = keys => Object.fromEntries(keys.map(k => [k, true]));
  return {schema: 1, packageHash: config.packageHash, engineHash: config.engineHash, seatlineRevision: config.seatlineRevision,
    quality: [{responses: 'responses', labels: 'labels', judgments: 'judgments', acceptance:'acceptance'}],
    regression: {kind: 'installed-ci', packageHash: config.packageHash, engineHash: config.engineHash, commit: 'c'.repeat(40), run: 'https://github.com/davletovb/Lineleaf/actions/runs/1',
      platforms: checks(['linux', 'macos']), checks: checks(CI_CHECKS), review: human},
    coexistence: {kind: 'live', packageHash: config.packageHash, seatlineRevision: config.seatlineRevision, consumers: 2, checks: checks(COEXISTENCE_CHECKS), review: human},
    latency: {kind: 'live', packageHash: config.packageHash, configurations: [{configurationHash: d.run.configurationHash, samples: 30, coldWarmDocumented: true,
      completionP95Ms: 200, approvedLimitMs: 300, typingOverheadP95Ms: 2, typingApprovedLimitMs: 5}], review: human},
    devices: [{platform: 'chrome-macos', browser: 'Chrome', browserVersion: '151.0.1.2', osVersion: 'test-os', packageHash: config.packageHash, checks: checks(DEVICE_CHECKS), review: human}],
    editors: {packageHash: config.packageHash, surfaces: {gmail: 'verified-copy-fallback', github: 'verified-replacement', linkedin: 'verified-copy-fallback', slack: 'verified-copy-fallback'}, review: human}};
}
async function gate(d, evidence) {
  const files = {responses: d.run, labels: d.labels, judgments: d.judgments, acceptance:d.acceptance};
  return betaGate(corpus, config, evidence, {read: async path => files[path.split('/').at(-1)]});
}
test('beta gate recomputes quality and requires all exact-package live/device evidence', async () => {
  const d = data(), e = acceptedEvidence(d), result = await gate(d, e);
  assert.equal(result.releaseReady, true); assert.deepEqual(result.advertisedPlatforms, ['chrome-macos']);
  assert.equal((await betaGate(corpus, config, null)).releaseReady, false);
  for (const mutate of [e => { e.packageHash = 'f'.repeat(64); }, e => { e.coexistence.kind = 'native-coexistence-fixture'; },
    e => { e.devices[0].checks.uninstall = null; }, e => { e.devices[0].browser = 'Chromium'; }, e => { e.latency.configurations[0].samples = 29; },
    e => { e.regression.checks.privacy = false; }, e => { e.editors.surfaces.github = 'pending'; }]) {
    const value = structuredClone(e); mutate(value); const result = await gate(d, value); assert.equal(result.releaseReady, false); assert.deepEqual(result.advertisedPlatforms, []);
  }
  d.run.rows.pop(); d.judgments.runHash = sha256(d.run); assert.equal((await gate(d, e)).releaseReady, false);
});

// F-02: clearer-wording suggestions are measured on their own cases, never folded into proofreading precision or recall.
test('clearer-wording suggestions are scored apart from corrections and from rewrites', () => {
  const clarityCases = corpus.cases.filter(c => c.mode === 'clarity');
  assert.equal(clarityCases.length, 18); assert.ok(clarityCases.filter(c => c.proposal.suggestions.length === 0).length >= 4); // already-clear, informal, ambiguous and negation traps
  assert.ok(clarityCases.some(c => c.strata.includes('negation')) && clarityCases.some(c => c.strata.includes('facts')));
  const s = reviewed(data());
  assert.equal(s.releaseEligible, true); assert.equal(s.coverage.clarity, 18);
  assert.equal(s.metrics.clarity.cases, 18); assert.equal(s.metrics.clarity.emitted, 18); assert.equal(s.metrics.clarity.humanPrecision, 1); assert.equal(s.metrics.clarity.referenceRecall, 1);
  assert.equal(s.metrics.proofread.cases, 326); assert.equal(s.metrics.style.cases, 36); // unchanged by the new mode
  assert.equal(Object.values(s.strata).reduce((n, x) => n + x.cases, 0), corpus.cases.filter(c => c.mode !== 'clarity').reduce((n, c) => n + c.strata.length, 0)); // no clearer-wording case enters the proofreading strata
});
test('human false positives among clearer-wording suggestions fail their own gate and leave the proofreading gate alone', () => {
  const d = data(); d.judgments.cases.find(r => r.id === 'clarity-004').suggestions[1].correct = false;
  const s = reviewed(d);
  assert.ok(s.reasons.includes('CLARITY_PRECISION_GATE_NOT_MET')); assert.ok(!s.reasons.includes('PRECISION_GATE_NOT_MET'));
  assert.equal(s.metrics.clarity.falsePositives, 1); assert.equal(s.metrics.clarity.humanPrecision, 17 / 18); assert.equal(s.metrics.proofread.humanPrecision, 1); assert.equal(s.releaseEligible, false);
});
test('offering no clearer wording at all cannot pass, and too few clearer-wording cases is incomplete coverage', () => {
  const d = data();
  for (const c of corpus.cases.filter(c => c.mode === 'clarity')) { d.run.rows.find(r => r.id === c.id).response = '{"suggestions":[]}'; d.judgments.cases.find(r => r.id === c.id).suggestions = []; }
  const s = reviewed(d); assert.equal(s.metrics.clarity.humanPrecision, null); assert.ok(s.reasons.includes('CLARITY_PRECISION_GATE_NOT_MET')); assert.equal(s.metrics.clarity.referenceRecall, 0);
  const reduced = structuredClone(corpus); reduced.cases = reduced.cases.filter(c => c.mode !== 'clarity');
  const run = {...data().run, corpusHash: sha256(reduced), rows: data().run.rows.filter(r => reduced.cases.some(c => c.id === r.id))};
  assert.ok(score(reduced, run).reasons.includes('CORPUS_COVERAGE_INCOMPLETE'));
});
test('a clearer-wording answer outside the contract is an invalid output, and a suggestion that changes a number is not emitted', () => {
  const d = data(); d.run.rows.find(r => r.id === 'clarity-001').response = '{"corrections":[]}';
  const s = score(corpus, d.run); assert.deepEqual(s.invalidCaseIds, ['clarity-001']);
  const changesNumber = data(); changesNumber.run.rows.find(r => r.id === 'clarity-006').response = JSON.stringify({suggestions: [{before: '80 percent', after: '90 percent', left: 'total of ', right: ' of the work', explanation: 'x'}]});
  assert.deepEqual(candidates(changesNumber.run.rows.find(r => r.id === 'clarity-006').response, corpus.cases.find(c => c.id === 'clarity-006').source, 'clarity', {variant: 'US'}), []);
});

test('evaluation accepts a fixed effort for the whole run and preserves provider default omission', async () => {
  for (const effort of ['', 'low', 'medium', 'max']) {
    const settings = {...config, effort};
    assert.equal(settings.effort, effort);
    const turns = [];
    const {run} = await evaluate(corpus, settings, {fixture: true, connectionFactory: () => {
      const c = corpus.cases[turns.length];
      return {async request(method, turn) {
        if (method === 'readiness') return {availability: 'available', authentication: 'authenticated', sign_in: 'subscription', capabilities: {tool_isolation: true, reasoning_effort: true, service_tier: true}};
        turns.push(turn.turn); return JSON.stringify(c.proposal);
      }, close() {}};
    }});
    assert.equal(run.rows.length, corpus.cases.length);
    for (const turn of turns) {
      if (effort) assert.equal(turn.reasoning_effort, effort);
      else assert.equal(Object.hasOwn(turn, 'reasoning_effort'), false);
    }
    assert.equal(run.configuration.effort, effort);
    assert.equal(run.configurationHash, sha256(run.configuration));
  }
  await assert.rejects(configuration({fixture: true, effort: 'unexpected'}), /INVALID_EFFORT/);
});
test('evaluation evidence hashes explicit effort and keeps historical configurations readable', () => {
  const {run} = data();
  validateRun(corpus, run);
  run.configuration.effort = 'low'; run.configurationHash = sha256(run.configuration);
  validateRun(corpus, run);
  run.configuration.effort = 'medium';
  assert.throws(() => validateRun(corpus, run));
  run.configurationHash = sha256(run.configuration); validateRun(corpus, run);
  run.configuration.effort = 'unknown'; run.configurationHash = sha256(run.configuration);
  assert.throws(() => validateRun(corpus, run));
});
test('evaluation fixes speed for the whole run and binds it to the evidence hash', async () => {
  for (const speed of ['', 'standard', 'fast']) {
    const settings = {...config, model: 'gpt-6-luna', effort: 'xhigh', speed}, turns = [];
    const {run} = await evaluate(corpus, settings, {fixture: true, connectionFactory: () => {
      const c = corpus.cases[turns.length];
      return {async request(method, turn) {
        if (method === 'readiness') return {availability: 'available', authentication: 'authenticated', sign_in: 'subscription', capabilities: {tool_isolation: true, reasoning_effort: true, ...(speed ? {service_tier: true} : {})}};
        turns.push(turn.turn); return JSON.stringify(c.proposal);
      }, close() {}};
    }});
    assert.equal(turns.length, corpus.cases.length);
    for (const turn of turns) {
      if (speed) assert.equal(turn.service_tier, speed);
      else assert.equal(Object.hasOwn(turn, 'service_tier'), false);
      assert.equal(turn.reasoning_effort, 'xhigh');
    }
    assert.equal(run.configuration.speed, speed); validateRun(corpus, run);
    run.configuration.speed = speed === 'fast' ? 'standard' : 'fast';
    assert.throws(() => validateRun(corpus, run));
    run.configurationHash = sha256(run.configuration); validateRun(corpus, run);
    run.configuration.speed = 'priority'; run.configurationHash = sha256(run.configuration);
    assert.throws(() => validateRun(corpus, run));
  }
  await assert.rejects(configuration({fixture: true, speed: 'unexpected'}), /INVALID_SPEED/);
});
test('evaluation stops before a writing send when the companion lacks service-tier support', async () => {
  let sends = 0;
  const {run, readiness} = await evaluate(corpus, {...config, effort: 'xhigh', speed: 'fast'}, {fixture: true, connectionFactory: () => ({
    async request(method) {
      if (method === 'readiness') return {availability: 'available', authentication: 'authenticated', sign_in: 'subscription', capabilities: {tool_isolation: true, reasoning_effort: true}};
      sends++; return 'unreachable';
    }, close() {}
  })});
  assert.equal(sends, 0); assert.equal(readiness, 'COMPANION_UPDATE_REQUIRED'); assert.equal(run.rows.length, 1);
});
test('evaluation records and hashes each provider and cloud policy, without Codex-only settings leaking', async () => {
  for (const provider of ['codex', 'claude', 'gemini', 'grok']) {
    const cfg = {...config, provider, effort: provider === 'codex' ? 'low' : '', speed: '', allowCloud: provider === 'gemini'};
    const {run} = await evaluate(corpus, cfg, {fixture: true});
    assert.equal(run.rows.length, corpus.cases.length); assert.ok(run.rows.every(row => row.status === 'completed'));
    assert.equal(score(corpus, run).configuration.provider, provider);
    const altered = structuredClone(run); altered.configuration.provider = provider === 'codex' ? 'claude' : 'codex';
    assert.throws(() => score(corpus, altered));
    if (provider !== 'codex') assert.equal(cfg.effort, '');
  }
  const blocked = await evaluate(corpus, {...config, provider: 'gemini', effort: '', speed: '', allowCloud: false}, {fixture: true});
  assert.equal(blocked.readiness, 'CLOUD_SIGN_IN_REQUIRED'); assert.equal(blocked.run.rows.length, 1);
  for (const cfg of [{provider: 'unknown'}, {provider: 'claude', effort: 'low'}, {provider: 'grok', speed: 'fast'}, {provider: 'codex', allowCloud: true}])
    await assert.rejects(configuration({...cfg, fixture: true}));
});

test('provider evaluation uses protected policy and refuses a changed cloud sign-in before output', async () => {
  let calls = [];
  const cfg = {...config, provider: 'gemini', effort: '', speed: '', allowCloud: true};
  const result = await evaluate(corpus, cfg, {fixture: true, connectionFactory: () => new NativeSeatline(() => fakeNative((m, p) => {
    calls.push(m);
    broker(m, p, {state: {...READY, sign_in: m.method === 'readiness' ? 'cloud' : 'api_key'}});
  }))});
  assert.equal(result.run.rows[0].code, 'CLOUD_ROUTE_UNAVAILABLE'); assert.equal(result.run.rows[0].response, '');
  assert.ok(calls.every(call => call.provider === 'gemini'));
  assert.deepEqual(calls.find(call => call.method === 'send_ready_with_policy').params.allowed_sign_in, ['cloud']);
  assert.equal(calls.some(call => call.method === 'send'), false);
});
