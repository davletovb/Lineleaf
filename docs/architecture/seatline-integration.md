# Lineleaf and Seatline Integration

Status: Integration requirements. Exact companion API and capabilities await A-01 verification. See the [implementation tracker](../product/lineleaf-implementation-tracker.md).

## Architecture and ownership

The established direction is one shared Seatline companion for multiple apps/extensions, with no writing-specific logic added to Seatline. The current merged companion code, API, and release readiness must be inspected in A-01 before implementation.

| Component | Responsibilities |
| --- | --- |
| Editor adapters in the extension | Detect supported fields; extract a bounded text snapshot; map text to editor positions; apply and undo supported edits |
| Extension suggestion engine | Writing prompts, response validation, exact edit matching, stale-result rejection, dictionary, request pacing, and rewrite previews |
| Extension UI | Inline cards/underlines, selection actions, popup/settings, accessibility, consent, and connection status |
| Extension service worker | Validate content-script senders/payloads; route requests; manage the Native Messaging connection and recovery |
| Shared Seatline companion | Generic provider execution and connections; inspect availability of client/session isolation, cancellation, and shared scheduling in A-01 |
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
