---
name: tier0-sdk-openapi-launchpad-get-members
version: 0.2.0
description: "POST /openapi/v1/launchpad/:projectName/getMembers - query project members and roles, including human-readable member selection"
---

# getMembers - `POST /openapi/v1/launchpad/:projectName/getMembers`

Query members and their assigned roles in one Launchpad project. The API key must have `uns:read` permission or full access.

## SDK Call

Pass the exact project name or project ID in `projectName`. Do not pass a resource name with a `projects/` prefix. The SDK URL-encodes the value.

```typescript
import { getCurrentProjectId } from '@tier0/sdk';
import { launchpadApi } from '@tier0/sdk/openapi';

const result = await launchpadApi.openapiv1launchpadgetmembers({
  projectName: getCurrentProjectId(),
  body: {
    roles: ['builder', 'operator'],
    updatedAtStart: '2026-07-01T00:00:00Z',
    updatedAtEnd: '2026-07-20T23:59:59Z',
    page: 1,
    size: 20,
  },
});

if (result.code !== 200 || !result.data) {
  throw new Error(result.msg ?? `getMembers failed with code ${result.code}`);
}

const options = result.data.list.map(member => ({
  value: member.userId, // internal only; submit this to APIs that require userId
  label: member.userName || member.email || 'Unnamed member',
  email: member.email,
  roles: member.roles.map(role => role.roleName || role.roleKey),
}));
```

## User-facing selection

This endpoint has no name/email keyword filter. For a project-scoped member picker, paginate the project members, then filter the loaded `userName` and `email` display fields in the application. Display the person's name, email, and relevant role names; keep `userId` and `memberId` internal.

Never render a free-text “User ID” field or ask an end user to paste an identifier. When several members have similar names, show their email and roles for disambiguation. If the member query is unavailable because the API key lacks permission, surface an application configuration error instead of falling back to raw ID entry.

## Request

| Field | Location | Type | Required | Description |
|---|---|---|---|---|
| `projectName` | path | `string` | yes | Exact project name or project ID |
| `roleKey` | body | `string` | no | Match one role key |
| `roles` | body | `string[]` | no | Match any listed role key |
| `updatedAtStart` | body | `string` | no | Inclusive RFC3339 lower bound |
| `updatedAtEnd` | body | `string` | no | Inclusive RFC3339 upper bound |
| `page` | body | `number` | no | Page number, default `1` |
| `size` | body | `number` | no | Page size, default `20`, maximum `100` |

`roleKey` and `roles` are combined as an OR filter. A matching member still returns all assigned roles. Use an empty object as `body` when no filters are needed.

## Response

Cloud business errors may use HTTP 200, so check `code` and `data` before consuming the result.

```typescript
type GetMembersResponse = {
  code: number;
  msg?: string;
  data?: {
    list: Array<{
      memberId: string;
      userId: string;
      userName?: string;
      email?: string;
      roles: Array<{
        roleId: string;
        roleKey: string;
        roleName?: string;
        description?: string;
        memberCount: number;
        apps?: Array<{
          appId: string;
          appName: string;
        }>;
      }>;
      updatedAt?: string;
    }>;
    total: number;
    page: number;
    size: number;
  };
};
```

Identifier fields are strings in both Cloud and Enterprise responses and must remain strings in application code. They are transport and relation values, not user-facing labels. The public response does not expose `accessLevel`.

Use an explicit project name or ID only when intentionally querying a different project. For the app's own project, always use `getCurrentProjectId()` so Cloud exports continue to work after import into Enterprise.
