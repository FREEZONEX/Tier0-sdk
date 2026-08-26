---
name: tier0-sdk-notifications
version: 1.0.0
description: "Tier0 SDK message notifications for TypeScript/JavaScript. Before using this Skill, first read tier0-sdk for shared SDK version, configuration, runtime, and layering rules. Use when sending an in-app notification (inbox message) to a workspace user with optional web/mobile push reminders, or querying the delivery status of a sent notification through @tier0/sdk/openapi."
metadata:
  requires:
    npm: ["@tier0/sdk"]
---

# Tier0 SDK — Notifications

**Before starting, read the root SDK Skill at [`../SKILL.md`](../SKILL.md).**

## ⚠️ Response format differs from every other endpoint

The two notifications endpoints do **not** use the `{code, msg, data}` envelope:

- **Success**: HTTP 200 with a bare JSON body (e.g. `{ messageId, status, createdAt }`). Read fields directly — `result.data` does not exist.
- **Failure**: a real HTTP status code (400/401/403/404/409/422/429) with body `{ errorCode, message }`. The SDK client throws `ApiError`; the raw error JSON lands in `error.msg`. Parsing pattern is in [`references/send.md`](references/send.md).

## Decision ladder: ask the user first

Sending a notification interrupts a real person. Never substitute defaults for these decisions:

| Parameter | Decided by | Rule |
|---|---|---|
| Recipient | **User** | Ask if unspecified. When given a name/email, the agent resolves it to a userId (see send.md); if multiple candidates match, list them and let the user pick — never guess |
| `channels` | **User** | Present the options: inbox only (silent) / + web push / + mobile push. Ask if unspecified — never silently send silent (user thinks a push went out) and never silently push to all channels (over-interruption) |
| Title / content | **User** (agent may draft, user reviews) | The agent enforces length limits (50/800 chars); the content itself is the user's intent |
| `mode` | Agent detects the scenario; ask when unsure | See send.md. Never silently default to `live` when uncertain |
| `idempotencyKey` | Agent | Business-event key discipline, see send.md |
| `sender` | Agent | Filled from the calling app's identity, see send.md |
| `type` | No choice | Fixed `"inbox"`, the only accepted value |

## Scope Routing

| Need | Read |
|---|---|
| Send a notification (inbox + optional push), sender contract, idempotency, error codes | [`references/send.md`](references/send.md) |
| Query delivery status by messageId, poll until terminal state | [`references/get.md`](references/get.md) |

## Final Checklist

1. Recipient and channels came from the user's explicit instruction, not defaults.
2. The recipient is an active member of the API key's workspace.
3. `idempotencyKey` is a business-event key, reused verbatim on retries.
4. Responses were parsed as bare JSON (no envelope) and errors via `ApiError.status` + JSON in `ApiError.msg`.
5. Status reported to the user says "sent", never "seen/read" — there is no read receipt.
