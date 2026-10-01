# Foundation evidence provenance

Accepted code revision: [`9d1ccaed15f3efcb0540db5d183fb5eab2718a2d`](https://github.com/davletovb/Lineleaf/commit/9d1ccaed15f3efcb0540db5d183fb5eab2718a2d). [Foundation validation run 36856262500](https://github.com/davletovb/Lineleaf/actions/runs/36856262500) passed all three jobs on that revision. Later documentation commits archive these results; this run is evidence for the named code revision.

| Evidence | Result | Provenance |
| --- | --- | --- |
| Linux editor/harness | 26 Python + 15 Chromium tests passed | Job `110349346070` |
| macOS editor/harness | 26 Python + 15 Chromium tests passed, including native keyboard undo | Job `110349345812` |
| [Native authorization report](native-authorization-ci.json) | Fifteen checks passed with unmodified Seatline and its upstream fake provider | Job `110349346210`; artifact `11158493018` |
| Linux fixture benchmark | Three first requests, fifteen subsequent requests, separate phase statistics, confirmed cancellation | Artifact `11159042613`; permanently labeled `kind: fixture` |
| macOS fixture benchmark | Synthetic benchmark job passed | Artifact `11159042611`; permanently labeled `kind: fixture` |

The archived native report is byte-identical to `native-authorization.json` inside artifact `11158493018`. Its SHA-256 is `cd622876ce6e585624e65141bca7d2393769661edab7d2ec138783e090db4049`. The downloaded artifact ZIP matched GitHub's published SHA-256 `ad49c38c102f7f86f9f30e42810ea0150ba43beb7e112ce83dc1c6212caaf55e`.

The native job builds Seatline revision `dc1086582c8b98498aa48dae91c8d174bc3cfc3c`. Its fake provider validates schema, diagnostics, and cancellation without an account. These results do not establish live provider latency, writing quality, Chrome permission UI behavior, or acceptance of an issued store ID.

Historical [run 36832723008](https://github.com/davletovb/Lineleaf/actions/runs/36832723008) validated original code revision `4e34703379e14eef3eacae28c9de8e8776651870` with sixteen Python tests, fifteen Linux editor tests, and eleven native authorization checks.

[Local native evidence](native-authorization-local.json) records the workspace's IPC restriction after four registry/origin checks. [Local provider readiness](provider-readiness-local.json) records the unavailable installed provider. Neither is a successful device or live-provider acceptance result.
