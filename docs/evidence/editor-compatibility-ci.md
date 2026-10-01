# D-01–D-03 editor safety evidence

This report covers synthetic editor boundaries, dynamic-document safety and a feasibility decision. It does not establish authenticated Gmail/GitHub/LinkedIn/Slack/Docs acceptance or writing quality. The [priority matrix](../investigations/priority-editor-matrix.md) keeps those live checks open; the [complex-editor investigation](../investigations/complex-editor-feasibility.md) records the direct-adapter decision.

## Implemented checks

- [Editor context](../../extension/lib/editor-context.mjs) follows only the active field's open composed ancestry, resolves retargeted events/focus, checks exclusions across shadow hosts, and guards known complex/priority rich surfaces.
- [Adapter](../../prototypes/editor/editor-adapter.mjs) snapshots route/Navigation API entry and ancestry identity. Both acceptance and undo recheck context. Ancestor mutation tracking catches remove/reinsert and exclusion ABA; field revisions and exact source still guard input/DOM changes. Geometry updates do not rewrite the source.
- [Manual panel](../../extension/content.mjs) cancels on SPA route changes, guards copy-only captures, and supports explicit user-pasted bounded text with no direct replacement. Paste typing does not call the provider; later edits stale the checked capture. Snapshots/paste text are cleared on close, pause, policy changes and expiry.
- [Inline geometry](../../extension/lib/geometry.mjs) intersects the viewport, field and composed scroll/clip ancestors. Offscreen/hidden/transformed/perspective/shaped-clipping fields do not start an automatic check. Container movement and resize redraw the overlay; existing text/formatting is unchanged.
- [Worker](../../extension/lib/controller.mjs) permits matching same-origin HTTP(S) frames, validates the exact live document ID/frame/URL/top origin before each provider phase, addresses the focused document and broadcasts policy invalidation to all installed documents. Cross-origin, sandboxed and opaque URLs remain denied. Extension/native permissions and the Seatline protocol are unchanged. Seatline main was rechecked at the existing audited `dc1086582c8b98498aa48dae91c8d174bc3cfc3c`.

## Regression boundaries

[Twenty-two compatibility browser tests](../../tests/compatibility.test.mjs) exercise the bundled production content script and worker with synthetic Chrome/native ports. They cover four intercepted priority-host boundaries; Google Docs proxy/pasted text; five complex markers; push/replace/hash/ABA routes, inline SPA cancellation/late output; identical replacement fields; removal/reinsertion and ancestor exclusions; open shadow native apply/undo; legacy selection without `getComposedRanges`; shadow IME; closed roots; denied clipboard; nested scroll clipping, container resizing and transforms, plus parent-frame navigation/hidden/excluded/sandbox guards.

[Six new controller regressions](../../tests/extension.test.mjs) cover exact-document same-origin frame eligibility, wrong/navigated/removed/cross-origin/sandboxed identities, navigation before submission and before delivering results, focused-document targeting/ambiguity refusal, matching-frame registration without opaque-origin inheritance, and all-document policy notification.

[Installed-extension frame coverage](../../tests/installed-extension.test.mjs) uses the packaged MV3 extension and real Chrome document IDs at synthetic HTTPS origins. It verifies a same-origin child, focused-document-only preview, exclusion of sandbox/blank/cross-origin frames and invalidation after revocation. No native host or real provider is supplied to that suite. CI runs the pinned Playwright Chromium on Linux/macOS with normal process configuration and the unchanged fifteen-check native authorization suite.

## Local validation and CI provenance

Local browser regressions use Chromium 153.0.8010.0 through the documented constrained-runner override. This browser does not expose installed extension service workers; the pinned full Playwright browser download is unavailable here. Installed MV3 acceptance is therefore checked in CI, not claimed from that local browser. Local `npm test` passes **144 checks**: 26 Python, 40 extension logic, 16 adapter, 20 selection, 20 inline and 22 compatibility browser regressions. The local package is recorded below; final source and CI provenance follow after the run.

Live writing, human screen-reader acceptance, real-site draft state, device-specific zoom/IME and provider latency remain their existing tracker gates. This slice does not release a beta.

Package candidate: `lineleaf-0.1.0.zip`, **37,265 bytes**, SHA-256 `32fe654840dadefa2b2b84a1cc62f1cdbca740360eb0eb5fa8809e7494df4250`. The manifest retains version `0.1.0` and development ID `lnbkadelggojehiapgnhonicnfonobal`. CI package identity and the exact code revision will be recorded after the run.
