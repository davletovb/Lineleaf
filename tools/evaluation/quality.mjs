import {createHash} from 'node:crypto';
import {candidates} from '../../extension/lib/candidates.mjs';
import {validText, exactKeys, MODES, REWRITE_MODES, EFFORTS} from '../../extension/lib/policy.mjs';

export const sha256 = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const fail = () => { throw new Error('INVALID_EVALUATION_DATA'); };
const id = value => typeof value === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
// Optional clearer-wording suggestions are measured on their own cases and their own metrics, never folded into proofreading precision.
export const CLARITY_MIN_CASES = 12;
export const STRATA = ['grammar', 'spelling', 'punctuation', 'already_correct', 'informal', 'facts', 'negation', 'ambiguous', 'second_language', 'unicode', 'paragraph', 'multi_edit', 'variant'];
export function validateCorpus(corpus) {
  if (!exactKeys(corpus, ['schema', 'id', 'author', 'kind', 'cases']) || corpus.schema !== 1 || !id(corpus.id)
      || !id(corpus.author) || corpus.kind !== 'synthetic' || !Array.isArray(corpus.cases) || corpus.cases.length > 500) fail();
  const seen = new Set(), texts = new Set();
  for (const c of corpus.cases) {
    if (!exactKeys(c, ['id', 'source', 'mode', 'variant', 'strata', 'protected', 'proposal']) || !id(c.id) || seen.has(c.id)
        || !validText(c.source) || !MODES.includes(c.mode) || !['US', 'UK'].includes(c.variant)
        || !Array.isArray(c.strata) || !c.strata.length || !c.strata.every(x => STRATA.includes(x))
        || !Array.isArray(c.protected) || c.protected.length > 32 || !c.protected.every(x => validText(x, 120) && c.source.includes(x))) fail();
    const key = `${c.mode}:${c.variant}:${c.source}`; if (texts.has(key)) fail(); texts.add(key); seen.add(c.id);
    candidates(JSON.stringify(c.proposal), c.source, c.mode);
    if (c.mode === 'shorter' && c.proposal.rewrite.length >= c.source.length) fail();
  }
  const rewrites = corpus.cases.filter(c => REWRITE_MODES.includes(c.mode));
  if (new Set(rewrites.map(c => c.source)).size !== rewrites.length) fail();
  return corpus;
}
export function human(review, author) {
  return exactKeys(review, ['kind', 'reviewer', 'independent', 'reviewedAt']) && review.kind === 'human'
    && id(review.reviewer) && review.reviewer !== author && review.independent === true
    && typeof review.reviewedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(review.reviewedAt)
    && Number.isFinite(Date.parse(review.reviewedAt));
}
export function validateLabels(corpus, labels) {
  if (!exactKeys(labels, ['schema', 'corpusHash', 'review', 'cases']) || labels.schema !== 1 || labels.corpusHash !== sha256(corpus)
      || !human(labels.review, corpus.author) || !Array.isArray(labels.cases) || labels.cases.length !== corpus.cases.length) fail();
  const result = new Map(), rejected = [];
  for (const row of labels.cases) {
    const c = corpus.cases.find(x => x.id === row.id);
    if (!c || result.has(row.id) || !exactKeys(row, ['id', 'decision', 'reference']) || !['approved', 'corrected', 'rejected'].includes(row.decision)) fail();
    if (row.decision === 'rejected') {
      if (row.reference !== null) fail();
      rejected.push(row.id); result.set(row.id, []); continue;
    }
    const edits = candidates(JSON.stringify(row.reference), c.source, c.mode);
    const unchanged = sha256(edits) === sha256(candidates(JSON.stringify(c.proposal), c.source, c.mode));
    if ((row.decision === 'approved') !== unchanged) fail();
    result.set(row.id, edits);
  }
  return {references: result, rejected};
}
export function validateAcceptance(corpus, run, policy) {
  if (!exactKeys(policy, ['schema', 'corpusHash', 'configurationHash', 'minimumReferenceRecall', 'review']) || policy.schema !== 1
      || policy.corpusHash !== sha256(corpus) || policy.configurationHash !== run.configurationHash || !human(policy.review, corpus.author)
      || Date.parse(policy.review.reviewedAt) > Date.parse(run.createdAt)
      || !Number.isFinite(policy.minimumReferenceRecall) || policy.minimumReferenceRecall <= 0 || policy.minimumReferenceRecall > 1) fail();
  return policy.minimumReferenceRecall;
}
export function validateRun(corpus, run) {
  // Old evidence remains readable; new runs include effort in the hashed
  // configuration so comparisons cannot silently change reasoning budgets.
  const hasEffort = Object.hasOwn(run?.configuration ?? {}, 'effort');
  if (!exactKeys(run, ['schema', 'id', 'kind', 'corpusHash', 'configuration', 'configurationHash', 'createdAt', 'timingBoundary', 'rows']) || run.schema !== 1
      || !id(run.id) || !['fixture', 'live', 'planned'].includes(run.kind) || run.corpusHash !== sha256(corpus)
      || !exactKeys(run.configuration, ['provider', 'model', 'providerVersion', 'seatlineRevision', 'engineHash', 'packageHash', 'runtime', ...(hasEffort ? ['effort'] : [])])
      || (hasEffort && !EFFORTS.includes(run.configuration.effort))
      || run.configuration.provider !== 'codex' || !validText(run.configuration.model, 128)
      || !validText(run.configuration.providerVersion, 128) || !/^[a-f0-9]{40}$/.test(run.configuration.seatlineRevision)
      || !hash(run.configuration.engineHash) || !hash(run.configuration.packageHash)
      || !exactKeys(run.configuration.runtime, ['platform', 'arch', 'cpu', 'memoryGB'])
      || !['linux', 'darwin', 'win32'].includes(run.configuration.runtime.platform)
      || !validText(run.configuration.runtime.arch, 32) || !validText(run.configuration.runtime.cpu, 256)
      || !Number.isFinite(run.configuration.runtime.memoryGB) || run.configuration.runtime.memoryGB <= 0
      || run.configurationHash !== sha256(run.configuration) || typeof run.createdAt !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(run.createdAt) || !Number.isFinite(Date.parse(run.createdAt))
      || run.timingBoundary !== 'fresh-native-ready-status-send-validation'
      || !Array.isArray(run.rows) || run.rows.length > corpus.cases.length) fail();
  if (run.kind === 'live' && (run.configuration.model === 'fixture-reference' || run.configuration.providerVersion === 'fixture')) fail();
  const seen = new Set();
  for (const row of run.rows) {
    const c = corpus.cases.find(x => x.id === row.id);
    if (!c || seen.has(row.id) || !exactKeys(row, ['id', 'inputHash', 'status', 'response', 'elapsedMs', 'code'])
        || row.inputHash !== sha256(c.source) || !['completed', 'failed'].includes(row.status)
        || typeof row.response !== 'string' || Buffer.byteLength(row.response) > 128 * 1024
        || !Number.isFinite(row.elapsedMs) || row.elapsedMs < 0
        || (row.status === 'completed' ? row.code !== null : !id(row.code))) fail();
    seen.add(row.id);
  }
}
export function validateJudgments(corpus, run, judgments, decoded) {
  if (!exactKeys(judgments, ['schema', 'runId', 'runHash', 'review', 'cases']) || judgments.schema !== 1
      || judgments.runId !== run.id || judgments.runHash !== sha256(run) || !human(judgments.review, corpus.author)
      || !Array.isArray(judgments.cases) || judgments.cases.length > corpus.cases.length) fail();
  const result = new Map();
  for (const row of judgments.cases) {
    const c = corpus.cases.find(x => x.id === row.id), edits = decoded.get(row.id);
    if (!c || result.has(row.id) || !exactKeys(row, ['id', 'suggestions', 'meaningPreserved']) || !Array.isArray(row.suggestions)) fail();
    if (!edits) {
      // Unavailable output cannot be reviewed; keep explicit pending markers in partial-run templates.
      if (row.suggestions.length || row.meaningPreserved !== null) fail();
      result.set(row.id, null); continue;
    }
    if (typeof row.meaningPreserved !== 'boolean' || row.suggestions.length !== edits.length
        || !row.suggestions.every(x => exactKeys(x, ['correct', 'explanationAccurate']) && typeof x.correct === 'boolean' && typeof x.explanationAccurate === 'boolean')) fail();
    result.set(row.id, row);
  }
  return result;
}
const sameEdit = (a, b) => a.start === b.start && a.end === b.end && a.after === b.after && a.category === b.category;
const count = (text, token) => text.split(token).length - 1;
function changed(source, edits) { for (const e of [...edits].reverse()) source = source.slice(0, e.start) + e.after + source.slice(e.end); return source; }
export function score(corpus, run, {labels = null, judgments = null, acceptance = null} = {}) {
  validateCorpus(corpus); validateRun(corpus, run);
  const labelReview = labels ? validateLabels(corpus, labels) : null;
  const references = labelReview?.references ?? new Map(corpus.cases.map(c => [c.id, candidates(JSON.stringify(c.proposal), c.source, c.mode)]));
  const minimumRecall = acceptance ? validateAcceptance(corpus, run, acceptance) : null;
  const decoded = new Map(), invalid = [];
  for (const row of run.rows) {
    if (row.status !== 'completed') { if (row.code === 'INVALID_OUTPUT') invalid.push(row.id); continue; }
    const c = corpus.cases.find(x => x.id === row.id);
    try { decoded.set(c.id, candidates(row.response, c.source, c.mode)); } catch { invalid.push(c.id); }
  }
  const reviewed = judgments ? validateJudgments(corpus, run, judgments, decoded) : null;
  const metrics = {proofread: {cases: 0, expected: 0, emitted: 0, referenceMatches: 0, humanCorrect: 0, falsePositives: 0},
    clarity: {cases: 0, expected: 0, emitted: 0, referenceMatches: 0, humanCorrect: 0, falsePositives: 0},
    style: {cases: 0, emitted: 0, humanApproved: 0, notShorter: 0}, protectedViolations: 0, meaningViolations: 0, explanationErrors: 0};
  const strata = Object.fromEntries(STRATA.map(s => [s, {cases: 0, expected: 0, emitted: 0, referenceMatches: 0}]));
  for (const c of corpus.cases) {
    const edits = decoded.get(c.id) ?? [], gold = references.get(c.id), judgment = reviewed?.get(c.id);
    const kind = c.mode === 'proofread' ? 'proofread' : c.mode === 'clarity' ? 'clarity' : 'style', suggests = kind !== 'style';
    const matches = suggests ? edits.filter(e => gold.some(g => sameEdit(e, g))).length : 0;
    const group = metrics[kind]; group.cases++; group.emitted += edits.length;
    if (suggests) {
      group.expected += gold.length; group.referenceMatches += matches;
      if (judgment) { group.humanCorrect += judgment.suggestions.filter(x => x.correct).length; group.falsePositives += judgment.suggestions.filter(x => !x.correct).length; }
    } else if (judgment?.meaningPreserved && judgment.suggestions.every(x => x.correct)) group.humanApproved++;
    if (kind !== 'clarity') for (const tag of c.strata) {
      strata[tag].cases++; strata[tag].expected += c.mode === 'proofread' ? gold.length : 0;
      strata[tag].emitted += edits.length; strata[tag].referenceMatches += matches;
    }
    const after = changed(c.source, edits);
    if (decoded.has(c.id) && c.mode === 'shorter' && after.length >= c.source.length) metrics.style.notShorter++;
    if (c.protected.some(token => count(c.source, token) !== count(after, token))) metrics.protectedViolations++;
    if (judgment && !judgment.meaningPreserved) metrics.meaningViolations++;
    if (judgment) metrics.explanationErrors += judgment.suggestions.filter(x => !x.explanationAccurate).length;
  }
  const p = metrics.proofread;
  p.referencePrecision = p.emitted ? p.referenceMatches / p.emitted : null;
  p.referenceRecall = p.expected ? p.referenceMatches / p.expected : null;
  p.humanPrecision = reviewed && p.emitted ? p.humanCorrect / p.emitted : null;
  const k = metrics.clarity;
  k.referencePrecision = k.emitted ? k.referenceMatches / k.emitted : null;
  k.referenceRecall = k.expected ? k.referenceMatches / k.expected : null;
  k.humanPrecision = reviewed && k.emitted ? k.humanCorrect / k.emitted : null;
  const reasons = [];
  if (run.kind !== 'live') reasons.push(run.kind === 'planned' ? 'PLANNED_NOT_QUALITY_EVIDENCE' : 'FIXTURE_NOT_QUALITY_EVIDENCE');
  if (!labels) reasons.push('INDEPENDENT_LABEL_REVIEW_REQUIRED');
  if (!judgments) reasons.push('INDEPENDENT_OUTPUT_REVIEW_REQUIRED');
  if (labelReview?.rejected.length) reasons.push('LABEL_CASE_REJECTED');
  if (!acceptance) reasons.push('APPROVED_RECALL_FLOOR_REQUIRED');
  else if (p.referenceRecall === null || p.referenceRecall < minimumRecall) reasons.push('RECALL_GATE_NOT_MET');
  const proofCases = corpus.cases.filter(c => c.mode === 'proofread');
  const coverage = {proofreading: proofCases.length, paragraphs: proofCases.filter(c => c.source.length >= 200).length,
    nearLimit: proofCases.filter(c => c.source.length >= 1800).length,
    multiEdit: proofCases.filter(c => references.get(c.id).length > 1).length,
    variant: proofCases.filter(c => c.strata.includes('variant')).length, clarity: metrics.clarity.cases};
  if (coverage.proofreading < 150 || coverage.paragraphs < 30 || coverage.nearLimit < 2 || coverage.multiEdit < 8 || coverage.variant < 6
      || coverage.clarity < CLARITY_MIN_CASES || STRATA.some(s => !strata[s].cases)) reasons.push('CORPUS_COVERAGE_INCOMPLETE');
  if (decoded.size !== corpus.cases.length || invalid.length) reasons.push('INCOMPLETE_OR_INVALID_RESPONSES');
  const unreviewed = [...decoded.keys()].filter(key => !reviewed?.get(key));
  if (judgments && unreviewed.length) reasons.push('INDEPENDENT_OUTPUT_REVIEW_INCOMPLETE');
  if (p.humanPrecision === null || p.humanPrecision < .95) reasons.push('PRECISION_GATE_NOT_MET');
  if (!p.expected || !p.referenceMatches) reasons.push('NO_VERIFIED_ERROR_DETECTION');
  // Same human bar as corrections, applied to the clearer-wording suggestions alone; offering none cannot satisfy it.
  if (k.humanPrecision === null || k.humanPrecision < .95) reasons.push('CLARITY_PRECISION_GATE_NOT_MET');
  if (REWRITE_MODES.some(mode => !corpus.cases.some(c => c.mode === mode))
      || metrics.style.humanApproved !== metrics.style.cases) reasons.push('REWRITE_REVIEW_GATE_NOT_MET');
  if (metrics.protectedViolations || metrics.meaningViolations) reasons.push('MEANING_PRESERVATION_GATE_NOT_MET');
  if (metrics.explanationErrors) reasons.push('EXPLANATION_REVIEW_GATE_NOT_MET');
  if (metrics.style.notShorter) reasons.push('SHORTER_REWRITE_LENGTH_GATE_NOT_MET');
  const times = run.rows.filter(x => x.status === 'completed').map(x => x.elapsedMs).sort((a, b) => a - b);
  const percentile = p => times.length ? times[Math.max(0, Math.ceil(times.length * p) - 1)] : null;
  return {schema: 1, runId: run.id, runHash: sha256(run), kind: run.kind, corpusHash: run.corpusHash,
    configurationHash: run.configurationHash, configuration: run.configuration,
    referenceKind: labels ? 'independently-human-reviewed' : 'unreviewed-proposals',
    outputReview: reviewed && !unreviewed.length ? 'independent-human' : reviewed ? 'partial-independent-human' : 'pending', releaseEligible: reasons.length === 0, reasons,
    attempted: run.rows.length, completed: decoded.size, invalidCaseIds: invalid, unreviewedCaseIds: unreviewed,
    missingCaseIds: corpus.cases.filter(c => !run.rows.some(r => r.id === c.id)).map(c => c.id),
    failedCases: run.rows.filter(r => r.status === 'failed').map(r => ({id: r.id, code: r.code})),
    invalidOutputRate: decoded.size + invalid.length ? invalid.length / (decoded.size + invalid.length) : null,
    minimumReferenceRecall: minimumRecall, rejectedLabelCaseIds: labelReview?.rejected ?? [], metrics, strata, coverage,
    latency: {kind: run.kind, boundary: run.timingBoundary, includesBrowserUI: false, completionP50Ms: percentile(.5), completionP95Ms: percentile(.95)},
    recallDefinition: 'Exact approved reference span/replacement/category matches; reported separately from human precision. Alternative valid edits require label adjudication. Clearer-wording suggestions are scored apart from corrections (metrics.clarity) and are not part of the proofreading strata.'};
}
export function reviewTemplates(corpus, run) {
  const review = {kind: 'pending', reviewer: '', independent: false, reviewedAt: ''};
  return {acceptance: {schema: 1, corpusHash: sha256(corpus), configurationHash: run.configurationHash, minimumReferenceRecall: null, review: {...review}},
    labels: {schema: 1, corpusHash: sha256(corpus), review: {...review}, cases: corpus.cases.map(c => ({id: c.id, decision: 'pending', reference: structuredClone(c.proposal)}))},
    judgments: {schema: 1, runId: run.id, runHash: sha256(run), review: {...review}, cases: corpus.cases.map(c => {
      const row = run.rows.find(x => x.id === c.id); let edits = [];
      try { if (row?.status === 'completed') edits = candidates(row.response, c.source, c.mode); } catch { /* Never preapprove a failed response. */ }
      return {id: c.id, suggestions: edits.map(() => ({correct: null, explanationAccurate: null})), meaningPreserved: null};
    })}};
}
