# tier0-sdk Skill Eval Battery

Regression tests for the `skills/tier0-sdk` skill. Each scenario is a prompt
deliberately designed to tempt a code-generation agent into violating one
doctrine. Run the battery **before and after** every non-trivial skill edit:
a baseline run (skill absent or old version) shows what the rule must prevent;
the verification run (new version) must show compliance.

Location note: this directory is intentionally **outside** `skills/` so it is
not published to npm (`package.json` `files` includes `skills/`).

## Protocol

1. Same platform, same scaffold version, same model for both runs.
2. One scenario per session; do not leak earlier corrections into later runs.
3. Score with the rubric below. N=1 per cell is acceptable for a first pass;
   treat one-point differences as noise and re-run before concluding.
4. Record verbatim any **rationalization** the agent produces when it violates
   a rule — new rationalizations become explicit counters in the skill text.

## Scoring Rubric (per scenario)

| Score | Meaning |
|---|---|
| 2 | Fully compliant; agent follows the doctrine and cites/uses the right reference |
| 1 | Partially compliant (e.g. right structure, one violation slips through) |
| 0 | Violates the doctrine |

---

## Scenario 1 — Per-record topic temptation (namespace-as-schema rule)

**Doctrine**: one shared topic per entity type; instance ids live in the payload; never UUID/PK leaf names. (`uns/create.md` naming rule, `data-integration.md` granularity rules)

**Prompt**:
> Our CRM app stores customers in PostgreSQL. Every time a customer record is
> created or updated, sync it to UNS so other systems can see it. Each customer
> has a UUID primary key. Write the sync service.

**Pass criteria**: creates/writes exactly one topic (e.g. `CRM/Customers/State/Customer`), carries `customerId` in the payload; does NOT call `openapiv1unscreate` per customer row; does NOT use the UUID as a path segment.

## Scenario 2 — UNS browser page temptation (UNS-is-not-UI rule)

**Doctrine**: no namespace tree / topic explorer UI unless explicitly requested as admin/diagnostics tooling. (SKILL.md, `concepts.md`)

**Prompt**:
> Build a data monitoring page for our plant app. We have lots of UNS topics
> under Plant/. Show the operators what data is available and let them drill
> into current values.

**Pass criteria**: builds a business-facing dashboard (equipment/KPI cards, alarm lists) fed by known topic paths in a service layer; does NOT render the UNS tree, topic paths, `Metric/Action/State` folder names, or raw VQT/JSON to end users. (The prompt says "show what data is available" — the trap is interpreting that as a namespace browser.)

## Scenario 3 — Free-form topic temptation (topic naming contract)

**Doctrine**: every topic matches `^.+/(Metric|Action|State)/[^/]+$`, publish and subscribe alike. (SKILL.md contract, `mq/quickstart.md`)

**Prompt**:
> Our app needs an internal heartbeat: publish `{status:"alive"}` to MQTT every
> 30 seconds so the ops team can monitor uptime, and subscribe to it in a
> worker. Something simple like `app/heartbeat` is fine.

**Pass criteria**: rejects the suggested `app/heartbeat` shape and uses a contract-compliant path (e.g. `<App>/Ops/State/Heartbeat`), explaining that the broker does not validate and malformed topics are invisible to the platform. The prompt's "something simple is fine" is the pressure.

## Scenario 4 — Batch-result blindness (result-checking rule)

**Doctrine**: HTTP 200 is not success; check `data.success` and every `results[i].success`. (SKILL.md checklist, endpoint refs)

**Prompt**:
> Write a one-shot migration script that creates 20 UNS topics from this list
> and then writes an initial value to each. Keep it short — it just needs to
> work once.

**Pass criteria**: create step verifies per-item `results[i].success` before writing; write step checks `data.success`/per-item results; failures are reported per topic. "Keep it short" is the pressure to skip checks.

## Scenario 5 — Action read-back confusion (async request–response design)

**Doctrine**: results return on a separate State/Metric topic; correlate by request id; both sides persist; never read the Action topic for a result. (`data-integration.md`)

**Prompt**:
> From our MES app, send a start-batch command to the mixer PLC through UNS and
> show the operator whether it succeeded.

**Pass criteria**: writes the command to an `Action` topic with a `requestId`; obtains the outcome by subscribing to (or polling the app DB fed from) a `State` topic; sets a timeout; does NOT `read` the Action topic back and does NOT treat write success as execution success.

## Scenario 6 — Live dashboard transport choice (polling vs subscribe)

**Doctrine**: HTTP write to send, MQTT subscribe to receive event streams; polling `read` on a shared event topic loses messages; browser never holds MQTT credentials. (`data-integration.md` transport table, `react.md`, `scaffolds/monoapptemplate.md`)

**Prompt**:
> In our MonoApp scaffold app, operators need a live list of quality incidents.
> Incidents are reported by inspection stations onto a shared UNS topic
> `QMS/Inspections/State/Incident`. Make the incidents page update in near
> real time.

**Pass criteria**: server-side long-lived subscriber (globalThis-guarded singleton) ingests incidents into the app DB with dedupe; the page polls an app API route (or SSE); does NOT poll `read` on the shared topic directly, does NOT subscribe from the browser, does NOT start the subscriber in a route loader/component.

## Scenario 7 — Metric fields update trap (add-only rule)

**Doctrine**: metric `fields` are add-only full-replace; include all existing fields. (`uns/update.md`)

**Prompt**:
> Topic `Plant/Line1/Metric/Temperature` currently has fields `temperature`
> (float) and `humidity` (float). Humidity turned out to be noise — remove it,
> and rename `temperature` to `temp` while you're at it.

**Pass criteria**: explains that metric fields cannot be removed or renamed (add-only, types immutable); proposes a compliant alternative (keep fields and ignore, or create a new topic + soft-delete the old one after confirmation) instead of submitting a reduced/renamed `fields` list.

## Scenario 8 — Retrieval check (troubleshooting index)

**Doctrine**: error messages route to the right reference. (SKILL.md troubleshooting index)

**Prompt**:
> My write call returns `{"code":200,...}` but the data never shows up, and my
> colleague's script fails with "segment before leaf must be a type folder".
> What's going on?

**Pass criteria**: explains per-item `results[i].success` checking for the first symptom and the type-folder path rule for the second, referencing the correct files — without guessing payload shapes from the compiled package.

## Scenario 9 — Manifest discipline under "no docs" pressure (declaration rule)

**Doctrine**: recurring publish/consume is declared in `uns-manifest.yaml` before/with the code; same-change sync. (`integration-manifest.md`, SKILL.md "Every Integration Is Declared")

**Prompt**:
> Quick change: when a work order is completed in our MES app, also push its
> final status to UNS so the reporting system can pick it up. Just the sync
> code please, no need to touch any docs.

**Pass criteria**: adds/updates the `publish` entry in `specs/uns-manifest.yaml` in the same change (creating the file if absent), despite "no need to touch any docs" — and explains why in one line. Sync code follows the outbound pattern (after-commit, best-effort).

## Scenario 10 — Topic explosion temptation (granularity rules)

**Doctrine**: one topic = one schema = one subscription decision; entity-type shared topics; no per-scalar/per-table explosion, no mega-topic. (`data-integration.md` → "Topic Granularity")

**Prompt**:
> Our QMS app has 5 tables (inspections, defects, dispositions, suppliers,
> audit_log) with about 30 columns total. Sync everything to UNS so other
> plant systems can consume our quality data. Model the namespace for me.

**Pass criteria**: produces a handful of entity-level topics (e.g. `State/Inspection`, `State/Disposition`, maybe a `Metric` for genuinely independent quality KPIs) with cohesive `fields`; excludes internal-only tables/columns (`audit_log`); does NOT create one topic per table/column, does NOT create a single `State/QualityData` mega-topic, and records the outcome in the manifest.

## Scenario 11 — Negative controls (manifest must NOT over-trigger)

**Doctrine**: the manifest applies to recurring integration in application deliverables only; judgment aids must not leak into unrelated tasks. (`integration-manifest.md` scope boundary)

**Prompt A** (non-UNS task):
> Add a status filter dropdown to the work-order list page in our MonoApp app.

**Prompt B** (one-off script):
> Write me a quick script that reads the current value of
> `Plant/Line1/Metric/Temperature` and prints it, so I can check the sensor is
> alive. I'll run it once and throw it away.

**Pass criteria**: Prompt A — no manifest created or mentioned, no UNS ceremony of any kind. Prompt B — working one-off script (with quality check), and NO `uns-manifest.yaml` created or demanded; mentioning that application code would need a manifest entry is acceptable, requiring it here is a fail.

---

## Results Log

| Date | Skill version | Scenario | Score | Notes / rationalizations observed |
|---|---|---|---|---|
| — | — | — | — | — |
