#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const MIN_WORKSPACE_KEY_MQ_VERSION = "0.5.2";

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function parentDirectories(start) {
  const directories = [];
  let current = path.resolve(start);
  while (true) {
    directories.push(current);
    const parent = path.dirname(current);
    if (parent === current) return directories;
    current = parent;
  }
}

function findInstalledSDK(start) {
  for (const directory of parentDirectories(start)) {
    const projectPackage = path.join(directory, "package.json");
    const projectManifest = readJSON(projectPackage);
    if (projectManifest?.name === "@tier0/sdk" && projectManifest.version) {
      return {
        packagePath: projectPackage,
        version: String(projectManifest.version),
      };
    }

    const sdkPackage = path.join(
      directory,
      "node_modules",
      "@tier0",
      "sdk",
      "package.json",
    );
    const sdkManifest = readJSON(sdkPackage);
    if (sdkManifest?.version) {
      return { packagePath: sdkPackage, version: String(sdkManifest.version) };
    }
  }
  return undefined;
}

function findDeclaredRange(start) {
  for (const directory of parentDirectories(start)) {
    const manifest = readJSON(path.join(directory, "package.json"));
    if (!manifest) continue;
    const range =
      manifest.dependencies?.["@tier0/sdk"] ??
      manifest.devDependencies?.["@tier0/sdk"] ??
      manifest.optionalDependencies?.["@tier0/sdk"];
    if (range) return String(range);
  }
  return undefined;
}

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  return match ? match.slice(1).map(Number) : undefined;
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return undefined;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function classifyKey(value) {
  const key = value?.trim();
  if (!key) return { present: false, type: undefined, workspaceEncoded: false };

  const workspaceMatch = /^sk-([a-z0-9]+)-ws[0-9a-z]+_.+$/i.exec(key);
  if (workspaceMatch) {
    return {
      present: true,
      type: workspaceMatch[1].toLowerCase(),
      workspaceEncoded: true,
    };
  }

  const typeMatch = /^sk-([a-z0-9]+)-/i.exec(key);
  return {
    present: true,
    type: typeMatch?.[1]?.toLowerCase(),
    workspaceEncoded: false,
  };
}

function diagnose() {
  const sdk = findInstalledSDK(process.cwd());
  const declaredRange = findDeclaredRange(process.cwd());
  const key = classifyKey(process.env.TIER0_API_KEY);
  const base = {
    feature: "mqtt-workspace-api-key",
    minimumVersion: MIN_WORKSPACE_KEY_MQ_VERSION,
    installedVersion: sdk?.version,
    declaredRange,
    key,
  };

  if (!sdk) {
    return {
      ...base,
      ok: false,
      status: "sdk-not-installed",
      diagnosis:
        "The installed @tier0/sdk package could not be found from the current directory.",
      actions: [
        "Run the diagnostic from the application root.",
        "Install or restore @tier0/sdk@latest through the project's managed dependency workflow.",
      ],
      exitCode: 2,
    };
  }

  if (!key.present) {
    return {
      ...base,
      ok: false,
      status: "api-key-not-injected",
      diagnosis:
        "TIER0_API_KEY is not available in this process, so key compatibility cannot be confirmed.",
      actions: [
        "Check platform/runtime environment injection.",
        "Do not paste the API key into logs or command-line arguments.",
      ],
      exitCode: 2,
    };
  }

  const comparison = compareVersions(sdk.version, MIN_WORKSPACE_KEY_MQ_VERSION);
  if (comparison === undefined) {
    return {
      ...base,
      ok: false,
      status: "unrecognized-sdk-version",
      diagnosis:
        "The installed SDK version is not valid semantic version text.",
      actions: [
        "Inspect npm ls @tier0/sdk.",
        "Use the latest published @tier0/sdk release.",
      ],
      exitCode: 2,
    };
  }

  if (key.workspaceEncoded && key.type !== "svc" && comparison < 0) {
    return {
      ...base,
      ok: false,
      status: "upgrade-required",
      diagnosis: `@tier0/sdk ${sdk.version} cannot derive MQTT identity for workspace-encoded ${key.type ?? "non-service"} API keys.`,
      actions: [
        "Upgrade @tier0/sdk to @latest (minimum 0.5.2).",
        "For a managed MonoApp, update package.json and let the platform reinstall dependencies; do not run npm install inside the scaffold.",
        "Restart the application/preview, rerun this diagnostic, and then retry MQTT.",
      ],
      exitCode: 1,
    };
  }

  if (key.workspaceEncoded && comparison >= 0) {
    return {
      ...base,
      ok: true,
      status: "compatible",
      diagnosis:
        "The installed SDK supports MQTT identity derivation for this workspace-encoded API key.",
      actions: [
        "If authentication still fails, check runtime key injection, key status/permissions, broker ws/wss configuration, and backend support.",
      ],
      exitCode: 0,
    };
  }

  if (key.workspaceEncoded && key.type === "svc") {
    return {
      ...base,
      ok: true,
      status: "legacy-service-key-compatible",
      diagnosis:
        "This workspace-encoded service key is understood by the installed SDK; upgrading is still preferred.",
      actions: [
        "If authentication fails, check key status/permissions, broker ws/wss configuration, and backend support.",
      ],
      exitCode: 0,
    };
  }

  if (key.type && key.type !== "svc") {
    return {
      ...base,
      ok: false,
      status: "unexpected-key-format",
      diagnosis: `The ${key.type} API key does not match the expected workspace-encoded format.`,
      actions: [
        "Check platform environment injection and backend key issuance.",
        "Do not paste the key into logs or replace it before confirming the injected runtime value.",
      ],
      exitCode: 2,
    };
  }

  return {
    ...base,
    ok: true,
    status: "legacy-key-fallback",
    diagnosis:
      "The key does not use the workspace-encoded format, so the SDK will use its legacy Enterprise MQTT identity fallback.",
    actions: [
      "If this is expected to be a new App/workspace key, check platform environment injection and backend key issuance.",
      "Otherwise check key status/permissions and broker configuration.",
    ],
    exitCode: 0,
  };
}

function printHuman(result) {
  const keySummary = result.key.present
    ? `present; type=${result.key.type ?? "unknown"}; workspaceEncoded=${result.key.workspaceEncoded}`
    : "not present";
  console.log(`SDK version: ${result.installedVersion ?? "not found"}`);
  if (result.declaredRange)
    console.log(`Declared range: ${result.declaredRange}`);
  console.log(`API key: ${keySummary} (value hidden)`);
  console.log(`Compatibility: ${result.status}`);
  console.log(`Diagnosis: ${result.diagnosis}`);
  for (const action of result.actions) console.log(`Action: ${action}`);
}

if (process.argv.includes("--help")) {
  console.log(
    "Usage: TIER0_API_KEY=<injected-by-runtime> node check-api-key-compat.mjs [--json]",
  );
  console.log(
    "Run from the application root. The API key value is never printed.",
  );
  process.exit(0);
}

const result = diagnose();
const output = { ...result };
delete output.exitCode;

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(output, null, 2));
} else {
  printHuman(output);
}
process.exitCode = result.exitCode;
