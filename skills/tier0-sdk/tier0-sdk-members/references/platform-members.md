---
name: tier0-sdk-openapi-platform-get-members
version: 0.2.0
description: "POST /openapi/v1/platform/getMembers - query Workspace members and roles, including human-readable member selection"
---

# getMembers - `POST /openapi/v1/platform/getMembers`

Query users in the API key's Workspace together with their platform roles. This endpoint has no project path parameter.

Cloud API keys need the `uns:read` resource key. Enterprise API keys need the `launchpad.view` resource; all standard read-only, writer, and full-access keys include the required read resource.

## SDK Call

```typescript
import { platformApi } from '@tier0/sdk/openapi';

const result = await platformApi.openapiv1platformgetmembers({
  keyword: 'alice',
  roles: ['builder', 'operator'],
  statuses: ['active'],
  updatedAtStart: '2026-07-01T00:00:00Z',
  updatedAtEnd: '2026-07-20T23:59:59Z',
  page: 1,
  size: 20,
});

if (result.code !== 200 || !result.data) {
  throw new Error(result.msg ?? `getMembers failed with code ${result.code}`);
}

const options = result.data.list.map(member => ({
  value: member.userId, // internal only; submit this to APIs that require userId
  label: member.nickName || member.userName || member.email || 'Unnamed member',
  email: member.email,
  roles: member.roles.map(role => role.roleName || role.roleKey),
}));
```

## User-facing selection

Use `keyword` with a name, nickname, or email entered in a member search box, and normally set `statuses: ['active']` when choosing a recipient or assignee. Display `label`, email, and relevant role names. Keep the option `value` internal; never label it “User ID”, show it as a disambiguator, or let an end user type it.

When multiple results match, present the human-readable options and require an explicit selection. If the member query is unavailable because the API key lacks permission, surface an application configuration error instead of falling back to an ID field.

## Request

All fields are optional.

| Field | Type | Description |
|---|---|---|
| `keyword` | `string` | Case-insensitive substring of username, nickname, or email. The API also accepts an exact numeric ID for trusted internal lookups; do not expose numeric-ID search to end users |
| `roleKey` | `string` | Match one role key |
| `roles` | `string[]` | Match any listed role key |
| `statuses` | `string[]` | `active` or `disabled` |
| `updatedAtStart` | `string` | Inclusive RFC3339 lower bound |
| `updatedAtEnd` | `string` | Inclusive RFC3339 upper bound |
| `page` | `number` | Page number, default `1` |
| `size` | `number` | Page size, default `20`, maximum `100` |

`roleKey` and `roles` are combined as an OR filter. Matching users still return all assigned roles. In Cloud, built-in public role keys are `owner`, `builder`, and `operator`; `admin` and `member` remain accepted as filter aliases. Enterprise keeps its stored role keys and names unchanged.

The effective `updatedAt` is the latest update time among the user, Workspace membership, and assigned roles.

## Response

```typescript
type PlatformGetMembersResponse = {
  code: number;
  msg?: string;
  data?: {
    list: Array<{
      userId: string;
      userName?: string;
      nickName?: string;
      email?: string;
      status: 'active' | 'disabled';
      roles: Array<{
        roleId: string;
        roleKey: string;
        roleName?: string;
        description?: string;
      }>;
      updatedAt: string;
    }>;
    total: number;
    page: number;
    size: number;
  };
};
```

User and role identifiers are strings and must remain strings in application code. They are transport and relation values, not user-facing labels. The endpoint does not return project membership IDs, role-bound applications, member counts, or `accessLevel`.
