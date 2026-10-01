# C-01–C-05 inline prototype evidence

Code revision: [`b920e0d6baeafa2458108beacf096cc080ad0e1e`](https://github.com/davletovb/Lineleaf/commit/b920e0d6baeafa2458108beacf096cc080ad0e1e), in [PR #3](https://github.com/davletovb/Lineleaf/pull/3). [CI run 36889393901](https://github.com/davletovb/Lineleaf/actions/runs/36889393901) passed all three jobs on the named code. Later documentation-only commits archive the results.

| Job | ID | Result |
| --- | --- | --- |
| Linux editor/harness/installed extension | `110460861507` | Passed: 115 tests |
| macOS editor/harness/installed extension | `110460862074` | Passed: 115 tests |
| Shared companion | `110460861754` | Passed: fifteen native checks |

The OS suites contain 26 Python harness, 31 extension logic, 16 editor adapter, 20 manual panel/integration, 18 inline, and four installed-extension tests. Playwright 1.62.1 installs Chrome for Testing **151.0.7922.34**. Local logic and browser checks also passed using the constrained-runner Chromium **153.0.8010.0**; the actual installed-extension acceptance is verified in CI rather than the local headless shell.

## Scope of verified behavior

- Default-off automatic consent, focusing prefilled text without a request, trusted-typing debounce, coalescing, paragraph-only sends, caret movement to unrelated paragraphs, composition guard, sensitive/excluded/oversized fields, and synthetic-event refusal.
- Global ten-second/six-attempts-per-minute automatic budget and provider cooldown across worker restarts using timestamp-only session state. Explicit writing preempts an automatic turn only after native cancellation drains; typing/policy/removal/offline cancellation rejects late output.
- Overlay geometry tracks actual textarea overflow/scroll and invalidates on style revisions. Input, textarea, controlled-input, and basic inline-contenteditable acceptance preserve tested state/formatting and native undo. A failed maxlength edit restores original text and keeps Copy available.
- Closed shadow roots, literal bounded category/explanation rendering, optional style labels in the manual rewrite path, trusted card actions, keyboard Tab/Enter/Escape, labeled region/action accessibility-tree semantics, and polite status announcements. Debugger inspection is test-only; no page hook ships.
- Dictionary normalization/bounds, spelling-only filtering, US/UK prompt variant, pause/reset, serialized preference/site/dictionary changes, and scoped popup pause updates that preserve newer model/variant/consent/dictionary settings. The automated review's stale-popup finding is fixed in the named code revision and its thread is resolved.
- The actual packaged MV3 extension loads with stable ID `lnbkadelggojehiapgnhonicnfonobal`, persists opt-in/dictionary settings across pages, enables/revokes the granted synthetic site, keeps automatic focus idle, reports a missing native host after trusted typing without editing, clears inline state on pause, and resets consent/dictionary/access. CI preapproves only the synthetic host through extension management before a real optional-permission request; clicking Chrome's native permission prompt remains unverified.

Successful writing output in UI/controller tests is synthetic. The native report downloaded from artifact `11175348535` passed all fifteen existing authorization/schema/cancellation checks against unmodified Seatline `dc1086582c8b98498aa48dae91c8d174bc3cfc3c` and its upstream fake provider. The downloaded outer archive matched GitHub's SHA-256 `a607888726569b991c3d3071018152469064c4ccfbb234dacc4c9af9cefad2f4`. This is separate from an authenticated Chrome-to-provider writing turn.

## Package provenance

The reproducible `lineleaf-0.1.0.zip` is **33,297 bytes**, SHA-256 `91a76d22e6b8acdfab15a5f60070ad5484026883508a626aa60e2b5b4a55a547`. Both downloaded Linux/macOS packages are byte-identical to the local build; each outer archive matches GitHub's published digest.

| Artifact | ID | Outer archive SHA-256 |
| --- | --- | --- |
| `lineleaf-extension-Linux` | `11176706335` | `5782401cda9f2fc6449a34b45079fe586e106f235b0e701ccf9e35e9f2f9dcc4` |
| `lineleaf-extension-macOS` | `11175563598` | `b126bec84cc5d4312d44f67b48200875138563ae5ceba083ea47590922a94f67` |

## Remaining acceptance

C-01 pacing is provisional development policy pending live provider latency/quality and actual device/IME checks. C-02 keyboard and accessibility-tree behavior pass, but human VoiceOver/NVDA acceptance and real-site geometry remain open. Categories/explanations are structurally verified; their linguistic accuracy remains quality-evaluation work. Actual Chrome-to-Seatline setup, native permission UI, real-account writing, advertised browser/OS support, real editor compatibility, shared-companion live coexistence, store identity, and beta release remain the tracker’s A/B/D/E gates.
