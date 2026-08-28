---
name: tier0-sdk-system
version: 1.1.0
description: "Tier0 SDK system and credential-diagnostic operations for TypeScript/JavaScript. Before using this Skill, first read tier0-sdk for shared SDK version, configuration, runtime, and layering rules. Use when diagnosing a supported API key's credential context, validating Tier0 service connectivity and capabilities, obtaining broker/service information, or reloading the gateway through @tier0/sdk/openapi. Do not use whoami to identify a person using an App; App API keys are business credentials, not end-user identities."
metadata:
  requires:
    npm: ["@tier0/sdk"]
---

# Tier0 SDK — System

**Before starting, read the root SDK Skill at [`../tier0-sdk/SKILL.md`](../tier0-sdk/SKILL.md).**

## References

| Task | Read |
|---|---|
| Diagnose a supported API key's credential context; never identify an App user | [`references/whoami.md`](references/whoami.md) |
| Validate connectivity and inspect capabilities/broker info | [`references/info.md`](references/info.md) |
| Reload gateway | [`references/reload.md`](references/reload.md) |

Use `whoami` only for credential diagnostics where the key type supports it. App API keys are shared business credentials and cannot represent the current App user; use the App authentication/session layer instead. Use read-only info calls for connectivity diagnostics before changing configuration. Treat gateway reload as a state-changing operation and execute it only when the user requests or authorizes it.
