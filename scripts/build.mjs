import {build} from 'esbuild';
import {cp, mkdir, rm, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = `${root}dist/lineleaf`;
await rm(output, {recursive: true, force: true}); await mkdir(output, {recursive: true});
for (const file of await readdir(`${root}extension`)) {
  if (['content.mjs', 'panel.css', 'inline.css'].includes(file)) continue;
  await cp(`${root}extension/${file}`, `${output}/${file}`, {recursive: true});
}
for (const file of ['selection.mjs', 'inline.mjs', 'geometry.mjs', 'editor-context.mjs', 'rich-text.mjs']) await rm(`${output}/lib/${file}`); // Browser-only modules and adapter are bundled into content.js.
await build({entryPoints: [`${root}extension/content.mjs`], outfile: `${output}/content.js`, bundle: true, format: 'iife',
  target: 'chrome124', loader: {'.css': 'text'}, legalComments: 'none', charset: 'utf8'});
console.log('Load unpacked: dist/lineleaf');
