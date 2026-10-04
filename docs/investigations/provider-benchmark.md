# A-03 — Provider benchmark harness

[benchmark_provider.py](../../tools/benchmark_provider.py) sends bounded synthetic writing through the existing companion. It does not start another broker or call a model API directly. Codex is the first candidate because the audited adapter exposes subscription classification and tool isolation. No authenticated provider runtime is available in this workspace, so **no live latency, reliability, quota, or cancellation result is claimed**.

## Run on a suitable machine

Use the audited installed companion, an authenticated Codex subscription, and a model exposed by the installed provider. Verify `lineleaf` has a Codex grant. Replace `MODEL_ID` with that actual model identifier:

```sh
python3 -m tools.benchmark_provider --companion /path/to/seatline-companion --provider codex --model MODEL_ID --samples 5 --timeout 30
```

The harness first requires available/authenticated/subscription status and tool isolation. An API-key, cloud, unknown, unavailable, or unclassified configuration is refused before writing. Each turn uses no tools, ephemeral context, and no continuation. Text is synthetic, limited to 2,000 characters, and wrapped as data. Six cases cover agreement, spelling, punctuation, correct text, facts/negation, and Unicode.

Reports contain case IDs, connection/repetition IDs, model selection, first-delta/completion milliseconds, terminal states, structured validity, cancellation confirmation, and observed rate-limit failure. `summary.phases.first_request` and `summary.phases.subsequent_request` each contain completion and first-delta p50/p95; no latency percentile pools the phases. They exclude prompts, drafts, deltas, credentials, and raw provider errors. Metrics are structural/source-match reliability, not a grammatical-quality score. A syntactically valid empty correction set can still miss an error; human quality review belongs to E-01.

Each repetition opens a fresh native client process/connection and checks provider readiness before writing. It sends all six cases, rotating their order so the same prompt is not always first. Thus `--samples 5` produces **five first requests and 25 subsequent requests**, while preserving five samples per case and the 30-turn measurement budget. The first request is the first **writing** turn on that connection, after the status probe. These are connection phases, not proof of cold/warm provider or model state: Seatline still launches a provider process per turn.

For a controlled cold-start experiment, record hardware/OS, provider CLI version, selected model, authentication mode, runtime state, and the independent run ID. Run this command separately after a documented idle/startup condition and again with the provider already active; compare the separate phase summaries from each report, including their sample counts. The harness cannot reset or prove remote model/server cache state. A live report lacking that metadata cannot satisfy A-03's cold/warm acceptance. Do not kill another app's runtime to manufacture a cold result.

The sample count is bounded (1–10 per case). The harness stops after the first failed turn, performs no retry or quota-exhaustion experiment, cancels a timed-out target and drains it before further work, and bounds frames, event count, and accumulated output. The cancellation probe uses top-level `target` and measures arrival of the target's `stopped`. If the response already completed, report that cancellation was not confirmed. Broker limits come from audited source; actual provider quota remains unknown unless separately established.

A disconnect, malformed stream, failed cancel/drain, later readiness failure, or cancellation-probe failure retains every earlier measurement and reports `status: incomplete`. An interrupted turn is recorded without counting its elapsed time as successful completion latency. Failure reasons are fixed diagnostic names or exception class names, never exception text. With no measurements, readiness/transport failure remains `blocked`.

## Readiness mode and launch counts

By default the harness runs as the production extension did before Seatline's readiness API: `status`, then `send` with `check_sign_in`, which makes Seatline probe sign-in again inside every turn. `--readiness cached` asks `readiness` once per connection (Seatline reuses a verified result for up to 30 seconds) and sends each turn with `send_ready` under it and `check_sign_in: false`. A companion without the API refuses the cached mode with `INVALID_REQUEST` and no measurement is taken.

`--launch-log PATH` names a fake provider's launch record (Seatline's fake Codex appends one line per launch to `codex-invocations`). The report then counts real launches, split into sign-in probes (`status`) and model turns (`generation`), for the readiness check, each turn (so per phase) and the cancellation probe. A live provider keeps no such record, so a live run has no launch counts.

```sh
python3 -m tools.validate_readiness --companion /path/to/seatline-companion \
  --fake-provider /path/to/seatline-fake-provider
```

runs both modes against an isolated broker with the fake Codex signed in with a subscription, a new broker per mode so the readiness cache starts empty, and requires exact counts: two samples are 13 turns in both modes; the legacy mode launches 15 probes (one per connection and one inside each of 13 turns), the cached mode one. CI runs it against the current companion revision; `tools/measure-readiness.mjs` runs the production controller itself through the same kind of broker and is described in [the integration notes](../architecture/seatline-integration.md#retained-connection-readiness-reuse-and-preparation). These are counts of fake-provider processes. They do not resolve A-03: there are still no live first/subsequent latency distributions.

## Fixture versus live evidence

```sh
python3 -m tools.benchmark_provider --fixture
```

The fixture tests transport, metrics, conservative JSON validation, and cancellation plumbing; its report is permanently labeled `kind: fixture`. Its deterministic delays are not provider measurements. CI archives fixture reports separately from native authorization evidence.

The real-companion CI probe separately uses Seatline's own pinned fake provider to check the writing-turn schema, missing-executable rejection, top-level cancellation, and `PROVIDER_RATE_LIMITED` mapping. All eleven `safe_failure` names match the audited [`wire.rs` reason constants](https://github.com/davletovb/seatline/blob/dc1086582c8b98498aa48dae91c8d174bc3cfc3c/companion/src/wire.rs); unknown strings are collapsed to `PROVIDER_FAILED`. This verifies diagnostics and schema without making a live provider-performance claim.

[Live readiness evidence](../evidence/provider-readiness-local.json) records `COMPANION_NOT_INSTALLED` for the default live command. A separately downloaded CI binary can be inspected locally, but is not a working installed/authenticated provider environment. Do not interpret fixture timings as resolving A-03.

Before closing A-03, collect at least 30 representative live turns (five samples per case), first/subsequent latency distributions, structured-output results, a confirmed cancellation, runtime/model metadata, and any observed limits. Freeze actual automatic-check budgets only after those results. No live benchmark runs in CI because CI has no provider account and must not receive subscription credentials.
