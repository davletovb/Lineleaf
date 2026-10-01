# C-01–C-05 — opt-in inline development prototype

This slice adds automatic paragraph proofreading to the [selection prototype](selection-mvp.md). It uses the same shared Seatline companion, stable extension identity, optional site grants, Codex subscription/tool-isolation gates, ephemeral turns, and validated editor adapter. No companion or native protocol changes are required. This is development behavior; live quality/latency, device setup, real editor compatibility, and human screen-reader acceptance remain open.

## Try the flow

Run `npm ci --ignore-scripts`, `npm run package`, and load `dist/lineleaf` unpacked in desktop Chrome. The ZIP is `dist/lineleaf-0.1.0.zip`. Existing load/setup instructions and Seatline authorization are in the selection guide.

1. Enable one ordinary HTTP/HTTPS site in the popup.
2. Open Settings and explicitly enable **Automatically check after typing pauses (experimental)** after reading the provider disclosure. Automatic mode defaults off, including after upgrading an existing enabled-site profile.
3. Type in an eligible input, textarea, or basic inline contenteditable. After 1.5 seconds of idle time, Lineleaf checks the current newline-delimited paragraph, up to 2,000 UTF-16 code units. Focusing prefilled text or moving the caret alone sends nothing.
4. Click an underline or the Lineleaf badge, or press **Alt+Shift+L**. Use Tab/Enter to review and accept, dismiss, copy, or add a spelling token to the dictionary. Escape closes the card and returns focus to the field. Changes always require acceptance.
5. Use **Undo last edit** before subsequent typing. **Check now** makes an explicit paragraph check; the selection panel still supports the four deliberately requested style rewrites.
6. Pause globally from a card or popup, resume in popup/settings, or disable the site. Reset removes stored preferences, dictionary, enabled sites, and optional site access; automatic mode returns to off.

## Behavior and boundaries

| Tracker item | Implemented behavior | Validation boundary |
| --- | --- | --- |
| C-01 | Trusted-typing idle debounce; composition guard; latest-paragraph coalescing; exact change detection; one global active turn; automatic ten-second/six-attempts-per-minute cap in session storage; cancellation; manual requests preempt automatic turns after cancellation drains | Synthetic worker/native fixtures verify scheduling. Live provider speed and actual IME/device behavior remain acceptance work. |
| C-02 | Closed-shadow overlay underlines; input/textarea mirrors and contenteditable DOM ranges; viewport clipping; scroll/resize/layout refresh; stale geometry invalidates; keyboard card, labeled actions, polite status announcements; native apply/undo and failed-edit copy recovery | Chromium fixture editing and accessibility-tree semantics are automated. Human VoiceOver/NVDA and real-site geometry remain unverified. |
| C-03 | Grammar, spelling, punctuation, and **Optional style** labels; literal before/after text; expandable bounded explanations. Automatic checks are correctness-only; style changes require an explicit rewrite action | Synthetic category/schema/rendering coverage verifies labels and association, not linguistic quality or truth of explanations. |
| C-04 | Persistent US/UK variant, normalized bounded personal dictionary, global pause, opt-in consent, and reset. Dictionary is both provider context and a deterministic spelling-only result filter; grammar/punctuation are retained | Controller/browser and installed-extension settings tests cover persistence and effects. US/UK writing quality requires live evaluation. |
| C-05 | Fail-closed sender/site/permission/excluded-field gates; visible remote-processing disclosure; fixed host/sign-in/timeout/invalid-response/offline diagnostics; bounded queue/rate-limit retry; pause/revoke/navigation/removal cancellation | Synthetic native success and real installed-extension missing-host paths are verified separately. This does not claim an authenticated Chrome-to-provider turn. |

Only supported, visible, writable fields in the main frame are eligible. Password/payment, ignored or hidden content, code/preformatted content, complex block editors, and oversized paragraphs use the existing manual/copy boundary. The active field may be held locally as an exact-source snapshot up to 100,000 code units; only its bounded active paragraph is sent. A caret move to another paragraph before idle cancels that scheduled source rather than sending unrelated text. Synthetic page events invalidate work but cannot authorize an automatic check.

Lineleaf does not mutate the field to draw underlines. Unsupported transforms or vertical writing show card/badge controls without a guessed underline. Style/tree/source revisions clear obsolete suggestions. Exact source, revision, inline formatting, unique context, Unicode boundaries, non-overlap, and supported native replacement are checked again before acceptance. Failed replacement restores the source when possible and keeps Copy available.

## Request and data lifecycle

There is one active writing turn across Lineleaf documents. Preference/site/dictionary writes are serialized; a popup pause only changes pause and cannot restore stale automatic consent or dictionary state. Starts of automatic attempts, including failed status probes, count toward the shared budget; refreshes and worker restarts cannot bypass it. Provider rate limits use a bounded sixty-second cooldown and queue-full uses five seconds. Their timestamps also survive service-worker restarts in session storage. Terminal host, sign-in, malformed-output, and timeout errors stop automatic retries until explicit checking or a fresh eligible context. Reconnecting the network does not automatically resend the draft.

Typing, composition, site disable/revocation, pause/settings changes, focus to another field, page hiding/navigation, and field removal clear previews and cancel in-flight work. Late output is ignored. Request snapshots/results expire after five minutes, including failed checks. Native turns have the existing thirty-second provider deadline; the UI has a sixty-five-second watchdog around handshake/status/request/cancellation. No field text, model output, credentials, or draft history is written to storage or logs. Stored local preferences intentionally include dictionary words and site origins; dictionary words are disclosed as being sent with checks. Session storage holds only pacing/backoff timestamps.

## Validation

`npm test` covers the Python investigation harness, controller/native/candidate logic, editor regressions, manual panel, and inline fixtures. `npm run test:extension` additionally loads the actual packaged MV3 extension, checks opt-in/dictionary persistence, exact optional-site enable/revoke, native missing-host diagnostics after trusted typing, pause cleanup, and reset. Tests use synthetic writing and fake provider output. The real extension tests preapprove only a synthetic optional host through Chromium extension management; they do not automate the native permission prompt.

The [tracker](../product/lineleaf-implementation-tracker.md) records acceptance status; [CI and package provenance](../evidence/inline-prototype-ci.md) records the tested revision and boundaries. D/E work remains pending: Gmail, GitHub, LinkedIn, Slack, quality evaluation, real screen-reader/device checks, and shared-companion live coexistence.
