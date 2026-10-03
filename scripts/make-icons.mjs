// Renders extension/icons/lineleaf.svg to the PNG sizes Chrome asks for. Run when the mark changes: node scripts/make-icons.mjs
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root = fileURLToPath(new URL('../', import.meta.url)), svg = await readFile(`${root}extension/icons/lineleaf.svg`, 'utf8');
const browser = await chromium.launch({executablePath: process.env.LINELEAF_CHROMIUM_PATH || undefined});
try {
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({viewport: {width: size, height: size}, deviceScaleFactor: 1});
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    await writeFile(`${root}extension/icons/lineleaf-${size}.png`, await page.screenshot({omitBackground: true, clip: {x: 0, y: 0, width: size, height: size}}));
    await page.close();
  }
} finally { await browser.close(); }
