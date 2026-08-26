---
name: tier0-sdk-openapi-notifications-send
version: 0.1.0
description: "POST /openapi/v1/notifications/send - send an in-app notification with optional web/mobile push"
---

# send - `POST /openapi/v1/notifications/send`

Send an inbox message to a user in the API key's Workspace, optionally triggering terminal push reminders (Web Push / mobile push).

The API key needs the `notifications:send` resource key (403 `NOTIFICATION_NOT_ALLOWED` when missing).

## ⚠️ No response envelope

Success is HTTP 200 with a **bare JSON body** — there is no `{code, msg, data}` wrapper. Errors use **real HTTP status codes** with body `{errorCode, message}`. The SDK throws `ApiError`; because the error body has no `code`/`msg` fields, the raw JSON text falls through into `error.msg`:

```typescript
import { notificationsApi, ApiError } from '@tier0/sdk/openapi';

try {
  const resp = await notificationsApi.openapiv1notificationssend(body);
  // resp IS { messageId, status, createdAt } — no envelope
} catch (e) {
  if (e instanceof ApiError) {
    // e.status = real HTTP status (409, 429, ...); e.code is 0 (no envelope)
    let errorCode = 'UNKNOWN';
    let message = e.msg; // non-JSON body (e.g. gateway-level 500) stays as raw text
    try { ({ errorCode, message } = JSON.parse(e.msg)); } catch {}
    // inspect errorCode per the table below (e.g. back off on NOTIFICATION_RATE_LIMITED), then:
  }
  throw e; // never swallow a failed send — callers must not proceed as if it succeeded
}
```

## Request

| Field | Type | Required | Description |
|---|---|---|---|
| `recipientUserId` | `string` | **yes** | Recipient user ID. A big integer carried as a string — **never convert to `number`** (JS precision loss). See "Resolving the recipient" below |
| `type` | `string` | **yes** | Message type. **Only `"inbox"` is accepted** (400 otherwise). A reserved field for future message forms; hard-code it |
| `title` | `string` | **yes** | 1-50 characters |
| `content` | `string` | **yes** | 1-800 characters (over the limit returns 422 `CONTENT_LIMIT_EXCEEDED`, not 400) |
| `idempotencyKey` | `string` | **yes** | ≤128 characters, see "Idempotency key discipline" |
| `mode` | `string` | no | `test` / `live`, default `live`. `test` auto-prefixes the title with `[Test]` |
| `channels` | `string[]` | no | Push channels: `web` / `mobile`. **Omitting and `[]` are synonymous = silent message** (inbox only, no reminder). **Pushing requires explicit values**, e.g. `["web","mobile"]` |
| `sender` | `object` | no | Sender identity, see below. Server defaults to `{"type":"other"}` |
| `source` | `string` | no | **Deprecated**: transitional alias for `sender.name` (`sender.name` wins). Do not send |

### Three easily-confused fields

| Field | Controls | Values |
|---|---|---|
| `type` | What kind of message body | Only `"inbox"` (in-app message), fixed |
| `channels` | Whether to **additionally ring a bell** beyond the inbox | `web` / `mobile` / omit = inbox only |
| `sender.type` | Who sent it | `app` / `other` |

The inbox message is always created (it IS the message); `channels` only decides whether to interrupt.

### Resolving the recipient (in priority order)

1. **Business context** (preferred): the triggering event/work order/session usually carries the target user ID — use it as-is (keep it a string).
2. **Platform member query**: `platformApi.openapiv1platformgetmembers({ keyword: 'alice', page: 1, size: 20 })` — see [`tier0-sdk-members`](../../tier0-sdk-members/SKILL.md). Each row's `userId` is the same ID space as `recipientUserId`.
3. ⚠️ Either way: **the recipient must be an active member of the API key's workspace**, otherwise 404 `RECIPIENT_NOT_AVAILABLE`. The member list is platform-wide — a listed user is not necessarily in this key's workspace. That mismatch is the first suspect for this 404.

## mode: detect the scenario

The only open calling scenario today is an agent-platform App. Rule:

- App **not yet published** (developing / previewing) → `mode: "test"` (recipients see the `[Test]` prefix and recognize a rehearsal)
- App **published** → `mode: "live"`

Detection heuristic — Live Preview runs a dev server (`NODE_ENV=development`), a published App runs the production build:

```typescript
const mode = process.env.NODE_ENV === 'production' ? 'live' : 'test';
```

This is a heuristic; an App overriding NODE_ENV breaks it. **When unsure, ask the user — never silently send `live` to real people.**

## sender: sender identity

Self-reported display/navigation hint — **not a verified identity; never base any security decision on it**.

| Field | Required | Rule |
|---|---|---|
| `sender.type` | no (default `other`) | Closed enum `"app"` \| `"other"`, 400 on other values. `app` = an App Builder application (enables jump/lookup semantics); `other` = fallback (scripts, integrations) |
| `sender.id` | required for `app` | For `app`: the appId (agent-platform UUID). Charset `[0-9a-zA-Z-]{1,128}` |
| `sender.name` | no | Human-readable display name, ≤100 chars (successor of deprecated `source`) |
| `sender.meta` | no | Type-specific extras, ≤500 bytes serialized. For `app`: `{"projectId": "..."}` |

**For the `app` scenario always send all three**: `id` (appId) + `meta.projectId` + `name`. The BFF looks up the real app name/icon and builds the app-detail jump URL from the (projectId, appId) pair — without projectId, the mobile Open button and icon lookup break, leaving only the `name` fallback.

**Where appId/projectId come from**:

- `meta.projectId`: **resolve at runtime** with `getCurrentProjectId()` from `@tier0/sdk` (the runtime injects `TIER0_PROJECT_ID`, see the root `references/configuration.md`). Never hard-code it at generation time — an App imported into another project would keep pointing at the source project, breaking icon lookup and Open-button navigation.
- `sender.id` (appId): no runtime injection exists for it. The AI building the App knows it in its session context — write it in as a constant (or the App's own env var) at code-generation time.

## Idempotency key discipline

- **Must be a business-event key**, e.g. `order-A1029-shipped-v1` — **never a random value/UUID** (a fresh key per attempt defeats idempotency; retries would re-notify the user)
- Retries **must reuse the same key**: an idempotent hit returns the original result without duplicating the notification
- Same key with different content → 409 `IDEMPOTENCY_KEY_CONFLICT` (the server compares a content digest as a misuse guard)
- 24-hour window: after it expires the same key creates a new message (new messageId)
- Scope is the API key: different keys never collide

## Response

```typescript
// HTTP 200, bare JSON, no envelope
{
  messageId: string;   // save it — the only handle for querying delivery status
  status: 'accepted' | 'sent' | 'failed';
  createdAt: string;   // ISO 8601
}
```

`status` is `accepted` on first submission. **An idempotent replay (same key within the 24h window) returns the existing record's current state instead — possibly already terminal `sent`/`failed`** — so treat the response as a status snapshot, not always "queued".

**Async semantics (important)**: at 200 + `accepted` the inbox message **does not exist yet** — validation passed and the job was queued; a background worker creates the message, and pushes go out later still. Therefore:

- `accepted` = the platform took the order; it is not delivery
- To confirm the terminal state, poll [get](./get.md) with the messageId (`sent` / `failed`)
- Even `sent` does not mean the user saw it (no read receipts) — report "sent", never "received/read"

## App integration checklist

For an AI generating App code:

1. API key: via App env vars (`TIER0_API_HOST` / `TIER0_API_KEY`); the key needs `notifications:send`
2. `sender.id` (appId): constant written at generation time; `sender.meta.projectId`: `getCurrentProjectId()` at runtime (server-side code — the runtime injects `TIER0_PROJECT_ID`)
3. mode: `NODE_ENV === 'production' ? 'live' : 'test'`
4. Recipient and channels: from the user's explicit instruction (see the decision ladder in [`../SKILL.md`](../SKILL.md)) — never hard-coded defaults

## Examples

### 1. Minimal silent inbox message (record only, no interruption)

```typescript
import { notificationsApi } from '@tier0/sdk/openapi';

const resp = await notificationsApi.openapiv1notificationssend({
  recipientUserId: '333145365391552',
  type: 'inbox',
  title: 'Weekly inventory report ready',
  content: 'The weekly inventory report is available on the Reports page.',
  idempotencyKey: 'inventory-weekly-2026W35',
  // no channels = silent: inbox only, no reminder
});
console.log(resp.messageId, resp.status); // "71234..." "accepted"
```

### 2. Full send with push + sender (App scenario)

```typescript
import { getCurrentProjectId } from '@tier0/sdk';

const resp = await notificationsApi.openapiv1notificationssend({
  recipientUserId: '333145365391552',
  type: 'inbox',
  title: 'Equipment alert',
  content: 'Mixing tank 01 on line 1 exceeded temperature limit (82°C). Immediate action required.',
  idempotencyKey: 'alert-tank01-overtemp-20260825T1500',
  mode: process.env.NODE_ENV === 'production' ? 'live' : 'test',
  channels: ['web', 'mobile'], // the user explicitly asked for push
  sender: {
    type: 'app',
    id: '550e8400-e29b-41d4-a716-446655440000', // appId: constant written at generation time
    name: 'OEE Monitor',
    meta: { projectId: getCurrentProjectId() }, // runtime value — correct even after the App is imported elsewhere
  },
});
```

### 3. Retry on failure (reuse the idempotency key)

```typescript
import { ApiError } from '@tier0/sdk/openapi';

const body = {
  recipientUserId: '333145365391552',
  type: 'inbox',
  title: 'Order shipped',
  content: 'Your order #A1029 has shipped.',
  idempotencyKey: 'order-A1029-shipped-v1', // unchanged across retries
};

async function sendWithRetry(maxAttempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      // if an earlier attempt actually succeeded, this is an idempotent hit — same messageId, no duplicate
      return await notificationsApi.openapiv1notificationssend(body);
    } catch (e) {
      const retryable = e instanceof ApiError && (e.status >= 500 || e.status === 429);
      if (!retryable || attempt >= maxAttempts) throw e; // other 4xx: retrying cannot help; exhausted: surface the last error, never swallow it
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

const resp = await sendWithRetry();
```

## Errors

| HTTP | errorCode | Cause | Handling |
|---|---|---|---|
| 400 | `INVALID_REQUEST` | Missing required field / title >50 / idempotencyKey >128 / invalid mode, channels, or sender enum / recipientUserId not an integer string | Fix the field per `message` |
| 400 | `INVALID_NOTIFICATION_TYPE` | `type` is not `"inbox"` | Hard-code `type: "inbox"` |
| 401 | `INVALID_CREDENTIAL` | API key missing or invalid | Check `TIER0_API_KEY` |
| 403 | `NOTIFICATION_NOT_ALLOWED` | Key lacks the `notifications:send` resource key | Ask an admin to grant it |
| 404 | `RECIPIENT_NOT_AVAILABLE` | Recipient is not an active member of the key's workspace | Verify workspace membership (first suspect: userId from the platform-wide list but not in this workspace) |
| 409 | `IDEMPOTENCY_KEY_CONFLICT` | Same key resent with different content | New event → new key; same event → keep content identical |
| 422 | `CONTENT_LIMIT_EXCEEDED` | content >800 characters | Truncate or shorten |
| 429 | `NOTIFICATION_RATE_LIMITED` | Rate limit (1000/min per key; keys are workspace-shared) | Back off and retry (reuse the key) |
| 500 | `INTERNAL_ERROR` | Server-side error | Back off and retry (reuse the key) |
