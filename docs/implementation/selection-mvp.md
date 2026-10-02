# B-01–B-05 — Explicit selection prototype

This development extension adds selected-text proofreading and six deliberate rewrite modes (improve it, paraphrase, clearer, shorter, more formal, friendlier) through the existing shared Seatline companion. The panel is the only rewrite surface when the inline assistant is off; the inline card offers the same rewrites with automatic checking enabled. It has no automatic checking or inline underlines. Live provider quality/latency and actual Chrome/macOS companion setup remain acceptance gates. Codex is the candidate provider; use subscription sign-in and a runtime reporting tool isolation.

## Build and load

```sh
npm ci --ignore-scripts
npm run package
```

Load `dist/lineleaf` unpacked through `chrome://extensions` with Developer mode enabled. `dist/lineleaf-0.1.0.zip` contains the same files at its root. The public manifest key keeps the development ID `lnbkadelggojehiapgnhonicnfonobal`, matching the existing Lineleaf authorization. No private signing key or provider credential ships in the package. Node and Python are development tools; extension users need only Chrome, their existing companion, and the supported provider runtime.

Authorize with the existing shared companion:

```sh
seatline-companion authorize lineleaf codex chrome-extension://lnbkadelggojehiapgnhonicnfonobal/
```

This replaces the Lineleaf grant. If you retain additional Lineleaf origins or providers, use the [authorization helper](../investigations/extension-authorization.md) with all of them. Do not install a second companion.

## Try a selection

1. Open an ordinary HTTP/HTTPS page. In the popup, enable that site and approve its optional host permission. Site enablement is exact-origin policy; Chrome permissions themselves cover all ports of that host. Incognito is excluded. D-02 permits same-origin HTTP(S) child frames with the same enabled/permitted top origin; opaque, sandboxed and cross-origin frames remain excluded.
2. Select 1–2,000 UTF-16 code units in a textarea, text/search input, or a simple contenteditable. Password/payment/one-time-code fields and marked excluded/code regions are refused. Complex editors and noneditable selections offer preview/copy when eligible.
3. Open Lineleaf's popup and choose **Open writing panel**. Review the selection, choose proofreading or a rewrite, and press **Check selection**. Only that bounded selection is sent, through Seatline to Codex. Typing stays available.
4. Review a suggestion, then accept, dismiss, or copy it. Rewrites are labeled **Optional style**. Accepting one edit invalidates the remaining preview; reopen on a new selection to check again. This conservative prototype does not rebase model suggestions after text changes.
5. **Undo last edit** uses Chromium's native undo and is available only before other field/document edits. The editor's own keyboard undo remains available. Complex formatting crossings and multiline replacements use copy fallback. If the site truncates, normalizes, or changes formatting during acceptance, Lineleaf restores the original text/inline nodes and makes that field copy-only until reload. Recovery first uses guarded native undo, then field-local restoration with an input notification for controlled state. If the site rejects even that restoration notification, the panel reports that its state could not be verified; it never reports the failed edit as accepted.

Chrome's native permission-prompt lifecycle still needs actual-device validation. If approving it closes the popup before Lineleaf saves site enablement, reopen the popup and enable the site again. A granted Chrome permission alone does not enable Lineleaf processing. Test this setup path before beta acceptance.

Use **Cancel**, close the panel, type in the selected field, navigate, disable the site, or pause globally to cancel/discard obsolete work. Changing preferences invalidates the preview. Selection snapshots expire after five minutes and are cleared when the panel closes; only preferences and enabled origins are stored.

## Implementation and bounds

The service worker validates extension identity, tab/exact live document identity, same-origin frame/top-page identity, current origin, enabled-site policy, permissions, message shape, mode, and text bound. Settings messages are accepted only from the extension popup/options pages. Content scripts cannot access stored preferences directly (`TRUSTED_CONTEXTS`). Optional site scripts never start a writing request themselves; the panel requires an explicit trusted button click.

Each check uses a new native connection, checks authenticated subscription status/tool isolation, and sends a no-tools ephemeral turn with no continuation. One request is allowed across Lineleaf tabs. A disconnect never automatically resubmits a request; a new user action opens a fresh connection. Protocol negotiation is bounded to ten seconds, status to fifteen seconds, writing to thirty seconds, and cancel drain to three seconds. Provider rate limits back off for sixty seconds; queue-full failures back off for five seconds.

Provider output is bounded to 128 KiB/4,096 events. Strict JSON refuses duplicate keys, non-finite values, deep nesting, extra fields, and unknown categories. Positions are computed as exact contextual source matches, in UTF-16 without normalization; Unicode grapheme boundaries, unique matches, and overlap checks are required. Model offsets are never accepted. Both revision and exact full source are checked immediately before native editing; mutation during focus and unsafe undo are refused by the A-04 adapter.

Native failure messages use fixed diagnostics rather than raw provider output. Site-state failures retain their own diagnostic, including global pause. Preview text uses text nodes, not model-generated HTML, inside a closed shadow root; ordinary page scripts cannot inspect or rewrite the suggestion DOM. The host remains part of the page and can be removed or obscured by it, so this is DOM isolation rather than a complete hostile-page security boundary. The prompt explicitly bounds each explanation to the validator's 280 UTF-16 code units. This is structural validation, not proof of grammatical accuracy or preserved facts: review rewrites, and keep E-01 quality acceptance open.

## Verification

```sh
npx playwright install chromium
npm test
npm run test:extension
```

Python tests retain the investigation coverage. Node tests exercise the production transport/controller with synthetic Chrome/native ports, including malformed output, cancellation, readiness, authorization, and no stored drafts. Browser tests run the bundled panel on synthetic editors, including real mouse drags released outside text controls, excluded descendants in spanning selections, and a complete production panel/controller/transport round trip through synthetic ports. Tests inspect the closed shadow root using Chromium debugger access; no page-accessible test hook ships. Installed-extension tests load the actual packaged MV3 extension and exercise stable identity, preferences, missing-host diagnostics, optional permissions, injection, closed-root isolation, and disablement. Headless CI preapproves only the synthetic host through Chromium's extension-management API before invoking the real optional-permission request; it does not test clicking Chrome's native permission prompt. These synthetic checks do not establish a successful real-account Chrome-to-Seatline writing turn.

CI runs both browser suites on Linux and macOS, packages the extension, and archives `lineleaf-extension-Linux` / `lineleaf-extension-macOS`. [Run 36879235204 and package provenance](../evidence/selection-prototype-ci.md) record 86 passing tests per OS, including 36 editor/panel tests and three actual installed-extension tests. The upstream native job independently keeps the unmodified companion's fifteen schema/authorization/send/cancel checks. Capture the actual Chrome/macOS setup, live provider run and writing-quality evidence before promoting integration items or releasing a beta. The C inline prototype and D editor boundaries are described separately. Real-site acceptance and beta quality/device gates remain open; see the [priority matrix](../investigations/priority-editor-matrix.md).

## Browser references

- [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Chrome optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Playwright extension testing](https://playwright.dev/docs/chrome-extensions)
