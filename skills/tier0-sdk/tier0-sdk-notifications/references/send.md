---
name: tier0-sdk-openapi-notifications-send
version: 0.4.0
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
| `recipientUserId` | `string` | **yes** | Internal recipient identifier resolved from Tier0 member data. Never expose it as user input or convert it to `number` (JS precision loss). See "Resolving the recipient" below |
| `type` | `string` | **yes** | Message type. **Only `"inbox"` is accepted** (400 otherwise). A reserved field for future message forms; hard-code it |
| `title` | `string` | **yes** | 1-50 characters |
| `content` | `string` | **yes** | 1-800 characters (over the limit returns 422 `CONTENT_LIMIT_EXCEEDED`, not 400) |
| `idempotencyKey` | `string` | **yes** | ≤128 characters, see "Idempotency key discipline" |
| `mode` | `string` | no | `test` / `live`, default `live`. `test` auto-prefixes the title with `[Test]` |
| `channels` | `string[]` | no | Push channels: `web` / `mobile`. **Omitting and `[]` are synonymous = silent message** (inbox only, no reminder). **Pushing requires explicit values**, e.g. `["web","mobile"]` |
| `sender` | `object` | no | Sender identity, see below. Server defaults to `{"type":"other"}` |
| `link` | `string` | no | Open-button target, see below. Omit for no Open button |
| `source` | `string` | no | **Deprecated**: transitional alias for `sender.name` (`sender.name` wins). Do not send |

### Three easily-confused fields

| Field | Controls | Values |
|---|---|---|
| `type` | What kind of message body | Only `"inbox"` (in-app message), fixed |
| `channels` | Whether to **additionally ring a bell** beyond the inbox | `web` / `mobile` / omit = inbox only |
| `sender.type` | Who sent it | `app` / `other` |

The inbox message is always created (it IS the message); `channels` only decides whether to interrupt.

### Resolving the recipient

The product interaction selects a person; only application code handles the ID.

1. **Existing trusted relation**: if a work order, assignment, or stored member selection already contains a Tier0 `userId`, reuse it internally as a string. Do not expose it or accept an arbitrary replacement from an end-user text field.
2. **Project-scoped selection**: use `launchpadApi.openapiv1launchpadgetmembers` with `getCurrentProjectId()` when recipients must belong to the current project. Build picker labels from `userName`, `email`, and roles; keep `userId` only as the option value.
3. **Workspace-wide selection**: use `platformApi.openapiv1platformgetmembers({ keyword, statuses: ['active'], page: 1, size: 20 })`. It searches the API key's Workspace by username, nickname, or email and returns `userId` in the required string form.
4. **Ambiguity**: when more than one member matches, show names, email, and relevant roles. Do not display IDs as the differentiator and never pick the first result silently.

Cloud member queries currently require `uns:read`; notification send separately requires `notifications:send`. If the key lacks member-read permission, surface a configuration error to the app owner or administrator. Never make the end user supply `recipientUserId` as a workaround.

In an App, never use `auth/whoami` to determine the sender or recipient. The App API Key is a shared business credential and does not identify the signed-in person. Obtain the current person from the App's authenticated session, then resolve that person's name/email to the string `userId` through the appropriate member list. This also avoids `whoami.userID`, whose current JavaScript `number` schema can lose precision for large IDs.

The notification endpoint accepts only active members of the API key's Workspace; otherwise it returns 404 `RECIPIENT_NOT_AVAILABLE`. If a member became unavailable after selection, refresh the picker and ask the user to choose again.

```typescript
import { platformApi } from '@tier0/sdk/openapi';

async function searchActiveRecipients(keyword: string) {
  const result = await platformApi.openapiv1platformgetmembers({
    keyword,
    statuses: ['active'],
    page: 1,
    size: 20,
  });
  if (result.code !== 200 || !result.data) {
    throw new Error(result.msg ?? `getMembers failed with code ${result.code}`);
  }
  return result.data.list.map(member => ({
    value: member.userId, // internal value sent as recipientUserId
    label: member.nickName || member.userName || member.email || 'Unnamed member',
    email: member.email,
    roles: member.roles.map(role => role.roleName || role.roleKey),
  }));
}
```

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

## link: the Open button target

Populates the **Open button** on the recipient's in-app message. Self-reported navigation hint — like `sender`, **never base any security decision on it**; the server validates the shape only, not that the destination exists or that the recipient may view it.

| Form | Example | How it opens |
|---|---|---|
| In-app path | `/launchpad/launch/<appId>?projectId=<projectId>` | Navigates inside the platform shell, in the recipient's own workspace |
| Absolute URL | `https://oee-monitor.example.com/alerts/tank01` | **`https://` only** (`http://` is rejected as cleartext; `javascript:` / `data:` and other pseudo-schemes are blocked by the same prefix allowlist). Opens in a **new tab** with `noopener`, outside the platform shell |

Validation (400 `INVALID_REQUEST` on any violation):

- Must start with `https://` (with at least one character after it) or `/`
- **Protocol-relative `//host/path` is rejected** — it has a leading slash but resolves cross-origin, so it does not count as an in-app path
- **Backslashes are rejected outright** — the WHATWG URL spec normalizes them to `/` in special-scheme URLs, so `/\host` resolves exactly like `//host`. Percent-encode a legitimate backslash as `%5C`
- ≤500 characters
- No whitespace, control, or invisible format characters. Classified by Unicode category, **not just ASCII**: a plain space, U+00A0 no-break space, U+3000 ideographic space, U+2028 line separator, **U+200B zero-width space and U+FEFF BOM** are all rejected. Percent-encode a space as `%20`

Omitting `link` is normal and safe. There are **two** navigation sources, and the button is rendered when either one is complete:

1. `link` — this field
2. `sender.type=app` carrying **both** `id` (appId) **and** `meta.projectId` — offers "open the sending App". An incomplete pair is not a source: with appId but no projectId the BFF cannot build the app-detail URL, so no button

With neither source present the message renders no Open button at all.

### Writing the path

**In-app path — leave the workspace segment out.** Platform routes live under `/ws/<workspaceId>/…`, but the web client prepends the **recipient's own** workspace to any `/`-prefixed path that does not already start with `/ws/`. So write `/launchpad/launch/<appId>?projectId=<projectId>`, not `/ws/1/launchpad/…`: a hard-coded `/ws/1` pins every recipient to workspace 1 and breaks the moment the App is imported into another workspace (same guardrail as `meta.projectId`, see the root [`SKILL.md`](../../SKILL.md)).

**An in-app path cannot deep-link inside an App.** Apps run in an iframe on the launch page, and that page's query string is not forwarded into the App — `/launchpad/launch/<appId>?projectId=<projectId>` always lands on the App's own entry screen. It is also exactly what the appId + projectId fallback already produces, so sending it as `link` adds nothing.

**To land on a specific screen inside your App, send its absolute `https://` URL.** The App knows its own deployed base URL (its own config/env — the SDK injects no such value); append your route to it. The trade-off: a new tab outside the platform shell.

**Mobile ignores `link`.** The mobile app opens the sending App via appId + projectId regardless, so a notification with a `link` lands on different pages on web and mobile. Do not put a mobile-critical destination in `link` alone.

**Point it somewhere the recipient can actually reach.** The server does no permission check — a link into a resource they cannot view lands them on a 403.

**Reading it back**: the field is called `link` on the way in, but the stored message exposes it as `actionType` (currently always `"link"`) and `actionPath` (the value you sent). You do not need these in the SDK — they are consumed by the web client — but the asymmetry surprises people reading server logs.

## Idempotency key discipline

- **Must be a business-event key**, e.g. `order-A1029-shipped-v1` — **never a random value/UUID** (a fresh key per attempt defeats idempotency; retries would re-notify the user)
- Retries **must reuse the same key**: an idempotent hit returns the original result without duplicating the notification
- Same key with different content → 409 `IDEMPOTENCY_KEY_CONFLICT` (the server compares a content digest as a misuse guard)
- ⚠️ **`link` is part of that digest**: reusing the same key while changing the link returns 409, *not* an idempotent hit. Retries must resend the body verbatim, link included
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
4. Recipient: selected by a human-readable member picker or resolved from a trusted business relation; `recipientUserId` remains internal and is never typed by the user
5. Channels: from the user's explicit instruction (see the decision ladder in [`../SKILL.md`](../SKILL.md)) — never hard-coded defaults

## Examples

The examples assume `recipientUserId` came from the selected member option or a trusted business relation. It is never collected through a raw-ID field.

### 1. Minimal silent inbox message (record only, no interruption)

```typescript
import { notificationsApi } from '@tier0/sdk/openapi';

const resp = await notificationsApi.openapiv1notificationssend({
  recipientUserId: selectedRecipient.value,
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
  recipientUserId: selectedRecipient.value,
  type: 'inbox',
  title: 'Equipment alert',
  content: 'Mixing tank 01 on line 1 exceeded temperature limit (82°C). Immediate action required.',
  idempotencyKey: 'alert-tank01-overtemp-20260825T1500',
  mode: process.env.NODE_ENV === 'production' ? 'live' : 'test',
  channels: ['web', 'mobile'], // the user explicitly asked for push
  // Open button target: a specific screen inside this App, so it must be an absolute https:// URL
  // built on the App's own deployed base URL (the App's own config — the SDK injects no such value).
  // An in-app path such as `/launchpad/launch/${appId}?projectId=...` would only reach the entry screen.
  link: `${process.env.APP_PUBLIC_URL}/alerts/tank01`,
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
  recipientUserId: selectedRecipient.value,
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
      // Retryable: server-side 5xx / rate limit — and transport failures with no HTTP response
      // (fetch throws TypeError on connection reset/DNS): the caller cannot know whether the
      // server accepted the request, and reusing the idempotency key makes the retry safe.
      const retryable = e instanceof ApiError ? e.status >= 500 || e.status === 429 : true;
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
| 400 | `INVALID_REQUEST` | Missing required field / title >50 / idempotencyKey >128 / invalid mode, channels, or sender enum / recipientUserId not an integer string / invalid `link` (bad prefix, protocol-relative `//host` or its backslash variant, backslash anywhere, >500 chars, any Unicode whitespace / control / invisible format character) | Fix the field per `message` |
| 400 | `INVALID_NOTIFICATION_TYPE` | `type` is not `"inbox"` | Hard-code `type: "inbox"` |
| 401 | `INVALID_CREDENTIAL` | API key missing or invalid | Check `TIER0_API_KEY` |
| 403 | `NOTIFICATION_NOT_ALLOWED` | Key lacks the `notifications:send` resource key | Ask an admin to grant it |
| 404 | `RECIPIENT_NOT_AVAILABLE` | Recipient is no longer an active member of the key's Workspace | Refresh members and ask the user to choose an available recipient; do not request an ID |
| 409 | `IDEMPOTENCY_KEY_CONFLICT` | Same key resent with different content | New event → new key; same event → keep content identical |
| 422 | `CONTENT_LIMIT_EXCEEDED` | content >800 characters | Truncate or shorten |
| 429 | `NOTIFICATION_RATE_LIMITED` | Rate limit (1000/min per key; keys are workspace-shared) | Back off and retry (reuse the key) |
| 500 | `INTERNAL_ERROR` | Server-side error | Back off and retry (reuse the key) |
