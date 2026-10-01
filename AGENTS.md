# Lineleaf repository guidance

## Read before implementing

- Product scope: `docs/product/lineleaf-product-framework.md`
- Work and dependencies: `docs/product/lineleaf-implementation-tracker.md`
- Ownership and integration: `docs/architecture/seatline-integration.md`
- Contributor workflow: `CONTRIBUTING.md`

## Work discipline

- Verify the code and open work before implementing a tracker item.
- Honor dependencies and preserve stable tracker IDs.
- Update status, owner, and evidence in the tracker with the corresponding change.
- Record incomplete validation as IMPLEMENTED — VERIFY. Use DONE only when the acceptance criterion is verified.
- Keep the README as an introduction, not a technical changelog.
- Choose implementation tooling during A-05/B-01; do not document commands or support that have not been verified.

## Architecture constraints

- Lineleaf owns all writing-specific logic.
- Reuse the one shared Seatline companion through its generic consumer interface.
- Do not create a Lineleaf companion, introduce app-worker processes, add a local HTTP listener, put writing code into Seatline, or add a Node runtime to Seatline.
- Inspect the currently merged companion API before coding against it. Do not invent its method names or claim generic capabilities already exist.
- Keep any provider-context or session state isolated between fields, requests, and consumer apps.

## Editing and data handling

- Model responses are advisory. Validate candidates and compute edit positions in application code.
- Recheck the text revision and exact source immediately before applying an edit.
- Preserve site/editor state, caret, formatting where supported, and meaningful undo. Use a copy fallback for unsupported replacement surfaces.
- Distinguish optional style changes from correctness corrections.
- Send only bounded text from enabled fields/sites. Do not capture unrelated page content or persist draft text by default.
- Avoid draft content and credentials in logs, issues, and telemetry.
- Test high-impact editing and provider behavior with meaningful regressions. Documentation-only changes need a link/consistency review rather than new tests.
