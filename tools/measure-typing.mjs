import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import os from 'node:os';
import {ROOT, privateJSON, engineHash} from './evaluate-writing.mjs';
import {sha256} from './evaluation/quality.mjs';
export async function measureTyping() {
  const browser = await chromium.launch({executablePath: process.env.LINELEAF_CHROMIUM_PATH || undefined,
    args: process.env.LINELEAF_CHROMIUM_SINGLE_PROCESS === '1' ? ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--single-process'] : []});
  try {
    const scenarios = [], page = await browser.newPage();
      await page.route('https://typing.lineleaf.test/**', async route => {
        const path = new URL(route.request().url()).pathname;
        const files = new Map([['/content.js', 'dist/lineleaf/content.js'], ['/controller-bridge.mjs', 'tests/fixtures/controller-bridge.mjs'], ['/test-api.mjs', 'tests/fixtures/extension-api.mjs']]);
        const file = files.get(path) ?? (['controller.mjs', 'native-seatline.mjs', 'policy.mjs', 'candidates.mjs', 'editor-policy.mjs'].includes(path.split('/').at(-1)) ? `dist/lineleaf${path}` : 'tests/fixtures/selection.html');
        let body = await readFile(join(ROOT, file), 'utf8');
        if (file.endsWith('.html')) body = body.replace('<script src="/content.js"></script>', '<script type="module" src="/controller-bridge.mjs"></script>');
        await route.fulfill({body, contentType: /\.m?js$/.test(file) ? 'text/javascript' : 'text/html'});
      });
    for (const automatic of [false, true]) {
      await page.goto(`https://typing.lineleaf.test/compose${automatic ? '?automatic' : ''}`); await page.waitForFunction(() => window.__lineleafMounted);
      await page.locator('#textarea').evaluate(el => {
        el.value = ''; el.focus(); let started;
        window.timings = [];
        el.addEventListener('beforeinput', event => { if (event.isTrusted) started = performance.now(); }, true);
        el.addEventListener('input', event => { if (event.isTrusted && started !== undefined) queueMicrotask(() => window.timings.push(performance.now() - started)); });
      });
      await page.keyboard.type('He go to work. ' + 'x'.repeat(105));
      if (automatic) await page.waitForFunction(() => fixture.worker.calls.some(x => x.method === 'send'));
      else await page.waitForTimeout(1800);
      const sample = await page.evaluate(() => ({times: [...window.timings].sort((a, b) => a - b), sends: fixture.worker.calls.filter(x => x.method === 'send').length}));
      if (sample.times.length !== 120 || sample.sends !== (automatic ? 1 : 0)) throw new Error('TYPING_PROBE_INCOMPLETE');
      const percentile = p => sample.times[Math.ceil(sample.times.length * p) - 1];
      scenarios.push({automatic, trustedInputs: sample.times.length, providerSubmissions: sample.sends, inputDispatchP50Ms: percentile(.5), inputDispatchP95Ms: percentile(.95), maxMs: sample.times.at(-1)});
    }
    return {schema: 1, kind: 'fixture-browser', engineHash: await engineHash(), packageHash: sha256(await readFile(join(ROOT, 'dist/lineleaf-0.1.0.zip'))),
      browser: browser.version(), platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model ?? 'unknown', scenarios,
      incrementalInputDispatchP95Ms: scenarios[1].inputDispatchP95Ms - scenarios[0].inputDispatchP95Ms,
      releaseEligible: false, boundary: 'Trusted beforeinput through the end of input dispatch; synthetic provider, test hardware, no paint/remote-latency or actual-device acceptance claim.'};
  } finally { await browser.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const report = await measureTyping(); await privateJSON(join(ROOT, 'test-results/typing-overhead.json'), report); console.log(JSON.stringify(report, null, 2)); }
  catch { console.error('TYPING_MEASUREMENT_FAILED'); process.exitCode = 2; }
}
