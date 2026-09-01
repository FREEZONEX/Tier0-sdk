---
name: tier0-sdk-notifications
version: 1.5.0
description: "Tier0 SDK message notifications for TypeScript/JavaScript. Before using this Skill, first read tier0-sdk for shared SDK version, configuration, runtime, and layering rules. Use when selecting a human recipient from Tier0 members, sending an in-app notification with optional web/mobile push reminders, or querying delivery status through @tier0/sdk/openapi. Resolve recipient IDs internally from member data; never make users enter or understand a user ID."
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

## Recipient UX invariant

`recipientUserId` is an internal transport field, not a user-facing concept.

- In an app, present a searchable member picker using names, nickname, email, and relevant roles. Store the selected member's `userId` internally and pass it to the send API; never render a free-text “User ID” field.
- In an agent conversation, ask for a recognizable person such as a name or email, query the member list, and show human-readable candidates when ambiguous. Never ask the user to find, paste, or choose a numeric ID.
- For a project-scoped audience, query that project's members. For a Workspace-wide audience, query platform members with `statuses: ['active']`. Read [`tier0-sdk-members`](../tier0-sdk-members/SKILL.md) before implementing either picker.
- A trusted business record may already contain a previously resolved `userId`; use it internally without exposing it. Do not accept an arbitrary ID supplied through ordinary end-user input.
- If the API key cannot query members, treat that as an app configuration or permission error. Do not fall back to raw-ID input. Cloud member queries currently require `uns:read` in addition to the notification permissions.

## Decision ladder: ask the user first

Sending a notification interrupts a real person. Never substitute defaults for these decisions:

| Parameter | Decided by | Rule |
|---|---|---|
| Recipient | **User** | Ask who should receive it using name/email or a member picker. Resolve `userId` internally from members; if multiple candidates match, show human-readable labels and let the user choose — never show IDs or guess |
| `channels` | **User** | Present the options: inbox only (silent) / + web push / + mobile push. Ask if unspecified — never silently send silent (user thinks a push went out) and never silently push to all channels (over-interruption) |
| Title / content | **User** (agent may draft, user reviews) | The agent enforces length limits (50/800 chars); the content itself is the user's intent |
| `mode` | Agent detects the scenario; ask when unsure | See send.md. Never silently default to `live` when uncertain |
| `idempotencyKey` | Agent | Business-event key discipline, see send.md |
| `sender` | Agent | Filled from the calling app's identity, see send.md. An `app` sender sends `type: 'app'` + `id` from `getCurrentAppId()` + `meta.projectId` from `getCurrentProjectId()`, and **omits `name`** — the server looks the real App name up. Never hard-code the appId. Only an `other` sender names itself |
| `link` | Agent (ask when ambiguous) | The Open-button target, derived from whatever the notification is about (the order, the alarming device, the work order). Ask when the destination is not obvious — and confirm the recipient can actually reach it. Omitting it is fine, but it does not guarantee no button: there are **two** navigation sources — `link`, and `sender.type=app` carrying **both** `id` (appId) and `meta.projectId`, which offers "open the sending App". No button appears only when both sources are absent |
| `type` | No choice | Fixed `"inbox"`, the only accepted value |

## Scope Routing

| Need | Read |
|---|---|
| Send a notification (inbox + optional push), sender contract, idempotency, error codes | [`references/send.md`](references/send.md) |
| Query delivery status by messageId, poll until terminal state | [`references/get.md`](references/get.md) |

## Final Checklist

1. The user selected a recognizable member; no UI or prompt asked for a raw user ID.
2. `recipientUserId` was resolved internally from member data or a trusted business relation.
3. Recipient and channels came from the user's explicit instruction, not defaults.
4. The recipient is an active member of the API key's workspace.
5. `idempotencyKey` is a business-event key, reused verbatim on retries.
6. Responses were parsed as bare JSON (no envelope) and errors via `ApiError.status` + JSON in `ApiError.msg`.
7. Status reported to the user says "sent", never "seen/read" — there is no read receipt.
8. If a `link` was sent, it passes **every** rule in [send.md](references/send.md) — `https://` or `/` prefix, protocol-relative `//host` and backslashes rejected, ≤500 characters, no Unicode whitespace / control / invisible format characters — and points at something the recipient has permission to open.
