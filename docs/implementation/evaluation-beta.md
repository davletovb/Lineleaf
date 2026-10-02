# E-01–E-03 — evaluation and gated review packaging

This slice supplies production-path quality evaluation, bounded shared-broker probes and a reproducible review archive. It does not establish live quality or a distributable beta. The tracker retains IMPLEMENTED — VERIFY until independent human/live/device acceptance exists.

## Writing evaluation

`evaluation/writing-corpus.json` contains 150 synthetic proofreading cases and 24 rewrites (six per clearer/shorter/formal/friendly mode), authored as unreviewed proposals. Strata include grammar, spelling, punctuation, already-correct, informal voice, names/numbers/dates, negation, ambiguity, second-language patterns and Unicode. Literal protected-token counts are a conservative screen; human review of meaning is still required. Some valid alternatives will differ from draft references.

```sh
npm run evaluate:fixture
```

This exercises the production `writingTurn`, `NativeSeatline`, readiness gates and `candidates` validator through synthetic native ports. `test-results/quality` contains private-mode responses, a content/hash-bound summary and pending label/judgment templates. Fixture reference agreement is harness evidence, never writing quality. Templates start with pending reviews and null judgments; no human acceptance is committed.

Copy `labels-template.json` to `labels.json`. An independent human must inspect every source/proposal and correct references before setting `review.kind` to `human`, a pseudonymous `reviewer`, `independent: true` and ISO `reviewedAt`. The ID must differ from corpus author `codex`. Keep the exact corpus hash. To change the corpus itself, regenerate all hashes/reviews/runs. Proofreading references use the same contextual schema as provider responses; alternative approved spans need reference adjudication.

After a real installed/authenticated provider is available, build the current package and run:

```sh
npm run package
node tools/evaluate-writing.mjs --companion /path/to/seatline-companion \
  --model ACTUAL_SELECTED_MODEL --provider-version ACTUAL_CLI_VERSION \
  --out test-results/quality-live
```

Replace placeholders with the actual model/CLI identity. Readiness must report authenticated subscription sign-in and tool isolation before and between turns. Turns are sequential, ephemeral, no-tools and without continuation/retry. The runner stops at the first readiness/output/timeout failure, caps responses, and logs only fixed codes and aggregate metrics. It never crawls pages or captures drafts. Status-only/live incomplete runs exit 2.

Copy the generated judgment template to `judgments.json`. Independently review the exact hash-bound run: each emitted suggestion's correctness and explanation, plus whole-output meaning, including rows with no suggestions. Booleans must be explicit; null/pending/self/nonhuman or partial reviews fail validation. Then score without resubmitting requests:

```sh
node tools/evaluate-writing.mjs --run test-results/quality-live/responses.json \
  --labels test-results/quality-live/labels.json \
  --judgments test-results/quality-live/judgments.json \
  --out test-results/quality-live/scored
```

Human proofreading precision must reach 0.95; exact-reference recall is reported separately. Structural invalidity, missing output, no verified error detection, protected token loss, human meaning/explanation errors or unapproved rewrites block quality eligibility. Reference precision/recall are not semantic metrics and do not replace human judgments. A known fixture identity cannot be relabeled live. Metadata/independence are operator attestations, not authentication of a model/person.

Configuration hashes bind provider/model/CLI, pinned Seatline, production engine/package and runtime hardware. Output judgments bind the full run hash, including responses. Corpus/reference files and reports use a bounded duplicate-key-refusing development JSON parser; provider outputs still use the stricter production parser. Development adapters never ship in the extension.

## Shared companion and responsiveness

```sh
python3 -m tools.validate_coexistence --companion /path/to/seatline-companion \
  --fake-provider /path/to/seatline-fake-provider
npm run measure:typing
```

The native probe uses the unmodified pinned Seatline broker, an isolated Linux registry and upstream fake provider with no user credentials. It registers two origins in one installation and checks thirteen concurrency/session/cancel/queue/recovery conditions in addition to the fifteen authorization checks. Two concurrent clients deliberately reuse request IDs; cross-app continuation/forget must fail without damaging the owner's session. A persistent session is used solely by the second-consumer negative probe; production Lineleaf turns remain ephemeral. Bounded queue pressure is exactly twelve synthetic attempts, then cancellation drains and recovery. It is never run against live quotas. Reports contain booleans/protocol enums, not outputs, session handles or account paths.

The typing probe uses the production bundle/controller with trusted typing and synthetic native ports. It records 120 input dispatch durations with automatic mode off/on, zero/one coalesced submissions, p50/p95/max and the incremental p95. The interval ends after input-dispatch microtasks; it excludes paint, device acceptance and remote latency. CI/browser/hardware identity accompanies results. A live latency/device acceptance attestation requires at least 30 samples per matching qualified configuration, documented cold/warm phases and human-approved limits from A-03. Fixture timing cannot satisfy it.

## Candidate and release

```sh
npm run beta:candidate
# After completing independent evidence; paths in evidence resolve relative to its file:
node tools/package-beta.mjs --release --evidence /path/to/beta-evidence.json
```

The candidate command writes `dist/lineleaf-0.1.0-beta-review.zip`: nested loadable extension ZIP, setup/support/privacy/acceptance docs, synthetic corpus, pending evidence template and `review.json`. It succeeds even when blocked, advertising no platform. Missing/malformed/stale/live-ineligible evidence always blocks release. Release mode exits 2 and removes an older generated `dist/lineleaf-0.1.0-beta.zip`; only a fully passing gate copies the exact extension ZIP there. ZIP generation is deterministic and atomic and refuses symlink inputs/self-containing destinations.

Copy `evaluation/beta-evidence-template.json` outside the candidate directory and complete it after inspecting evidence. Attach references to reviewed live responses/labels/judgments for each qualified configuration; current installed Linux/macOS CI; live two-consumer coexistence; approved live latency/typing; actual Chrome device checks; and the four authenticated priority-editor results. Every artifact/attestation must match current package/engine/Seatline identities. Do not put response/credential artifacts into candidate archives or ordinary CI logs. See [beta acceptance](../beta/ACCEPTANCE.md) for the human procedure and trust boundary.

Installed CI additionally upgrades an isolated unpacked test copy from 0.1.0 to 0.1.1 using the same public identity, restarts its profile, verifies preferences/dictionary/grants and automatic opt-out, then revokes/resets/restarts. The shipped version stays 0.1.0. Native permission prompts, store updates, uninstall and human screen-reader checks remain actual-device gates. CI archives only fixture summaries and blocked candidate material, never a beta ZIP.
