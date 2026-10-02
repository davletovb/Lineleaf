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

For documentation-only changes, review the wording and local links. Keep the established build, test, and packaging commands current when changing the extension toolchain.

The development toolchain is Node 24 and Python 3.12+. Run `npm ci --ignore-scripts`, `npx playwright install chromium`, `npm test`, and `npm run test:extension`. Build the unpacked extension with `npm run build`; `npm run package` also creates its ZIP. See the [selection prototype](docs/implementation/selection-mvp.md) for outputs and [scope/toolchain decision](docs/architecture/mvp-scope-and-toolchain.md) for native validation and live benchmark gates. Fixture results must never be described as live provider evidence.

Move an item to IMPLEMENTED — VERIFY when the change exists but required validation is outstanding. Mark it DONE only with linked evidence that its acceptance criterion is met.

For E evaluation, run `npm run evaluate:fixture`, `npm run measure:typing`, and `npm run beta:candidate` after the regression suites. The [evaluation guide](docs/implementation/evaluation-beta.md) describes independent labels/output judgments, isolated shared-broker probes and live evidence. `beta:release` refuses distribution without complete current-package human/live/device evidence; a review candidate is allowed to remain blocked.

## Respect ownership and user data

Writing prompts, editor adapters, suggestions, preferences, and application-specific pacing belong in Lineleaf. Use the existing generic Seatline consumer interface and record missing capabilities as dependencies.

Share synthetic or redacted examples in issues and pull requests. Avoid real drafts, provider credentials, or sensitive page content in logs and screenshots.
