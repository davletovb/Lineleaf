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
6. Select up to 2,000 UTF-16 code units, open the writing panel, and explicitly check. Review before accepting. Try Undo immediately after accepting. Complex and rich editors use Copy when replacement cannot be verified; with automatic checking on they also show an inline preview, and editors in the verified families (for example X's Draft.js composer) offer Accept, reversed by the editor's own undo (Ctrl/⌘ Z).
7. The inline card offers explicit rewrites of your selection (or the caret paragraph) with automatic checking on, and also with it off: on an enabled site press **Alt+Shift+L** in a field and the card opens. Nothing is read or sent until you choose an action in it. The rewrites are **Improve it**, **Paraphrase**, **Clearer**, **Shorter**, **More formal** and **Friendlier**. Each sends only that text, shows the original beside the suggestion, flags a changed number, name or negation, and replaces nothing until you press **Replace**. If a request gets no answer (90 seconds for something you asked, 30 for a background check) it is cancelled, nothing is changed, and background checks pause for five minutes; try again, pick a faster model in Settings, and use **Check Seatline** there. The writing panel offers the same six modes for a selection only (no paragraph fallback), as a compact before → after preview with **Accept**.
8. Automatic paragraph proofreading is off by default. Enable the experimental option deliberately after reading the remote-processing disclosure. Typing pauses for 1.5 seconds before a check; pacing permits one active Lineleaf turn, at least ten seconds between automatic attempts, and at most six attempts per minute across tabs.
9. Test pause, exact-site disable/revoke, and reset. Remove Lineleaf through Chrome to uninstall. Revoke its native access with `seatline-companion revoke lineleaf`; keep the shared companion available for other consumers.

Update review: retain the same extracted directory, replace its contents with the new candidate, and reload in Chrome. Verify version, preferences, dictionary, site grants, and opt-out behavior. A store update/uninstall path needs separate acceptance once a store identity exists.

Use synthetic writing for review. Read `PRIVACY.md`, `SUPPORT.md`, and `ACCEPTANCE.md` before deciding whether this candidate is ready for a beta.
