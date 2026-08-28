---
name: tier0-sdk-members
version: 1.1.0
description: "Tier0 SDK member and role queries for TypeScript/JavaScript. Before using this Skill, first read tier0-sdk for shared SDK version, configuration, runtime, and layering rules. Use when querying members and roles for one Launchpad project or querying platform/workspace users, building human-readable member selectors, and resolving internal user identifiers through @tier0/sdk/openapi. Users select people by name, nickname, email, and role; application code keeps IDs internal."
metadata:
  requires:
    npm: ["@tier0/sdk"]
---

# Tier0 SDK — Members

**Before starting, read the root SDK Skill at [`../tier0-sdk/SKILL.md`](../tier0-sdk/SKILL.md).**

## Scope Routing

| Need | Read |
|---|---|
| Members and roles for one Launchpad project | [`references/project-members.md`](references/project-members.md) |
| Workspace-wide users, roles, status, keyword, and update-time filters | [`references/platform-members.md`](references/platform-members.md) |

Use `getCurrentProjectId()` for generated project-scoped applications when the project reference requires the current runtime project. Do not substitute a project-member query for a workspace-wide platform query or vice versa.

## User-facing member selection

- Present people by name or nickname, with email and relevant roles when needed to distinguish matching results.
- Keep `userId`, `memberId`, and `roleId` as internal option values or relation keys. Never render a free-text ID field or ask an end user to find, paste, or understand an identifier.
- Search by human identity. The Workspace endpoint supports `keyword`; the project endpoint does not, so paginate project members and filter the loaded display fields in the application.
- If several people match, let the user choose from human-readable candidates. Never guess and never expose IDs as the differentiator.
- If member-read permission is unavailable, report an application configuration problem to its owner or administrator. Do not use raw ID entry as a fallback.

## Final Checklist

1. The selected endpoint matches project scope versus workspace scope.
2. Runtime project context is used instead of a hard-coded project identifier.
3. User-facing choices show human identity fields; identifiers remain internal.
4. Required authorization scope is handled as documented, without falling back to user-entered IDs.
