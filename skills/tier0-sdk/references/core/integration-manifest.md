---
name: tier0-sdk-integration-manifest
version: 0.1.0
description: "UNS integration manifest (uns-manifest.yaml): declaring every recurring publish/consume an application has with UNS — format, declare-before-implement discipline, consumer discovery workflow, staleness rules."
---

# UNS Integration Manifest

Every application that has a **recurring** integration with UNS keeps a manifest
file — `uns-manifest.yaml` — declaring what it publishes and what it consumes.
The manifest is the app's integration contract: anyone (humans, agents, other
teams) can answer "what does this app emit?" and "what does this app depend on?"
without reading code.

## When This Applies — and When It Does Not

**Applies to**: application deliverable code with ongoing UNS I/O — services
that publish on business events, long-lived subscribers, pages that read
current values or history.

**Does NOT apply to**: one-off scripts, migration/verification scripts,
diagnostics, dev-time exploration (`browse`/`search` while investigating), or
projects that do not touch UNS at all. Do not create a manifest, or mention one,
for tasks outside the boundary. The manifest is bookkeeping for durable
integration surface, not ceremony for every SDK call.

## File Location

| Environment | Path |
|---|---|
| MonoApp / App Builder scaffold apps | `specs/uns-manifest.yaml` (next to `specs/spec.md`) |
| Other projects | `docs/uns-manifest.yaml`, or repo root if there is no `docs/` |

## Format

```yaml
version: 1
app: CRM                     # business namespace root, from the spec (never package.json)

publish:
  - topic: CRM/Sales/State/Order
    type: state              # metric | action | state — must match the path's type folder
    fields:
      - { name: orderId,   type: string }
      - { name: status,    type: string }
      - { name: total,     type: float }
      - { name: updatedAt, type: int }
    trigger: after order create/status transition commits
    example: '{"orderId":"SO-1001","status":"confirmed","total":1280.5,"updatedAt":1782108520121}'
    notes: outbound mirror; app DB is source of truth

consume:
  - topic: WMS/Inventory/State/TransferOrder
    type: state
    fields_observed:         # what was seen at discovery time — a snapshot, not authority
      - { name: requestId, type: string }
      - { name: status,    type: string }
      - { name: updatedAt, type: int }
    usage: server subscriber ingests into transfers table, dedupe by requestId
    quality_policy: drop events older than stored updatedAt
    discovered: 2026-07-10 via browse include_metadata
  - topic: Plant/+/Metric/Temperature   # subscribe patterns are declared too
    type: metric
    usage: line-overview dashboard, on-demand read
    quality_policy: render only quality == Good
    discovered: 2026-07-10 via search
```

Every `topic` value must satisfy the naming contract
(`^.+/(Metric|Action|State)/[^/]+$`, wildcards allowed in consume patterns).

## Rules

These are mechanical rules — they hold whenever the manifest applies:

1. **Declare before implement.** A topic enters the manifest before (or in the
   same change as) the code that creates/writes/publishes/subscribes it. Never
   leave the manifest for "later documentation".
2. **Same-change sync.** Adding, renaming, or removing UNS I/O in code updates
   the manifest in the same change.
3. **Bidirectional completeness.** Every literal topic string (and subscribe
   pattern) in application code appears in the manifest; every manifest entry
   has a corresponding implementation. This rule is designed to become an
   automated contract check — keep the YAML parseable.
4. **Create from the manifest.** When provisioning topics
   (`openapiv1unscreate`), derive the node tree and `fields` from the manifest
   entry, so the declared schema and the created schema cannot drift.

## Consumer Workflow (integrating against an existing UNS)

Three steps, in order:

1. **Discover (dev time)**: use `browse`/`search` with `include_metadata` to
   find the topics the feature needs and read their `fields` — see
   `references/openapi/uns/browse.md` / `search.md`.
2. **Pin**: record each chosen topic in `consume` with its observed schema,
   usage, quality policy, and discovery date.
3. **Runtime reads declared paths only**: application code reads/subscribes the
   pinned paths from the service layer. No runtime discovery — `browse`/`search`
   do not belong in request paths or page loads.

### The manifest is observation, not authority

`fields_observed` records what the upstream schema looked like on the
`discovered` date. The live UNS is the source of truth and upstream schemas
evolve. When a read/write fails with a schema-shaped error, or payloads stop
matching expectations: re-verify against live UNS (`read`/`browse` with
`include_metadata`), fix the code, and update the manifest entry — do not "fix"
code to match a stale manifest.

## Granularity Review

Before adding a `publish` entry, check it against the topic granularity
criteria in `references/core/data-integration.md` → "Topic Granularity". As a
review signal (not a quota): a typical application publishes single digits to
about a dozen topics — one shared `State` per entity type, a `Metric` per
genuinely independent measurement, an `Action` per command type. If the publish
list grows well beyond that, re-check each entry against the split/merge
criteria before proceeding. Per-instance topics for small, long-lived named
sets (equipment, stations) are legitimate and do not count toward this signal.
