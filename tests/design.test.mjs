import assert from 'node:assert/strict';
import {test, before, after} from 'node:test';
import {readFile} from 'node:fs/promises';
import {extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {panelFor} from './fixtures/panel-driver.mjs';
// The look of every surface: shared tokens meet WCAG AA in light and dark, and the redesigned popup, settings page, inline badge,
// underlines and word popover behave the way their design says. Editing and request behaviour is covered by the other suites.
const DIST = fileURLToPath(new URL('../dist/lineleaf/', import.meta.url)), ROOT = fileURLToPath(new URL('../', import.meta.url));

// ---------- tokens ----------
const luminance = hex => {
  const n = parseInt(hex.slice(1), 16), lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const css = await readFile(new URL('../extension/tokens.css', import.meta.url), 'utf8'), split = css.indexOf('@media');
const read = block => Object.fromEntries([...block.matchAll(/--ll-([a-z0-9-]+):\s*(#[0-9a-f]{6})/g)].map(m => [m[1], m[2]]));
const palettes = {light: read(css.slice(0, split))}; palettes.dark = {...palettes.light, ...read(css.slice(split))};
// [foreground, background, minimum]: text pairs need 4.5, graphics and underlines 3.
const PAIRS = [['ink', 'bg', 7], ['ink', 'surface', 7], ['ink-2', 'bg', 4.5], ['ink-2', 'surface', 4.5], ['ink-2', 'surface-2', 4.5], ['ink-3', 'bg', 4.5], ['ink-3', 'surface', 4.5],
  ['on-brand', 'brand', 4.5], ['on-brand', 'brand-hover', 4.5], ['brand-ink', 'brand-soft', 4.5], ['brand-ink', 'bg', 4.5], ['brand-ink', 'surface', 4.5],
  ['fix-ink', 'fix-soft', 4.5], ['fix-ink', 'bg', 4.5], ['fix-ink', 'surface', 4.5], ['clear-ink', 'clear-soft', 4.5], ['clear-ink', 'bg', 4.5], ['clear-ink', 'surface', 4.5],
  ['style-ink', 'style-soft', 4.5], ['style-ink', 'bg', 4.5], ['style-ink', 'surface', 4.5], ['warn-ink', 'warn-soft', 4.5], ['on-accent', 'fix', 4.5], ['on-accent', 'clear', 4.5],
  ['fix', 'bg', 3], ['clear', 'bg', 3], ['style', 'bg', 3], ['brand', 'bg', 3], ['bg', 'ink', 7]];
for (const scheme of ['light', 'dark']) {
  test(`design tokens meet WCAG AA in ${scheme} mode`, () => {
    for (const [fg, bg, minimum] of PAIRS) assert.ok(ratio(palettes[scheme][fg], palettes[scheme][bg]) >= minimum, `${scheme}: ${fg} on ${bg} is ${ratio(palettes[scheme][fg], palettes[scheme][bg]).toFixed(2)}, needs ${minimum}`);
    assert.ok(palettes[scheme]['line'] && palettes[scheme]['line-soft']);
  });
}
test('the dark palette redefines every colour token the light palette defines', () => {
  const dark = read(css.slice(split)), colours = Object.keys(palettes.light).filter(key => !/^(r|r-sm|r-lg|pill|font|mono)$/.test(key));
  assert.deepEqual(colours.filter(key => !(key in dark)).sort(), []);
});

// ---------- rendered pages ----------
let browser;
before(async () => {
  browser = await chromium.launch({executablePath: process.env.LINELEAF_CHROMIUM_PATH || undefined,
    args: process.env.LINELEAF_CHROMIUM_SINGLE_PROCESS === '1' ? ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--single-process'] : []});
});
after(async () => { await browser?.close(); });
// Runs inside the page: the contrast of an element's text against the first opaque background behind it.
const CONTRAST = '(' + function (el) {
  const rgb = value => (value.match(/[\d.]+/g) ?? []).map(Number), channel = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  let background = [255, 255, 255];
  for (let node = el; node; node = node.parentElement ?? node.getRootNode().host) {
    const color = rgb(getComputedStyle(node).backgroundColor); if (color.length === 3 || color[3] === 1) { background = color; break; }
  }
  const [a, b] = [lum(rgb(getComputedStyle(el).color)), lum(background)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05);
}.toString() + ')';
const TYPES = {'.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml'};
const stub = ({sites = [], paused = false, automatic = false, clarity = false, url = 'https://mail.example.com/compose'} = {}) => `
  const settings = {variant: 'US', model: '', effort: 'low', speed: '', paused: ${paused}, automatic: ${automatic}, clarity: ${clarity}, dictionary: ['lineleaf'], sites: ${JSON.stringify(sites)}};
  window.chrome = {runtime: {id: 'abcdefghijklmnopabcdefghijklmnop', openOptionsPage() {}, async sendMessage({type, payload}) {
      if (type === 'save-settings') Object.assign(settings, payload.changes);
      if (type === 'get-check-timing') return {ok: true, value: window.lastTiming ?? null};
      if (type === 'check-connection') return {ok: true, value: {availability: 'available', authentication: 'authenticated', sign_in: 'subscription', tool_isolation: true, update_required: window.outdated === true}};
      return {ok: true, value: settings};
    }}, tabs: {async query() { return [{id: 1, url: ${JSON.stringify(url)}, incognito: false}]; }}, permissions: {async request() { return true; }}};`;
async function extensionPage(file, options = {}, {scheme = 'light', viewport = {width: 360, height: 640}, reducedMotion = 'no-preference'} = {}) {
  const context = await browser.newContext({colorScheme: scheme, viewport, reducedMotion}), page = await context.newPage();
  await page.route('https://ext.lineleaf.test/**', async route => {
    const path = new URL(route.request().url()).pathname.slice(1);
    try { await route.fulfill({body: await readFile(`${DIST}${path}`), contentType: TYPES[extname(path)] ?? 'text/plain'}); } catch { await route.fulfill({status: 404, body: ''}); }
  });
  await page.addInitScript(stub(options)); await page.goto(`https://ext.lineleaf.test/${file}`);
  return {page, context};
}
const settled = (page, selector) => page.waitForFunction(selector => document.querySelector(selector)?.textContent && document.querySelector(selector).textContent !== 'Loading', selector);

test('popup: state, switches and the reason the panel is unavailable are visible and named', async () => {
  for (const [options, label, disabled, hint] of [
    [{}, 'Off here', true, /Turn on/], [{sites: ['https://mail.example.com']}, 'On here', false, null],
    [{sites: ['https://mail.example.com'], paused: true}, 'Paused', true, /paused/i], [{url: 'chrome://extensions'}, 'Unavailable', true, /cannot run/]
  ]) {
    const {page, context} = await extensionPage('popup.html', options);
    await page.waitForFunction(label => document.querySelector('#state').textContent === label, label);
    assert.equal(await page.locator('#open').isDisabled(), disabled, label);
    if (hint) assert.match(await page.locator('#status').textContent(), hint, label); else assert.equal(await page.locator('#status').textContent(), '');
    assert.ok(await page.getByRole('switch', {name: /Check my writing here/}).count() === 1 && await page.getByRole('switch', {name: /Pause on all sites/}).count() === 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, `${label}: no sideways scroll at popup width`);
    await context.close();
  }
});
test('popup and settings keep readable contrast, in light and dark, as rendered', async () => {
  for (const scheme of ['light', 'dark']) {
    const popup = await extensionPage('popup.html', {sites: ['https://mail.example.com']}, {scheme});
    await settled(popup.page, '#state');
    for (const selector of ['h1', '.tagline', '#site', '.switch-text .muted', '.hint', '.fine', '#state', '#open', '#connection', '.label-line'])
      assert.ok(await popup.page.locator(selector).first().evaluate((el, src) => eval(src)(el), CONTRAST) >= 4.5, `${scheme} popup ${selector}`);
    await popup.context.close();
    const settings = await extensionPage('options.html', {sites: ['https://mail.example.com'], automatic: true, clarity: true}, {scheme, viewport: {width: 1100, height: 800}});
    await settled(settings.page, '#authorize');
    for (const selector of ['h1', '.card-section h2', '.lede', '.facts li', '.tag', '.nav a', '.nav a[aria-current="true"]', 'label[for="variant"]', '.muted', '#status', 'button.primary', 'button.danger', '.command code', '.sites li .origin'])
      assert.ok(await settings.page.locator(selector).first().evaluate((el, src) => eval(src)(el), CONTRAST) >= 4.5, `${scheme} settings ${selector}`);
    await settings.context.close();
  }
});
test('settings: every control is named, the side navigation follows the section, and nothing scrolls sideways', async () => {
  const {page, context} = await extensionPage('options.html', {sites: ['https://mail.example.com', 'https://x.com']}, {viewport: {width: 1100, height: 700}});
  await settled(page, '#authorize');
  const unnamed = await page.evaluate(() => [...document.querySelectorAll('input, select, textarea, button')].filter(el => !(el.labels?.length || el.getAttribute('aria-label') || el.textContent.trim())).map(el => el.id || el.tagName));
  assert.deepEqual(unnamed, []);
  assert.equal(await page.locator('.nav a[aria-current="true"]').textContent(), 'Writing');
  await page.locator('#privacy').scrollIntoViewIfNeeded(); await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() => document.querySelector('.nav a[aria-current="true"]')?.textContent === 'Privacy & data');
  assert.equal(await page.getByRole('button', {name: 'Disable https://x.com'}).count(), 1);
  const bar = await page.locator('.savebar').boundingBox(); assert.equal(Math.round(bar.y + bar.height), 700); // Save stays in reach.
  // The Save bar never covers the end of the page: something added after it (the installed-extension tests add a button there) stays clickable.
  await page.evaluate(() => { const probe = document.createElement('button'); probe.textContent = 'End of page probe'; probe.onclick = () => { window.probed = true; }; document.body.append(probe); });
  await page.getByRole('button', {name: 'End of page probe'}).click(); assert.equal(await page.evaluate(() => window.probed), true);
  await page.evaluate(() => scrollTo(0, 0));
  assert.equal(await page.locator('#clarity').isDisabled(), true); await page.locator('#automatic').check(); assert.equal(await page.locator('#clarity').isDisabled(), false);
  await page.getByRole('button', {name: 'Check Seatline'}).click(); await page.waitForFunction(() => /Codex: available/.test(document.querySelector('#status').textContent));
  await page.setViewportSize({width: 420, height: 800});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'no sideways scroll on a narrow window');
  await context.close();
  const empty = await extensionPage('options.html', {}, {viewport: {width: 1100, height: 700}}); await settled(empty.page, '#authorize');
  assert.match(await empty.page.locator('#sites li.empty').textContent(), /No sites enabled yet/); await empty.context.close();
});
test('Check Seatline does not call a companion that cannot receive writing ready, in settings or in the toolbar menu', async () => {
  for (const [file, options] of [['options.html', {}], ['popup.html', {sites: ['https://mail.example.com']}]]) {
    const {page, context} = await extensionPage(file, options, {viewport: {width: 1100, height: 700}});
    await settled(page, file === 'options.html' ? '#authorize' : '#state');
    await page.evaluate(() => { window.outdated = true; });
    await page.getByRole('button', {name: 'Check Seatline'}).click();
    await page.waitForFunction(() => /seatline-companion install/.test(document.querySelector('#status').textContent));
    assert.match(await page.locator('#status').textContent(), /^Codex: available, authenticated, subscription\. .*nothing was sent/);
    await context.close();
  }
});
test('settings: the authorization command can be copied', async () => {
  const {page, context} = await extensionPage('options.html', {}, {viewport: {width: 1100, height: 700}});
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {origin: 'https://ext.lineleaf.test'}); await settled(page, '#authorize');
  await page.getByRole('button', {name: 'Copy'}).click(); await page.waitForFunction(() => document.querySelector('#status').textContent === 'Command copied.');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'seatline-companion authorize lineleaf codex chrome-extension://abcdefghijklmnopabcdefghijklmnop/');
  await context.close();
});
test('settings: saved model, effort and speed stay together and timings label the requested speed', async () => {
  const {page, context} = await extensionPage('options.html', {}, {viewport: {width: 1100, height: 700}});
  await settled(page, '#authorize');
  assert.equal(await page.getByLabel('Reasoning effort').inputValue(), 'low');
  assert.equal(await page.getByLabel('Speed', {exact: true}).inputValue(), '');
  const model = await page.locator('#model').boundingBox(), effort = await page.locator('#effort').boundingBox();
  assert.equal(Math.round(model.y), Math.round(effort.y));
  await page.locator('#model').fill('gpt-6-luna'); await page.getByLabel('Reasoning effort').selectOption('xhigh');
  await page.getByLabel('Speed', {exact: true}).selectOption('fast');
  await page.getByRole('button', {name: 'Save preferences'}).click();
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Preferences saved.');
  assert.equal(await page.getByLabel('Reasoning effort').inputValue(), 'xhigh');
  assert.equal(await page.getByLabel('Speed', {exact: true}).inputValue(), 'fast');
  assert.match(await page.locator('#speed-help').textContent(), /more subscription allowance/);
  assert.equal(await page.getByRole('link', {name: 'current Codex speed and usage'}).getAttribute('href'), 'https://learn.chatgpt.com/docs/agent-configuration/speed');
  await page.evaluate(() => { window.lastTiming = {kind: 'manual', mode: 'proofread', requested_model: 'gpt-6-luna', reasoning_effort: 'xhigh', requested_service_tier: 'fast', outcome: 'completed', total_ms: 3420, readiness_ms: 8, finish_ms: 17}; });
  await page.getByText('Last manual check timing', {exact: true}).click(); await page.getByRole('button', {name: 'Refresh timing'}).click();
  await page.waitForFunction(() => document.querySelector('#timing-summary').textContent.includes('gpt-6-luna'));
  assert.match(await page.locator('#timing-phases').textContent(), /Unavailable/);
  assert.match(await page.locator('#timing-phases').textContent(), /3\.42 s/);
  assert.match(await page.locator('#timing-summary').textContent(), /xhigh · requested fast speed/);
  await page.getByLabel('Speed', {exact: true}).selectOption('standard');
  await page.getByRole('button', {name: 'Save preferences'}).click();
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Preferences saved.' && document.querySelector('#speed').value === 'standard');
  assert.equal(await page.getByLabel('Reasoning effort').inputValue(), 'xhigh');
  assert.equal(await page.locator('#model').inputValue(), 'gpt-6-luna');
  await page.getByLabel('Speed', {exact: true}).selectOption('');
  await page.getByRole('button', {name: 'Save preferences'}).click();
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Preferences saved.' && document.querySelector('#speed').value === '');
  assert.equal(await page.getByLabel('Reasoning effort').inputValue(), 'xhigh');
  assert.equal(await page.locator('#model').inputValue(), 'gpt-6-luna');
  await page.evaluate(() => { window.lastTiming = {version: 2, kind: 'manual', mode: 'proofread', requested_service_tier: null, attempts: 1, outcome: 'completed'}; });
  await page.getByRole('button', {name: 'Refresh timing'}).click();
  await page.waitForFunction(() => document.querySelector('#timing-summary').textContent.includes('provider default speed'));
  await page.evaluate(() => { window.lastTiming = {version: 1, kind: 'manual', mode: 'proofread', attempts: 1, outcome: 'completed'}; });
  await page.getByRole('button', {name: 'Refresh timing'}).click();
  await page.waitForFunction(() => document.querySelector('#timing-summary').textContent.includes('speed unavailable'));
  await context.close();
});
test('keyboard focus is visible on switches and buttons, and reduced motion removes the animations', async () => {
  const {page, context} = await extensionPage('popup.html', {sites: ['https://mail.example.com']}, {reducedMotion: 'reduce'});
  await settled(page, '#state'); await page.keyboard.press('Tab');
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow), 'none');
  assert.ok(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#enabled'), '::after').transitionDuration) <= 0.001));
  await context.close();
});

// ---------- inline ----------
async function inlinePage({scheme = 'light', reducedMotion = 'no-preference'} = {}) {
  const context = await browser.newContext({colorScheme: scheme, reducedMotion, viewport: {width: 900, height: 700}}), page = await context.newPage();
  await page.route('https://design.lineleaf.test/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const files = new Map([['/content.js', 'dist/lineleaf/content.js'], ['/controller-bridge.mjs', 'tests/fixtures/controller-bridge.mjs'], ['/test-api.mjs', 'tests/fixtures/extension-api.mjs']]);
    const file = files.get(path) ?? (['controller.mjs', 'native-seatline.mjs', 'policy.mjs', 'candidates.mjs', 'editor-policy.mjs', 'check-timing.mjs'].some(x => path === `/lib/${x}`) ? `dist/lineleaf${path}` : 'tests/fixtures/selection.html');
    let body = await readFile(ROOT + file, 'utf8');
    if (file.endsWith('.html')) body = body.replace('<script src="/content.js"></script>', '<script type="module" src="/controller-bridge.mjs"></script>');
    await route.fulfill({body, contentType: /\.m?js$/.test(file) ? 'text/javascript' : 'text/html'});
  });
  await page.goto('https://design.lineleaf.test/?automatic'); await page.waitForFunction(() => window.__lineleafMounted);
  return {page, context, inline: panelFor(page, {attribute: 'data-lineleaf-inline'})};
}
const TWO = '{"corrections":[{"before":"go","after":"goes","left":"He ","right":" to","category":"grammar","explanation":"Subject agreement"},{"before":"wrk","after":"work","left":"the ","right":".","category":"spelling","explanation":"Misspelled word"}]}';
async function withSuggestions(options) {
  const env = await inlinePage(options); await env.page.evaluate(answer => { fixture.worker.answer = answer; }, TWO);
  await env.page.locator('#textarea').fill('He go to work and he is late for the wrk.'); await env.inline.locator('.underline').waitFor();
  return env;
}
const visible = (inline, selector) => inline.locator(selector).evaluate(el => el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0);
test('badge shows the count and the kind of suggestion, and a working ring while a check runs', async () => {
  const {page, context, inline} = await withSuggestions();
  assert.deepEqual(await inline.locator('.badge').evaluate(el => ({state: el.dataset.state, count: el.querySelector('.count')?.textContent, tip: el.dataset.tip})), {state: 'fix', count: '2', tip: '2 suggestions'});
  assert.match(await inline.locator('.badge').evaluate(el => el.getAttribute('aria-label')), /^2 suggestions\./); // The count is decoration; the name carries the message.
  await page.evaluate(() => { fixture.worker.hold = true; }); await page.keyboard.press('Alt+Shift+l'); await inline.locator('#card-title').waitFor();
  await inline.button('Check now').evaluate(el => el.focus()); await page.keyboard.press('Enter'); // An explicit check is not held back by the automatic interval.
  await inline.locator('.badge').waitFor(el => el.dataset.busy === 'true');
  assert.equal(await inline.locator('.badge').evaluate(el => el.dataset.tip), 'Checking…');
  assert.equal(await inline.locator('.ring').evaluate(el => getComputedStyle(el).animationName), 'll-spin');
  await context.close();
});
test('a word opens a compact popover beside it with the word marked; More reveals the rewrite tools; Escape closes it', async () => {
  const {page, context, inline} = await withSuggestions();
  const word = await inline.locator('.underline').evaluate(el => { const r = el.getBoundingClientRect(); return {left: r.left, right: r.right, bottom: r.bottom}; });
  await inline.locator('.underline').click(); await inline.locator('#card-title').waitFor();
  assert.equal(await inline.locator('.card').evaluate(el => el.dataset.compact), 'true');
  const card = await inline.locator('.card').evaluate(el => { const r = el.getBoundingClientRect(); return {top: r.top, left: r.left}; });
  assert.ok(card.top >= word.bottom && card.top - word.bottom < 24, 'the card sits just under the word'); assert.ok(Math.abs(card.left - word.left) < 40, 'and starts at it');
  assert.equal(await inline.locator('.mark').count(), 1); // The word the card is about is tinted.
  assert.equal(await visible(inline, '.rewrite'), false); assert.equal(await visible(inline, '.foot'), false);
  assert.equal(await inline.button('More').evaluate(el => el.getAttribute('aria-expanded')), 'false');
  assert.equal(await visible(inline, '#status'), true); // Feedback stays visible in the compact card.
  await inline.button('More').evaluate(el => el.focus()); await page.keyboard.press('Enter');
  assert.equal(await visible(inline, '.rewrite'), true); assert.equal(await inline.button('Less').evaluate(el => el.getAttribute('aria-expanded')), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await inline.locator('.card').evaluate(el => el.hidden), true); assert.equal(await inline.locator('.mark').count(), 0);
  assert.equal(await page.locator('#textarea').evaluate(el => document.activeElement === el), true);
  await context.close();
});
test('the keyboard opens the full card: rewrite tools and everyday actions are visible, with no word marked', async () => {
  const {page, context, inline} = await withSuggestions(); await page.keyboard.press('Alt+Shift+l'); await inline.locator('#card-title').waitFor();
  assert.equal(await inline.locator('.card').evaluate(el => el.dataset.compact), 'false');
  for (const selector of ['.rewrite', '.foot', '.privacy']) assert.equal(await visible(inline, selector), true, selector);
  assert.equal(await inline.button('More').count(), 0);
  await context.close();
});
test('an underline covers only the foot of the word, so clicking the word itself still places the caret', async () => {
  const {page, context, inline} = await withSuggestions();
  assert.equal(await inline.locator('.underline').evaluate(el => el.getBoundingClientRect().height), 6);
  const middle = await inline.locator('.underline').evaluate(el => { const r = el.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top - 7}; });
  await page.mouse.click(middle.x, middle.y);
  assert.equal(await inline.locator('.card').evaluate(el => el.hidden), true); // The click reached the text, not the underline.
  assert.equal(await page.locator('#textarea').evaluate(el => el.selectionStart >= 3 && el.selectionStart <= 5), true);
  await context.close();
});
test('the inline card is legible and calm in dark mode and with reduced motion', async () => {
  for (const scheme of ['light', 'dark']) {
    const {page, context, inline} = await withSuggestions({scheme, reducedMotion: 'reduce'}); await page.keyboard.press('Alt+Shift+l'); await inline.locator('#card-title').waitFor();
    const background = await inline.locator('.card').evaluate(el => getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number));
    assert.equal(background[0] < 100, scheme === 'dark', `${scheme} card background`);
    for (const selector of ['#card-title', '.category', '.change .after', '.change .before', '.explanation, summary', '.muted', '.privacy', '#status', 'button.primary', '.chip.lead', '.chip:not(.lead)', '.foot button'])
      assert.ok(await inline.locator(selector).evaluate((el, src) => eval(src)(el), CONTRAST) >= 4.5, `${scheme} ${selector}`);
    assert.ok(await inline.locator('.card').evaluate(el => parseFloat(getComputedStyle(el).animationDuration) <= 0.001), 'reduced motion removes the pop-in');
    await context.close();
  }
});
