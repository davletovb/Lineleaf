# E-01–E-03 — evaluation and review-candidate provenance

[PR #5](https://github.com/davletovb/Lineleaf/pull/5) implements the evaluation/coexistence/packaging workflow. [Run 36954523129](https://github.com/davletovb/Lineleaf/actions/runs/36954523129) passed all three jobs on code revision [`6cc7e482903e93679a870b2779af3d32ead5ada8`](https://github.com/davletovb/Lineleaf/commit/6cc7e482903e93679a870b2779af3d32ead5ada8). This evidence is for that named code revision; later documentation commits archive it.

| Boundary | Verified result | Job/artifact |
| --- | --- | --- |
| Linux regressions | 31 Python + 55 Node logic/evaluation + 90 browser + 7 installed MV3 = **183 passed** | Job `110674437074` |
| macOS regressions | Same **183 passed**, including native editing/undo and installed profile update/restart | Job `110674437045` |
| Shared companion | Fifteen authorization checks plus thirteen concurrent routing/session/cancellation/queue/recovery checks; all passed through pinned unmodified Seatline and upstream fake provider | Job `110674436881`; artifact `11206050061` |
| Quality harness | All 150 proofreading + 24 rewrite cases completed on each OS; pending independent labels/output judgments; `kind: fixture`, `releaseEligible: false` | Beta-review artifacts `11206000502` (Linux), `11205128180` (macOS) |
| Package gate | Candidate `releaseReady: false`, advertised platforms empty; all seven evidence groups required | Same beta-review artifacts |
| Stable installed lifecycle | Test-copy upgrade 0.1.0 → 0.1.1 retains ID/preferences/dictionary/grants/automatic opt-out; revoke/reset/restart clears access | Seven-test installed suite on each OS |

Evaluation regressions refuse all-empty corrections, false positives below 95% human precision, altered facts/negation, meaning/explanation failures, stale/hash-mismatched/duplicate data, missing rewrite modes, pending/non-independent reviews and malformed production output. A version-bump regression ensures current evidence uses the built manifest's ZIP and refuses a missing current archive even when an older ZIP exists. Unit-test human/live approvals exist only in memory and are not acceptance evidence. The review finding about hard-coded archive versions is fixed and its thread resolved.

## Downloaded package verification

The downloaded Actions artifact ZIPs matched GitHub's published SHA-256 digests. Both OS packages and candidates were then compared byte-for-byte with the local build.

| Content | Bytes | SHA-256 | Artifacts |
| --- | --- | --- | --- |
| `lineleaf-0.1.0.zip` | 38,606 | `02b9b307f1e40d04c61aae36000c5f637f89ecfe33db695b909a4ffc6e3eb2db` | `11205711831` Linux; `11205063397` macOS |
| `lineleaf-0.1.0-beta-review.zip` | 50,955 | `13be0ba2b07aee0410347fb6b7e3241dd930407cbd05678238ddbdc0cd78d4d6` | `11206000502` Linux; `11205128180` macOS |
| [Archived native coexistence report](native-coexistence-ci.json) | Exact downloaded bytes | `f3a41674ead151d51db0ba0c3249635c836f538d33fdaefd7b3909315e50d9f4` | `11206050061` |

Production engine hash: `be7ad7501906e13b4b77738f48152d372416e557bbc243b0eefbad2783d99236`. Parsed corpus hash: `daf83e4653f5b01b86f7a9b13685ffdbf12c237d0b002b176ad89e8d60acfabc`. Seatline revision: `dc1086582c8b98498aa48dae91c8d174bc3cfc3c`. Corpus/run hashes use the documented evaluator object representation; ZIP hashes use raw bytes.

Candidate contents are the nested extension ZIP, four beta guides, synthetic corpus, pending evidence template and blocked `review.json`. No model responses, completed label/judgment files, credentials or beta distribution ZIP ship. Local repeated archives are byte-identical. A local refusal check seeded a stale generated beta ZIP: release returned exit 2 and removed it. The extension itself is unchanged by this tooling slice.

## Typing probe boundary

Both CI probes use Playwright 1.62.1 Chromium 151.0.7922.34 and production content/controller code with synthetic native ports. Each scenario has 120 trusted inputs: automatic off makes zero provider submissions; automatic on coalesces them into one.

| CI hardware | Off input-dispatch p95 | On input-dispatch p95 | Incremental p95 |
| --- | --- | --- | --- |
| Linux x64, AMD EPYC 9V74 | 0.30 ms | 0.40 ms | 0.10 ms |
| macOS arm64, Apple M1 (Virtual) | 0.20 ms | 0.30 ms | 0.10 ms |

These times cover trusted `beforeinput` through input-dispatch microtasks. They exclude paint, live provider latency and actual-device responsiveness, and remain `kind: fixture-browser`, `releaseEligible: false`. No performance threshold is accepted from these measurements.

## Open acceptance

E-01/E-02/E-03 stay **IMPLEMENTED — VERIFY**. Independent human reference and output/explanation/meaning review, actual subscription provider quality across exact configurations, approved cold/warm latency/typing limits, live multi-consumer use, authenticated priority-editor drafts, and actual Chrome install/update/uninstall/permission/native/screen-reader checks remain required. Installed CI uses synthetic host preapproval and missing-native-host paths; it does not verify Chrome's native permission prompt or a successful authenticated browser-to-provider turn. Shared-broker fixtures prove scoped isolation under synthetic load, not subscription-provider coexistence on a user's device.

Use the [evaluation guide](../implementation/evaluation-beta.md) and [acceptance checklist](../beta/ACCEPTANCE.md) to complete current-package evidence. Human/CI/device attestation fields require release-owner inspection; completeness and hashes do not authenticate a reviewer or service.
