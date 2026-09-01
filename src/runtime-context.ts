import { getEnvVar } from './runtime-env.js';

/** Return the project identifier injected by the Tier0 application runtime. */
export function getCurrentProjectId(): string {
  const projectId = getEnvVar('TIER0_PROJECT_ID')?.trim();
  if (!projectId) {
    throw new Error(
      'Tier0 SDK: current project ID is required. Run inside a Tier0 application runtime or set TIER0_PROJECT_ID.'
    );
  }
  return projectId;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Return the agent-platform app id injected by the Tier0 application runtime.
 *
 * Throws rather than passing a suspect value through: a wrong app id has no
 * symptom at call time — the notification is still accepted — it only makes the
 * server-side app lookup miss forever, leaving the message with no App name,
 * no icon and no Open button.
 */
export function getCurrentAppId(): string {
  const appId = getEnvVar('APP_ID')?.trim();
  if (!appId) {
    throw new Error(
      'Tier0 SDK: current app ID is required. Run inside a Tier0 application runtime or set APP_ID.'
    );
  }
  if (!UUID_RE.test(appId)) {
    throw new Error(
      `Tier0 SDK: APP_ID="${appId}" is not an agent-platform app id (expected a UUID). ` +
        'The MonoApp scaffold sets APP_ID to the deployment session id; the platform must inject the real app id.'
    );
  }
  return appId;
}
