---
name: tier0-sdk-openapi-notifications-send
version: 0.8.3
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
| `channels` | `string[]` | no | Push channels: `web` / `mobile`. At the current SDK/API contract, **omitting and `[]` are synonymous = silent message** (inbox only, no reminder). Skill-generated code therefore uses explicit arrays for every intent. `web` also covers the Tier0 desktop client, so there is no `desktop` value |
| `sender` | `object` | no | Sender identity, see below. Server defaults to `{"type":"other"}` |
| `link` | `string` | no | Open-button target, see below. **Omitting and `""` are synonymous**; the button then disappears only if the sender is not a complete `app` sender (see below) |
| `source` | `string` | no | **Deprecated**: transitional alias for `sender.name` (`sender.name` wins). Do not send |

### Three easily-confused fields

| Field | Controls | Values |
|---|---|---|
| `type` | What kind of message body | Only `"inbox"` (in-app message), fixed |
| `channels` | Whether to **additionally ring a bell** beyond the inbox | `web` (browser + desktop client) / `mobile` / `[]` = inbox only |
| `sender.type` | Who sent it | `app` / `other` |

The inbox message is always created (it IS the message); `channels` only decides whether to interrupt.

### Channel selection for generated Apps

Translate the user's words directly into an explicit array:

| User intent | Generate | Result |
|---|---|---|
| "Notify the user" with no terminal qualifier | `channels: ['web', 'mobile']` | Inbox + Web & Desktop + Mobile |
| All terminal reminders | `channels: ['web', 'mobile']` | Inbox + Web & Desktop + Mobile |
| Web & Desktop only | `channels: ['web']` | Inbox + Web & Desktop |
| Mobile only | `channels: ['mobile']` | Inbox + Mobile |
| Inbox only / silent | `channels: []` | Inbox only |

`web` and Desktop are one channel. Never emit `desktop`, and never infer a narrower channel set from whether the generated App is a web page, desktop shell, or mobile-facing view. Do not omit `channels` to express the default notification intent: `@tier0/sdk@0.3.5` forwards the body unchanged, so omission still means inbox only. Use `['web', 'mobile']` explicitly until the published SDK contract is verified to expand omission itself.

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

Four fields, and what to put in each:

| Field | Required | What to put in it |
|---|---|---|
| `sender.type` | no (default `other`) | `"app"` when an App Builder application is sending — it unlocks the icon and open-the-App behaviour below. `"other"` for anything else (scripts, integrations, backend jobs). Closed enum: any other value is 400 |
| `sender.id` | **yes when `type` is `app`** | The **appId** (agent-platform UUID) — always `getCurrentAppId()` from `@tier0/sdk`, never a literal, see below. Accepted but pointless for `other` — nothing consumes it there |
| `sender.name` | optional in the contract, but **required in practice for `other`** | **Leave it out when `type` is `app`** — the platform resolves the real name from (projectId, appId), see below. **Always send it for `other`**: nothing can be looked up, so omitting it leaves the message with no sender identity at all. ≤100 chars (successor of the deprecated `source`) |
| `sender.meta` | no | For `app`: `{"projectId": "<the current project id>"}`. **Every value must be a string** — `{projectId: 123}` is not valid. ≤500 bytes serialized |

Neither the name nor the icon is self-reported for an App: both are resolved server-side by looking up (projectId, appId). An **Android** push is the one exception — it composes its icon URL from appId directly, with no lookup; iOS and Web Push carry no icon at all (see below).

**For the `app` scenario send exactly three fields**: `type: 'app'` + `id` (appId) + `meta.projectId`. `type` is what selects the App behaviour at all — omit it and the sender silently defaults to `other`, losing the name lookup, the icon and the Open button. The (appId, projectId) pair then drives everything the in-app message shows: the name lookup, the App icon there, and the Open button. Without `projectId` those three break together — the Android push icon is the exception, since it is composed from `appId` alone (see below).

**Do not send `sender.name` for an `app` sender.** The platform looks the real name up, so a self-reported copy can only disagree with it — and it goes stale the moment the App is renamed. Omit it and the displayed name always tracks the App's actual name. If the lookup finds nothing (App deleted, or not visible to this recipient), the message simply shows no sender name; that is the intended degradation, not something to paper over.

`sender.name` is for `other` senders — scripts, integrations, backend jobs — which have no entity to look up. There it is the **only** identity available: send it every time, and make it recognizable to the person receiving the message ("Nightly stock sync", not "script"). Leave it out and the recipient sees a message from nobody.

**`sender.name` never reaches a push notification.** The push payload is title + content, plus — for `sender.type=app` on **Android** — an app icon thumbnail whose URL is composed from `sender.id` (appId) directly, with no lookup. So a push shows your App's icon but never its name: whatever must identify the source to someone reading the push has to be in the `title` or `content` you wrote. Web Push and iOS ignore the icon field too.

**Where the two values come from** — both at runtime, neither as a literal:

- `meta.projectId`: `getCurrentProjectId()` from `@tier0/sdk` (the runtime injects `TIER0_PROJECT_ID`, see the root [`references/configuration.md`](../../references/configuration.md)). Never hard-code it at generation time — an App imported into another project would keep pointing at the source project, breaking icon lookup and Open-button navigation.
- `sender.id`: `getCurrentAppId()` from `@tier0/sdk` (the runtime injects `APP_ID`).
  - ⚠️ **Never write the appId in as a constant, and never read `APP_ID` yourself.** `getCurrentAppId()` validates that the value is an agent-platform UUID; a raw read gives you whatever is there. The MonoApp scaffold defaults `APP_ID` to the deployment *session id* (`DB_SCHEMA` and `APP_ID` are normally the same, e.g. `session-xyz789`) or to the literal `monoapp` — either passes the server's charset check, is accepted, and then makes the lookup miss every time: no App name, no icon, no Open button, and no error anywhere.
  - **If `getCurrentAppId()` throws, that is the bug surfacing early.** It means the runtime is still injecting a session id instead of the real app id — a platform-side fix. Do not work around it by hard-coding a UUID or falling back to `process.env.APP_ID`.

```typescript
import { getCurrentAppId, getCurrentProjectId } from '@tier0/sdk';

// Both getters are server-side: they read platform-injected env vars,
// which a browser bundle cannot see.
const sender = {
  type: 'app',
  id: getCurrentAppId(),                      // validated agent-platform UUID
  meta: { projectId: getCurrentProjectId() }, // no name: the server looks the real one up
};
```

## link: the Open button target

Populates the **Open button** on the recipient's in-app message. Self-reported navigation hint — like `sender`, **never base any security decision on it**; the server validates the shape only, not that the destination exists or that the recipient may view it.

| Form | Example | How it opens |
|---|---|---|
| `/`-prefixed path, message from a **complete `app` sender** (`id` + `meta.projectId`) | `/alerts/tank01` (your App's own route) | Inside the platform shell: the App launch page opens **your App on that screen** — the path is forwarded into the App's iframe, relative to the App's base URL |
| `/`-prefixed path, message from an **`other` sender** | `/uns` | A platform route, inside the shell; the client prepends the recipient's workspace |
| Absolute URL | `https://oee-monitor.example.com/alerts/tank01` | **`https://` only** (`http://` is rejected as cleartext; `javascript:` / `data:` and other pseudo-schemes are blocked by the same prefix allowlist). Opens in a **new tab** with `noopener`, outside the platform shell |

### What the server checks

**A malformed `link` fails the whole send** — 400 `INVALID_REQUEST`, no message is created. The cost of a bad link is not "no Open button", it is "the notification never went out".

**An empty string is not malformed.** `link: ""` is treated exactly like omitting the field — accepted, no navigation from this source — so a form that serializes an untouched optional input as `""` needs no special handling. It is also excluded from the idempotency digest, so it cannot conflict with a pre-`link` request replayed inside the 24h window.

For a non-empty value the server checks the **shape only**, in this order (first match wins):

- Must start with `https://` (with at least one character after it) or `/`
- **Protocol-relative `//host/path` is rejected** — it has a leading slash but resolves cross-origin, so it does not count as an in-app path
- **Backslashes are rejected outright** — the WHATWG URL spec normalizes them to `/` in special-scheme URLs, so `/\host` resolves exactly like `//host`. Percent-encode a legitimate backslash as `%5C`
- ≤500 characters
- No whitespace, control, or invisible format characters. Classified by Unicode category, **not just ASCII**: a plain space, U+00A0 no-break space, U+3000 ideographic space, U+2028 line separator, **U+200B zero-width space and U+FEFF BOM** are all rejected. Percent-encode a space as `%20`

Everything else is rejected by the prefix rule: `http://` (cleartext), `javascript:` / `data:` pseudo-schemes, `//evil.com`, a bare `https://`, and a path that forgot its leading slash (`alerts/tank01`).

**What it does *not* check** — the shape is the whole contract:

- **No host allowlist.** `https://anything-at-all.example.com/x` passes; the recipient leaves the platform
- **No route existence check.** `/a/route/that/does/not/exist` passes and 404s on click
- **No permission check.** A link into something the recipient cannot see passes and 403s on click

That is what "self-reported navigation hint" means in practice: getting it right is entirely the caller's job.

Omitting `link` is normal and safe. There are **two** navigation sources, and the button is rendered when either one is complete:

1. `link` — this field
2. `sender.type=app` carrying **both** `id` (appId) **and** `meta.projectId` — offers "open the sending App". An incomplete pair is not a source: without `projectId` the app-detail URL cannot be built, so no button

With neither source present the message renders no Open button at all.

### Writing the path

What a `/`-prefixed path means depends on **who the sender is**. The web client treats a path on a message from a complete `app` sender as a route **inside that App**; only messages without an app identity have their paths resolved against the platform.

**A. A screen inside your own App → your own router path.** Send the path exactly as your App's router knows it:

```typescript
link: '/alerts/tank01',
```

Because the message carries your **complete** app sender (`id` + `meta.projectId` — the same pair everything else depends on), the web client opens the platform's App launch page and forwards the path into the App's iframe, resolved **relative to the App's own base URL**. The leading `/` is required by the server's validation (a slashless `alerts/tank01` fails the whole send with 400) and does not mean your App's site root. The recipient stays inside the platform shell, on that exact screen. Do not prefix it with `/ws/<workspaceId>` and do not build an absolute URL from `window.location` — the path is yours, the surrounding address is the platform's job.

⚠️ With an **incomplete** app sender (missing `meta.projectId`) the client cannot build the App launch target, so the same path silently degrades to a platform route — `/ws/<workspace>/alerts/tank01`, a 404. One more failure mode of dropping `projectId`.

An absolute `https://` URL also works but opens in a **new tab** (`noopener`), outside the platform shell — use it for destinations that genuinely live elsewhere, not for your own screens.

**B. A platform page (UNS, Flows, …) → a `/`-prefixed path, from a sender with no app identity.** For an `other` sender (or no sender), a path is resolved against the platform: the client prepends the workspace, so write `/uns`, never `/ws/1/uns` — a hard-coded `/ws/1` pins every recipient to workspace 1 (same guardrail as `meta.projectId`, see the root [`SKILL.md`](../../SKILL.md)).

⚠️ **An `app` sender cannot use a `/`-prefixed `link` to reach a platform page.** The app identity wins: the path is forwarded into your App, so `/launchpad` would look for a `/launchpad` route *inside your App*. If an App genuinely needs to send the recipient to a platform page, the only form left is an absolute `https://` platform URL — accepting the new-tab behaviour — or no `link` at all (the Open button then opens your App's entry screen).

**An undeployed App gets no Open button.** If the sending App is not deployed (stopped, deleted), the web client suppresses the button entirely rather than navigating into a dead iframe — another reason not to treat the button as guaranteed.

**Do not smuggle the path through `sender.meta`.** The web client also reads `sender.meta.path` as a last-resort fallback for callers that predate `link`, but it is exactly that — a fallback, last in priority, absent from the contract. It even outranks the entry-screen fallback: a stored app message with `meta.path` and no `link` opens that path, not the App's entry screen. New code sends the top-level `link`.

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
2. `sender`: `type: 'app'` + `id` from `getCurrentAppId()` + `meta.projectId` from `getCurrentProjectId()`, both resolved at runtime (server-side code). No `name` — the server looks the real App name up
3. mode: `NODE_ENV === 'production' ? 'live' : 'test'`
4. Recipient: selected by a human-readable member picker or resolved from a trusted business relation; `recipientUserId` remains internal and is never typed by the user
5. Channels: map the user's wording with the decision ladder in [`../SKILL.md`](../SKILL.md). Generic notification → explicit `['web', 'mobile']`; explicit inbox-only → `[]`; never generate `desktop`

## Examples

The examples assume `recipientUserId` came from the selected member option or a trusted business relation. It is never collected through a raw-ID field.

### 1. Explicit inbox-only message (record only, no interruption)

```typescript
import { notificationsApi } from '@tier0/sdk/openapi';

const resp = await notificationsApi.openapiv1notificationssend({
  recipientUserId: selectedRecipient.value,
  type: 'inbox',
  title: 'Weekly inventory report ready',
  content: 'The weekly inventory report is available on the Reports page.',
  idempotencyKey: 'inventory-weekly-2026W35',
  channels: [], // the user explicitly requested inbox only
  // an `other` sender has nothing to look up, so it must name itself
  sender: { type: 'other', name: 'Inventory reporter' },
});
console.log(resp.messageId, resp.status); // "71234..." "accepted"
```

### 2. Generic notification with all reminders + sender (App scenario)

```typescript
import { getCurrentAppId, getCurrentProjectId } from '@tier0/sdk';

const resp = await notificationsApi.openapiv1notificationssend({
  recipientUserId: selectedRecipient.value,
  type: 'inbox',
  title: 'Equipment alert',
  content: 'Mixing tank 01 on line 1 exceeded temperature limit (82°C). Immediate action required.',
  idempotencyKey: 'alert-tank01-overtemp-20260825T1500',
  mode: process.env.NODE_ENV === 'production' ? 'live' : 'test',
  // Generic "notify" uses the normal reminder scope. The same array represents
  // an explicit request for all terminal reminders.
  channels: ['web', 'mobile'],
  // Open button target: this App's OWN router path. Because the message carries an app
  // sender, the client forwards it into the App's iframe — see "Writing the path".
  link: '/alerts/tank01',
  sender: {
    type: 'app',
    id: getCurrentAppId(), // validated at runtime — never a hard-coded UUID or a raw APP_ID read
    // no name: the server resolves the real App name from (projectId, appId)
    meta: { projectId: getCurrentProjectId() }, // runtime value — correct even after the App is imported elsewhere
  },
});
```

For an explicitly narrower reminder scope, change only the channel array:

```typescript
channels: ['web'];   // Web & Desktop only; never use 'desktop'
channels: ['mobile']; // Mobile only
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
  channels: ['web', 'mobile'], // generic notification = normal reminder scope
  sender: { type: 'other', name: 'Order service' }, // an `other` sender must name itself
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
