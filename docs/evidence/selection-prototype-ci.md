# B-01–B-05 selection prototype evidence

Code revision: [`ac3ec6e36ee093fadeaa2e328c9fe8daad96e52a`](https://github.com/davletovb/Lineleaf/commit/ac3ec6e36ee093fadeaa2e328c9fe8daad96e52a), in [PR #2](https://github.com/davletovb/Lineleaf/pull/2). [CI run 36874657265](https://github.com/davletovb/Lineleaf/actions/runs/36874657265) passed all three jobs. Later documentation commits record this evidence; the named revision identifies the tested code.

| Validation | Result | Job |
| --- | --- | --- |
| Linux | 26 Python, 20 extension logic, 16 editor, 15 bundled-panel, and 3 installed-extension tests passed | `110410882791` |
| macOS | The same 80 tests passed, including native keyboard undo | `110410882980` |
| Shared companion | Existing fifteen native authorization/schema/send/cancel checks passed against unmodified Seatline `dc1086582c8b98498aa48dae91c8d174bc3cfc3c` and its upstream fake provider | `110410882253` |

Both OS jobs use Playwright 1.62.1 and Chrome for Testing **151.0.7922.34** with normal process configuration. Local editor/panel checks also passed using constrained-runner Chromium **153.0.8010.0**. Installed-extension tests were verified in CI, not the local headless-shell browser.

The actual MV3 extension loaded with the stable development ID, stored preferences across worker restarts, reported a missing native host safely, enabled and injected only on the granted synthetic site, and removed permission/script access when disabled. Headless CI preapproves `https://writing.test/*` through Chromium's extension-management API before exercising the real optional-permission request. It does not test clicking Chrome's native permission prompt.

Transport/controller regressions use synthetic Chrome/native ports and verify readiness, authenticated subscription/tool-isolation gates, strict sender/payload validation, bounded output, cancellation, disconnect recovery, one global request, policy invalidation, and no persisted drafts. Panel/editor regressions validate bounded selection-only submission, contextual edit mapping, stale/ABA revisions, composition/sensitive-field refusal, preview/dismiss/cancel/undo, literal model text, and copy fallback. Failed native edits restore original text/inline nodes; regressions cover controlled normalization, partial maxlength insertion, removed formatting/comments, Chromium whitespace normalization, and avoiding global undo after an unrelated field edit.

## Package provenance

The reproducible `lineleaf-0.1.0.zip` is **24,996 bytes**, SHA-256:

```text
62efc499fba349aa129ec3d61f19dedba8911ac841e268c52ae21cd5b9644ba4
```

It is byte-identical in the local build and both downloaded CI artifacts. Each outer artifact archive was checked against GitHub's published digest:

| Artifact | ID | Outer archive SHA-256 |
| --- | --- | --- |
| `lineleaf-extension-Linux` | `11168423850` | `1e3be54d207e6e161fdaefed6badf60a6bdbb38c33dc93a6a3e558f3c2c766ca` |
| `lineleaf-extension-macOS` | `11167759498` | `1f360e14151850374458dc8ac9b04fbfa0cc540994c9b9b4e218dfcf143d05dd` |

These results establish B-01 scaffolding, B-04 candidate validation, and B-05 editing acceptance on the scoped synthetic surfaces. B-02/B-03 remain **IMPLEMENTED — VERIFY** until actual Chrome-to-Seatline setup and a real-account writing turn are recorded. Live provider latency, writing quality, real editor support, store identity, and beta release are not established by these tests. C–E items remain open.
