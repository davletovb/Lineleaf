# Interface design

The 2026-10-03 redesign gives every Lineleaf surface one look: the inline badge, underlines and card, the writing panel, the toolbar popup and the settings page. Grammarly is the *functional* reference named in the [product framework](../product/lineleaf-product-framework.md) (help appears where the user types, one specific change at a time, accept or dismiss); the look itself is Lineleaf's own. Nothing about editing, requests, consent or privacy changed: the redesign replaced markup and styles, and the existing editing, rewrite, clarity, privacy and lifecycle suites run unchanged except where noted below.

## Principles

- **Quiet until useful.** One small badge by the field; underlines only where there is a suggestion; the card opens on request.
- **One primary action per view.** *Accept* (or *Replace*) is the only filled button in a card; *Dismiss*, *Copy* and the everyday actions are quieter.
- **Colour is never the only cue.** A correction is a solid red underline with a round dot; optional wording is a dashed blue underline with a square dot; a rewrite is purple with a diamond. Counts and state are also in text and accessible names.
- **One set of tokens.** [`tokens.css`](../../extension/tokens.css) (colour, radius, shadow, motion) and [`base.css`](../../extension/base.css) (buttons, disclosure rows, category dots, the before → after change, focus ring) are linked by the extension pages and bundled in front of the inline and panel sheets, so the surfaces cannot drift apart.
- **Nothing remote.** System fonts, inline SVG drawn by script (no markup strings, so it works under a page's CSP), no web fonts, images or analytics. Toolbar icons are PNGs generated from [`icons/lineleaf.svg`](../../extension/icons/lineleaf.svg) by `scripts/make-icons.mjs`.
- **Light and dark follow the system.** Contrast is checked for both (below). Motion is a 120–180 ms fade; `prefers-reduced-motion` removes it; `forced-colors` gets a system focus outline.

## Inline

| Part | Design |
| --- | --- |
| Badge | A 30 px leaf by the bottom-right of the field (below it, so it never covers the text). It shows a red count for corrections, blue when every suggestion is optional wording, a sparkle when a rewrite is ready, and a spinning ring while a check runs. A tooltip shows the short state (“2 suggestions”, “Checking…”); the accessible name still carries the full message. |
| Underlines | A thin target at the foot of the word (6 px), so clicking the word itself still places the caret. Thickens on hover. |
| Word popover | Clicking an underline opens a compact card just under the word (above it when there is no room), and the word is tinted. It shows the kind of suggestion, the change (`go → goes`, old text struck through), **Accept**, **Dismiss**, **Copy**, *Why this suggestion?*, the position among the others, and **More**. The status line and the “Codex via Seatline” disclosure stay visible. |
| Full card | Alt+Shift+L, the badge, and any action that needs a visible result open the same card with everything: the rewrite tools (*Improve it*, *Paraphrase* and the four tone/length chips), the status strip with the elapsed-time line during a request, and the footer (*Undo last edit*, *Check now*, *Cancel check*, *Pause Lineleaf*, *Settings*). **More** on the popover reveals the same sections without moving the card. |
| Rewrite preview | Original and Suggested text, preservation warning, **Replace**, **Try again**, **Copy**, **Back**. |

Kept from before, because tests and assistive technology rely on them: the card is a labelled region, not a dialog; focus moves to its heading; Escape closes it and returns focus to the field; buttons are found by their exact visible name; the page cannot reach the closed shadow roots. One change to a tested contract: the Tab order inside a suggestion is now Close → **Accept** → Dismiss → Copy → *Why this suggestion?* (the explanation used to come before Accept), so the primary action is reached first and visual and focus order agree.

## Writing panel

The same header (leaf tile, title, close), the selection quote, the action selector, **Check selection** as the only filled button, quiet **Pause Lineleaf**, a scrolling area so the Accept row is always reachable, and result cards that use the same change/category components as the inline card.

## Popup

A header with the mark, a site card showing the site, its first letter and a state pill (*On here*, *Off here*, *Paused*, *Unavailable*), two switches (*Check my writing here*, *Pause on all sites*), **Open writing panel**, and quiet *Check Seatline* and *Settings*. When the panel button is unavailable the popup says why (“Turn on …”, “Lineleaf cannot run on this page.”) instead of leaving a dimmed button unexplained.

## Settings

A page of cards with a side navigation that follows the section being read (the last section is highlighted at the very bottom), and a bar that keeps **Save preferences** and the status line in view. Automatic checking and clearer wording are switches with their limits listed as short bullets; the Seatline command has a **Copy** button; enabled sites are rows with a *Disable* button and an explained empty state; **Reset preferences and site access** is styled as destructive. All previous disclosures are kept, reorganised rather than shortened. Narrow windows stack the navigation above the content.

## Validation

- `tests/design.test.mjs` (13 tests): every text and graphic token pair meets WCAG AA in light and dark; the dark palette redefines every light colour; the popup states, names and no-sideways-scroll; contrast of rendered popup, settings and inline elements in both schemes (computed from the live styles, not the tokens); settings control names, navigation highlight, save bar, narrow layout, clarity switch dependency and the copy button; visible keyboard focus and reduced motion; the badge states and spinner; the word popover (position, tint, compact → More → Escape and focus return); the keyboard-opened full card; underline hit target; the card in dark mode with reduced motion.
- Mutating the new behaviour (popover compact rule, word tint, anchoring, underline height, Save bar position, navigation at the page end, busy state, two colour tokens, popup hint, switch role, reduced motion, focus ring, full card on keyboard open, copy button) makes a design test fail each time; fifteen mutations, fifteen caught.
- Existing suites keep passing against the new markup, which is the evidence that editing, rewrites, clarity, privacy and the lifecycle are unchanged. The counts for the current head are in the [tracker decision log](../product/lineleaf-implementation-tracker.md).
- [CI run 37093680169](https://github.com/davletovb/Lineleaf/actions/runs/37093680169) passed Linux, macOS and shared-companion at code revision `56db5c3`.
- Local screenshots in light and dark of the badge, underlines, popover, full card, rewrite preview, a request in progress, the panel, the popup states and the settings page were reviewed while designing; they are not committed.

## Not verified

- Appearance on real sites. X, Gmail, LinkedIn, Slack and Notion bring their own fonts, themes, zoom and stacking contexts; the fixtures here do not. The card follows the *system* colour scheme, not the page's, so a light card can sit on a dark page.
- Screen readers (VoiceOver, NVDA, JAWS), Windows high-contrast themes and browser zoom beyond 200 % were not exercised; only the accessibility tree, focus order and computed contrast were.
- Right-to-left and CJK text layout, and viewports narrower than about 320 px.
- System fonts differ per platform; widths were reviewed with one fallback font only.
- Differences from Grammarly that are deliberate or not yet done: the popover opens on click, not hover; no per-category taxonomy beyond correction / optional wording / rewrite; the badge sits below the field rather than inside it; no sentence-level score or tone detector.

The tracker keeps C-02 (inline underlines and cards) at IMPLEMENTED — VERIFY; this redesign does not close its screen-reader criterion.
