# D-01 — Priority editor compatibility matrix

Investigated: 2026-10-02. This matrix records the implemented policy and **synthetic regression results**, not successful live-site acceptance. No authenticated Gmail, GitHub compose, LinkedIn, or Slack editor was exercised in this workspace. D-01 remains **IMPLEMENTED — VERIFY** until those draft-only checks are recorded. A site name in this table is not a support claim.

The [production editor policy](../../extension/lib/editor-context.mjs) is conservative even when a rich editor happens to have a flat DOM. [Compatibility regressions](../../tests/compatibility.test.mjs) serve locally generated HTML at intercepted test URLs, including the named hosts. They do not download site markup or emulate the sites' private state models. The [D evidence report](../evidence/editor-compatibility-ci.md) records the tested source and environment.

| Priority surface | Implemented behavior | Verified in regression | Live acceptance |
| --- | --- | --- | --- |
| Gmail compose, `mail.google.com` | Rich contenteditable: explicit selection preview/copy; automatic checking and direct replacement unavailable | Closed preview, bounded selection, Copy, preserved bold/source, no automatic rich-editor request | Pending: actual compose state, selection, paste, account/browser version |
| GitHub comment | Ordinary textarea uses the existing native replacement adapter; a recognized complex editor uses copy fallback | Synthetic textarea selection → preview → accept → native undo preserves the draft; replacement is not a promise about GitHub's current UI | Pending: actual comment draft, site state after acceptance, native and keyboard undo |
| LinkedIn post, `linkedin.com` and subdomains | Rich contenteditable: explicit preview/copy; no automatic check or replacement | Bounded preview/copy, preserved source/formatting, no automatic rich-editor request | Pending: actual post draft and navigation/formatting behavior |
| Slack web, `slack.com` and subdomains | Rich contenteditable: explicit preview/copy; no automatic check or replacement | Bounded preview/copy, clipboard denial/manual-copy recovery, preserved source/formatting | Pending: actual channel/message draft, composer lifecycle and clipboard/paste |

Ordinary text/search inputs and textareas outside excluded or recognized complex-editor containers retain the tested generic adapter. This does not promote an entire application to supported status. Google Docs has a stricter site-wide replacement guard; see the [separate feasibility result](complex-editor-feasibility.md).

## Supported development boundaries

The tested adapter remains limited to ordinary textarea/text/search inputs and basic contenteditable with flat text and inline formatting. Cross-format replacements, blocks, noneditable islands, multiline replacements, recognized rich-editor frameworks, and unverified priority rich editors use explicit preview/copy. If no usable DOM selection exists, open the panel, paste 1–2,000 characters, choose **Use pasted text**, then **Check selection**. This path never replaces page text and never starts an automatic request.

Open shadow roots expose only their active field to Lineleaf. Closed roots are outside support. Same-origin HTTP(S) child frames may operate only when their exact origin is enabled and permitted and the top page has that same origin. Cross-origin, sandboxed/opaque, `about:blank`, `srcdoc`, and data/blob frames are outside this slice. Inline geometry supports identity transforms and pure translations, including a translated document root and nested clipping. Rotation, skew, scale, perspective, individual CSS rotate/scale properties and shaped clipping remain outside support. No new extension permission is introduced.

## Live acceptance procedure

For each matrix row, use an authenticated account and an **unsent synthetic draft**, for example `He go to work. Maya has 3 tickets.` Record date, browser/OS/version, Lineleaf commit/package hash, Seatline/provider configuration and surface. Keep account details and real drafts out of reports.

1. Enable that exact origin and verify the provider disclosure. Select only the first sentence; confirm that the panel and provider request contain only the selected text.
2. In copy-only composers, confirm Accept is disabled, Copy or keyboard-copy works, and the original text, formatting and site draft state remain intact. Manually paste the suggestion and use the site's undo. Confirm that ordinary typing in a rich composer starts no automatic request.
3. For a GitHub textarea, accept one bounded correction; verify the complete draft, surrounding sentence, caret, site's reflected draft state, formatting where applicable, native panel undo and keyboard undo. Repeat with a controlled rerender and a multiline draft. Use copy fallback if replacement is rejected.
4. Test draft replacement/removal, SPA navigation, resize and nested scrolling. A stale preview must refuse acceptance; removed/navigated drafts cancel work. Inspect only the synthetic request payload when checking paragraph boundaries.
5. Pause/disable the site while a check is pending; confirm cancellation and cleared previews. Test a missing companion, then reconnect through the established setup flow. Capture a real provider round trip separately from editor correctness.

Attach results and any necessary dedicated adapter to the same tracker item. Promote a surface only after its site state and undo pass. A failure leaves its fallback in place; it does not justify broad DOM mutation.
