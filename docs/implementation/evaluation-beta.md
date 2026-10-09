# E-01–E-03 — evaluation and gated review packaging

This slice supplies production-path quality evaluation, bounded shared-broker probes and a reproducible review archive. It does not establish live quality or a distributable beta. The tracker retains IMPLEMENTED — VERIFY until independent human/live/device acceptance exists.

## Writing evaluation

The bundled corpus is English. Turkish proofreading (F-04) and guarded writing styles (F-05) have no independently reviewed corpus yet, so their quality is unmeasured and the English results do not cover them. The runner, label validator, scoring and pending judgment templates accept `TR` cases and pass the case's declared language into candidate validation and the prompt; a measurement never depends on what the language detector (F-06) makes of a case, and the detector itself is not evaluated by this corpus. Use `--corpus /path/to/turkish-corpus.json` with the same corpus schema for separate Turkish preparation, fixture and live runs; the option also applies when scoring an archived run. `languages.EN` and `languages.TR` report proofreading, clarity and style separately. Per-language coverage, precision, recall and rewrite-review gates prevent English results from hiding a failing or incomplete Turkish stratum in a mixed corpus; each language needs proofreading cases, at least twelve clarity cases and all six rewrite modes. Synthetic Turkish regression inputs test this plumbing, not linguistic quality or provider acceptance.

`evaluation/writing-corpus.json` contains 326 synthetic proofreading cases, 18 clearer-wording cases (mode `clarity`, scored apart from corrections with their own metrics and a 95% human-precision gate; four have no expected suggestion) and 36 distinct-source rewrites (six per improve/paraphrase/clearer/shorter/formal/friendly mode; the improve and paraphrase references were added with the inline rewrite feature and are as unreviewed as the rest), authored as unreviewed proposals. Strata include grammar, spelling, punctuation, already-correct, informal voice, names/numbers/dates, negation, ambiguity, second-language patterns, Unicode, paragraphs, multiple edits and US/UK-sensitive words. There are 176 paragraphs of at least 200 characters, 36 multi-edit cases, 12 paired variant cases and four cases near the 2,000-character limit. The expanded paragraphs include controlled correct/error variants across 32 topics; these are correlated test families, not a random sample of independent real-world writing. Literal protected-token counts are a conservative screen; human review of meaning is still required. Some valid alternatives will differ from draft references.

```sh
npm run evaluate:fixture
```

This exercises the production `writingTurn`, `NativeSeatline`, readiness gates and `candidates` validator through synthetic native ports. `test-results/quality` contains private-mode responses, a content/hash-bound summary and pending label/judgment templates. Fixture reference agreement is harness evidence, never writing quality. Templates start with pending review headers, per-case decisions, null judgments and an unapproved recall policy; no human acceptance is committed.

Copy `labels-template.json` to `labels.json`. An independent human must inspect every source/proposal and correct references before setting `review.kind` to `human`, a pseudonymous `reviewer`, `independent: true` and ISO `reviewedAt`. The ID must differ from corpus author `codex`. Each case requires `decision: approved`, `corrected` or `rejected`. Approved references must match the draft; corrected references must actually differ after production decoding. A rejected case requires `reference: null` and blocks release until the corpus is repaired and reviewed again. Changing only a review header cannot approve labels. Keep the exact corpus hash. This v2 corpus invalidates earlier references/runs; regenerate all hashes/reviews/runs. Proofreading references use the same contextual schema as provider responses; alternative approved spans need reference adjudication.

The evaluator accepts a fixed `--effort` for a whole run (`none`, `low`, `medium`, `high`, `xhigh`, `max`, or an empty string for Provider default). Omission uses Low, matching Lineleaf Settings. The choice is sent on every turn and included in the configuration hash; changing it requires fresh evidence. Scoring an existing `--run` cannot override its recorded effort. Compare efforts in separate output directories with the same corpus, model and prompt engine. Shorter-context prompts remain deferred; this change retains the original context instructions and strict whole-response validation.

`--speed standard|fast` also fixes an explicit requested tier for the whole run, is forwarded on every case, and is bound into its configuration hash. Omission or `--speed ""` records Provider default as an empty setting and omits the turn field, matching Settings. It does not reveal the inherited tier; choose explicit Standard/Fast when comparing their processing. Scoring existing evidence cannot override it. For a Fast comparison, keep model, effort, corpus, provider version and engine unchanged, use separate output directories, and pass `--effort xhigh --speed standard` or `--effort xhigh --speed fast` to both preparation and live collection. Compare recall as well as human precision and latency; fixture agreement cannot establish equal error detection. Readiness must advertise forwarding for an explicit service tier and any explicit reasoning effort before generation. Speed metadata records the requested tier, not confirmation of the backend tier served.

Before collecting live outcomes, prepare templates for the intended model/CLI/runtime configuration without contacting a provider:

```sh
npm run package
node tools/evaluate-writing.mjs --prepare --effort low --model ACTUAL_SELECTED_MODEL \
  --provider-version ACTUAL_CLI_VERSION --out test-results/quality-plan
```

An independent release owner reviews `acceptance-template.json`, chooses `minimumReferenceRecall` in (0, 1], and records the human approval. Keep the policy as `acceptance.json`; its corpus/configuration hashes must match the later live run, and its approval time must precede that run. No numeric floor is preapproved or inferred from fixture scores. Choose a meaningful floor before seeing model outcomes. Planned reports are explicitly `kind: planned`, contain zero responses and cannot qualify as live evidence.

After a real installed/authenticated provider is available, build the current package and run:

```sh
npm run package
node tools/evaluate-writing.mjs --companion /path/to/seatline-companion \
  --model ACTUAL_SELECTED_MODEL --provider-version ACTUAL_CLI_VERSION \
  --out test-results/quality-live
```

Replace placeholders with the actual model/CLI identity. Readiness must report authenticated subscription sign-in and tool isolation before every turn. Turns are sequential, ephemeral, no-tools and without continuation/retry. Every case opens a fresh native connection, measures ready negotiation/status/send/production validation, and closes it. Invalid model output is recorded as `INVALID_OUTPUT` and the next case still runs; there is no retry. Readiness, timeout, rate-limit, queue, transport or aggregate-output-limit failures stop the run. Responses remain bounded; stdout logs only fixed codes and aggregate metrics. It never crawls pages or captures drafts. Status-only/live incomplete runs exit 2.

Copy the generated judgment template to `judgments.json`. Independently review the exact hash-bound run: each emitted suggestion's correctness and explanation, plus whole-output meaning, including rows with no suggestions. Available outputs need explicit booleans. For malformed, failed or unattempted rows, retain empty suggestions and `meaningPreserved: null`; unavailable output cannot be human-approved. Hash-bound partial reviews yield a blocked summary with missing/invalid/unreviewed case IDs rather than a generic failure. Missing reviews block release; stale bindings and malformed review shapes are still refused. Then score without resubmitting requests:

```sh
node tools/evaluate-writing.mjs --run test-results/quality-live/responses.json \
  --labels test-results/quality-live/labels.json \
  --judgments test-results/quality-live/judgments.json \
  --acceptance test-results/quality-plan/acceptance.json \
  --out test-results/quality-live/scored
```

Human proofreading precision must reach 0.95; exact-reference recall is reported separately and must meet the independently preapproved floor. One detection at near-zero recall fails that gate even with perfect precision. Shorter rewrites must actually reduce UTF-16 length. Coverage requires at least 150 proofreading cases, 30 paragraphs of at least 200 characters, eight multi-edit references, six variant cases and two cases at least 1,800 characters long. Structural invalidity, missing output, no verified error detection, protected token loss, human meaning/explanation errors or unapproved rewrites block quality eligibility. Reference precision/recall are not semantic metrics and do not replace human judgments. A known fixture identity cannot be relabeled live. Metadata/independence are operator attestations, not authentication of a model/person.

The invalid-output rate uses completed model answers (valid plus invalid), excluding infrastructure failures and unattempted cases. New latency reports label `fresh-native-readiness-protected-send-validation` (historical `fresh-native-ready-status-send-validation` remains readable) and `includesBrowserUI: false`: they include a new bridge/handshake/fresh-readiness/protected-send per case (the cold path: the production extension now keeps its connection and reuses Seatline's readiness, so these are not its timings), but exclude browser dispatch, UI/paint and teardown. Valid-suggestion percentiles alone do not replace cold/warm or actual-device acceptance.

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

Copy `evaluation/beta-evidence-template.json` outside the candidate directory and complete it after inspecting evidence. Attach references to reviewed live responses/labels/judgments and the approved acceptance policy for each qualified configuration; current installed Linux/macOS CI; live two-consumer coexistence; approved live latency/typing; actual Chrome device checks; and the four authenticated priority-editor results. Every artifact/attestation must match current package/engine/Seatline identities. Do not put response/credential artifacts into candidate archives or ordinary CI logs. See [beta acceptance](../beta/ACCEPTANCE.md) for the human procedure and trust boundary.

Installed CI additionally upgrades an isolated unpacked test copy from 0.1.0 to 0.1.1 using the same public identity, restarts its profile, verifies preferences/dictionary/grants and automatic opt-out, then revokes/resets/restarts. The shipped version stays 0.1.0. Native permission prompts, store updates, uninstall and human screen-reader checks remain actual-device gates. CI archives only fixture summaries and blocked candidate material, never a beta ZIP.

## Provider comparisons

`tools/evaluate-writing.mjs` accepts `--provider codex|claude|gemini|grok` (default Codex). Use the native model ID and actual runtime version. Gemini requires explicit `--allow-cloud`, matching the Settings disclosure; other providers reject that flag. Effort/speed overrides are Codex-only. Configuration hashes now include provider and cloud policy; historical Codex evidence remains readable. Qualified beta configurations identify their provider. Fixture runs exercise schemas and routing, never live quality or provider speed.

The bounded latency benchmark also accepts those providers. For Gemini use `--provider gemini --readiness cached --allow-cloud`; cloud opt-in is refused on the legacy unprotected-send path. Its fixture mode simulates the cloud classification without accessing an account. Compare like-for-like text, output validation and quality metrics; switching providers does not establish a speed improvement by itself.
