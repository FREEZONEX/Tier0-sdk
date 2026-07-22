---
name: tier0-sdk-members
version: 1.0.0
description: "Tier0 SDK member and role queries for TypeScript/JavaScript. Use when querying members and roles for one Launchpad project or querying platform/workspace users, workspace roles, status, keywords, and update-time filters through @tier0/sdk/openapi."
metadata:
  requires:
    npm: ["@tier0/sdk"]
---

# Tier0 SDK — Members

**Before starting, read [`../tier0-sdk/SKILL.md`](../tier0-sdk/SKILL.md).**

## Scope Routing

| Need | Read |
|---|---|
| Members and roles for one Launchpad project | [`references/project-members.md`](references/project-members.md) |
| Workspace-wide users, roles, status, keyword, and update-time filters | [`references/platform-members.md`](references/platform-members.md) |

Use `getCurrentProjectId()` for generated project-scoped applications when the project reference requires the current runtime project. Do not substitute a project-member query for a workspace-wide platform query or vice versa.

## Final Checklist

1. The selected endpoint matches project scope versus workspace scope.
2. Runtime project context is used instead of a hard-coded project identifier.
3. Required authorization scope is handled as documented.
