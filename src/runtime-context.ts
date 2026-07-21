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
