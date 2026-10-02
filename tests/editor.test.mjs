import assert from "node:assert/strict";
import {after, before, test} from "node:test";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
const {chromium} = await import(process.env.LINELEAF_PLAYWRIGHT_MODULE || "playwright");
let browser, page;
before(async () => {
  browser = await chromium.launch({executablePath: process.env.LINELEAF_CHROMIUM_PATH || undefined,
    args: process.env.LINELEAF_CHROMIUM_SINGLE_PROCESS === "1"
      ? ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-zygote", "--single-process"] : []});
  page = await browser.newPage();
});
after(async () => { await browser?.close(); });

async function fixture(run) {
  try {
    // Serve only synthetic fixtures through Playwright interception. No local HTTP listener.
    await page.route("https://lineleaf.test/**", async route => {
      const path = new URL(route.request().url()).pathname;
      const files = new Map([
        ["/", ["./fixtures/editors.html", "text/html"]],
        ["/prototypes/editor/editor-adapter.mjs", ["../prototypes/editor/editor-adapter.mjs", "text/javascript"]],
        ["/extension/lib/editor-context.mjs", ["../extension/lib/editor-context.mjs", "text/javascript"]],
        ["/extension/lib/editor-policy.mjs", ["../extension/lib/editor-policy.mjs", "text/javascript"]]
      ]);
      const file = files.get(path);
      if (!file) return route.abort();
      await route.fulfill({body: await readFile(fileURLToPath(new URL(file[0], import.meta.url))), contentType: file[1]});
    });
    await page.goto("https://lineleaf.test/");
    await page.waitForFunction(() => window.ready);
    await run(page);
  } finally { await page.unrouteAll({behavior: "wait"}); }
}

for (const id of ["textarea", "input", "controlled", "editable"]) {
  test(`${id}: replace exact span, retain caret/formatting and native undo`, async () => fixture(async page => {
    const result = await page.evaluate(id => {
      const element = document.getElementById(id), adapter = adapters[id];
      element.focus();
      if (id === "editable") {
        const node = element.lastChild;
        document.getSelection().setBaseAndExtent(node, node.length, node, node.length);
      } else element.setSelectionRange(14, 14);
      const applied = adapter.apply(adapter.snapshot(), {start: 3, end: 5, before: "go", after: "goes"});
      return {applied, value: element.value ?? element.textContent,
        caret: id === "editable" ? document.getSelection().focusOffset : element.selectionStart,
        bold: id === "editable" ? element.querySelector("strong")?.textContent : null,
        state: id === "controlled" ? controlledState : null};
    }, id);
    assert.equal(result.applied.status, "applied");
    assert.equal(result.value, "He goes to work.");
    assert.equal(result.caret, id === "editable" ? 9 : 16);
    if (id === "editable") assert.equal(result.bold, "goes");
    if (id === "controlled") assert.equal(result.state, result.value);
    const undo = await page.evaluate(id => adapters[id].undo(), id);
    assert.equal(undo.status, "undone");
    assert.equal(await page.locator(`#${id}`).evaluate(el => el.value ?? el.textContent), "He go to work.");
    if (id === "controlled") assert.equal(await page.evaluate(() => controlledState), "He go to work.");
  }));
}

test("keyboard undo restores the original content", async () => fixture(async page => {
  await page.evaluate(() => adapters.textarea.apply(adapters.textarea.snapshot(),
    {start: 3, end: 5, before: "go", after: "goes"}));
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  assert.equal(await page.locator("#textarea").inputValue(), "He go to work.");
}));

test("retains backward selection and adjusts it across a replacement", async () => fixture(async page => {
  const result = await page.evaluate(() => {
    input.focus(); input.setSelectionRange(6, 14, "backward");
    adapters.input.apply(adapters.input.snapshot(), {start: 3, end: 5, before: "go", after: "goes"});
    return [input.selectionStart, input.selectionEnd, input.selectionDirection];
  });
  assert.deepEqual(result, [8, 16, "backward"]);
}));

test("stale response and ABA input revisions never replace text", async () => fixture(async page => {
  const result = await page.evaluate(() => {
    const adapter = adapters.input, snapshot = adapter.snapshot();
    input.value = "Changed"; input.dispatchEvent(new InputEvent("input"));
    input.value = snapshot.source; input.dispatchEvent(new InputEvent("input"));
    return [adapter.apply(snapshot, {start: 3, end: 5, before: "go", after: "goes"}), input.value];
  });
  assert.equal(result[0].status, "copy");
  assert.equal(result[1], "He go to work.");
}));

test("programmatic change without an input event is still detected", async () => fixture(async page => {
  const result = await page.evaluate(() => {
    const snapshot = adapters.input.snapshot(); input.value = "He stays home.";
    return adapters.input.apply(snapshot, {start: 3, end: 5, before: "go", after: "goes"});
  });
  assert.equal(result.status, "copy");
  assert.equal(await page.locator("#input").inputValue(), "He stays home.");
}));

test("composition and removed/readonly fields use copy fallback", async () => fixture(async page => {
  const results = await page.evaluate(() => {
    const edit = {start: 3, end: 5, before: "go", after: "goes"};
    const snapshots = [adapters.input.snapshot(), adapters.textarea.snapshot(), adapters.controlled.snapshot()];
    input.dispatchEvent(new CompositionEvent("compositionstart"));
    textarea.readOnly = true; controlled.remove();
    return [adapters.input.apply(snapshots[0], edit), adapters.textarea.apply(snapshots[1], edit),
      adapters.controlled.apply(snapshots[2], edit)];
  });
  assert.ok(results.every(result => result.status === "copy"));
}));

test("block editors and cross-format corrections use copy fallback", async () => fixture(async page => {
  const result = await page.evaluate(() => [adapters.complex.snapshot(),
    adapters.editable.apply(adapters.editable.snapshot(), {start: 0, end: 5, before: "He go", after: "They go"}),
    editable.innerHTML]);
  assert.equal(result[0], null);
  assert.equal(result[1].reason, "crosses_format_boundary");
  assert.equal(result[2], "He <strong>go</strong> to work.");
}));

test("grapheme boundaries protect emoji and combining characters", async () => fixture(async page => {
  const results = await page.evaluate(() => {
    input.value = "👩🏽‍💻 cafe\u0301 go";
    const adapter = adapters.input, snapshot = adapter.snapshot();
    const split = adapter.apply(snapshot, {start: 0, end: 2, before: "👩", after: "woman"});
    const combining = adapter.apply(snapshot, {start: 11, end: 12, before: "e", after: "E"});
    const source = input.value, at = source.indexOf("go");
    const complete = adapter.apply(adapter.snapshot(), {start: at, end: at + 2, before: "go", after: "goes"});
    return {split, combining, complete, value: input.value};
  });
  assert.equal(results.split.status, "copy");
  assert.equal(results.combining.status, "copy");
  assert.equal(results.complete.status, "applied");
  assert.equal(results.value, "👩🏽‍💻 cafe\u0301 goes");
}));

test("mutation on focus prevents replacement", async () => fixture(async page => {
  const result = await page.evaluate(() => {
    const snapshot = adapters.input.snapshot();
    input.addEventListener("focus", () => { input.value = "Site changed the field."; }, {once: true});
    return adapters.input.apply(snapshot, {start: 3, end: 5, before: "go", after: "goes"});
  });
  assert.equal(result.reason, "changed_on_focus");
  assert.equal(await page.locator("#input").inputValue(), "Site changed the field.");
}));

test("a site rewrite during native input restores the source and blocks further replacement", async () => fixture(async page => {
  const result = await page.evaluate(() => {
    input.addEventListener("input", () => { input.value = "Site owns this value."; });
    return adapters.input.apply(adapters.input.snapshot(), {start: 3, end: 5, before: "go", after: "goes"});
  });
  assert.equal(result.reason, "native_edit_not_confirmed");
  assert.equal(await page.locator("#input").inputValue(), "He go to work.");
  assert.equal(result.restored, true);
  assert.equal(await page.evaluate(() => new (adapters.input.constructor)(input).snapshot()), null);
}));

test("later typing in another field prevents global undo from touching it", async () => fixture(async page => {
  await page.evaluate(() => adapters.input.apply(adapters.input.snapshot(),
    {start: 3, end: 5, before: "go", after: "goes"}));
  await page.locator("#other").fill("Other user edit");
  const result = await page.evaluate(() => adapters.input.undo());
  assert.equal(result.status, "copy");
  assert.equal(await page.locator("#other").inputValue(), "Other user edit");
  assert.equal(await page.locator("#input").inputValue(), "He goes to work.");
}));

test("failed-edit recovery never invokes global undo after a site handler edits another field", async () => fixture(async page => {
  const result = await page.evaluate(() => {
    const native = document.execCommand.bind(document); let undos = 0;
    document.execCommand = (...args) => { if (args[0] === "undo") undos++; return native(...args); };
    input.addEventListener("input", () => {
      if (!input.value.includes("goes")) return;
      input.value = input.value.toUpperCase();
      other.value = "Other site edit"; other.dispatchEvent(new InputEvent("input", {bubbles: true}));
    });
    const applied = adapters.input.apply(adapters.input.snapshot(), {start: 3, end: 5, before: "go", after: "goes"});
    return {applied, undos, source: input.value, other: other.value};
  });
  assert.equal(result.applied.restored, true);
  assert.equal(result.undos, 0);
  assert.equal(result.source, "He go to work.");
  assert.equal(result.other, "Other site edit");
}));

test("snapshot ownership prevents applying another adapter's revision", async () => fixture(async page => {
  assert.equal(await page.evaluate(() => adapters.input.apply(adapters.textarea.snapshot(),
    {start: 3, end: 5, before: "go", after: "goes"}).status), "copy");
}));
