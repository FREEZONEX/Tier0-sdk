# Cloud App / Stream acceptance source overlay

Eight App fixture files overlay the reviewed Scaffold v11 source ZIP. This example uses the actual frozen root `@tier0/sdk` for browser describe/invoke, publish/subscribe, disposal and visible errors/unknown results. It adds no SDK runtime behavior, backend responses, auth bypass or deployment action.

Supply `Tier0-App-Scaffold-v11-57d6ee4-source.zip` separately. Its SHA-256 must be `0aead594b1693a4b75a3b4cb53f29b1c22c78b81ed9cbd20f87a8a16fcbbfe22`; source commit is `57d6ee405ce0856ca98fdb686840ca6224d910fa`. The base's version 11 / `15ce099` marker stays unchanged. The tool does not download a replacement, resolve a registry package, or build SDK HEAD.

From the SDK root, with Python 3:

```sh
python3 examples/cloud-app-stream-acceptance/reconstruct.py \
  --base-zip /absolute/path/Tier0-App-Scaffold-v11-57d6ee4-source.zip \
  --output-dir /absolute/private/new-acceptance-output
```

The output directory must not exist and must be outside the SDK checkout. It contains `scaffold/`, the source ZIP, SHA-256 sidecar, full member manifest and reconstruction provenance. Every source member, all 32 locked gates and the deterministic ZIP bytes are verified before writing. Default source SHA-256 is `27a1d6e4d864da7cc7049a5137e0e570b098a1eb51a977ae547bcebffdc12def` (264 files). The repository stores only the eight overlay files, not the complete Scaffold or SDK tarball.

Add `--build` to run `npm ci --no-audit --no-fund`, **full** `npm run build` including postbuild gates, and the five App fixture tests in the new output directory. Node 22.12+ and access to the base's pinned dependencies are required. Logs stay in that private output; no dev server or deployment starts. The tool verifies source members again after building.

```sh
python3 examples/cloud-app-stream-acceptance/test_reconstruct.py \
  --base-zip /absolute/path/Tier0-App-Scaffold-v11-57d6ee4-source.zip
```

The historical private fixture ZIP has SHA-256 `82f0ae89f08a4dce7b84547008065e066044722fefc3125b346e33eee945355f`. Its `acceptance-fixture.json` includes private audit identity metadata. The tracked overlay omits that identity and the original private-only repository-edit status. This is the only member-content difference between the default reconstruction and that historical ZIP; the seven other fixture files are exact copies. Do not check private metadata or reconstructed outputs into Git.

To reproduce the historical ZIP byte for byte, add `--private-metadata /absolute/private/acceptance-fixture.json` to reconstruction. Only the original JSON's pinned SHA-256 is accepted; arbitrary metadata cannot override the source. To test both the private ZIP and its manifest byte for byte, supply all three optional inputs:

```sh
python3 examples/cloud-app-stream-acceptance/test_reconstruct.py \
  --base-zip /absolute/path/Tier0-App-Scaffold-v11-57d6ee4-source.zip \
  --private-metadata /absolute/private/acceptance-fixture.json \
  --reference-source-zip /absolute/private/original-acceptance-source.zip \
  --reference-member-manifest /absolute/private/source-file-manifest.json
```

`provenance.json` separates the source pack's SDK artifact commit from any subsequent example-only SDK repository HEAD. The installed artifact remains **`7f0a82ef6a719dd6843c29c1046f87ad3c2970a7`**, tarball SHA-256 **`63ca9a348124acaab14c2fa9319b1aed10ff22bc3419ef81daa2b95f1e77afb5`**, even after committing this example. Package/lockfile, `@tier0/sdk-v2/data`, auth, SSR policy and gates come unchanged from the base. Never repack the tarball to label it with example-only HEAD.

Both App Node test files (`template-state.test.mjs` and `sdk-acceptance-fixture.test.ts`) are stored with an extra `.fixture` suffix and restored to their original names during reconstruction. This keeps App-only tests out of the SDK's Vitest discovery without changing SDK test configuration.

Previous fixture evidence records 169 full-build tests, 5 fixture tests and 32 gates passed; those counts are historical build evidence, not a fresh build claim for each reconstruction. Browser, 375px, broker/policy and business ACK acceptance remain **unverified** until authenticated deployment. Use only parent-approved owned fixtures. `ack.echo` is the initial business request code; message topic is empty until an authorized logical topic is supplied. Connection details and authorization come solely from the trusted platform runtime. Broker flush does not prove receiver ACK. Reconcile unknown outcomes before deliberately replaying the same captured intent/key. Jenkins and deployment remain the parent task's responsibility.
