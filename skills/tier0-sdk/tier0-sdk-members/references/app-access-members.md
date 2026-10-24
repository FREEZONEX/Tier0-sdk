---
name: tier0-sdk-openapi-app-access-members
version: 0.2.0
description: "Cloud App access members by App ID, without Project ownership"
---

# Cloud App access members

Use `POST /openapi/v1/apps/access-members/list`. The SDK no longer exports the retired Cloud Launchpad Project member endpoint. This does not change Enterprise server permissions or the workspace-wide platform member endpoint.

```typescript
import { appsApi } from '@tier0/sdk/openapi';

const result = await appsApi.openapiV1Appslistaccessmembers({
  appId: currentAppId,
  roleKeys: ['operator'],
  page: 1,
  size: 20,
});
// This endpoint's public response is the AppAccessMembersListResp itself.
const options = result.list.map(member => ({
  value: member.userId,
  label: member.userName || member.email || 'Unnamed member',
  roles: member.roles.map(role => role.roleName),
}));
```

Use the actual App ID, including for root Apps. Never infer an App from a Folder, substitute a Project ID, or fall back to the retired route. The current API key/App binding and server permissions still determine access; an exported SDK method grants no permission.

The required body field is `appId`. Optional filters are `roleKeys`, `grantedAtStart`, `grantedAtEnd`, `page`, and `size`. Granted-at bounds are integer milliseconds (closed intervals, second precision), not RFC3339 strings. The response includes `appId`, `published`, `allActiveMembers`, `productionVersionId` when present, `roles`, `list`, `total`, `page`, and `size`. Respect the server's numeric flags; do not turn `1`/`2` into invented boolean contracts.

Display names, emails and roles; keep user IDs internal. If member access is unavailable, report the authorization/configuration error; do not ask users to paste IDs. This endpoint does not document a keyword filter; filter loaded display fields when needed.
