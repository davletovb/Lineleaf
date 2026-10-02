# Lineleaf — Product Framework

Version: 0.1  
Established: 2026-10-01  
Status: Planned behavior and proposed targets. Implementation status lives in the [tracker](lineleaf-implementation-tracker.md).

## Product direction

Build a browser writing assistant with the familiar Grammarly interaction: help appears where the user types, offers specific corrections, and lets the user accept or dismiss each change. Seatline supplies the shared connection to supported AI providers.

Product promise: **Clearer writing. Still your words.**

The first release should help with grammar, spelling, punctuation, clarity, and deliberate rewrites. It should preserve meaning and authorship, retain formatting on supported editors, and respect the writer's voice by default. Explicit tone and rewrite actions may deliberately change wording or tone. The goal is dependable everyday writing assistance; complete Grammarly feature parity is a longer roadmap.

The distinction worth testing is provider choice through the companion the user already installed, combined with conservative editing and optional explanations. Supported provider sessions can be reused where their tooling permits it. Do not promise that every consumer subscription works, that usage is unlimited, or that installing Seatline removes provider limits.

## Product principles

1. **Preserve authorship and intent.** Corrections should be conservative. A requested rewrite or tone change must still keep facts and intent intact.
2. **Keep the user in control.** Suggestions require acceptance, rewrites have a preview, and changes can be undone on supported editors.
3. **Help where writing happens.** Avoid context switching while keeping typing responsive.
4. **Make correctness and style distinct.** Optional preferences should not be presented as grammatical errors.
5. **Share the companion.** Lineleaf owns the writing experience and consumes Seatline's generic provider connection.
6. **Make support evidence-based.** An editor/provider is supported after validation, not because a generic adapter seems applicable.

The preservation promise concerns authorship, intent, and control. It does not require retaining every word or an original tone when the user explicitly asks to change it.

## Scope and defaults

| Capability | First usable release | Later expansion |
| --- | --- | --- |
| Proofreading | Grammar, spelling, punctuation; minimal suggested edits | Additional languages and advanced style rules |
| Inline interaction | Underlines/cards, accept, dismiss, pause | More polished positioning and grouped suggestions |
| Rewriting | Selected text, or the caret paragraph in the inline card: improve it, paraphrase, clearer, shorter, more formal, friendlier; explicit actions with a before/after preview, available without the automatic opt-in; optional, off-by-default clearer-wording underlines that need automatic checking and are labelled apart from corrections | Multiple alternatives, custom tone presets and broader draft assistance |
| Explanations | Brief optional explanation for a correction | Learner-focused explanations and recurring patterns |
| Editing support | Textarea, supported text inputs, basic contenteditable | Dedicated rich-editor and site adapters |
| Preferences | English, US/UK variant, site enablement, personal dictionary | Other English variants, multilingual support, style profiles |
| Provider connection | Existing Seatline companion; one validated provider initially | Additional validated providers and capability-aware routing |

Chrome desktop is the initial browser target. Platform coverage follows what the existing Seatline installation supports; start development on macOS and validate further platforms separately. Edge and Firefox need explicit compatibility work rather than an assumed free port.

Google Docs, complex Notion editors, Monaco/code editors, and difficult embedded editors are separate compatibility investigations. Generic contenteditable support is not evidence that these work. Offer a selection/copy fallback wherever safe replacement is not available. Do not include plagiarism detection, AI-authorship detection, team administration, or mobile support in the first release.

Default interaction: the user enables assistance for a site, types normally, and receives suggestions after a pause. Corrections require acceptance. Rewrites are explicit actions with a preview. Include keyboard access, a clear checking state, a pause control, and visible connection errors.

The [A-05 implementation decision](../architecture/mvp-scope-and-toolchain.md) starts validation with explicit requests on simple tested editors. Automatic checking remains gated on live provider measurements; the pause-based interaction above is the later C milestone target.

## Component ownership

[Seatline integration](../architecture/seatline-integration.md) defines component ownership, the intended connection, the API investigation, and the safe editing pipeline. All writing-specific functionality belongs in Lineleaf.

## Responsiveness and shared-provider usage

A shared companion does not guarantee a warm model session or instantaneous proofreading. Measure current provider process/session behavior and request costs in A-03 rather than assuming that background checks are cheap.

Initial tuning hypotheses, to validate with measurements:

- Begin with roughly 1.5–2 seconds of idle time before a check, and check only changed paragraphs.
- Keep one in-flight automatic check per active editor and coalesce queued changes to the latest revision.
- Start with a minimum 10-second interval between automatic provider submissions; explicit rewrites bypass that local delay but still obey generic Seatline/provider limits. The optional clearer-wording check is a second automatic request per paragraph and spends the same interval and cap.
- Bound automatic requests to about 2,000 characters initially. Larger explicit rewrites need a visible preview and separate limit.
- Keep a small in-memory cache keyed by the text and writing settings. Do not persist raw draft text or text-derived cache keys by default.
- Apply backoff for provider-limit/busy errors. Cap background traffic across all tabs in this extension; use existing shared scheduling if exposed. Do not claim cross-app fairness unless it is verified.
- Prefer user-triggered work over automatic checks where the existing companion interface supports priority. Otherwise keep automatic work sparse and cancellable.

Measure cold/warm latency, p50/p95 time to valid suggestions, canceled requests, requests per minute, stale responses, and typing responsiveness. If provider calls cannot meet the desired inline experience, evaluate an extension-owned local spelling/rule component with its own licensing and accuracy review. This is a contingency, not a new Seatline requirement.

## Privacy and permissions

Use explicit site enablement with optional host permissions for continuous operation; manual selection actions can use temporary page access where suitable. Chrome documents the corresponding content-script permission mechanisms. [Source: Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts).

Before enabling automatic checks, explain that the bounded text being checked is sent through Seatline to the selected provider. A local companion does not make remote model processing local. Show the selected provider in settings and make pausing/disabling a site straightforward.

Capture only the active supported field/selection and necessary surrounding text. Do not capture the whole page, browsing history, unrelated messages, or provider credentials. Keep draft history off by default, avoid text in logs/telemetry, and use expiring in-memory text snapshots. Incognito operation is off initially. Stored preferences/dictionary entries have a clear reset/delete control.

## Beta quality gates

These are proposed targets, not measured results:

- Build at least 150 reviewed writing cases: real errors, already-correct text, informal voice, names/numbers, negation, ambiguous sentences, and second-language English. Use independent human review for labels and meaning preservation, with an explicit per-case reference decision. Include paragraph-length, multi-error and US/UK-sensitive cases and distinct rewrite sources.
- Target at least 95% precision for emitted grammar/spelling/punctuation corrections on that set. Report exact-reference recall separately and require a meaningful independently approved minimum per corpus/provider configuration, chosen before the live run. Hiding almost every suggestion must not count as success. Report optional style suggestions separately.
- No accepted rewrite may alter a name, number, date, negation, or factual meaning in the reviewed beta set without making the change explicit for user review.
- All deterministic stale-response, ambiguous-match, Unicode, editor-removal, and session-isolation scenarios must pass. No text-loss or corruption in the supported-editor regression suite.
- Record typing overhead and provider latency on stated hardware and provider configurations. Set the inline latency release threshold after A-03; show progress and do not freeze typing while checking.
- Verify that disabled sites/excluded fields make no writing request, draft text does not appear in logs, and another Seatline consumer cannot inherit this extension's writing context.

## Decisions to establish during implementation

- Shared-companion API is audited in [A-01](../investigations/seatline-api-audit.md); actual Chrome/store authorization acceptance remains A-02.
- Initial provider based on measured quality, latency, and output reliability.
- Native MV3 ES modules and development tooling are selected in [A-05](../architecture/mvp-scope-and-toolchain.md); product scaffolding/packaging remains B-01.
- Beta editor requirements and fallback-only surfaces.
- Whether an extension-owned local spelling/rule component is necessary after benchmarking.
- Distribution and business model after the usable prototype.

The first release does not require a hosted inference server. Supported subscription/provider sessions depend on the capabilities and rules of the selected provider tooling.

## References

The initial requirements were developed on 2026-10-01. Browser documentation supports the stated platform capabilities; it does not establish that Lineleaf or Seatline already implements them.

- [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Grammarly browser product](https://www.grammarly.com/browser) — functional reference for inline proofreading and explicit rewrites
