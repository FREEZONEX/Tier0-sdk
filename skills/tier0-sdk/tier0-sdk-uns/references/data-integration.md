# External collection into UNS

Choose an existing target Collection or create its record schema, configure and enable the Source, then bind its latest revision. A timer Stream declares api.uns.use({collectionId,access:"write"}) and writes mapped records with stable upstream keys. Validate and deploy, inspect a real run, then read target records. Returning an HTTP response, sample previews and buffered writes do not establish persistence. Use Source/Stream operations from the current SDK contract; retired Flow and Control interfaces have no aliases.

Read the generated UnsV2Request type and the current operation contract before supplying payloads. Authentication, current scope and resource checks remain authoritative.

Source creation/update/state changes and Stream document creation/update/deployment default `dryRun` to false; a separate preview is optional. SQL Source creation accepts inline `{ kind: "usernamePassword", material: { username, password } }` credentials with an idempotencyKey. Omit credentials.method and keep secrets out of config.endpoint; Vault stores them atomically with the Source. Inspect the deployed release and timer run, then read the Collection records.
