import { describe, it, expect, afterEach } from 'vitest';
import { getCurrentAppId, getCurrentProjectId } from '../src/runtime-context.js';

const originalAppId = process.env.APP_ID;
const originalProjectId = process.env.TIER0_PROJECT_ID;

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  setEnv('APP_ID', originalAppId);
  setEnv('TIER0_PROJECT_ID', originalProjectId);
});

describe('getCurrentAppId', () => {
  it('returns an injected agent-platform UUID', () => {
    setEnv('APP_ID', '550e8400-e29b-41d4-a716-446655440000');
    expect(getCurrentAppId()).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('trims surrounding whitespace', () => {
    setEnv('APP_ID', '  550E8400-E29B-41D4-A716-446655440000  ');
    expect(getCurrentAppId()).toBe('550E8400-E29B-41D4-A716-446655440000');
  });

  it('throws when APP_ID is missing or blank', () => {
    setEnv('APP_ID', undefined);
    expect(() => getCurrentAppId()).toThrow(/app ID is required/);
    setEnv('APP_ID', '   ');
    expect(() => getCurrentAppId()).toThrow(/app ID is required/);
  });

  // The values that silently break the app lookup: the scaffold default and the
  // deployment session id the MonoApp scaffold puts in APP_ID.
  it.each(['monoapp', 'session-xyz789', '12345'])('rejects %s as a non-UUID app id', (value) => {
    setEnv('APP_ID', value);
    expect(() => getCurrentAppId()).toThrow(/is not an agent-platform app id/);
  });
});

describe('getCurrentProjectId', () => {
  it('returns the injected project id', () => {
    setEnv('TIER0_PROJECT_ID', 'proj-1');
    expect(getCurrentProjectId()).toBe('proj-1');
  });

  it('throws when TIER0_PROJECT_ID is missing', () => {
    setEnv('TIER0_PROJECT_ID', undefined);
    expect(() => getCurrentProjectId()).toThrow(/project ID is required/);
  });
});
