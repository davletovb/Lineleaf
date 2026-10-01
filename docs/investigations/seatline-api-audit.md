# A-01 — Shared Seatline consumer contract

Inspected 2026-10-01 at merged revision [`dc1086582c8b98498aa48dae91c8d174bc3cfc3c`](https://github.com/davletovb/seatline/tree/dc1086582c8b98498aa48dae91c8d174bc3cfc3c). No tagged release was available at inspection. The binary reports `Seatline companion 0.1.0-dev (protocol 1)`. The machine-readable pin is [seatline-contract.json](../../config/seatline-contract.json).

## Installation and transport

Seatline supplies one executable and one per-user broker. Unix platforms use a private socket; Windows uses a named pipe. Chrome connects to the existing `com.seatline.host` Native Messaging host. There is no HTTP listener or product worker. The stdio bridge authenticates to the broker itself; a browser must not send a grant token or the raw socket authentication frame.

The upstream Linux CI binary from [run 36710813675](https://github.com/davletovb/seatline/actions/runs/36710813675), artifact `11093463828`, was downloaded and verified against its published SHA-256: `ba5113b328b4d336bd342016aa7917132ea1d6ba829928022957e194e0288ff5`. Version, installation, registry, and exact-origin checks executed locally. This workspace denies the broker's socket creation; [A-02](extension-authorization.md) records that limit and the full native CI test.

## Wire version 1

Frames use a four-byte little-endian length and a UTF-8 JSON object, bounded to 1 MiB. The native bridge emits `{"type":"ready","version":1}`. Requests have `id`, `provider`, `method`, and `params`; events have `id` and `event`. Request IDs permit 1–128 ASCII letters, digits, and `._:-`.

| Method | Parameters / behavior |
| --- | --- |
| `status` | Provider status, capabilities, authentication, models, sign-in classification; ends with `completed` |
| `send` | Turn object; streams updates and one terminal event |
| `forget` | `sessions` handles, scoped to the consumer |
| `cleanup` | `group`, scoped to the consumer |
| `cancel` | **Top-level** `target` request ID, not `params.target`; no separate cancel acknowledgement |

Updates: `launched`, `started`, `activity`, `delta`, `session`, `session_lost`, `usage`, `source`, `status`, `completed`, `stopped`, and `failed`. Cancellation is confirmed by the target's terminal `stopped` event; a request may finish before cancellation wins.

The turn schema is strict: `system`, `messages` (`role` and `text`), `model`, `tools`, `session`, `continuation`, `cleanup_group`, and `check_sign_in`. Writing investigations use `tools: "none"`, `session: "ephemeral"`, null continuation/group, and `check_sign_in: true`. Do not share sessions between fields or apps.

## Authentication and capabilities

`authorize APP PROVIDERS ORIGINS...` replaces that app's entire grant and rotates its token. `revoke APP` closes its connections. Tokens stay in Seatline's protected registry. Native allowed origins are the exact union of registered app origins; an origin matching no app or multiple apps is refused.

Status distinguishes availability, authentication, and sign-in classification (`subscription`, `api_key`, `cloud`, `unknown`). `check_sign_in` alone **does not enforce subscription-only use**. Lineleaf must require authenticated subscription status and `capabilities.tool_isolation === true` before writing requests. Codex exposes the needed classification; Claude can return authenticated with unknown sign-in, which this slice refuses. The adapter registry also contains Gemini and Grok; listing an adapter is not evidence of a usable subscription configuration.

Capabilities include streaming, continuation, web search, model selection, cancellation, and tool isolation. Check runtime status; do not infer capability from provider name.

## Scheduling and missing evidence

Limits: 8 running turns, 2 per app, 2 per provider; 64 queued, 8 per app; 32 connections; 2,000 sessions per app / 10,000 total; 15-minute maximum turn. A bounded scheduler is not a latency guarantee. No consumer priority control was found.

Providers still launch a process per turn. First/subsequent requests on a connection do not establish model warmness. There is no structured-output grammar enforced by the companion, so Lineleaf validates JSON and source matches itself. Provider quotas, model latency, cancellation latency, and writing quality remain live measurement dependencies. No new Seatline feature is required for the explicit-request investigation.

## Source authority

- [Companion commands and native bridge](https://github.com/davletovb/seatline/blob/dc1086582c8b98498aa48dae91c8d174bc3cfc3c/companion/README.md)
- [Hub request routing and grants](https://github.com/davletovb/seatline/blob/dc1086582c8b98498aa48dae91c8d174bc3cfc3c/companion/src/hub.rs)
- [Wire encoding and safe failures](https://github.com/davletovb/seatline/blob/dc1086582c8b98498aa48dae91c8d174bc3cfc3c/companion/src/wire.rs)
- [Turn schema](https://github.com/davletovb/seatline/blob/dc1086582c8b98498aa48dae91c8d174bc3cfc3c/seatline-core/src/turn.rs)
- [Provider registry](https://github.com/davletovb/seatline/blob/dc1086582c8b98498aa48dae91c8d174bc3cfc3c/providers/src/lib.rs)
