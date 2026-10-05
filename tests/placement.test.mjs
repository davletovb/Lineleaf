import assert from 'node:assert/strict';
import {test, before, after} from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {panelFor} from './fixtures/panel-driver.mjs';
import {LAYOUTS} from './fixtures/composers.mjs';
// Where the badge sits. Real composers put controls (send, voice, model picker) in the strip right under the editable, so the
// badge must find a free spot next to the visible input box instead of covering them. The layouts are synthetic copies of
// the arrangements of popular chat and social composers; nothing here says how Lineleaf looks on those live sites.
let browser, page, inline;
before(async () => {
  browser = await chromium.launch({executablePath: process.env.LINELEAF_CHROMIUM_PATH || undefined,
    args: process.env.LINELEAF_CHROMIUM_SINGLE_PROCESS === '1' ? ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--single-process'] : []});
  page = await browser.newPage({viewport: {width: 900, height: 700}}); inline = panelFor(page, {attribute: 'data-lineleaf-inline'});
  await page.route('https://placement.lineleaf.test/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const files = new Map([['/content.js', '../dist/lineleaf/content.js'], ['/controller-bridge.mjs', './fixtures/controller-bridge.mjs'], ['/test-api.mjs', './fixtures/extension-api.mjs']]);
    const file = files.get(path) ?? (['controller.mjs', 'native-seatline.mjs', 'policy.mjs', 'candidates.mjs', 'editor-policy.mjs'].some(x => path === `/lib/${x}`) ? `../dist/lineleaf${path}` : './fixtures/selection.html');
    let body = await readFile(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    if (file.endsWith('.html')) body = body.replace('<script src="/content.js"></script>', '<script type="module" src="/controller-bridge.mjs"></script>');
    await route.fulfill({body, contentType: /\.m?js$/.test(file) ? 'text/javascript' : 'text/html'});
  });
});
after(async () => { await browser?.close(); });

async function show(html, setup = () => {}, text = 'He go to work and he is late for the wrk.') {
  await page.goto('https://placement.lineleaf.test/?automatic'); await page.waitForFunction(() => window.__lineleafMounted);
  await page.evaluate(html => { document.body.innerHTML = html; }, html); await page.evaluate(setup);
  await page.locator('#field').fill(text); await inline.locator('.underline').waitFor();
  await settle();
}
const settle = () => page.waitForTimeout(450); // Placement is re-chosen at most every 400 ms; the poll repaints on movement.
const badge = () => inline.locator('.badge').evaluate(el => { const r = el.getBoundingClientRect(); return {left: r.left, top: r.top, right: r.right, bottom: r.bottom, place: el.dataset.place}; });
const boxOf = () => page.evaluate(() => { const r = (document.querySelector('[data-box]') ?? document.querySelector('#field')).getBoundingClientRect(); return {left: r.left, top: r.top, right: r.right, bottom: r.bottom}; });
const rects = selector => page.evaluate(selector => [...document.querySelectorAll(selector)].map(el => { const r = el.getBoundingClientRect(); return {left: r.left, top: r.top, right: r.right, bottom: r.bottom}; }), selector);
const touches = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const gap = (a, b) => Math.hypot(Math.max(0, a.left - b.right, b.left - a.right), Math.max(0, a.top - b.bottom, b.top - a.bottom));

for (const name of Object.keys(LAYOUTS)) {
  test(`${name}: the badge covers no control and not the field, stays on screen, and stays by the input box`, async () => {
    await show(LAYOUTS[name]);
    const spot = await badge(), [field] = await rects('#field'), box = await boxOf();
    assert.ok(spot.left >= 8 && spot.top >= 8 && spot.right <= 900 - 8 && spot.bottom <= 700 - 8, `on screen: ${JSON.stringify(spot)}`);
    for (const control of await rects('[data-control]')) assert.ok(!touches(spot, control), `covers a control at ${JSON.stringify(control)} from ${JSON.stringify(spot)} (${spot.place})`);
    assert.ok(!touches(spot, field), 'the badge never sits on the text it is about');
    assert.ok(gap(spot, box) <= 16, `by the input box, not far from it: ${Math.round(gap(spot, box))} px (${spot.place})`);
  });
}
test('the pill keeps its border clear: the badge is outside the rounded box, never straddling its edge', async () => {
  await show(LAYOUTS.pill);
  const spot = await badge(), box = await boxOf();
  assert.ok(!(spot.top < box.bottom && spot.bottom > box.bottom) && !(spot.top < box.top && spot.bottom > box.top), `an edge of the box crosses the badge: ${JSON.stringify({spot, box})}`);
});
test('scrolling carries the badge with its field, from the remembered place and without a new search', async () => {
  for (const name of ['card', 'dock']) {
    await show(LAYOUTS[name]); await page.evaluate(() => { document.body.style.minHeight = '2400px'; });
    const before = await badge(), [field] = await rects('#field');
    for (let i = 0; i < 3; i++) { await page.evaluate(() => scrollBy(0, 30)); await page.waitForTimeout(60); } // all inside the 400 ms the choice is kept
    const after = await badge(), [moved] = await rects('#field');
    assert.equal(moved.top, field.top - 90); assert.equal(after.place, before.place, name);
    assert.ok(Math.abs((after.top - before.top) - (moved.top - field.top)) < 1, `${name}: the badge moves exactly as far as the field (${after.top - before.top} vs ${moved.top - field.top})`);
  }
});
test('a control that appears on the badge pushes it to a free spot, and it stays there afterwards', async () => {
  await show(LAYOUTS.card); const first = await badge();
  await page.evaluate(spot => { const b = document.createElement('button'); b.id = 'late'; b.dataset.control = ''; b.textContent = 'New'; b.style.cssText = `position:fixed;left:${spot.left - 4}px;top:${spot.top - 4}px;width:${spot.right - spot.left + 8}px;height:${spot.bottom - spot.top + 8}px;z-index:99`; document.body.append(b); dispatchEvent(new Event('resize')); }, first);
  await settle(); const moved = await badge(), [late] = await rects('#late');
  assert.ok(!touches(moved, late), `moved out from under the new control: ${JSON.stringify(moved)}`); assert.notEqual(moved.place, first.place);
  // Once the control goes away the old place is clear again, but a place that is clear is kept: no hopping back and forth.
  await page.evaluate(() => { document.getElementById('late').remove(); dispatchEvent(new Event('resize')); }); await settle();
  assert.equal((await badge()).place, moved.place);
});
test('a field that fills the window still gets a badge on screen', async () => {
  await show('<textarea id="field" style="position:fixed;inset:0;width:100vw;height:100vh;border:0;font:18px system-ui">He go to work.</textarea>');
  const spot = await badge();
  assert.ok(spot.left >= 0 && spot.top >= 0 && spot.right <= 900 && spot.bottom <= 700, JSON.stringify(spot));
});
test('a clickable <div> and a control inside a shadow root count as controls, not as empty space', async () => {
  // Bare field, no box around it. Below its end: a <div> that is only clickable by its cursor. Above its end: a shadow-hosted button.
  await show(`<style>body{margin:0}</style><textarea id="field" style="position:absolute;left:200px;top:200px;width:400px;height:60px">He go to work.</textarea>
    <div data-control style="position:absolute;left:560px;top:264px;width:60px;height:40px;cursor:pointer"></div><div id="host" data-control style="position:absolute;left:560px;top:156px;width:60px;height:40px"></div>`,
    () => { document.getElementById('host').attachShadow({mode: 'open'}).innerHTML = '<button style="width:60px;height:40px">Go</button>'; });
  const spot = await badge();
  for (const control of await rects('[data-control]')) assert.ok(!touches(spot, control), `${JSON.stringify(spot)} covers ${JSON.stringify(control)}`);
  assert.notEqual(spot.place, 'below-end:0'); assert.notEqual(spot.place, 'above-end:0'); // both were looked at and refused
});
test('the tooltip opens toward the room there is', async () => {
  // Computed values of an absolutely positioned pseudo-element are pixels, so compare what the rules specify: 0px on the side it hangs from.
  const tip = () => inline.locator('.badge').evaluate(el => { const s = getComputedStyle(el, '::after'); return {align: el.dataset.tipAlign ?? null, flip: el.dataset.tipFlip ?? null, left: s.left, right: s.right, top: s.top}; });
  await show(LAYOUTS.card); // plenty of room: above the badge, growing to the left (the original behaviour)
  const roomy = await tip(); assert.deepEqual([roomy.align, roomy.flip, roomy.right, roomy.top.startsWith('-')], [null, null, '0px', true]);
  // Near the left edge the tooltip grows to the right instead of off the screen.
  await show('<style>body{margin:0}</style><textarea id="field" style="position:fixed;left:8px;top:300px;width:100px;height:60px">He go to work.</textarea>');
  const left = await tip(); assert.deepEqual([left.align, left.left], ['start', '0px']);
  // Near the top, where the badge has to go above its field, the tooltip opens below the badge.
  await show(`<style>body{margin:0}</style><textarea id="field" style="position:fixed;left:300px;top:48px;width:300px;height:40px">He go to work.</textarea>
    <div data-control style="position:fixed;left:0;top:92px;width:100%;height:60px;cursor:pointer"></div>`);
  const top = await tip(); assert.equal(top.flip, 'below'); assert.ok(parseFloat(top.top) > 30, `below the badge: ${top.top}`);
});
