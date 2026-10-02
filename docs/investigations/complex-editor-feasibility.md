# D-03 — Google Docs and complex-editor feasibility

Decision: **do not offer generic direct replacement in Google Docs or recognized complex-editor frameworks, and no checks of any kind in Google Docs**. Explicit DOM selections can use preview/copy when eligible; canvas/closed/opaque surfaces use user-pasted text in the manual panel. Recognized rich contenteditable editors may show an opt-in, copy-only inline preview of the caret paragraph (Lineleaf reads text and draws an overlay; it never writes to the editor). No working Google Docs, Notion, or framework-specific adapter is being advertised. This is a completed feasibility decision, not live editor support.

## Findings and decision

| Surface/model | Source-backed observation | Consequence for Lineleaf |
| --- | --- | --- |
| Google Docs | Google announced canvas rendering and warned that extensions depending on HTML could need changes; its supported integration direction is Workspace add-ons/APIs | DOM text nodes, hidden input proxies and selection offsets are not evidence of a document mutation/undo API. Guard the whole `docs.google.com` host against replacement and automatic checks. Do not scrape canvas, accessibility mirrors, clipboard contents or whole documents. |
| Lexical | Its official documentation identifies editor state, rather than the DOM, as the source of truth; updates run through editor operations | A flat contenteditable can still have a separate state model. Treat `data-lexical-editor` as copy-only (inline preview only, never replacement). A future adapter requires verified access to the owning editor's transaction and history APIs. |
| ProseMirror | Its official guide describes state, transactions and a view that renders the model to the DOM | A successful DOM insertion is insufficient proof of a valid model transaction, selection or undo. Treat `.ProseMirror` as copy-only (inline preview only) pending a dedicated adapter. |
| Slate, Quill, Draft-style markers | Lineleaf has no validated adapter or live application evidence for these surfaces | Conservatively guard `[data-slate-editor]`, `.ql-editor`, `.DraftEditor-root` and `.public-DraftEditor-content`, including ancestor/descendant markers. The marker tests use synthetic HTML; a separate, uncommitted local run exercised the real Draft.js 0.11.7, Slate 0.126/slate-react 0.127, Quill 2.0.3, ProseMirror view 1.42 and Lexical 0.52 in headless Chromium for the copy-only inline preview only (see the rich-editor preview section of the inline guide). |
| Notion and priority rich composers | No dedicated, tested application adapter exists in Lineleaf | Known Notion hosts and Gmail/LinkedIn/Slack rich contenteditable use copy fallback (and the same opt-in inline preview) even when no framework marker is present. No claim is made about their current internal editor libraries. |
| Monaco/CodeMirror, closed roots and opaque/cross-origin frames | These are outside the product's accepted writing/editor scope | Code regions are excluded; inaccessible roots/frames are not traversed. The manual pasted-text path is available on an enabled, eligible HTTP(S) page. |

Sources reviewed 2026-10-02:

- [Google Workspace: Docs canvas rendering](https://workspaceupdates.googleblog.com/2021/05/Google-Docs-Canvas-Based-Rendering-Update.html). This 2021 announcement explains an architectural obstacle; it is not a fresh inspection of today's signed-in Docs UI.
- [Lexical editor state](https://lexical.dev/docs/concepts/editor-state).
- [ProseMirror guide](https://prosemirror.net/docs/guide/).
- [Chrome content script frame permissions](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) and [scripting document targets](https://developer.chrome.com/docs/extensions/reference/api/scripting).

The consequences above are Lineleaf engineering decisions inferred from those model boundaries and the absence of a verified adapter.

## Working fallback

Open Lineleaf on an enabled eligible page. If the surface exposes a bounded ordinary DOM selection, check it explicitly and copy the result. Otherwise copy text yourself, paste up to 2,000 characters into the panel, select **Use pasted text**, choose proofreading or a rewrite and press **Check selection**. Suggestions remain copy-only; the user controls paste and the editor's own undo. Typing in the paste field alone makes no provider call. Editing it invalidates a checked snapshot; close, navigation, pause, policy changes and expiry clear the captured text. There is no background clipboard read or persisted draft.

The [compatibility suite](../../tests/compatibility.test.mjs) verifies the Google Docs input-proxy guard, the pasted-text path, complex markers even with flat inline DOM, denied clipboard/manual copy, and source/format preservation. This is synthetic evidence; a live Docs/Notion round trip is not claimed.

## Gate for a future direct adapter

A separate implementation needs an identifiable, versioned editor interface and permission boundary; explicit selected-text extraction with model positions; revision/transaction identity and exact-source rechecks; a native model transaction preserving formatting, names/numbers, selection and collaboration state; and editor-owned undo that cannot overwrite other users' or later local edits. Test the actual application and supported versions on the advertised browser/OS, including IME, history, rerenders, removal/navigation and concurrent/collaborative edits. Keep preview/copy when any gate fails. Undocumented private globals, forcing an alternative Docs renderer, or injecting text into a hidden proxy do not satisfy these gates.
