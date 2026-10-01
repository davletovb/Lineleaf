# Lineleaf — Implementation Tracker

Established: 2026-10-01  
Status: A/B/C slices merged; D-01 through D-03 editor boundaries and feasibility implemented in PR #4. Live/device/provider and real-site acceptance gates remain open.

This is the authoritative progress record. Requirements are defined in the [product framework](lineleaf-product-framework.md) and [Seatline integration document](../architecture/seatline-integration.md).

Foundation implementation: [PR #1](https://github.com/davletovb/Lineleaf/pull/1). Code commit `9d1ccaed15f3efcb0540db5d183fb5eab2718a2d` passed 26 Python regressions and 15 Chromium editor regressions on both Linux and macOS, plus fifteen native checks in [CI run 36856262500](https://github.com/davletovb/Lineleaf/actions/runs/36856262500). [Evidence provenance](../evidence/README.md) ties the archived native report to that run and commit. Historical [run 36832723008](https://github.com/davletovb/Lineleaf/actions/runs/36832723008) covered the original implementation at `4e34703` (16 Python, 15 Linux editor, eleven native checks).

Selection implementation: [PR #2](https://github.com/davletovb/Lineleaf/pull/2). Code commit `ac3ec6e36ee093fadeaa2e328c9fe8daad96e52a` passed 80 tests on each of Linux/macOS plus fifteen shared-companion native checks in [CI run 36874657265](https://github.com/davletovb/Lineleaf/actions/runs/36874657265). [Selection evidence](../evidence/selection-prototype-ci.md) records job IDs, test boundaries, and byte-identical Linux/macOS/local package provenance. Actual Chrome-to-Seatline setup and live writing remain B-02/B-03 verification gates.

PR #2 review follow-up at `0a9d01615a42e560445f3d2330f47c58776972a0` preserves drag selections, refuses ranges spanning excluded descendants, retains pause diagnostics, closes the panel shadow root, and aligns prompt explanation bounds. [CI run 36879235204](https://github.com/davletovb/Lineleaf/actions/runs/36879235204) passed 86 tests on each OS plus fifteen native checks; [current package provenance](../evidence/selection-prototype-ci.md) records the reproducible updated ZIP. Browser regression coverage includes the production worker-to-panel path through synthetic Chrome/native ports. The native permission-prompt lifecycle remains part of actual-device acceptance; the setup guide records popup-close recovery.

Inline implementation baseline: [PR #3](https://github.com/davletovb/Lineleaf/pull/3). Code revision `b920e0d6baeafa2458108beacf096cc080ad0e1e` passed **115 tests on each Linux/macOS** plus fifteen native checks in [CI run 36889393901](https://github.com/davletovb/Lineleaf/actions/runs/36889393901). [Inline evidence](../evidence/inline-prototype-ci.md) records tested consent/pacing, paragraph privacy, keyboard/geometry/editing, dictionary/variant/pause/reset, missing-host behavior, the resolved stale-popup review finding, and byte-identical packages. Live automatic latency/device/IME and human screen-reader acceptance keep C-01/C-02 in verification.

PR #3 review follow-up at `e18ebb67a8ea8daf337c3b8c1aae400172161636` passes **121 tests on each Linux/macOS** plus fifteen native checks in [CI run 36911704950](https://github.com/davletovb/Lineleaf/actions/runs/36911704950). [Updated evidence/package provenance](../evidence/inline-prototype-ci.md#review-follow-up) covers two stale options pages, partial compare-and-save preferences/dictionary deltas, focus handoff, deduplicated announcements, and expanded dictionary tokens. C-03 returns to verification for explanation accuracy; C-04 consistent preference acceptance is verified on the scoped tests.

## Progress

- Planned implementation items: **21**
- DONE: **8**
- IMPLEMENTED — VERIFY: **10**
- IN PROGRESS: **0**
- BLOCKED: **0**
- TODO: **3**

Repository setup is recorded separately below and is not counted as product implementation.

## Status and ownership

| Status | Meaning |
| --- | --- |
| TODO | Work has not started |
| IN PROGRESS | An owner is actively working on the item |
| BLOCKED | A named dependency prevents progress; explain it in Evidence |
| IMPLEMENTED — VERIFY | The change exists, but required acceptance validation is outstanding |
| DONE | Acceptance criterion is met with linked evidence |

Keep IDs stable. Record ownership before starting and update progress counts when statuses change. Link the issue/pull request and validation evidence. Check currently merged code and open work before implementing anything. Dependencies must be DONE or have documented acceptance evidence for the dependent slice; unfinished dependencies keep the dependent item unstarted.

A staged decision can have separate dependency gates only when the decision log explicitly names the accepted slice and its evidence. `IMPLEMENTED — VERIFY` does not automatically release downstream implementation. The owner's 2026-10-01 instruction to implement B-01–B-05 authorizes a development prototype using the accepted A-01/A-04 contract/editor evidence, A-02 native authorization/schema tests, A-03 fixture/validation tools, and A-05 toolchain. This revises the earlier planning-only B-01 gate. Live provider and actual device/store acceptance remain required before claiming those integrations or a beta; A-02/A-03/A-05 retain their verification states.

## Milestones

| Milestone | Outcome | Items |
| --- | --- | --- |
| A | Verify the integration, provider behavior, and safe editing foundation | A-01 through A-05 |
| B | Deliver explicit selection proofreading and rewriting | B-01 through B-05 |
| C | Add controlled, accessible inline proofreading | C-01 through C-05 |
| D | Validate real editors and investigate complex surfaces | D-01 through D-03 |
| E | Evaluate quality, coexistence, and beta packaging | E-01 through E-03 |

## Work items

| ID | Item | Depends on | Acceptance criterion | Status | Owner | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| A-01 | Inspect the current shared Seatline consumer API/release | — | Record supported transport, methods/events, versions, authentication/capabilities, and exact missing dependencies | DONE | Codex | [Pinned source/binary audit](../investigations/seatline-api-audit.md); protocol 1, no tagged release |
| A-02 | Validate extension authorization and IDs | A-01 | One installed companion accepts the approved development/store consumer; no per-product installation | IMPLEMENTED — VERIFY | Codex | [Stable ID, probe, validator](../investigations/extension-authorization.md); native CI passes one installation/two consumers, reauthorization disconnect/reconnect, revocation, and origin isolation; actual Chrome/macOS and issued store ID remain |
| A-03 | Benchmark one supported provider | A-01 | Measure cold/warm latency, structured-output reliability, cancellation, and limits for representative writing requests | IMPLEMENTED — VERIFY | Codex | [Benchmark harness and procedure](../investigations/provider-benchmark.md); fixture verified; live authenticated provider unavailable |
| A-04 | Prototype safe editor mutation | — | Textarea, text input, basic contenteditable, and a controlled-input fixture preserve content, caret, formatting where applicable, and undo | DONE | Codex | [Compatibility report](../investigations/editor-compatibility.md); 16 adapter tests pass, including failed-edit recovery; B panel coverage adds 15 tests |
| A-05 | Freeze MVP scope and extension toolchain | A-01/A-04 for toolchain/editor boundaries; A-02/A-03 for final freeze | Document achievable editor support, acceptable latency, provider choice, toolchain, and unresolved blockers | IMPLEMENTED — VERIFY | Codex | [Staged scope/toolchain decision](../architecture/mvp-scope-and-toolchain.md); explicit development-prototype authorization recorded below; final provider/latency/install gates remain |
| B-01 | Scaffold an MV3 extension and settings | Accepted A-05 toolchain slice; final release still gated | Packaged extension loads with minimal permissions and explicit per-site controls | DONE | Codex | [Installed-extension CI evidence](../evidence/selection-prototype-ci.md); stable ID, trusted preferences, optional site grants/injection/revocation pass on Linux/macOS; reproducible ZIP |
| B-02 | Integrate Seatline transport and lifecycle | Accepted A-02 contract/native-test slice, B-01; device acceptance still gated | Validate sender/payloads; handle unavailable host, disconnect, cancellation, and recovery without duplicate work | IMPLEMENTED — VERIFY | Codex | [Transport/controller and missing-host CI evidence](../evidence/selection-prototype-ci.md) passes; actual Chrome/native setup remains |
| B-03 | Implement selection proofreading/rewriting | Accepted A-03 schema/fixture slice, B-02; live acceptance still gated | Selected text yields a bounded preview; unchanged text is replaced only through a supported adapter | IMPLEMENTED — VERIFY | Codex | [Selection prototype and CI](../evidence/selection-prototype-ci.md): explicit proofreading/four rewrite modes, bounded previews pass; real-account writing/quality remains |
| B-04 | Validate candidates and derive edit positions | B-03 prototype slice | Malformed output, repeated phrases, overlapping edits, Unicode, and changed revisions are handled safely | DONE | Codex | [Linux/macOS CI](../evidence/selection-prototype-ci.md): bounded strict JSON, exact contextual matches, duplicate/ambiguous/overlap refusal, UTF-16/graphemes, stale/ABA checks pass |
| B-05 | Implement accept, dismiss, and undo | A-04, B-04 validated editing slice | Accepting an edit preserves the tested editor's state; user can dismiss and undo without losing other typing | DONE | Codex | [Linux/macOS CI](../evidence/selection-prototype-ci.md): scoped editor/panel accept/dismiss/native undo, caret/formatting, failed-edit restoration and unrelated-field undo guards pass; real-site validation remains D-01 |
| C-01 | Add automatic paragraph checking | B-04 | Pause-based checks respect composition, change detection, request caps, coalescing, and cancellation | IMPLEMENTED — VERIFY | Codex | [CI/evidence](../evidence/inline-prototype-ci.md) verifies trusted-typing debounce, composition guard, coalescing/cancellation, manual priority, worker-restart-safe shared caps; live pacing/device/IME acceptance remains |
| C-02 | Add inline underlines and cards | B-05, C-01 | Suggestions track text and scrolling; controls work by keyboard and screen reader | IMPLEMENTED — VERIFY | Codex | [CI/evidence](../evidence/inline-prototype-ci.md) verifies scoped overlay scrolling, closed cards, keyboard/AX semantics, exact apply/native undo/copy recovery; human screen readers and real-site geometry remain |
| C-03 | Add correctness/style categories and explanations | C-02 | Optional style changes are clearly labeled; explanations match their corrections | IMPLEMENTED — VERIFY | Codex | [CI/evidence](../evidence/inline-prototype-ci.md) verifies correctness vs optional-style labels, literal bounded explanations associated with their validated candidates; explanation accuracy is not yet verified; requires live evaluation in E-01 |
| C-04 | Add dictionary, language variant, and pause controls | C-02 | Preferences affect checks consistently and can be reset | DONE | Codex | [CI/evidence](../evidence/inline-prototype-ci.md) verifies opt-in/dictionary persistence, US/UK prompt, spelling-only filtering, scoped pause, serialized mutations, reset and revoked access; review follow-up CI verifies stale options, dictionary deltas, and conflict refusal |
| C-05 | Complete privacy and failure flows | B-02, C-01 | No processing on disabled sites/excluded fields; provider disclosure and useful error states are present | DONE | Codex | [CI/evidence](../evidence/inline-prototype-ci.md) verifies disabled/excluded/synthetic-event refusal, remote-provider disclosure, fixed diagnostics, cancellation and retry bounds; authenticated setup remains B-02/B-03 |
| D-01 | Validate priority real-world editors | C-05 | Publish a tested matrix for Gmail compose, GitHub comments, LinkedIn posts, and Slack web; unsupported surfaces use fallback | IMPLEMENTED — VERIFY | Codex | [Priority matrix](../investigations/priority-editor-matrix.md) and [regressions/evidence](../evidence/editor-compatibility-ci.md): priority-host fallback and GitHub textarea boundaries tested on intercepted synthetic HTML; authenticated draft-only Gmail/GitHub/LinkedIn/Slack checks remain |
| D-02 | Handle dynamic fields and geometry | D-01 | SPA navigation, resizing, scrolling, permitted frames, and supported open shadow roots do not misapply edits | IMPLEMENTED — VERIFY | Codex | [Slot review follow-up](../evidence/editor-compatibility-ci.md#slot-review-follow-up) corrects composed ancestry/exclusion/clipping through assigned slots and adds three regressions; local suite passes 149 checks; final Linux/macOS installed CI pending. Prior baseline passed 152 per OS plus fifteen native checks |
| D-03 | Investigate Google Docs and complex editors | D-01 | Produce a separate feasibility result; do not advertise support without a working tested adapter | DONE | Codex | [Separate feasibility decision](../investigations/complex-editor-feasibility.md): no generic Google Docs/complex replacement claim; guarded frameworks/Docs input proxy and explicit pasted-text copy fallback verified on synthetic browser tests |
| E-01 | Run writing-quality and regression evaluation | C-03, D-01 | Meet the product framework's beta quality gates across the validated provider configurations | TODO | — | — |
| E-02 | Validate shared-companion coexistence | B-02, C-01 | Concurrent use with another consumer neither mixes sessions nor creates uncontrolled background traffic | TODO | — | — |
| E-03 | Package a reviewable beta | E-01, E-02 | Install/update/uninstall and permission behavior verified on each advertised browser/OS; beta package and support matrix ready | TODO | — | — |

## First development slice

The merged A-01–A-05 foundation slice includes executable investigation tools and a minimal native status probe. It does not count as B-01 product scaffolding. The owner subsequently requested B-01–B-05 together: development proceeds with the explicit staged evidence above, while live provider/latency and device acceptance remain open. C development follows the owner’s subsequent C-01–C-05 instruction. The owner now requests D-01–D-03 as one slice; E stays TODO.

Inline automation follows safe replacement, validated provider behavior, and explicit selection actions.

## Repository setup record

Completed 2026-10-01:

- Introduced Lineleaf with its product promise and documentation entry points.
- Established the product framework, stable 21-item tracker, and Seatline boundary.
- Added contributor/agent guidance, formatting defaults, and GitHub issue/pull-request templates.

The A/B slices now establish development tools, extension source, and CI packaging. Beta release remains E-03 gated.

## Decision log

| Date | Decision | Basis |
| --- | --- | --- |
| 2026-10-01 | Use Lineleaf as the repository/product name | Repository setup requested for davletovb/Lineleaf |
| 2026-10-01 | Use the existing shared Seatline companion | Established one-companion/multiple-consumer direction |
| 2026-10-01 | Preserve authorship, intent, and control while permitting explicit tone changes | Product naming and preservation discussion |
| 2026-10-01 | Freeze explicit requests on simple tested editors; keep automation gated | A-04 Chromium evidence; live provider metrics unavailable |
| 2026-10-01 | Use native MV3 ES modules, Node 24/Python 3.12 development tools, and Playwright 1.62.1 | [A-05 decision](../architecture/mvp-scope-and-toolchain.md); no user Node runtime |
| 2026-10-01 | Initial split A-05 acceptance approved toolchain/editor boundaries; final provider/latency/install freeze remains A-02/A-03 gated | [A-01 audited contract](../investigations/seatline-api-audit.md) and [A-04 tested surfaces](../investigations/editor-compatibility.md). The initial planning-only B-01 restriction is superseded by the next decision. |
| 2026-10-01 | Owner explicitly authorizes B-01–B-05 development now using accepted investigation slices | Use A-01/A-04 evidence, fifteen A-02 native/schema/cancel checks, A-03 fixture/source validation and A-05 toolchain for an explicit-request prototype. This permits implementation, not live-provider/device acceptance, automatic checking, or beta release. |
| 2026-10-01 | Owner explicitly authorizes C-01–C-05 implementation as one development slice | Use merged B-04/B-05 validation and B-02 transport evidence. Automatic checks require a new explicit opt-in, remain off by default, use 1.5-second idle debounce and a persistent shared ten-second/six-per-minute cap. This authorizes implementation while live latency, real-account, device, and real-editor acceptance stay open. |
| 2026-10-01 | Accept the tested C-01 scheduling/transport and C-02 scoped editing/keyboard/AX slices for C-03–C-05 | [CI run 36889393901](https://github.com/davletovb/Lineleaf/actions/runs/36889393901) and [package/evidence boundaries](../evidence/inline-prototype-ci.md) verify categories, preferences, and privacy/failure criteria on scoped fixtures and the installed MV3 missing-host path. C-01 live pacing/device/IME and C-02 human screen-reader/real-site acceptance remain verify; no beta or authenticated-writing claim follows. |
| 2026-10-01 | Reopen C-03 explanation accuracy and C-04 consistent preference acceptance after review | Rendered association is not evidence that explanations match corrections. C-03 stays verify until linguistic evaluation. Stale-options saves and exact-token-only filtering are corrected with partial compare-and-save fields, dictionary deltas, expanded token filtering, and new installed/browser/controller regressions; C-04 acceptance awaits their CI evidence. |
| 2026-10-01 | Verify C-04 scoped preference consistency after the review fixes | [CI run 36911704950](https://github.com/davletovb/Lineleaf/actions/runs/36911704950) passes two installed options-page conflict/merge regressions plus token/possessive dictionary and controller checks. C-03 explanation accuracy remains verify; human screen-reader and live quality gates remain open. |
| 2026-10-02 | Owner explicitly authorizes D-01–D-03 as one development slice | Accept the priority-editor synthetic policy/fixture boundary for dynamic safety and feasibility work; D-01 remains verify for actual authenticated drafts. This does not promote real-site support or unblock E-01 beta quality acceptance. D-02 may be verified on its declared same-origin/open-shadow development boundaries after installed Linux/macOS CI passes. |
| 2026-10-02 | Verify D-02 development boundaries and D-03 feasibility after the combined slice | [CI run 36938198620](https://github.com/davletovb/Lineleaf/actions/runs/36938198620) on `eebe79dd2a3d16976b0f8a94011a7a031064903d` passes 152 checks per OS and fifteen native checks; downloaded packages match the local build. D-01 stays verify for actual authenticated priority-editor drafts; C-02 human/device and E quality/coexistence/beta gates remain open. |
| 2026-10-02 | Reopen D-02 for assigned-slot composed ancestry after review | Follow assigned slots before light-DOM parents so shadow-tree exclusions/clipping are honored; verify the added privacy, geometry and slot-ABA regressions in CI before promoting this boundary again. |
