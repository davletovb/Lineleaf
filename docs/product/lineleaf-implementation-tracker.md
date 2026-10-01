# Lineleaf — Implementation Tracker

Established: 2026-10-01  
Status: A foundation merged; B-01 through B-05 selection prototype implemented and tested. B-01/B-04/B-05 meet scoped acceptance; live/device/provider gates remain open.

This is the authoritative progress record. Requirements are defined in the [product framework](lineleaf-product-framework.md) and [Seatline integration document](../architecture/seatline-integration.md).

Foundation implementation: [PR #1](https://github.com/davletovb/Lineleaf/pull/1). Code commit `9d1ccaed15f3efcb0540db5d183fb5eab2718a2d` passed 26 Python regressions and 15 Chromium editor regressions on both Linux and macOS, plus fifteen native checks in [CI run 36856262500](https://github.com/davletovb/Lineleaf/actions/runs/36856262500). [Evidence provenance](../evidence/README.md) ties the archived native report to that run and commit. Historical [run 36832723008](https://github.com/davletovb/Lineleaf/actions/runs/36832723008) covered the original implementation at `4e34703` (16 Python, 15 Linux editor, eleven native checks).

Selection implementation: [PR #2](https://github.com/davletovb/Lineleaf/pull/2). Code commit `ac3ec6e36ee093fadeaa2e328c9fe8daad96e52a` passed 80 tests on each of Linux/macOS plus fifteen shared-companion native checks in [CI run 36874657265](https://github.com/davletovb/Lineleaf/actions/runs/36874657265). [Selection evidence](../evidence/selection-prototype-ci.md) records job IDs, test boundaries, and byte-identical Linux/macOS/local package provenance. Actual Chrome-to-Seatline setup and live writing remain B-02/B-03 verification gates.

PR #2 review follow-up preserves drag selections, refuses ranges spanning excluded descendants, retains pause diagnostics, closes the panel shadow root, and aligns prompt explanation bounds. Browser regression coverage includes the production worker-to-panel path through synthetic Chrome/native ports. The native permission-prompt lifecycle remains part of actual-device acceptance; the setup guide records popup-close recovery.

## Progress

- Planned implementation items: **21**
- DONE: **5**
- IMPLEMENTED — VERIFY: **5**
- IN PROGRESS: **0**
- BLOCKED: **0**
- TODO: **11**

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
| C-01 | Add automatic paragraph checking | B-04 | Pause-based checks respect composition, change detection, request caps, coalescing, and cancellation | TODO | — | — |
| C-02 | Add inline underlines and cards | B-05, C-01 | Suggestions track text and scrolling; controls work by keyboard and screen reader | TODO | — | — |
| C-03 | Add correctness/style categories and explanations | C-02 | Optional style changes are clearly labeled; explanations match their corrections | TODO | — | — |
| C-04 | Add dictionary, language variant, and pause controls | C-02 | Preferences affect checks consistently and can be reset | TODO | — | — |
| C-05 | Complete privacy and failure flows | B-02, C-01 | No processing on disabled sites/excluded fields; provider disclosure and useful error states are present | TODO | — | — |
| D-01 | Validate priority real-world editors | C-05 | Publish a tested matrix for Gmail compose, GitHub comments, LinkedIn posts, and Slack web; unsupported surfaces use fallback | TODO | — | — |
| D-02 | Handle dynamic fields and geometry | D-01 | SPA navigation, resizing, scrolling, permitted frames, and supported open shadow roots do not misapply edits | TODO | — | — |
| D-03 | Investigate Google Docs and complex editors | D-01 | Produce a separate feasibility result; do not advertise support without a working tested adapter | TODO | — | — |
| E-01 | Run writing-quality and regression evaluation | C-03, D-01 | Meet the product framework's beta quality gates across the validated provider configurations | TODO | — | — |
| E-02 | Validate shared-companion coexistence | B-02, C-01 | Concurrent use with another consumer neither mixes sessions nor creates uncontrolled background traffic | TODO | — | — |
| E-03 | Package a reviewable beta | E-01, E-02 | Install/update/uninstall and permission behavior verified on each advertised browser/OS; beta package and support matrix ready | TODO | — | — |

## First development slice

The merged A-01–A-05 foundation slice includes executable investigation tools and a minimal native status probe. It does not count as B-01 product scaffolding. The owner subsequently requested B-01–B-05 together: development proceeds with the explicit staged evidence above, while live provider/latency and device acceptance remain open. C–E items stay TODO.

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
