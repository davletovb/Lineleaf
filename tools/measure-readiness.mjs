#!/usr/bin/env node
// What a writing check costs, measured through the production controller, a real Seatline companion and a stand-in Codex.
//
// The controller (`extension/lib/controller.mjs`, or the copy named by --extension) is installed on a synthetic Chrome. Its native
// connection is a real `seatline-companion` bridge talking to a real broker in an isolated registry, and the provider is a small
// shell script that answers like a signed-in Codex subscription and records every launch. So the counts are real processes:
//
//   hosts  native Messaging host processes started (one per connectNative)
//   login  `codex login status` launches, i.e. sign-in/readiness probes
//   exec   `codex exec` launches, i.e. model turns
//
// What this is NOT: a measurement of a live provider. The stand-in answers at once, so the milliseconds are the extension, the bridge,
// the broker and process starts, and say nothing about Codex's own latency; a live run needs a provider account and is not part of CI.
//
//   node tools/measure-readiness.mjs --companion /path/to/seatline-companion [--checks 6] [--prepare] [--extension DIR]
//   node tools/measure-readiness.mjs --companion ... --compare /path/to/older/extension/lib   # baseline, current, current + prepare
//   node tools/measure-readiness.mjs --companion ... --expect cached [--prepare]   # exit 1 unless the counts below hold
//
// --expect cached: a companion with Seatline's readiness API. All checks complete over one host process, with one sign-in probe in all
// (none for a check that follows a preparation) and one model turn per check.
// --expect legacy: a companion that predates it. The controller falls back after one refused `readiness`; the connection is still kept,
// and each check costs the two probes (status, and the one inside the turn) that older companions always ran.
//
// Linux only (the broker and bridge use the registry layout and shell the isolated-registry validation uses).
import {execFileSync, spawn} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {homedir, platform, arch, cpus} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {nativePort} from './evaluation/native-port.mjs';
import {fakeChrome} from '../tests/fixtures/extension-api.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CODEX = `#!/bin/sh
# A stand-in Codex: records each launch, answers like a ChatGPT-subscription sign-in, and returns one valid correction.
echo "$*" >> "$(dirname "$0")/codex-launches"
case "$1" in
  login) echo 'Logged in using ChatGPT' >&2; exit 0 ;;
  exec)
    cat > /dev/null
    echo '{"type":"thread.started","thread_id":"00000000-0000-4000-8000-000000000000"}'
    echo '{"type":"turn.started"}'
    echo '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"{\\"corrections\\":[{\\"before\\":\\"go\\",\\"after\\":\\"goes\\",\\"left\\":\\"He \\",\\"right\\":\\" to\\",\\"category\\":\\"grammar\\",\\"explanation\\":\\"Subject agreement\\"}]}"}}'
    echo '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}' ;;
  *) exit 2 ;;
esac
`;

/** An isolated registry and broker; `remove()` ends it. */
async function install(companion) {
  if (platform() !== 'linux') throw new Error('ISOLATED_REGISTRY_REQUIRES_LINUX');
  const contract = JSON.parse(readFileSync(join(ROOT, 'config/seatline-contract.json'), 'utf8'));
  const origin = `chrome-extension://${contract.development_extension_id}/`;
  // Seatline verifies every ancestor of a provider workspace: a private child of the real home, not shared /tmp.
  const root = mkdtempSync(join(homedir(), 'lineleaf-readiness-')), data = join(root, 'data'), providers = join(root, 'providers');
  mkdirSync(providers, {mode: 0o700});
  const env = {...process.env, SEATLINE_DATA_DIR: data, XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'), XDG_DATA_HOME: join(root, 'provider-data'), SEATLINE_BROKER_IDLE_SECS: '0'};
  const run = (...args) => execFileSync(companion, args, {env, stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000});
  run('install'); const installed = readFileSync(join(data, 'companion-executable'), 'utf8').trim();
  run('authorize', 'lineleaf', 'codex', origin);
  const broker = {SEATLINE_DATA_DIR: data, XDG_CONFIG_HOME: env.XDG_CONFIG_HOME, XDG_CACHE_HOME: env.XDG_CACHE_HOME, XDG_DATA_HOME: env.XDG_DATA_HOME, SEATLINE_BROKER_IDLE_SECS: '0', PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LINELEAF_PROVIDER_PATH: providers};
  writeFileSync(join(providers, 'codex'), CODEX); chmodSync(join(providers, 'codex'), 0o700);
  const server = spawn(installed, ['serve'], {env: broker, stdio: 'ignore'});
  for (let i = 0; i < 200 && !existsSync(join(data, 'broker.sock')); i++) await new Promise(r => setTimeout(r, 25));
  if (!existsSync(join(data, 'broker.sock'))) throw new Error('the isolated broker did not start');
  const launches = () => { try { return readFileSync(join(providers, 'codex-launches'), 'utf8').split('\n').filter(Boolean); } catch { return []; } };
  return {installed, origin, broker, launches, contract,
    remove() { server.kill(); rmSync(root, {recursive: true, force: true}); }};
}

async function until(predicate, what, timeout = 20000) {
  for (const stop = Date.now() + timeout; !predicate();) { if (Date.now() > stop) throw new Error(`timed out waiting for ${what}`); await new Promise(r => setTimeout(r, 5)); }
}
const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
const round = value => Math.round(value * 10) / 10;

/** Runs `checks` writing checks (and optionally a preparation first) through the controller in `extension`. */
async function scenario(world, {extension, checks, prepare}) {
  const {installController} = await import(pathToFileURL(join(resolve(extension), 'controller.mjs')));
  const f = fakeChrome({sites: ['https://writing.test']});
  const counts = {hosts: 0, frames: []};
  f.api.runtime.connectNative = () => {
    counts.hosts++;
    const port = nativePort(world.installed, [world.origin], world.broker);
    const post = port.postMessage.bind(port); // what was asked of the companion, by method only: never text
    port.postMessage = message => { counts.frames.push(message.method); post(message); };
    return port;
  };
  const controller = installController(f.api);
  const marks = () => ({hosts: counts.hosts, frames: counts.frames.length, login: world.launches().filter(l => l.startsWith('login')).length, exec: world.launches().filter(l => l.startsWith('exec')).length});
  const rows = [];
  const record = (name, before, started, outcome) => {
    const after = marks();
    rows.push({step: name, outcome, ms: round(performance.now() - started), hosts: after.hosts - before.hosts, login: after.login - before.login, exec: after.exec - before.exec, frames: counts.frames.slice(before.frames)});
  };
  if (prepare) {
    const before = marks(), started = performance.now(); const reply = await f.rpc('prepare', null, f.sender);
    record('prepare', before, started, reply.ok ? reply.value : reply.code);
  }
  for (let i = 1; i <= checks; i++) {
    const before = marks(), started = performance.now(); const peer = f.connect({documentId: `field-${i}`});
    peer.onMessage.emit({type: 'start', id: crypto.randomUUID(), text: 'He go to work.', mode: 'proofread'});
    await until(() => peer.received.some(m => m.type === 'result' || m.type === 'error'), `check ${i}`);
    const final = peer.received.find(m => m.type === 'result' || m.type === 'error');
    record(`check ${i}`, before, started, final.type === 'result' ? 'ok' : final.code);
    await until(() => controller.active === null, 'the controller to be idle');
  }
  return rows;
}

function summarize(rows) {
  const checks = rows.filter(r => r.step.startsWith('check')), first = checks[0], later = checks.slice(1);
  const sum = (list, key) => list.reduce((total, r) => total + r[key], 0);
  return {
    completed: checks.filter(r => r.outcome === 'ok').length, of: checks.length,
    first_check: first && {ms: first.ms, hosts: first.hosts, login: first.login, exec: first.exec},
    later_checks: later.length ? {n: later.length, median_ms: median(later.map(r => r.ms)), hosts: sum(later, 'hosts'), login: sum(later, 'login'), exec: sum(later, 'exec')} : null,
    total: {hosts: sum(rows, 'hosts'), login: sum(rows, 'login'), exec: sum(rows, 'exec')},
  };
}

/** What `--expect` holds a run to; returns the mismatches. */
function expectations(kind, {summary, steps}, checks, prepared) {
  const wrong = [], same = (name, actual, wanted) => { if (actual !== wanted) wrong.push(`${name}: ${actual}, expected ${wanted}`); };
  same('checks completed', summary.completed, checks); same('host processes', summary.total.hosts, 1); same('model turns', summary.total.exec, checks);
  if (kind === 'cached') {
    same('sign-in probes in all', summary.total.login, 1);
    if (prepared) { const prepare = steps.find(step => step.step === 'prepare'); same('prepare outcome', prepare?.outcome, 'prepared'); same('first check probes after a preparation', summary.first_check.login, 0); same('first check hosts after a preparation', summary.first_check.hosts, 0); }
  } else {
    same('sign-in probes in all', summary.total.login, 2 * checks);
    same('first check methods', steps.find(step => step.step === 'check 1')?.frames.join(','), 'readiness,status,send');
    for (const step of steps.filter(step => step.step.startsWith('check') && step.step !== 'check 1')) same(`${step.step} methods`, step.frames.join(','), 'status,send');
  }
  return wrong;
}

const {values} = parseArgs({options: {expect: {type: 'string'}, companion: {type: 'string'}, extension: {type: 'string', default: join(ROOT, 'extension/lib')}, compare: {type: 'string'},
  checks: {type: 'string', default: '6'}, prepare: {type: 'boolean', default: false}, label: {type: 'string'}, json: {type: 'boolean', default: false}}});
if (!values.companion) { console.error('usage: measure-readiness.mjs --companion <seatline-companion> [--checks N] [--prepare] [--extension DIR] [--compare OLDER_EXTENSION_LIB] [--expect cached|legacy] [--json]'); process.exit(2); }
const checks = Number(values.checks);
if (!(checks >= 2 && checks <= 20)) { console.error('--checks must be between 2 and 20'); process.exit(2); }
const runs = values.compare
  ? [{label: 'baseline (per-request connection, status probe)', extension: values.compare, prepare: false},
     {label: 'current', extension: values.extension, prepare: false},
     {label: 'current, prepared before the first check', extension: values.extension, prepare: true}]
  : [{label: values.label ?? 'current', extension: values.extension, prepare: values.prepare}];
const report = {kind: 'native-stand-in', provider: 'stand-in codex (shell script); NOT a live provider',
  machine: `${platform()} ${arch()}, ${cpus().length} x ${cpus()[0]?.model}, node ${process.version}`, checks, runs: []};
for (const run of runs) {
  // Each run gets a new broker, so its readiness cache starts empty and nothing carries over from the one before.
  const world = await install(resolve(values.companion));
  try {
    report.seatline_revision = process.env.SEATLINE_REVISION || world.contract.revision; // CI names the revision actually under test
    const steps = await scenario(world, {extension: run.extension, checks, prepare: run.prepare});
    report.runs.push({label: run.label, prepare: run.prepare, summary: summarize(steps), steps});
  } finally { world.remove(); }
}
if (values.expect) {
  if (!['cached', 'legacy'].includes(values.expect) || values.compare || report.runs.length !== 1) { console.error('--expect cached|legacy takes one run'); process.exit(2); }
  const wrong = expectations(values.expect, report.runs[0], checks, report.runs[0].prepare);
  report.expected = {kind: values.expect, mismatches: wrong};
  if (wrong.length) { console.error(`Readiness expectations (${values.expect}) failed:\n  ${wrong.join('\n  ')}`); process.exitCode = 1; }
}
if (values.json) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Writing checks through the production controller, a real Seatline companion and a stand-in Codex (${checks} checks per run).`);
  for (const run of report.runs) {
    const {first_check: first, later_checks: later, total, completed, of} = run.summary;
    console.log(`\n${run.label}: ${completed}/${of} completed; in all ${total.hosts} host process(es), ${total.login} sign-in probe(s), ${total.exec} model turn(s)`);
    if (first) console.log(`  first check:  ${first.ms} ms, ${first.hosts} host(s), ${first.login} probe(s), ${first.exec} turn(s)`);
    if (later) console.log(`  later checks: median ${later.median_ms} ms, ${later.hosts} host(s), ${later.login} probe(s), ${later.exec} turn(s) over ${later.n} checks`);
  }
}
