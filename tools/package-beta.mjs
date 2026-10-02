import {readFile, writeFile, copyFile, mkdir, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve, dirname, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {ROOT, CORPUS, engineHash, privateJSON} from './evaluate-writing.mjs';
import {sha256, validateCorpus} from './evaluation/quality.mjs';
import {readData} from './evaluation/json.mjs';
import {betaGate} from './evaluation/beta-gate.mjs';
import {packagePath} from './evaluation/package.mjs';
export async function main(argv = process.argv.slice(2)) {
  const {values} = parseArgs({args: argv, options: {candidate: {type: 'boolean'}, release: {type: 'boolean'}, evidence: {type: 'string'}}});
  if (Boolean(values.candidate) === Boolean(values.release)) throw new Error('CHOOSE_CANDIDATE_OR_RELEASE');
  const {version, path: extension} = await packagePath(ROOT);
  const target = join(ROOT, `dist/lineleaf-${version}-beta.zip`);
  // The release command cannot leave an older generated beta at the advertised path after refusal.
  if (values.release) await rm(target, {force: true});
  const context = {packageHash: sha256(await readFile(extension)), engineHash: await engineHash(),
    seatlineRevision: (await readData(join(ROOT, 'config/seatline-contract.json'))).revision};
  const corpus = validateCorpus(await readData(CORPUS)); let evidence = null;
  try { if (values.evidence) evidence = await readData(resolve(values.evidence)); } catch { /* Invalid evidence is a blocked review, never a release. */ }
  const report = await betaGate(corpus, context, evidence, {directory: values.evidence ? dirname(resolve(values.evidence)) : ROOT});
  const directory = join(ROOT, 'dist/beta-review'); await rm(directory, {recursive: true, force: true}); await mkdir(directory, {recursive: true});
  await copyFile(extension, join(directory, `lineleaf-${version}.zip`));
  for (const name of ['SETUP.md', 'SUPPORT.md', 'PRIVACY.md', 'ACCEPTANCE.md']) {
    const guide = await readFile(join(ROOT, 'docs/beta', name), 'utf8');
    await writeFile(join(directory, name), guide.replaceAll('lineleaf-0.1.0.zip', `lineleaf-${version}.zip`));
  }
  await copyFile(CORPUS, join(directory, 'writing-corpus.json'));
  await copyFile(join(ROOT, 'evaluation/beta-evidence-template.json'), join(directory, 'evidence-template.json'));
  await privateJSON(join(directory, 'review.json'), report);
  const archive = join(ROOT, `dist/lineleaf-${version}-beta-review.zip`);
  const zip = spawnSync('python3', [join(ROOT, 'scripts/package.py'), '--source', directory, '--target', archive], {stdio: ['ignore', 'pipe', 'ignore'], shell: false});
  if (zip.status !== 0) throw new Error('PACKAGE_FAILED');
  if (values.release && report.releaseReady) await copyFile(extension, target);
  console.log(JSON.stringify({...report, reviewArchiveHash: sha256(await readFile(archive))}, null, 2));
  return values.candidate || report.releaseReady ? 0 : 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); } catch { console.error('BETA_INPUT_OR_IO_FAILED'); process.exitCode = 2; }
}
