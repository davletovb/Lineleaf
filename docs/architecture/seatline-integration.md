# Lineleaf and Seatline Integration

Status: A-01 contract audited at Seatline `dc1086582c8b98498aa48dae91c8d174bc3cfc3c`, protocol 1. The extension targets Seatline `81aae35c5923a2b22b0e5f01b387d1c422495c9a` (`config/seatline-contract.json`), whose readiness, effort and service-tier APIs it uses, and requires its protected send method for writing. The audited legacy revision remains a status/refusal compatibility check. [API audit](../investigations/seatline-api-audit.md), [authorization evidence](../investigations/extension-authorization.md), and [A-05 decision](mvp-scope-and-toolchain.md) distinguish verified code from open live/device gates. See the [implementation tracker](../product/lineleaf-implementation-tracker.md).

## Architecture and ownership

Lineleaf saves **Reasoning effort** beside its model setting in Writing settings; it applies to every manual check, automatic check, clarity check and rewrite. Low is the default. Provider default omits the override. An explicit choice requires `status.capabilities.reasoning_effort === true` before a protected send; an older companion is refused, and its protected subscription/tool-isolation requirements still apply. The application sends the saved value as Seatline's generic optional `turn.reasoning_effort`; Codex maps it to a single `-c model_reasoning_effort="low"` override without changing provider configuration. A model can reject a budget it does not support.

**Speed** is saved beside Model and Reasoning effort, defaults to Standard, and applies to every writing mode. Switching it preserves model and effort. Every writing turn sends the chosen generic `service_tier`, including explicit Standard so an inherited Codex Fast default cannot change the comparison. Both choices require `status.capabilities.service_tier === true` before writing; an older companion is refused before generation. Codex uses invocation-only tier/feature overrides; no request control, config-file edit or automatic fallback is added. The official [speed guide](https://learn.chatgpt.com/docs/agent-configuration/speed), checked 2026-10-06, documents availability and 2.5× included subscription usage (purchased/Enterprise usage is 2×); these are usage multipliers, not speed guarantees. Adapter support alone does not establish model/account eligibility.

Proofreading and clarity ask for short explanations. Their original context instructions remain: context minimization and empty-context guidance are deferred until corpus evaluation, because substring ambiguity can invalidate a whole response. The JSON schema, correction counts, explanation/context bounds, exact source matching, ambiguity rejection and stale-result/edit checks are unchanged. Short explanations are an instruction, not a measured latency or quality guarantee.

Successful ephemeral Codex turns are stopped and reaped promptly after the provider reports `turn.completed`. Terminal delivery still follows cleanup; persistent sessions keep their save/exit grace. This removes a potential post-completion wait without reusing a provider process. Seatline's app-server slice remains deferred.

Settings → Seatline → Last manual check timing records only the last non-cancelled manual check in browser session storage. Automatic and cancelled checks do not overwrite it. It can be refreshed and copied. Reset invalidates older requests and drains in-flight timing writes before clearing it; timing-storage failure cannot prevent site-permission removal. Its total covers worker receipt through candidate validation, excluding page dispatch and rendering. Readiness includes the handshake/cache/probe path; launch wait includes queueing; startup is launch to provider start; answer is provider start to the first complete message; completion is that message to the terminal event, including remaining messages and cleanup. Missing phases show Unavailable. Readiness retries accumulate, while provider phases describe the last attempt. Numbers, static labels, requested model/effort/speed and outcome are recorded; drafts, answers, provider error text and origins are excluded. Timing writes cannot delay result delivery. Version 2 adds `requested_service_tier`; the display says requested speed, because it does not confirm the tier served. The selected model is the requested ID, not confirmation of an inherited provider default.

The established direction is one shared Seatline companion for multiple apps/extensions, with no writing-specific logic added to Seatline. A-01 inspected the merged pre-release code; future contract updates need the same source/release review.

| Component | Responsibilities |
| --- | --- |
| Editor adapters in the extension | Detect supported fields; extract a bounded text snapshot; map text to editor positions; apply and undo supported edits |
| Extension suggestion engine | Writing prompts, response validation, exact edit matching, stale-result rejection, dictionary, request pacing, and rewrite previews |
| Extension UI | Inline cards/underlines, selection actions, popup/settings, accessibility, consent, and connection status |
| Extension service worker | Validate content-script senders/payloads; route requests; manage the Native Messaging connection and recovery |
| Shared Seatline companion | Generic provider execution; app-scoped grants/sessions, target cancellation, and bounded shared scheduling verified in A-01 source |
| Supported provider runtime | Model execution and provider-owned authentication/session behavior |

Chrome Native Messaging is the intended extension-to-companion transport. Content scripts communicate through the extension service worker; they cannot invoke Native Messaging directly. The native host must allow the extension's actual ID, and Chrome's `allowed_origins` list cannot use wildcards. [Source: Chrome Native Messaging documentation](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

Use the established generic Seatline consumer interface. Do not invent method names in this document, embed a second companion, add a local HTTP listener, introduce app-worker processes, or add a Node runtime to Seatline. A development/build toolchain for the extension is a separate decision and does not imply a user-installed Node requirement.

First integration investigation must establish how a new consumer is authorized, whether the shared-companion path is merged/released, and how development and store extension IDs are registered without making users install another companion. Treat missing generic capabilities as explicit dependencies, not as permission to put writing code into Seatline.

The initial extension does not need a hosted inference server or a Cloudflare relay. A website can later provide documentation or distribution independently.

## Integration investigation: A-01 through A-03

Record evidence from the currently merged Seatline code/release for:

- Generic consumer entry point, transport, supported versions, and request/event/error schemas.
- New-consumer authorization and development/store extension ID registration.
- Provider capabilities, authentication/session modes, output format, and process lifecycle.
- Request correlation, cancellation, timeouts, reconnect/recovery, and session isolation.
- Any priority, capacity, or shared scheduling mechanism available to consumers.
- Measured cold/warm latency, structured-output reliability, and provider limits.

Separate implemented capabilities from proposals or unmerged work. Missing capabilities are named dependencies with evidence and an owner. Writing-specific logic remains in Lineleaf.

Use a persistent Native Messaging connection where supported by the established companion interface. A host disconnect still needs bounded reconnection and safe request recovery; do not resubmit mutations blindly or depend on permanent service-worker memory. [Chrome service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

## Retained connection, readiness reuse and preparation

This is Lineleaf's side of Seatline's performance work (the Seatline performance tracker's G-01). Seatline owns the readiness cache and the companion; Lineleaf owns when to ask, what its policy accepts, and what a field's request may carry.

**One connection, kept for a while.** The service worker opens one Native Messaging connection and keeps it between requests, instead of starting a new native host process for every check. It is closed after a minute with no request (`LINK_IDLE`), when Lineleaf is paused or reset, and when no site is enabled, so an idle browser leaves no companion process. If it closes, the next request reconnects by itself. A frame that provably never left, because the retained port had already gone, is sent once more on a new connection; a request that was sent and then lost to a disconnect fails once with `NATIVE_UNAVAILABLE` and is never replayed, because Seatline may already have started a turn for it.

**Readiness before every send, from Seatline's cache.** A check asks `readiness` (cached, up to 30 seconds old), verifies a subscription sign-in and tool isolation, then sends `send_ready_with_policy` with `allowed_sign_in: ["subscription"]` and `check_sign_in: false`. Seatline validates the final readiness and enforces that allowlist before generation, including if credentials change to an API key after the earlier check. Client status delivery and cancellation are no longer the launch-policy gate. `SIGN_IN_POLICY_DENIED` maps to the subscription-required message and is final. Evidence-change/expiry/unverified refusals may be retried once after a fresh check, since nothing launched. Local file changes invalidate readiness; keyring/server changes without a local signal remain bounded by the 30-second window.

**Companions without the protected API.** Legacy status remains available for setup, but writing requires `send_ready_with_policy`. An unknown readiness method or unsupported protected send reports `COMPANION_UPDATE_REQUIRED`, with zero generation and no fallback to `send`/`send_ready`. Capabilities are forgotten on disconnect so updating the companion is noticed. `readiness` predates the protected send, so a companion can answer it and still refuse every check; Check Seatline therefore also reports `update_required` after a refused protected send (remembered until one is accepted) or when the readiness API is absent, and Lineleaf does not probe the protected method with a request that could start a turn. A running broker keeps serving until it has been idle for ten minutes, so an update needs `seatline-companion install` and a restart of the running companion to take effect. CI checks both the pinned companion and legacy refusal against `dc1086582c8b98498aa48dae91c8d174bc3cfc3c`.

**Preparation.** Seatline's `prepare` resolves the provider and checks readiness; it runs no prompt, starts no model turn and keeps no process warm. Lineleaf asks for it, with no text, only for the provider the user chose (Codex), only for a site the user enabled while Lineleaf is not paused, and only at moments that point to a check:

| Moment | Prepares? |
| --- | --- |
| Focus moves into an eligible editor with automatic checking on | Yes |
| The user presses Alt Shift L for the inline card, or opens the writing panel | Yes |
| The toolbar menu opens on a site Lineleaf is on for | Yes |
| Focus moves into an editor with automatic checking off | No: focus alone does nothing without the opt-in |
| A disabled site, a paused Lineleaf, a password, payment or read-only field, an excluded field | No |

The page asks at most once every ten seconds per frame, and the worker at most once every ten seconds in all. It declines when a request is running, the provider is rate-limited or has just timed out, or the companion has no readiness API, and it never shows a failure (nobody asked). A completed preparation leaves its connection and readiness available for the next request. If writing or an explicit diagnostic arrives while preparation is unfinished, the worker aborts preparation and detaches its port before starting foreground work on a new port. Preparation timeout/drain callbacks cannot close that foreground connection, including when the old companion ignores cancellation or its native handshake never completes. The user's own **Check Seatline** always asks for a fresh readiness and never reuses a cached answer.

**Cancellation retention.** The companion terminates the target request without acknowledging the cancellation ID. That ID is removed when the target terminates, or on disconnect/drain timeout; five completed cancellations leave no retained IDs. Fixtures use the real target-only terminal protocol.

**Independent context per field.** Every request is its own ephemeral turn: `session: "ephemeral"`, no continuation, no cleanup group, and the text of that one field (plus the user's dictionary). The connection carries no conversation state: answers are matched by request ID and buffered per request, one writing request runs at a time (a second field is told `BUSY`, not queued), a cancelled request's output that arrives late is dropped, and a persistent-session event from the companion is a contract violation that drops the connection. A preparation carries no field at all.

**Historical evidence before the review corrections.** Counts come from real processes: the production controller through a real companion and broker with a stand-in Codex that records its launches (`tools/measure-readiness.mjs`), and the provider benchmark with Seatline's fake Codex (`tools/validate_readiness.py`). For eight checks the earlier controller started eight native host processes and ran sixteen sign-in probes and eight turns; the initial retained-connection implementation starts one host, runs one probe and eight turns, and a preparation before the first check moves that probe ahead of it (the first check then starts no host and runs no probe). The original old-companion fallback retained one host but still ran sixteen probes for eight checks. Current strict builds instead refuse writing on that companion; the corrected pin requires fresh CI evidence. Those are launches of a stand-in provider, not Codex: the milliseconds in the reports measure the extension, the bridge, the broker and process starts, not a provider's own latency. **No live latency, quota or sign-in result for a real provider is claimed or exists.** See [evidence](../evidence/readiness-reuse-local.json) and [benchmark notes](../investigations/provider-benchmark.md#readiness-mode-and-launch-counts). The first check after more than 30 idle seconds, or with a changed account, pays one probe again; Chrome documents that an extension service worker stays alive while it holds a Native Messaging port, so with the connection kept the worker may stay alive for up to a minute after the last request; that has not been observed in a real Chrome here.

## Safe suggestion and editing pipeline

1. On an enabled site, identify the active supported editor. Assign an editor identity and monotonically increasing text revision. Avoid password, payment, one-time-code, and excluded fields; sensitivity detection is imperfect, so user site controls remain necessary.
2. Wait until composition has finished and typing has paused. Snapshot the smallest useful paragraph/selection plus limited context. Preserve a mapping between the snapshot and the editor.
3. Submit a bounded proofreading or rewrite request through Seatline. Include a request ID and the applicable snapshot identity/revision in the extension's bookkeeping. Treat user-written text as data, with no tool or browser actions available to the writing request.
4. Ask for structured correction candidates with original text, replacement, local context, category, and a short explanation. Validate structure, size, allowed categories, and the corresponding source revision.
5. Derive edit positions in extension code. Do not trust model-generated character offsets. Require a unique exact source match using context; drop ambiguous, overlapping, or unlocatable candidates. Document the offset convention and normalization mapping, including emoji and combining characters.
6. Render suggestions without rewriting the editor's HTML. Distinguish correctness corrections from optional style preferences. An LLM-provided confidence value is not a calibrated probability.
7. On acceptance, check the editor revision and exact source again, apply one adapter-supported edit, and verify the result. Preserve the caret, formatting, and meaningful undo behavior. Never blindly apply a response to changed text.
8. On further typing, navigation, or editor removal, cancel/supersede obsolete work and ignore late responses. New drafts never inherit another field's provider context.

Model output is advisory. Rewrites must preserve names, numbers, dates, negation, and uncertainty; never silently add claims. Test these separately from surface fluency.

Ordinary inputs and controlled/rich editors can behave differently when edited. The adapter prototype must prove that the site's own state and undo history remain correct. Unsupported editors use a preview-and-copy fallback.

## Evidence to record

A-04 should produce minimal editor fixtures and a short compatibility report. B-02 should record the validated companion version and interface. D-01/D-03 should produce the site/editor support matrix, including supported replacement and copy-only fallback behavior.

The [product framework](../product/lineleaf-product-framework.md) defines request-pacing hypotheses, permissions, privacy behavior, and beta quality targets.
