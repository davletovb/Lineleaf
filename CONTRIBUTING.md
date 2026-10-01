# Contributing to Lineleaf

Start with the [product framework](docs/product/lineleaf-product-framework.md), [implementation tracker](docs/product/lineleaf-implementation-tracker.md), and [Seatline integration requirements](docs/architecture/seatline-integration.md).

## Pick and record work

Choose an unblocked TODO item. Check existing code and open pull requests before starting so work is not duplicated. Record the owner, status, and issue or pull-request link in the tracker.

Use a branch and pull request for implementation work unless the repository owner directs otherwise. Keep the tracker update in the same pull request as the work it describes. If scope or dependencies change, explain that in the tracker.

## Describe the change

Reference the tracker ID, explain the behavior being changed, and report validation. A pull request should be understandable without the original conversation. Treat a documentation statement about planned behavior as a requirement, not evidence of implementation.

The README is a product introduction. Keep detailed implementation progress in the tracker and architecture decisions in the relevant documentation.

## Validate the work

Run checks appropriate to the change. Editing behavior needs meaningful coverage of caret/format preservation, undo, Unicode, repeated text, stale responses, and controlled editors. Provider integration needs disconnect, cancellation, session-isolation, and limit handling checks.

For documentation-only changes, review the wording and local links. Establish and document build, test, and packaging commands when the extension toolchain is selected in A-05/B-01.

The A-05 development toolchain is Node 24 and Python 3.12+. Run `npm ci --ignore-scripts`, `npx playwright install chromium`, and `npm test`. See the [scope/toolchain decision](docs/architecture/mvp-scope-and-toolchain.md) for native validation and live benchmark gates. Fixture results must never be described as live provider evidence. Product packaging remains B-01.

Move an item to IMPLEMENTED — VERIFY when the change exists but required validation is outstanding. Mark it DONE only with linked evidence that its acceptance criterion is met.

## Respect ownership and user data

Writing prompts, editor adapters, suggestions, preferences, and application-specific pacing belong in Lineleaf. Use the existing generic Seatline consumer interface and record missing capabilities as dependencies.

Share synthetic or redacted examples in issues and pull requests. Avoid real drafts, provider credentials, or sensitive page content in logs and screenshots.
