import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {readData} from './json.mjs';
import {sha256} from './quality.mjs';

export async function packagePath(root) {
  const manifest = await readData(join(root, 'dist/lineleaf/manifest.json'));
  if (typeof manifest.version !== 'string' || !/^\d+(?:\.\d+){0,3}$/.test(manifest.version)) throw new Error('INVALID_PACKAGE_VERSION');
  const path = join(root, `dist/lineleaf-${manifest.version}.zip`);
  return {version: manifest.version, path};
}
export async function readPackage(root) {
  const pack = await packagePath(root);
  return {...pack, packageHash: sha256(await readFile(pack.path))};
}
