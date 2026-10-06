import {score, sha256, human} from './quality.mjs';
import {exactKeys, validText} from '../../extension/lib/policy.mjs';
import {readData} from './json.mjs';
import {resolve} from 'node:path';
export const CI_CHECKS = ['editing', 'privacy', 'requestLimits', 'frames', 'keyboardSemantics'];
export const COEXISTENCE_CHECKS = ['concurrentRouting', 'sessionIsolation', 'cancellationIsolation', 'automaticBudget', 'recovery'];
export const DEVICE_CHECKS = ['install', 'update', 'uninstall', 'permissionPrompt', 'revoke', 'pause', 'reset', 'nativeRoundTrip', 'keyboardUndo', 'screenReader'];
const all = (value, keys) => exactKeys(value, keys) && keys.every(key => value[key] === true);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const samePackage = (value, context) => value?.packageHash === context.packageHash;
export async function betaGate(corpus, context, evidence, {directory = '.', read = readData} = {}) {
  const reasons = [], qualities = [];
  const fail = code => { if (!reasons.includes(code)) reasons.push(code); };
  if (!exactKeys(evidence, ['schema', 'packageHash', 'engineHash', 'seatlineRevision', 'quality', 'regression', 'coexistence', 'latency', 'devices', 'editors'])
      || evidence.schema !== 1 || !samePackage(evidence, context) || evidence.engineHash !== context.engineHash
      || evidence.seatlineRevision !== context.seatlineRevision) fail('CURRENT_PACKAGE_EVIDENCE_REQUIRED');
  const inputs = evidence?.quality;
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 8) fail('LIVE_QUALITY_REQUIRED');
  else for (const item of inputs) {
    try {
      if (!exactKeys(item, ['responses', 'labels', 'judgments', 'acceptance']) || !Object.values(item).every(p => validText(p, 500))) throw new Error();
      const [run, labels, judgments, acceptance] = await Promise.all([item.responses, item.labels, item.judgments, item.acceptance].map(path => read(resolve(directory, path))));
      const result = score(corpus, run, {labels, judgments, acceptance});
      if (!result.releaseEligible || run.configuration.packageHash !== context.packageHash || run.configuration.engineHash !== context.engineHash
          || run.configuration.seatlineRevision !== context.seatlineRevision) throw new Error();
      if (qualities.some(q => q.configurationHash === result.configurationHash)) throw new Error();
      qualities.push({configurationHash: result.configurationHash, provider: result.configuration.provider, model: result.configuration.model, providerVersion: result.configuration.providerVersion,
        humanPrecision: result.metrics.proofread.humanPrecision, referenceRecall: result.metrics.proofread.referenceRecall,
        minimumReferenceRecall: result.minimumReferenceRecall});
    } catch { fail('LIVE_QUALITY_REQUIRED'); }
  }
  const r = evidence?.regression;
  if (!exactKeys(r, ['kind', 'packageHash', 'engineHash', 'commit', 'run', 'platforms', 'checks', 'review']) || r.kind !== 'installed-ci'
      || !samePackage(r, context) || r.engineHash !== context.engineHash || !/^[a-f0-9]{40}$/.test(r.commit)
      || !/^https:\/\/github\.com\/davletovb\/Lineleaf\/actions\/runs\/\d+$/.test(r.run)
      || !all(r.platforms, ['linux', 'macos']) || !all(r.checks, CI_CHECKS) || !human(r.review, corpus.author)) fail('INSTALLED_REGRESSION_REQUIRED');
  const co = evidence?.coexistence;
  if (!exactKeys(co, ['kind', 'packageHash', 'seatlineRevision', 'consumers', 'checks', 'review']) || co.kind !== 'live'
      || !samePackage(co, context) || co.seatlineRevision !== context.seatlineRevision || !Number.isInteger(co.consumers) || co.consumers < 2
      || !all(co.checks, COEXISTENCE_CHECKS) || !human(co.review, corpus.author)) fail('LIVE_COEXISTENCE_REQUIRED');
  const latency = evidence?.latency;
  if (!exactKeys(latency, ['kind', 'packageHash', 'configurations', 'review']) || latency.kind !== 'live'
      || !samePackage(latency, context) || !human(latency.review, corpus.author) || !Array.isArray(latency.configurations)
      || latency.configurations.length !== qualities.length || !qualities.length) fail('APPROVED_LIVE_LATENCY_REQUIRED');
  else {
    const seen = new Set();
    for (const sample of latency.configurations) {
      if (!exactKeys(sample, ['configurationHash', 'samples', 'coldWarmDocumented', 'completionP95Ms', 'approvedLimitMs', 'typingOverheadP95Ms', 'typingApprovedLimitMs'])
          || !digest(sample.configurationHash) || seen.has(sample.configurationHash) || !qualities.some(q => q.configurationHash === sample.configurationHash)
          || !Number.isInteger(sample.samples) || sample.samples < 30 || sample.coldWarmDocumented !== true
          || !Number.isFinite(sample.completionP95Ms) || sample.completionP95Ms < 0 || !Number.isFinite(sample.approvedLimitMs) || sample.approvedLimitMs <= 0
          || sample.completionP95Ms > sample.approvedLimitMs || !Number.isFinite(sample.typingOverheadP95Ms) || sample.typingOverheadP95Ms < 0
          || !Number.isFinite(sample.typingApprovedLimitMs) || sample.typingApprovedLimitMs <= 0 || sample.typingOverheadP95Ms > sample.typingApprovedLimitMs) fail('APPROVED_LIVE_LATENCY_REQUIRED');
      seen.add(sample.configurationHash);
    }
  }
  const platforms = [];
  if (!Array.isArray(evidence?.devices) || !evidence.devices.length || evidence.devices.length > 2) fail('ADVERTISED_DEVICE_ACCEPTANCE_REQUIRED');
  else for (const d of evidence.devices) {
    if (!exactKeys(d, ['platform', 'browser', 'browserVersion', 'osVersion', 'packageHash', 'checks', 'review'])
        || !['chrome-macos', 'chrome-linux'].includes(d.platform) || platforms.includes(d.platform) || d.browser !== 'Chrome'
        || !/^\d+(?:\.\d+){1,3}$/.test(d.browserVersion) || !validText(d.osVersion, 128) || !samePackage(d, context)
        || !all(d.checks, DEVICE_CHECKS) || !human(d.review, corpus.author)) fail('ADVERTISED_DEVICE_ACCEPTANCE_REQUIRED');
    else platforms.push(d.platform);
  }
  const editors = evidence?.editors;
  if (!exactKeys(editors, ['packageHash', 'surfaces', 'review']) || !samePackage(editors, context) || !human(editors.review, corpus.author)
      || !exactKeys(editors.surfaces, ['gmail', 'github', 'linkedin', 'slack'])
      || !Object.values(editors.surfaces).every(value => ['verified-replacement', 'verified-copy-fallback'].includes(value))) fail('LIVE_EDITOR_MATRIX_REQUIRED');
  return {schema: 1, kind: 'beta-review', packageHash: context.packageHash, engineHash: context.engineHash,
    corpusHash: sha256(corpus), seatlineRevision: context.seatlineRevision, releaseReady: !reasons.length, reasons,
    advertisedPlatforms: reasons.length ? [] : platforms, qualifiedConfigurations: qualities};
}
