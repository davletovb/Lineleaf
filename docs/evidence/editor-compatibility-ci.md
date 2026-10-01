# D-01–D-03 editor safety evidence

This report covers synthetic editor boundaries, dynamic-document safety and a feasibility decision. It does not establish authenticated Gmail/GitHub/LinkedIn/Slack/Docs acceptance or writing quality. The [priority matrix](../investigations/priority-editor-matrix.md) keeps those live checks open; the [complex-editor investigation](../investigations/complex-editor-feasibility.md) records the direct-adapter decision.

## Implemented checks

- [Editor context](../../extension/lib/editor-context.mjs) follows only the active field's open composed ancestry, resolves retargeted events/focus, checks exclusions across shadow hosts, and guards known complex/priority rich surfaces.
- [Adapter](../../prototypes/editor/editor-adapter.mjs) snapshots route/Navigation API entry and ancestry identity. Both acceptance and undo recheck context before and after native commands and during recovery. A site changing drafts in an input/undo handler cannot cause restoration of old text into the next context; UI callbacks tolerate their panel being removed during the command. Ancestor mutation tracking catches remove/reinsert and exclusion ABA; field revisions and exact source still guard input/DOM changes. Geometry updates do not rewrite the source.
- [Manual panel](../../extension/content.mjs) cancels on SPA route changes, guards copy-only captures, and supports explicit user-pasted bounded text with no direct replacement. Paste typing does not call the provider; later edits stale the checked capture. Snapshots/paste text are cleared on close, pause, policy changes and expiry.
- [Inline geometry](../../extension/lib/geometry.mjs) intersects the viewport, field and composed scroll/clip ancestors. Offscreen/hidden/transformed/perspective/shaped-clipping fields do not start an automatic check. Container movement and resize redraw the overlay; existing text/formatting is unchanged.
- [Worker](../../extension/lib/controller.mjs) permits matching same-origin HTTP(S) frames, validates the exact live document ID/frame/URL/top origin before each provider phase, addresses the focused document and broadcasts policy invalidation to all installed documents. Cross-origin, sandboxed and opaque URLs remain denied. Extension/native permissions and the Seatline protocol are unchanged. Seatline main was rechecked at the existing audited `dc1086582c8b98498aa48dae91c8d174bc3cfc3c`.

## Regression boundaries

[Twenty-four compatibility browser tests](../../tests/compatibility.test.mjs) exercise the bundled production content script and worker with synthetic Chrome/native ports. They cover four intercepted priority-host boundaries; Google Docs proxy/pasted text; five complex markers; push/replace/hash/ABA routes, inline SPA cancellation/late output; identical replacement fields; removal/reinsertion and ancestor exclusions; open shadow native apply/undo; legacy selection without `getComposedRanges`; shadow IME; closed roots; denied clipboard; nested scroll clipping, container resizing and transforms, plus parent-frame navigation/hidden/excluded/sandbox guards.

[Six new controller regressions](../../tests/extension.test.mjs) cover exact-document same-origin frame eligibility, wrong/navigated/removed/cross-origin/sandboxed identities, navigation before submission and before delivering results, focused-document targeting/ambiguity refusal, matching-frame registration without opaque-origin inheritance, and all-document policy notification.

[Installed-extension frame coverage](../../tests/installed-extension.test.mjs) uses the packaged MV3 extension and real Chrome document IDs at synthetic HTTPS origins. It verifies a same-origin child, focused-document-only preview, exclusion of sandbox/blank/cross-origin frames and invalidation after revocation. No native host or real provider is supplied to that suite. CI runs the pinned Playwright Chromium on Linux/macOS with normal process configuration and the unchanged fifteen-check native authorization suite.

## Local validation and CI provenance

Local browser regressions use Chromium 153.0.8010.0 through the documented constrained-runner override. This browser does not expose installed extension service workers; the pinned full Playwright browser download is unavailable here. Installed MV3 acceptance is therefore checked in CI, not claimed from that local browser. Local `npm test` passes **146 checks**: 26 Python, 40 extension logic, 16 adapter, 20 selection, 20 inline and 24 compatibility browser regressions. The local package and verified final code/CI provenance are recorded below.

Live writing, human screen-reader acceptance, real-site draft state, device-specific zoom/IME and provider latency remain their existing tracker gates. This slice does not release a beta.

Package candidate: `lineleaf-0.1.0.zip`, **37,499 bytes**, SHA-256 `7e9f7937c488cf20faeba2924f89c1c31e640ebd24495cedc5c73bd7980a4cc8`. The manifest retains version `0.1.0` and development ID `lnbkadelggojehiapgnhonicnfonobal`. The Linux/macOS CI packages were downloaded and verified byte-identical to this local package; their outer artifact digests were also checked.

Initial code `fc5a1244429ccf51e20ffa09217124cc39fcbf76` passed **150 checks per OS plus fifteen native checks** in [run 36937709228](https://github.com/davletovb/Lineleaf/actions/runs/36937709228), including the actual installed-frame test. The final follow-up adds two browser regressions for draft changes during insertion/undo/recovery.

## Final code acceptance

Code commit **`eebe79dd2a3d16976b0f8a94011a7a031064903d`**, tree `33819b3c3f486a0dc20db779fb55192ce0420287`, passed [CI run 36938198620](https://github.com/davletovb/Lineleaf/actions/runs/36938198620): **152 tests per OS** (26 Python, 40 logic, 16 adapter, 20 selection, 20 inline, 24 compatibility and six installed-extension tests), plus **fifteen native checks**. All jobs succeeded with the pinned full Playwright Chromium and normal process configuration.

| Job | ID | Result |
| --- | --- | --- |
| Linux editor/harness/installed extension | [110623329860](https://github.com/davletovb/Lineleaf/actions/runs/36938198620/job/110623329860) | All 152 pass |
| macOS editor/harness/installed extension | [110623329669](https://github.com/davletovb/Lineleaf/actions/runs/36938198620/job/110623329669) | All 152 pass |
| Unmodified shared Seatline native fixture | [110623329910](https://github.com/davletovb/Lineleaf/actions/runs/36938198620/job/110623329910) | All fifteen report checks true |

| Downloaded artifact | ID | Verified outer ZIP SHA-256 |
| --- | --- | --- |
| lineleaf-extension-Linux | `11198931944` | `8fa79bcf3d5eb7bd030b73c00fd15792d6be0be3e6389ab9941ef8bd9ed3ed89` |
| lineleaf-extension-macOS | `11199510109` | `e8d82fdf19141e854110e59285188473f57738f01a701ebc75603ca7b1d1e051` |
| native-authorization | `11198971698` | `4072f751d798b189809f92e6561a21367e2b19d8a68692049c14546a99235170` |

Both extension artifact inner ZIPs equal the local 37,499-byte package above. The native report identifies the audited Seatline revision, protocol 1, Linux, the stable development ID and an upstream synthetic provider; it explicitly leaves store identity, native Chrome permission UI and live authentication unverified. D-02 is DONE for the declared development boundaries and D-03 for its separate feasibility result. D-01 real-editor acceptance remains IMPLEMENTED — VERIFY. A subsequent documentation-only commit records this result without changing tested extension code.
