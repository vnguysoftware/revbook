import { describe, it, expect } from 'vitest';
import { hasScope } from '../../security/scopes.js';

describe('hasScope', () => {
  it('empty scopes grants full access (backward compat)', () => {
    expect(hasScope([], 'issues:read')).toBe(true);
    expect(hasScope([], 'admin:write')).toBe(true);
  });

  it('wildcard grants everything', () => {
    expect(hasScope(['*'], 'issues:read')).toBe(true);
    expect(hasScope(['*'], 'admin:write')).toBe(true);
  });

  it('exact match works', () => {
    expect(hasScope(['issues:read'], 'issues:read')).toBe(true);
  });

  it('rejects when scope not granted', () => {
    expect(hasScope(['issues:read'], 'issues:write')).toBe(false);
  });

  it('write does not imply read', () => {
    expect(hasScope(['issues:write'], 'issues:read')).toBe(false);
  });

  it('multiple scopes checked correctly', () => {
    const scopes = ['issues:read', 'alerts:read', 'dashboard:read'];
    expect(hasScope(scopes, 'issues:read')).toBe(true);
    expect(hasScope(scopes, 'alerts:read')).toBe(true);
    expect(hasScope(scopes, 'dashboard:read')).toBe(true);
    expect(hasScope(scopes, 'issues:write')).toBe(false);
    expect(hasScope(scopes, 'admin:read')).toBe(false);
  });
});
