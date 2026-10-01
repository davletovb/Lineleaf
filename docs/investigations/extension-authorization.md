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

This Linux-only validator uses temporary `SEATLINE_DATA_DIR` and `XDG_CONFIG_HOME`; it does not touch the user's registry. It installs the **unmodified shared binary once**, grants two synthetic consumers, verifies the registered exact-origin manifest, rejects malformed/unknown/ambiguous origins, verifies provider authorization, token rotation/disconnect/reconnect, and app-scoped revocation. No authenticated provider is needed to test routing and status. CI compiles the pinned upstream binary and runs the same test.

Local [native evidence](../evidence/native-authorization-local.json) verifies four registry/origin checks but reports `ENVIRONMENT_DENIES_LOCAL_IPC`, because this workspace forbids socket listeners. That is partial evidence, not a successful broker test.

Still required for acceptance: review the native CI report, test actual Chrome permission/connection behavior on macOS, and repeat with the issued store ID when available. The two synthetic consumers validate grant isolation, not simultaneous writing workloads (E-02).
