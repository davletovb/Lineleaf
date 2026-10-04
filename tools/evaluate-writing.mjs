import {readFile, writeFile, mkdir, chmod} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import {parseArgs} from 'node:util';
import {NativeSeatline} from '../extension/lib/native-seatline.mjs';
import {candidates} from '../extension/lib/candidates.mjs';
import {writingTurn, preferences, requireReady, errorCode} from '../extension/lib/policy.mjs';
import {nativePort} from './evaluation/native-port.mjs';
import {sha256, validateCorpus, score, reviewTemplates} from './evaluation/quality.mjs';
import {readData} from './evaluation/json.mjs';
import {readPackage} from './evaluation/package.mjs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const CORPUS = join(ROOT, 'evaluation/writing-corpus.json');
const ENGINE = ['extension/lib/policy.mjs', 'extension/lib/candidates.mjs', 'extension/lib/native-seatline.mjs'];
export async function engineHash() { return sha256(await Promise.all(ENGINE.map(async path => [path, sha256(await readFile(join(ROOT, path)))]))); }
export async function privateJSON(path, value) {
  await mkdir(resolve(path, '..'), {recursive: true, mode: 0o700});
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', {mode: 0o600}); await chmod(path, 0o600);
}
export async function configuration({model, providerVersion, fixture}) {
  const contract = JSON.parse(await readFile(join(ROOT, 'config/seatline-contract.json'), 'utf8'));
  return {provider: 'codex', model: fixture ? 'fixture-reference' : model, providerVersion: fixture ? 'fixture' : providerVersion,
    seatlineRevision: contract.revision, engineHash: await engineHash(), packageHash: (await readPackage(ROOT)).packageHash,
    runtime: {platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model ?? 'unknown', memoryGB: Math.round(os.totalmem() / 1073741824 * 100) / 100}};
}
export function plannedRun(corpus, config, kind = 'planned') {
  return {schema: 1, id: randomUUID(), kind, corpusHash: sha256(corpus), configuration: config,
    configurationHash: sha256(config), createdAt: new Date().toISOString(), timingBoundary: 'fresh-native-ready-status-send-validation', rows: []};
}
function fixtureConnection(corpus) {
  return new NativeSeatline(() => {
    const listeners = new Set(), disconnects = new Set();
    const emit = value => queueMicrotask(() => { for (const fn of listeners) fn(value); });
    const port = {onMessage: {addListener: fn => listeners.add(fn)}, onDisconnect: {addListener: fn => disconnects.add(fn)},
      disconnect: () => {}, postMessage(request) {
        if (request.method === 'status') emit({id: request.id, event: {type: 'status', status: {availability: 'available', authentication: 'authenticated', sign_in: 'subscription', capabilities: {tool_isolation: true}}}});
        else {
          const source = JSON.parse(request.params.messages[0].text).text;
          // The case whose exact production prompt this is, so every mode (including future ones) is matched the same way.
          const c = corpus.cases.find(c => c.source === source && request.params.system === writingTurn(c.source, c.mode, preferences({variant: c.variant})).system);
          emit({id: request.id, event: {type: 'delta', text: JSON.stringify(c.proposal)}});
        }
        emit({id: request.id, event: {type: 'completed'}});
      }};
    emit({type: 'ready', version: 1}); return port;
  });
}
export async function evaluate(corpus, config, {fixture = false, companion = 'seatline-companion', timeout = 30000, connectionFactory} = {}) {
  validateCorpus(corpus);
  if (!fixture && (!config.model || config.providerVersion === 'fixture' || config.model === 'fixture-reference')) throw new Error('LIVE_CONFIGURATION_REQUIRED');
  const run = plannedRun(corpus, config, fixture ? 'fixture' : 'live');
  const open = connectionFactory ?? (() => fixture ? fixtureConnection(corpus) : new NativeSeatline(() => nativePort(companion)));
  let readiness = null, bytes = 0;
  for (const c of corpus.cases) {
    const started = performance.now(), settings = preferences({model: fixture ? '' : config.model, variant: c.variant});
    const row = {id: c.id, inputHash: sha256(c.source), status: 'failed', response: '', elapsedMs: 0, code: null};
    let native, checkingReadiness = true;
    try {
      // Every case gets a new bridge/handshake, status probe and ephemeral send: the cold path. Production now keeps its connection and reuses
      // Seatline's readiness, so these timings are not production's (the report's timing boundary says what they include).
      native = open();
      requireReady(await native.request('status', null, {timeout: Math.min(timeout, 15000)}));
      checkingReadiness = false;
      row.response = await native.request('send', writingTurn(c.source, c.mode, settings), {timeout});
      bytes += Buffer.byteLength(row.response);
      if (bytes > 4 * 1048576) { row.response = ''; row.code = 'EVALUATION_OUTPUT_LIMIT'; }
      else { candidates(row.response, c.source, c.mode); row.status = 'completed'; }
    } catch (error) { row.code = errorCode(error); if (checkingReadiness) readiness = row.code; }
    finally { row.elapsedMs = Math.round((performance.now() - started) * 1000) / 1000; native?.close(); }
    run.rows.push(row);
    // Bad model JSON is a measured outcome; infrastructure/readiness/limits stop the run without retry.
    if (row.status === 'failed' && row.code !== 'INVALID_OUTPUT') break;
  }
  return {run, readiness};
}
const readJSON = readData;
export async function main(argv = process.argv.slice(2)) {
  const {values} = parseArgs({args: argv, options: {prepare: {type: 'boolean'}, fixture: {type: 'boolean'}, companion: {type: 'string'}, model: {type: 'string'},
    'provider-version': {type: 'string'}, out: {type: 'string', default: 'test-results/quality'}, run: {type: 'string'},
    labels: {type: 'string'}, judgments: {type: 'string'}, acceptance: {type: 'string'}, timeout: {type: 'string', default: '30'}}});
  const corpus = validateCorpus(await readJSON(CORPUS)), out = resolve(values.out);
  if (values.prepare && (values.fixture || values.run || values.labels || values.judgments || values.acceptance)) throw new Error('PREPARATION_OPTIONS_CONFLICT');
  let run, readiness;
  if (values.run) {
    if (values.fixture || values.model || values.companion) throw new Error('SCORING_OPTIONS_CONFLICT');
    run = await readJSON(values.run);
  } else {
    if (!values.fixture && (!values.model || preferences({model: values.model}).model !== values.model || !values['provider-version'])) throw new Error('LIVE_CONFIGURATION_REQUIRED');
    const timeout = Number(values.timeout); if (!Number.isFinite(timeout) || timeout < 1 || timeout > 120) throw new Error('INVALID_TIMEOUT');
    const config = await configuration({model: values.model, providerVersion: values['provider-version'], fixture: values.fixture});
    if (values.prepare) run = plannedRun(corpus, config);
    else {
      ({run, readiness} = await evaluate(corpus, config, {fixture: values.fixture, companion: values.companion, timeout: timeout * 1000}));
      await privateJSON(join(out, 'responses.json'), run); // Explicit synthetic-corpus review artifact; never page/draft capture.
    }
  }
  const labels = values.labels ? await readJSON(values.labels) : null, judgments = values.judgments ? await readJSON(values.judgments) : null;
  const acceptance = values.acceptance ? await readJSON(values.acceptance) : null;
  const report = score(corpus, run, {labels, judgments, acceptance});
  if (readiness) report.readiness = readiness;
  await privateJSON(join(out, 'summary.json'), report);
  const templates = reviewTemplates(corpus, run);
  // Separate templates never overwrite completed label/output reviews.
  await privateJSON(join(out, 'labels-template.json'), templates.labels);
  await privateJSON(join(out, 'judgments-template.json'), templates.judgments);
  await privateJSON(join(out, 'acceptance-template.json'), templates.acceptance);
  console.log(JSON.stringify(report, null, 2)); // No sources, outputs, account paths, credentials or raw provider errors.
  return values.prepare || report.releaseEligible || (values.fixture && report.completed === corpus.cases.length) ? 0 : 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); } catch { console.error('EVALUATION_INPUT_OR_IO_FAILED'); process.exitCode = 2; }
}
