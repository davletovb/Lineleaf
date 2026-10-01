# A-04 — Safe editor mutation prototype

[EditorAdapter](../../prototypes/editor/editor-adapter.mjs) and [synthetic fixtures](../../tests/fixtures/editors.html) implement and test the minimal Chromium mutation slice. This is not evidence of compatibility with Gmail, Slack, React, or Google Docs.

| Surface | Verified behavior / boundary |
| --- | --- |
| Textarea | Exact-span replacement; caret, native undo, keyboard undo |
| Text/search input | Exact-span replacement; caret and backward selection; native undo |
| Controlled input fixture | Synchronous input state update with microtask value reflection; replacement and undo keep state consistent |
| Basic contenteditable | Flat text with inline span/bold/italic/etc.; replacement within one text node keeps formatting and undo |
| Cross-format range, block/rich editor, noneditable island | Copy fallback; no direct replacement |

Fifteen browser regressions passed locally using Playwright 1.62.1 and headless Chromium **153.0.8010.0**. A separately installed test browser used a single-process launch because of workspace IPC restrictions. CI runs the pinned Playwright browser with its normal process setup; neither browser package nor Playwright ships to extension users.

[CI run 36856262500](https://github.com/davletovb/Lineleaf/actions/runs/36856262500), on code commit `9d1ccaed15f3efcb0540db5d183fb5eab2718a2d`, passed all fifteen browser tests and 26 Python harness regressions on **both Linux and macOS**, using the pinned Playwright browser and normal process configuration. Keyboard undo selects `Meta+z` on macOS and `Control+z` elsewhere. Historical [run 36832723008](https://github.com/davletovb/Lineleaf/actions/runs/36832723008) covered the original `4e34703` implementation: fifteen Linux editor tests on Chromium **151.0.7922.34**, alongside sixteen Python regressions.

The adapter owns opaque snapshots and checks source plus input/DOM revision immediately before editing and again after focus. It rejects another adapter's snapshot, stale/ABA input revisions, composition, disconnected/readonly/disabled fields, invalid source spans, and grapheme-splitting offsets. Span offsets are UTF-16 DOM offsets, with `Intl.Segmenter` guarding emoji and combining sequences. Positions must be derived in application code, never accepted from a model.

Supported replacement uses Chromium `document.execCommand('insertText')`, followed by an exact resulting-text/inline-tree check and caret transformation. Successful edits retain native history. The B-05 review fix adds failed-edit recovery: a site rewrite, partial insertion, or formatting change restores the captured source and original inline nodes. Native undo is attempted only when document input history confirms no unrelated field edit; otherwise field-local restoration notifies controlled state with an input event. If a site rejects the restored value again, the DOM source is recovered and the panel reports unverifiable site state. That field becomes copy-only until reload. Direct value/tree restoration is reserved for this failure path. Undo uses native history and refuses if text/revision changed or another field emitted input. The selection panel now displays the adapter result and provides clipboard/manual-copy fallback.

`execCommand` is deprecated and its event/undo behavior is browser-specific. [MDN documents the undo-preservation use case and limitations](https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand). This decision needs continued Chromium regression testing and explicit site adapters. No claim is made that every controlled framework or formatting layout will accept native insertion. The prototype cannot guarantee isolation from unobserved script edits to unrelated document undo history; a production undo UI must respect that uncertainty.

## Reproduce

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm test
```

`npm test` runs Python harness, extension logic, and browser tests. With an existing test Chromium, set `LINELEAF_CHROMIUM_PATH` to its executable. The fixtures are served through Playwright request interception; no local HTTP listener is added. Single-process mode (`LINELEAF_CHROMIUM_SINGLE_PROCESS=1`) is an optional constrained-runner workaround, not the CI/default browser configuration.

The adapter suite now has sixteen tests, including failed-edit recovery after a site synchronously edits another field. Fifteen bundled-panel tests cover selection-only sending, preview/accept/dismiss/cancel/undo, sensitive and composition guards, stale responses, safe literal previews, partial `maxlength` insertion, controlled-state normalization, and formatting/comment restoration. See [selection verification](../evidence/selection-prototype-ci.md) for the current code revision and CI evidence. Real editor validation remains D-01/D-03.
