---
name: tier0-sdk-system
version: 1.0.0
description: "Tier0 SDK system and identity operations for TypeScript/JavaScript. Before using this Skill, first read tier0-sdk for shared SDK version, configuration, runtime, and layering rules. Use when checking the current API-key identity, validating Tier0 service connectivity and capabilities, obtaining broker/service information, or reloading the gateway through @tier0/sdk/openapi."
metadata:
  requires:
    npm: ["@tier0/sdk"]
---

# Tier0 SDK — System

**Before starting, read the root SDK Skill at [`../SKILL.md`](../SKILL.md).**

## References

| Task | Read |
|---|---|
| Check current identity/API-key context | [`references/whoami.md`](references/whoami.md) |
| Validate connectivity and inspect capabilities/broker info | [`references/info.md`](references/info.md) |
| Reload gateway | [`references/reload.md`](references/reload.md) |

Use read-only identity/info calls for diagnostics before changing configuration. Treat gateway reload as a state-changing operation and execute it only when the user requests or authorizes it.
