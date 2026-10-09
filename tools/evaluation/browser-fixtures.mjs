import {readdir} from 'node:fs/promises';

let modules;
// Route only real flat packaged modules, never arbitrary URL paths. Shared by browser fixtures and typing measurement.
export async function isPackagedLibraryModule(path) {
  const match = /^\/lib\/([a-z][a-z0-9-]*\.mjs)$/u.exec(path);
  if (!match) return false;
  modules ??= readdir(new URL('../../dist/lineleaf/lib/', import.meta.url)).then(files => new Set(files.filter(file => file.endsWith('.mjs'))));
  return (await modules).has(match[1]);
}
