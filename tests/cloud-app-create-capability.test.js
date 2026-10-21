import { describe, expect, it } from 'vitest';
import { orderCreateHint } from '../examples/cloud-uns-app/public/order-create-capability.mjs';

const capability = () => ({ version: 'cloud-app-create-capability/v1', allowed: true, reason: 'allowed',
  appRevision: 19, collectionRevision: 4, binding: 'a'.repeat(64),
  inputSchema: { type: 'object', additionalProperties: false, required: ['orderNo', 'amount'],
    properties: { orderNo: { type: 'string' }, amount: { type: 'integer', minimum: 0 } } } });

describe('current employee capability for the fixed order creation form', () => {
  it('uses only the separate write input schema, without needing readable fields or a role', () => {
    const cap = capability();
    expect(orderCreateHint(cap, 19)).toBe('createAllowed');
    cap.inputSchema.properties.writeOnlyOptional = { type: 'string' };
    expect(orderCreateHint(cap, 19)).toBe('createAllowed');
    expect(cap).not.toHaveProperty('recordSchema');
  });

  it.each([
    undefined, null, {}, { ...capability(), version: 'cloud-app-create-capability/v2' },
    { ...capability(), allowed: 'true' }, { ...capability(), binding: '' },
    { ...capability(), appRevision: 18 }, { ...capability(), collectionRevision: 0 },
    { ...capability(), collectionRevision: 9007199254740992 },
  ])('disables missing, unknown or malformed capability metadata %#', (cap) => {
    expect(orderCreateHint(cap, 19)).toBe('createUnavailable');
  });

  it('does not treat a valid binding as authorization and recomputes eligibility on change', () => {
    const cap = capability(); cap.allowed = false; delete cap.inputSchema;
    expect(orderCreateHint(cap, 19)).toBe('createDenied');
    expect(orderCreateHint({ ...capability(), binding: 'b'.repeat(64) }, 19)).toBe('createAllowed');
    expect(orderCreateHint(capability(), 20)).toBe('createUnavailable');
  });

  it.each([
    (s) => { s.required.push('department'); s.properties.department = { type: 'string' }; },
    (s) => { s.required.push('ownerUserId'); },
    (s) => { s.required = ['amount', 'amount']; },
    (s) => { s.required = 'amount'; },
    (s) => { delete s.properties.amount; },
    (s) => { s.properties.amount = { type: 'string' }; },
    (s) => { s.properties.orderNo = { type: 'string', enum: ['invalid spaces'] }; },
    (s) => { s.properties.orderNo = { type: 'string', pattern: '^a$' }; },
    (s) => { s.properties.amount = { type: 'integer', minimum: 0.1, maximum: 0.2 }; },
    (s) => { s.properties.amount = { type: 'integer', maximum: -1 }; },
    (s) => { s.properties.amount = { type: 'integer', enum: [-1, 1.5, '1'] }; },
    (s) => { s.properties.amount = { type: 'number', minimum: '1' }; },
    (s) => { s.properties.amount = { type: 'number', maximum: Infinity }; },
    (s) => { s.properties.amount = { type: 'number', minimum: 9007199254740992 }; },
    (s) => { s.oneOf = [{ required: ['amount'] }]; },
    (s) => { s.enum = [{ orderNo: 'a', amount: 1 }]; },
    (s) => { s.additionalProperties = true; },
  ])('disables required or schema semantics this form cannot satisfy %#', (change) => {
    const cap = capability(); change(cap.inputSchema);
    expect(orderCreateHint(cap, 19)).toBe('createUnsupported');
  });

  it('supports values selectable through the existing text and integer controls, without inventing defaults', () => {
    const cap = capability();
    cap.inputSchema.properties.orderNo.enum = ['order-1'];
    cap.inputSchema.properties.amount = { type: 'number', minimum: 0.2, maximum: 2.8, enum: [1, 2] };
    const original = structuredClone(cap);
    expect(orderCreateHint(cap, 19)).toBe('createAllowed');
    expect(cap).toEqual(original);
  });
});
