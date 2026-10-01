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

Supported replacement uses Chromium `document.execCommand('insertText')`, followed by an exact resulting-text check and caret transformation. It performs no whole-value assignment or HTML rewrite. Undo uses native history and refuses if text/revision changed or another field emitted input. A site rewrite during the native input event is reported as unconfirmed and is not overwritten. “Copy” is an adapter result for the future UI to display; the prototype does not write to the clipboard itself.

`execCommand` is deprecated and its event/undo behavior is browser-specific. [MDN documents the undo-preservation use case and limitations](https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand). This decision needs continued Chromium regression testing and explicit site adapters. No claim is made that every controlled framework or formatting layout will accept native insertion. The prototype cannot guarantee isolation from unobserved script edits to unrelated document undo history; a production undo UI must respect that uncertainty.

## Reproduce

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm test
```

`npm test` runs Python harness tests and browser tests. With an existing test Chromium, set `LINELEAF_CHROMIUM_PATH` to its executable. The fixtures are served through Playwright request interception; no local HTTP listener is added. Single-process mode (`LINELEAF_CHROMIUM_SINGLE_PROCESS=1`) is an optional constrained-runner workaround, not the CI/default browser configuration.

The suite covers successful replacement/undo on four surfaces, keyboard undo, backward selection, stale and programmatic changes, composition/removal/readonly guards, format boundaries, Unicode, focus-time mutation, site-controlled input rewrites, cross-field undo refusal, and snapshot ownership. Real editor validation remains D-01/D-03.
