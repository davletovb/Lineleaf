# A-02 — Extension authorization

The [diagnostic extension](../../prototypes/native-client/manifest.json) is an unpacked MV3 probe with only `nativeMessaging` permission. Its public manifest key fixes the development ID to **`lnbkadelggojehiapgnhonicnfonobal`**. A test derives the ID from SHA-256 of the public key. No private signing key is committed or needed for this unpacked probe.

The Chrome Web Store ID is not issued (`null` in the contract). Do not substitute a synthetic ID or advertise store acceptance. The probe is not the B-01 product extension: it only checks the existing companion and Codex status and sends no writing.

## Existing installation procedure

1. Use the already installed shared `seatline-companion` at the audited revision. On a first installation only, run its `install` command. Do not install a Lineleaf-specific host.
2. In Chrome's extension developer mode, load `prototypes/native-client` unpacked. Verify the displayed ID matches the development ID above.
3. Preview the Lineleaf grant, using the actual path of the shared companion:

   ```sh
   python3 -m tools.authorize_lineleaf --companion /path/to/seatline-companion --extension-id lnbkadelggojehiapgnhonicnfonobal
   ```

4. Apply that command with `--apply` when the origins/providers are correct. The helper defaults to Codex. Repeat `--extension-id` for **every** development/store ID that must retain access; repeat `--provider` for every retained provider. This replaces the entire Lineleaf grant and rotates its credentials; it does not change other consumer grants.
5. Open the probe and select **Check connection**. Protocol 1 and sanitized provider status should appear. Missing host, permission, protocol, timeout, and disconnect paths use fixed diagnostics.
6. To remove access, run `seatline-companion revoke lineleaf`. Leave the shared installation available to other apps.

## Automated validation

```sh
python3 -m tools.validate_authorization --companion /path/to/seatline-companion
```

This Linux-only validator uses temporary `SEATLINE_DATA_DIR`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, and `XDG_DATA_HOME` beneath the user's private home. Seatline's audited [`workspace.rs`](https://github.com/davletovb/seatline/blob/dc1086582c8b98498aa48dae91c8d174bc3cfc3c/platform/src/workspace.rs) checks every workspace ancestor and rejects shared `/tmp`, even when the test directory itself is private. Audited upstream [`install.rs`](https://github.com/davletovb/seatline/blob/dc1086582c8b98498aa48dae91c8d174bc3cfc3c/companion/src/install.rs) writes the installed executable under `SEATLINE_DATA_DIR` and Linux Chrome registration under `XDG_CONFIG_HOME`. It requires the existing HOME for registration but does not replace it or write the user's registry. Probe diagnostics retain terminal enums and allowlisted reasons only.

It installs the **unmodified shared binary once**, grants two synthetic consumers, verifies the registered exact-origin manifest, rejects malformed/unknown/ambiguous origins, verifies provider authorization, reauthorization disconnect/reconnect, and app-scoped revocation. These tests confirm connection invalidation and successful reconnect/status; they do **not** submit a saved old token to prove its refusal. Token rotation is established by the audited source, not by those connection checks. Timeouts record failed checks; protocol/disconnect errors preserve completed per-check details in a JSON failure report.

The broker receives only temporary runtime paths, deterministic locale/PATH, and app-specific provider discovery overrides. It receives no HOME, user Codex configuration, or account credentials. Discovery initially points to an empty private directory, so a writing-turn send must fail as `EXECUTABLE_NOT_FOUND`, proving the real schema is accepted without running a provider account. With `--fake-provider /path/to/seatline-fake-provider`, the validator then installs **Seatline's pinned test binary** as `codex` in that directory and checks completed synthetic send, rate-limit diagnostic mapping, and cancellation of an in-flight target. CI builds both upstream binaries and exercises this path; no provider account is used, and no measured live latency is claimed.

Local [native evidence](../evidence/native-authorization-local.json) verifies four registry/origin checks but reports `ENVIRONMENT_DENIES_LOCAL_IPC`, because this workspace forbids socket listeners. That is partial evidence, not a successful broker test.

[CI run 36856262500](https://github.com/davletovb/Lineleaf/actions/runs/36856262500), on code commit `9d1ccaed15f3efcb0540db5d183fb5eab2718a2d`, passed all **fifteen** native checks against the pinned shared companion, including the missing-executable schema check and upstream-fixture send, rate-limit, and cancel probes. The archived [native report](../evidence/native-authorization-ci.json) is byte-identical to that run's artifact. [Evidence provenance](../evidence/README.md) records its artifact ID and checksums. Historical [run 36832723008](https://github.com/davletovb/Lineleaf/actions/runs/36832723008) covered the original eleven-check implementation at `4e34703`.

Still required for acceptance: test actual Chrome permission/connection behavior on macOS and repeat with the issued store ID when available. The two synthetic consumers validate grant isolation, not simultaneous writing workloads (E-02).
