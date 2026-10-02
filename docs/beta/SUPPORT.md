# Candidate support matrix

`review.json` is the package-bound gate report. A blocked candidate advertises no supported platform. The following are development boundaries and acceptance targets.

| Surface | Implemented/tested boundary | Beta acceptance |
| --- | --- | --- |
| Desktop Chrome on Linux/macOS | Installed MV3 tests in pinned Playwright Chromium on both CI operating systems | Actual Chrome install, update, uninstall, permission prompt, successful native turn and human accessibility checks pending per advertised device |
| Codex through shared Seatline | Strict protocol, subscription/tool-isolation readiness, bounded ephemeral no-tools turns | Independently reviewed live quality and approved latency per exact model/CLI/runtime configuration pending |
| Explicit rewrites (Improve it, Paraphrase, Clearer, Shorter, More formal, Friendlier) | Inline card (automatic checking on): selection or caret paragraph, Original/Suggested preview, Replace, Try again, Copy, Back. Writing panel: selection only, compact before → after preview with Accept. Both flag a changed number, name or negation (a heuristic, not a guarantee); Replace through the same paths as corrections (adapter fields, verified rich editors, else Copy); synthetic regressions, local runs against the real editor libraries | Independently reviewed live quality for improve and paraphrase pending; real-site checks pending |
| Textarea/text/search input; simple inline contenteditable | Synthetic edit, caret, formatting, Unicode, stale response and native undo regressions | Actual device/editor checks pending |
| Gmail, GitHub, LinkedIn, Slack | Synthetic priority-editor policy and safe copy fallback | Authenticated synthetic-draft matrix pending; no real-site replacement claim |
| Same-origin frames and open shadow roots | Scoped synthetic frame/slot/privacy/geometry regressions | Live editor/device validation pending |
| Rich editors in verified families (Draft.js such as X, Lexical, Slate, ProseMirror, Quill) | With the automatic opt-in, inline underlines of the caret paragraph and Accept applied through the editor's own input path; the editor's undo reverses it; the editor becomes copy-only if it rejects or reverts an edit (synthetic fixtures; local runs against the real libraries) | Real X and other live composers, IME and collaboration pending |
| Other rich editors; Gmail, LinkedIn, Slack, Notion | Explicit preview/Copy; with the automatic opt-in, a copy-only inline preview of the caret paragraph | Authenticated real-site check pending; no replacement support |
| Google Docs and canvas/code editors | Explicit pasted-text/manual preview and Copy when eligible | No replacement and no automatic checking |
| Windows, Firefox, Edge, mobile; closed/cross-origin/opaque frames | Outside current acceptance targets | Not advertised |

Identity transforms and translations retain inline geometry. Scale, rotation, skew, perspective, shaped clipping and vertical writing use the manual/copy boundary. Password/payment/one-time-code fields, excluded/code regions, hidden/read-only content, incognito and oversized paragraphs are refused.

Provider errors use fixed diagnostics. Check the shared native host, exact Lineleaf grant, subscription sign-in and tool isolation. Pause or disable the site to stop work. Reconnects do not automatically resend drafts. After an error, use an explicit check on current text. Rate-limit/queue cooldowns protect the shared provider; do not defeat them to benchmark live quotas.

For review reports include candidate/package hash, browser/OS version, provider CLI/model/version, fixed error code and synthetic reproduction. Never include credentials, account paths, real drafts or raw provider stderr. Filing or sending a report remains an explicit reviewer action.
