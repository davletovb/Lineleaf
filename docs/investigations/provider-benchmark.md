# A-03 — Provider benchmark harness

[benchmark_provider.py](../../tools/benchmark_provider.py) sends bounded synthetic writing through the existing companion. It does not start another broker or call a model API directly. Codex is the first candidate because the audited adapter exposes subscription classification and tool isolation. No authenticated provider runtime is available in this workspace, so **no live latency, reliability, quota, or cancellation result is claimed**.

## Run on a suitable machine

Use the audited installed companion, an authenticated Codex subscription, and a model exposed by the installed provider. Verify `lineleaf` has a Codex grant. Replace `MODEL_ID` with that actual model identifier:

```sh
python3 -m tools.benchmark_provider --companion /path/to/seatline-companion --provider codex --model MODEL_ID --samples 5 --timeout 30
```

The harness first requires available/authenticated/subscription status and tool isolation. An API-key, cloud, unknown, unavailable, or unclassified configuration is refused before writing. Each turn uses no tools, ephemeral context, and no continuation. Text is synthetic, limited to 2,000 characters, and wrapped as data. Six cases cover agreement, spelling, punctuation, correct text, facts/negation, and Unicode.

Reports contain case IDs, model selection, first-delta/completion milliseconds, terminal states, structured validity, p50/p95 summaries, cancellation confirmation, and observed rate-limit failure. They exclude prompts, drafts, deltas, credentials, and raw provider errors. Metrics are structural/source-match reliability, not a grammatical-quality score. A syntactically valid empty correction set can still miss an error; human quality review belongs to E-01.

The first request and subsequent requests are labeled separately. To assess a genuinely cold start, record hardware/OS, provider CLI version, selected model, authentication mode, and whether its runtime was already active, then run a fresh process under controlled conditions. Seatline launches a provider process per turn; the harness cannot force or prove server/model coldness. Do not kill another app's runtime to manufacture a cold result.

The sample count is bounded (1–10 per case). The harness stops after the first failed turn, performs no retry or quota-exhaustion experiment, cancels a timed-out target and drains it before further work, and bounds frames, event count, and accumulated output. The cancellation probe uses top-level `target` and measures arrival of the target's `stopped`. If the response already completed, report that cancellation was not confirmed. Broker limits come from audited source; actual provider quota remains unknown unless separately established.

## Fixture versus live evidence

```sh
python3 -m tools.benchmark_provider --fixture
```

The fixture tests transport, metrics, conservative JSON validation, and cancellation plumbing; its report is permanently labeled `kind: fixture`. Its deterministic delays are not provider measurements. CI archives fixture reports separately from native authorization evidence.

[Live readiness evidence](../evidence/provider-readiness-local.json) records `COMPANION_NOT_INSTALLED` for the default live command. A separately downloaded CI binary can be inspected locally, but is not a working installed/authenticated provider environment. Do not interpret fixture timings as resolving A-03.

Before closing A-03, collect at least 30 representative live turns (five samples per case), first/subsequent latency distributions, structured-output results, a confirmed cancellation, runtime/model metadata, and any observed limits. Freeze actual automatic-check budgets only after those results. No live benchmark runs in CI because CI has no provider account and must not receive subscription credentials.
