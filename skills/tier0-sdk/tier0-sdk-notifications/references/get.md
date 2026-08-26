---
name: tier0-sdk-openapi-notifications-get
version: 0.1.0
description: "POST /openapi/v1/notifications/get - query delivery status of a sent notification"
---

# get - `POST /openapi/v1/notifications/get`

Query a notification's delivery status by messageId. Ownership is anchored to the API key: **only messages sent by this key are visible**.

The API key needs the `notifications:read` resource key — independent from send's `notifications:send`.

## ⚠️ No response envelope

Same as [send](./send.md): success is bare JSON without `{code,msg,data}`; failure is a real HTTP status with `{errorCode,message}` (thrown as `ApiError`, raw JSON in `error.msg`). Parsing pattern at the top of send.md.

## SDK Call

```typescript
import { notificationsApi } from '@tier0/sdk/openapi';

const resp = await notificationsApi.openapiv1notificationsget({ messageId: '7123456789012345' });
```

## Request

| Field | Type | Required | Description |
|---|---|---|---|
| `messageId` | `string` | **yes** | The messageId returned by send, passed verbatim (string — never convert to number) |

## Response

```typescript
// HTTP 200, bare JSON
{
  messageId: string;
  type: string;          // "inbox"
  status: string;        // "accepted" | "sent" | "failed"
  createdAt: string;     // ISO 8601
  completedAt?: string;  // terminal timestamp (present for sent/failed)
  errorCode?: string;    // failure reason code (failed only)
  message?: string;      // failure description (failed only)
}
```

### The three states (explain the boundary to the user)

| status | Means | Does NOT mean |
|---|---|---|
| `accepted` | Order taken; the inbox message is still being created asynchronously | Not created, let alone delivered |
| `sent` | Inbox message created; push jobs handed to the channel providers (browser/phone push services) | **Not that the user saw it** — there are no read receipts; the server cannot know |
| `failed` | Processing failed — read `errorCode` / `message` | — |

Correct wording when reporting to the user: `sent` = "sent", never "received/read".

## Polling guidance

- `accepted → sent` usually completes within seconds. Poll at 1-2s intervals **with a cap** (e.g. 10 attempts); past the cap report "still processing" instead of waiting forever
- Stop at `sent` / `failed` (terminal states never change)
- On `failed`, surface `errorCode` + `message` to the user — never swallow it

```typescript
async function waitForTerminal(messageId: string, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const resp = await notificationsApi.openapiv1notificationsget({ messageId });
    if (resp.status !== 'accepted') return resp; // sent or failed: terminal
    if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, 1500)); // no pointless sleep after the final poll
  }
  return null; // still processing — tell the user honestly
}
```

## Errors

| HTTP | errorCode | Cause | Handling |
|---|---|---|---|
| 404 | `MESSAGE_NOT_FOUND` | **Two possibilities**: ① messageId does not exist or is mistyped; ② the message was sent by a **different API key** (ownership check — "not found" ≠ "message lost") | First verify the current key is the one that sent it, then check the messageId |
| 401 | `INVALID_CREDENTIAL` | API key missing or invalid | Check `TIER0_API_KEY` |
| 403 | `NOTIFICATION_NOT_ALLOWED` | Key lacks the `notifications:read` resource key | Ask an admin (note: being able to send does not imply read — the two resource keys are independent) |
| 400 | `INVALID_REQUEST` | messageId missing or malformed | Pass the original string returned by send |
