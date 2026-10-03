# Lineleaf

**Clearer writing. Still your words.**

Lineleaf is a browser writing assistant designed to help with grammar, spelling, punctuation, clarity, and tone where you type. It connects to supported AI providers through the shared **Seatline companion**, while you choose which suggestions to accept.

## Planned experience

- Inline corrections with brief explanations.
- Rewrites of a selection or paragraph: improve it, paraphrase, or change clarity, length or tone.
- Optional, off-by-default suggestions for clearer wording, kept apart from corrections.
- Explicit acceptance, dismissal, and undo.
- A personal dictionary, English variants, and controls for each site.
- Conservative edits that preserve your intent and authorship.

Chrome desktop is the initial target. Support for individual websites and editors will be established through testing.

## Project status

The repository foundation and planning documents are in place. The first milestone validates the Seatline connection, provider response times, and safe editing behavior before the extension is scaffolded.

## Start here

- [Product framework](docs/product/lineleaf-product-framework.md) — scope, experience, privacy, and quality targets.
- [Implementation tracker](docs/product/lineleaf-implementation-tracker.md) — 21 work items, dependencies, and acceptance criteria.
- [Seatline integration](docs/architecture/seatline-integration.md) — ownership, transport, and editing requirements.
- [Contributing](CONTRIBUTING.md) — how to work on a tracker item.

Lineleaf owns the writing experience. Seatline remains the shared, provider-neutral companion that other apps and extensions can also use.
