---
name: tier0-sdk-openapi-launchpad-get-members
version: 0.1.0
description: "POST /openapi/v1/launchpad/:projectName/getMembers - query project members and roles"
---

# getMembers - `POST /openapi/v1/launchpad/:projectName/getMembers`

Query members of one Launchpad project. The API key must have `uns:read` permission or full access.

## SDK Call

`projectName` is a path parameter. Put filters and pagination in `body`; the SDK URL-encodes the project name.

```typescript
import { launchpadApi } from '@tier0/sdk/openapi';

const result = await launchpadApi.openapiv1launchpadgetmembers({
  projectName: 'Factory Operations',
  body: {
    roleKey: 'operator',
    roles: ['builder'],
    updatedAtStart: '2026-07-01T00:00:00Z',
    updatedAtEnd: '2026-07-17T23:59:59Z',
    page: 1,
    size: 20,
  },
});

if (result.code !== 200 || !result.data) {
  throw new Error(result.msg ?? `getMembers failed with code ${result.code}`);
}

for (const member of result.data.list) {
  console.log(member.userId, member.userName, member.roles);
}
```

## Request

| Field | Location | Type | Required | Description |
|---|---|---|---|---|
| `projectName` | path | `string` | yes | Exact project name, or project UUID when the name is ambiguous |
| `roleKey` | body | `string` | no | Match one role key |
| `roles` | body | `string[]` | no | Match any listed role key |
| `updatedAtStart` | body | `string` | no | Inclusive RFC 3339 lower bound |
| `updatedAtEnd` | body | `string` | no | Inclusive RFC 3339 upper bound; a whole-second value includes that second |
| `page` | body | `number` | no | Page number, default `1` |
| `size` | body | `number` | no | Page size, default `20`, maximum `100` |

`roleKey` and `roles` are combined as an OR filter after trimming and case normalization. A matching member still returns all assigned roles, not only the roles that matched the filter.

Use `{}` as `body` when no filters are needed.

## Response

Cloud business errors can use HTTP 200, so always check `code` and `data`. The SDK returns the wire envelope below:

```typescript
type GetMembersResponse = {
  code: number;
  msg?: string;
  data?: {
    list: Array<{
      memberId: number;
      userId: string;
      userName?: string;
      email?: string;
      accessLevel: string;
      roles: Array<{
        roleId: number;
        roleKey: string;
        roleName?: string;
        description?: string;
        memberCount: number;
        apps?: Array<{ appId: number; appName: string }>;
      }>;
      updatedAt?: string;
    }>;
    total: number;
    page: number;
    size: number;
  };
};
```

`memberId`, `roleId`, and `appId` are stable numeric OpenAPI identifiers. Do not derive domain meaning from their numeric values.
