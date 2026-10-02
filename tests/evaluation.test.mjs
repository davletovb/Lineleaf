import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sha256, validateCorpus, score, reviewTemplates} from '../tools/evaluation/quality.mjs';
import {parseData, readData} from '../tools/evaluation/json.mjs';
import {evaluate} from '../tools/evaluate-writing.mjs';
import {betaGate, CI_CHECKS, COEXISTENCE_CHECKS, DEVICE_CHECKS} from '../tools/evaluation/beta-gate.mjs';
import {NativeSeatline} from '../extension/lib/native-seatline.mjs';
import {nativePort} from '../tools/evaluation/native-port.mjs';
import {candidates} from '../extension/lib/candidates.mjs';
import {readPackage} from '../tools/evaluation/package.mjs';
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
  const run = {schema: 1, id: 'test-run', kind: 'live', corpusHash: sha256(corpus), configuration: structuredClone(config), configurationHash: sha256(config), createdAt: '2026-10-02T00:00:00Z',
    rows: corpus.cases.map(c => ({id: c.id, inputHash: sha256(c.source), status: 'completed', response: JSON.stringify(c.proposal), elapsedMs: 12, code: null}))};
  const templates = reviewTemplates(corpus, run); templates.labels.review = {...human}; templates.judgments.review = {...human};
  for (const row of templates.judgments.cases) { row.meaningPreserved = true; row.suggestions.forEach(x => { x.correct = x.explanationAccurate = true; }); }
  return {run, ...templates}; // In-memory test data, never an attestation of actual human/live results.
}
function reviewed(d) { d.judgments.runHash = sha256(d.run); return score(corpus, d.run, {labels: d.labels, judgments: d.judgments}); }
test('corpus has 150 distinct proofreading cases, four rewrite modes and pending independent review', () => {
  assert.equal(corpus.cases.filter(c => c.mode === 'proofread').length, 150);
  assert.deepEqual([...new Set(corpus.cases.filter(c => c.mode !== 'proofread').map(c => c.mode))].sort(), ['clearer', 'formal', 'friendly', 'shorter']);
  assert.equal(new Set(corpus.cases.map(c => c.id)).size, 174);
  const d = data(), templates = reviewTemplates(corpus, d.run);
  assert.equal(templates.labels.review.kind, 'pending'); assert.equal(templates.judgments.cases[0].suggestions[0].correct, null);
  assert.throws(() => score(corpus, d.run, {labels: templates.labels}));
});
test('quality separates precision, exact-reference recall, style, explanations and latency provenance', () => {
  const s = reviewed(data()); assert.equal(s.releaseEligible, true);
  assert.equal(s.metrics.proofread.humanPrecision, 1); assert.equal(s.metrics.proofread.referenceRecall, 1);
  assert.equal(s.metrics.style.cases, 24); assert.equal(s.metrics.style.humanApproved, 24);
  assert.equal(s.latency.kind, 'live'); assert.equal(s.latency.completionP95Ms, 12);
});
test('empty corrections cannot pass by hiding every error even with a human review marker', () => {
  const d = data();
  for (const c of corpus.cases.filter(c => c.mode === 'proofread')) {
    d.run.rows.find(r => r.id === c.id).response = '{"corrections":[]}'; d.judgments.cases.find(r => r.id === c.id).suggestions = [];
  }
  const s = reviewed(d); assert.equal(s.releaseEligible, false); assert.equal(s.metrics.proofread.humanPrecision, null);
  assert.ok(s.reasons.includes('NO_VERIFIED_ERROR_DETECTION')); assert.equal(s.metrics.proofread.referenceRecall, 0);
});
test('a fully reviewed run still needs every advertised rewrite mode', () => {
  const reduced = structuredClone(corpus); reduced.cases = reduced.cases.filter(c => c.mode !== 'formal');
  const d = data(), ids = new Set(reduced.cases.map(c => c.id));
  d.run.corpusHash = d.labels.corpusHash = sha256(reduced);
  d.run.rows = d.run.rows.filter(r => ids.has(r.id)); d.labels.cases = d.labels.cases.filter(r => ids.has(r.id));
  d.judgments.cases = d.judgments.cases.filter(r => ids.has(r.id)); d.judgments.runHash = sha256(d.run);
  const s = score(reduced, d.run, {labels: d.labels, judgments: d.judgments});
  assert.equal(s.releaseEligible, false); assert.ok(s.reasons.includes('REWRITE_REVIEW_GATE_NOT_MET'));
});
test('human false positives trigger the 95 percent precision gate while recall remains separately visible', () => {
  const d = data();
  for (const c of corpus.cases.filter(c => c.id.startsWith('already_correct-')).slice(0, 10)) {
    d.run.rows.find(r => r.id === c.id).response = JSON.stringify({corrections: [{before: c.source, after: 'Unnecessary replacement.', left: '', right: '', category: 'grammar', explanation: 'Synthetic false positive.'}]});
    d.judgments.cases.find(r => r.id === c.id).suggestions = [{correct: false, explanationAccurate: true}];
  }
  const s = reviewed(d); assert.ok(s.metrics.proofread.humanPrecision < .95); assert.equal(s.metrics.proofread.falsePositives, 10);
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
test('runner uses production turns, has no continuation/tools, stops after failure and reflects only fixed codes', async () => {
  const calls = []; let closed = false;
  const connection = {async request(method, turn) { calls.push({method, turn}); if (method === 'status') return {availability: 'available', authentication: 'authenticated', sign_in: 'subscription', capabilities: {tool_isolation: true}};
    return '{"corrections":[],"corrections":[]}'; }, close() { closed = true; }};
  const {run} = await evaluate(corpus, config, {connection}); assert.equal(run.rows.length, 1); assert.equal(run.rows[0].code, 'INVALID_OUTPUT');
  assert.equal(closed, true); const send = calls.find(c => c.method === 'send').turn;
  assert.equal(send.tools, 'none'); assert.equal(send.session, 'ephemeral'); assert.equal(send.continuation, null);
  assert.match(send.system, /Preserve facts, names, numbers, dates, negation/); assert.equal(JSON.parse(send.messages[0].text).text, corpus.cases[0].source);
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
    assert.equal(candidates(response, 'Zoë: He go to work.', 'proofread').length, 1);
  } finally { native.close(); }
});
function acceptedEvidence(d) {
  const checks = keys => Object.fromEntries(keys.map(k => [k, true]));
  return {schema: 1, packageHash: config.packageHash, engineHash: config.engineHash, seatlineRevision: config.seatlineRevision,
    quality: [{responses: 'responses', labels: 'labels', judgments: 'judgments'}],
    regression: {kind: 'installed-ci', packageHash: config.packageHash, engineHash: config.engineHash, commit: 'c'.repeat(40), run: 'https://github.com/davletovb/Lineleaf/actions/runs/1',
      platforms: checks(['linux', 'macos']), checks: checks(CI_CHECKS), review: human},
    coexistence: {kind: 'live', packageHash: config.packageHash, seatlineRevision: config.seatlineRevision, consumers: 2, checks: checks(COEXISTENCE_CHECKS), review: human},
    latency: {kind: 'live', packageHash: config.packageHash, configurations: [{configurationHash: d.run.configurationHash, samples: 30, coldWarmDocumented: true,
      completionP95Ms: 200, approvedLimitMs: 300, typingOverheadP95Ms: 2, typingApprovedLimitMs: 5}], review: human},
    devices: [{platform: 'chrome-macos', browser: 'Chrome', browserVersion: '151.0.1.2', osVersion: 'test-os', packageHash: config.packageHash, checks: checks(DEVICE_CHECKS), review: human}],
    editors: {packageHash: config.packageHash, surfaces: {gmail: 'verified-copy-fallback', github: 'verified-replacement', linkedin: 'verified-copy-fallback', slack: 'verified-copy-fallback'}, review: human}};
}
async function gate(d, evidence) {
  const files = {responses: d.run, labels: d.labels, judgments: d.judgments};
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
