# Lineleaf review candidate setup

This archive is for development review. Check `review.json`: `releaseReady: false` means beta distribution is blocked. No browser/OS is advertised until the acceptance checklist passes. The nested extension ZIP contains the loadable manifest at its root; extract it before loading unpacked.

1. Use desktop Chrome on a review device. Extract `lineleaf-0.1.0.zip`, open `chrome://extensions`, enable Developer mode, and load its directory unpacked. Verify ID `lnbkadelggojehiapgnhonicnfonobal`. This is a stable development ID, not an issued Chrome Web Store ID.
2. Use your existing shared Seatline companion at revision `dc1086582c8b98498aa48dae91c8d174bc3cfc3c`. Use its normal installation procedure if it is not installed. Lineleaf ships no companion, provider, Node runtime, or credential.
3. Authorize the Lineleaf development origin with the existing companion:

   ```sh
   seatline-companion authorize lineleaf codex chrome-extension://lnbkadelggojehiapgnhonicnfonobal/
   ```

   This replaces the entire Lineleaf grant. Include every retained Lineleaf origin/provider when reauthorizing. Other consumer grants remain separate.
4. Use a Codex subscription sign-in and a provider runtime reporting tool isolation. Select the model intentionally in Lineleaf Settings. API-key sign-in and missing tool isolation are refused. No validated model/version combination is claimed by this candidate.
5. Open a synthetic draft on one ordinary HTTPS site, enable that exact site in the popup, and approve Chrome's optional host permission. If approval closes the popup, reopen it and enable the site again. A Chrome grant alone does not enable Lineleaf processing.
6. Select up to 2,000 UTF-16 code units, open the writing panel, and explicitly check. Review before accepting. Try Undo immediately after accepting. Complex editors use Copy when replacement cannot be verified.
7. Automatic paragraph proofreading is off by default. Enable the experimental option deliberately after reading the remote-processing disclosure. Typing pauses for 1.5 seconds before a check; pacing permits one active Lineleaf turn, at least ten seconds between automatic attempts, and at most six attempts per minute across tabs.
8. Test pause, exact-site disable/revoke, and reset. Remove Lineleaf through Chrome to uninstall. Revoke its native access with `seatline-companion revoke lineleaf`; keep the shared companion available for other consumers.

Update review: retain the same extracted directory, replace its contents with the new candidate, and reload in Chrome. Verify version, preferences, dictionary, site grants, and opt-out behavior. A store update/uninstall path needs separate acceptance once a store identity exists.

Use synthetic writing for review. Read `PRIVACY.md`, `SUPPORT.md`, and `ACCEPTANCE.md` before deciding whether this candidate is ready for a beta.
