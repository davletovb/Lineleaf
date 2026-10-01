# A-05 — MVP scope and toolchain decision

Decision date: 2026-10-01. This approves the toolchain and simple-editor boundaries using [A-01](../investigations/seatline-api-audit.md) and [A-04](../investigations/editor-compatibility.md). Final MVP provider/latency/install decisions remain gated by [A-02](../investigations/extension-authorization.md) and [A-03](../investigations/provider-benchmark.md). The [tracker decision log](../product/lineleaf-implementation-tracker.md#decision-log) records this split acceptance explicitly. B-01 may reuse the accepted toolchain for planning, but implementation stays TODO until A-05 is DONE. This decision does not approve a public beta or automatic checks.

## Product slice

Chrome desktop MV3, initially developed/tested for macOS. English US/UK remains the language target. Start with user-invoked proofreading of bounded selected text, preview, accept/dismiss, and native undo on the verified simple surfaces. Tone changes are explicit actions; correctness suggestions preserve facts, negation, authorial intent, and formatting. Unsupported surfaces offer copying the proposed text. Real-world editors, language-variant evaluation, accessible UI, and per-site controls must be implemented and validated in the B–E items.

Use the existing shared Seatline companion and `com.seatline.host`, pinned to the audited pre-release revision until a release/contract update is reviewed. Codex is the first **candidate** provider. Writing requests require authenticated subscription status and tool isolation, use no tools, and stay ephemeral with no continuation. No writing is sent by the A-02 probe. No consumer worker, second companion, inference server, or HTTP bridge is added.

Automatic pause-based checking stays disabled until live provider evidence supports it. The product framework's 1.5–2 second idle pause / ten-second minimum interval remain hypotheses for C-01, not a validated background policy. Provider work must never block typing.

## Latency and release gates

For explicit requests, use a provisional 30-second deadline, cancellation, and visible progress. It is a product timeout, not a measured acceptable p95. A-03 must produce at least 30 live turns, first/subsequent p50/p95, source-valid structured output, confirmed cancellation, and stated hardware/runtime/model metadata before finalizing provider choice or automatic-check latency thresholds. The harness records static broker limits without spending calls to discover an account's quota.

If results are too slow for inline checking, keep explicit requests usable and separately evaluate an extension-owned local spelling/rule component. Its licensing and quality need review; Seatline must remain provider-neutral. Do not make an unlimited-use claim.

## Toolchain

| Area | Choice | Reason |
| --- | --- | --- |
| Extension | MV3, native ES modules, plain JavaScript/CSS | Small investigation and browser-owned APIs; no bundler/framework required yet |
| Local development | Node 24 and npm lockfile | Runs tests only; no Node dependency for the user or Seatline |
| Provider/native investigation | Python 3.12+, standard library | Bounded framing/subprocess harness, no extra runtime added to Seatline |
| Browser regressions | Playwright 1.62.1, `node:test` | Actual Chromium editing, caret, formatting, and native undo |
| Harness regressions | Python `unittest` | Fragmented/malformed framing, exact origins, sign-in gates, output validation, cancellation |
| CI | Linux browser tests and pinned upstream companion build | Synthetic tests need no account; native authorization exercises the actual shared binary |
| Distribution | Unpacked diagnostic only in milestone A | Product packaging/settings remain B-01; store signing/ID remain release work |

`npm ci --ignore-scripts`, `npx playwright install chromium`, and `npm test` are the verified development path. CI also installs browser OS dependencies. There is no product build/package command before B-01.

## Open gates and ownership

| Gate | Evidence needed | Effect |
| --- | --- | --- |
| Native broker validation | [CI report passed](../evidence/native-authorization-ci.json) on the pinned shared binary | Broker/grant behavior verified; Chrome/device/store gates remain |
| Actual Chrome/macOS setup | One existing shared installation, unpacked ID, permission UI and connection | No advertised macOS installation acceptance yet |
| Store ID | Issued ID and exact-origin authorization check | Store distribution remains unavailable |
| Live provider | Authenticated subscription, measured results and runtime metadata | A-03 and final A-05 latency/provider decisions remain verify |
| Rich/real editors | D-01/D-03 site-specific evidence | Simple fixture results do not imply site compatibility |

Repository owner supplies the eventual provider-account/device validation; engineering owns harness fixes and evidence review. A-01 and A-04 support this conservative freeze. The tracker retains open verification states for the dependent decisions rather than treating synthetic output as live acceptance.
