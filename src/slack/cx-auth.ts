import { getEnv } from '../config/env.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('slack-cx-auth');

let _allowedUserIds: Set<string> | null = null;

function getAllowedUsers(): Set<string> {
  if (_allowedUserIds) return _allowedUserIds;

  const env = getEnv();
  const raw = env.SLACK_CX_USER_IDS;
  if (!raw) {
    _allowedUserIds = new Set();
    return _allowedUserIds;
  }

  _allowedUserIds = new Set(
    raw.split(',').map((id) => id.trim()).filter(Boolean),
  );
  log.info({ count: _allowedUserIds.size }, 'CX engineer allowlist loaded');
  return _allowedUserIds;
}

/**
 * Check whether a Slack user ID is on the CX engineer allowlist.
 * If no allowlist is configured (SLACK_CX_USER_IDS is empty), all users are denied.
 */
export function isCxEngineer(slackUserId: string): boolean {
  const allowed = getAllowedUsers();
  if (allowed.size === 0) {
    log.warn('No CX engineers configured in SLACK_CX_USER_IDS');
    return false;
  }
  return allowed.has(slackUserId);
}
