/**
 * API key scope system.
 *
 * Scopes control what operations an API key can perform.
 * Empty scopes array = full access (backward compat for existing keys).
 */

export const SCOPES = [
  'issues:read',
  'issues:write',
  'alerts:read',
  'alerts:write',
  'admin:read',
  'admin:write',
  'setup:write',
  'access-checks:read',
  'access-checks:write',
  'dashboard:read',
  'users:read',
  '*',
] as const;

export type Scope = (typeof SCOPES)[number];

/**
 * Check if granted scopes satisfy the required scope.
 *
 * Rules:
 * - Empty array = full access (backward compat)
 * - '*' grants everything
 * - Exact match required otherwise
 * - 'issues:write' does NOT imply 'issues:read' — grant both if needed
 */
export function hasScope(granted: string[], required: Scope): boolean {
  // Empty scopes = full access (backward compat for existing keys)
  if (granted.length === 0) return true;

  // Wildcard
  if (granted.includes('*')) return true;

  return granted.includes(required);
}
