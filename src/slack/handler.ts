import type { Database } from '../config/database.js';
import type { SlackCommandPayload, SlackMessage } from './types.js';
import { isCxEngineer } from './cx-auth.js';
import { formatError, formatUnauthorized, formatHelp } from './formatters.js';
import { handleLookup } from './commands/lookup.js';
import { handleIssues } from './commands/issues.js';
import { handleStatus } from './commands/status.js';
import { handleInvestigate } from './commands/investigate.js';
import { handleHelp } from './commands/help.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('slack-handler');

// ─── Rate Limiting ──────────────────────────────────────────────────

const commandRates = new Map<string, number[]>();
const MAX_COMMANDS_PER_MIN = 30;

function checkCommandRate(userId: string): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;

  let timestamps = commandRates.get(userId) || [];
  timestamps = timestamps.filter((ts) => ts > windowStart);
  timestamps.push(now);
  commandRates.set(userId, timestamps);

  return timestamps.length <= MAX_COMMANDS_PER_MIN;
}

// Periodically clean old rate limit entries
setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [userId, timestamps] of commandRates) {
    const filtered = timestamps.filter((ts) => ts > cutoff);
    if (filtered.length === 0) {
      commandRates.delete(userId);
    } else {
      commandRates.set(userId, filtered);
    }
  }
}, 60_000);

// ─── Command Dispatcher ────────────────────────────────────────────

/**
 * Parse `/rb <subcommand> <args>` and dispatch to the right handler.
 */
export async function handleSlackCommand(
  db: Database,
  payload: SlackCommandPayload,
): Promise<SlackMessage> {
  const { user_id, user_name, text, response_url } = payload;

  // 1. Auth check
  if (!isCxEngineer(user_id)) {
    log.warn({ userId: user_id, userName: user_name }, 'Unauthorized Slack command attempt');
    return formatUnauthorized();
  }

  // 2. Rate limit check
  if (!checkCommandRate(user_id)) {
    return formatError('Rate limit exceeded. Please wait a moment before trying again (max 30 commands/min).');
  }

  // 3. Parse subcommand and args
  const parts = text.trim().split(/\s+/);
  const subcommand = (parts[0] || 'help').toLowerCase();
  const args = parts.slice(1).join(' ');

  log.info({ userId: user_id, userName: user_name, subcommand, args }, 'Slack command received');

  // 4. Dispatch
  try {
    switch (subcommand) {
      case 'lookup':
        return await handleLookup(db, args);

      case 'issues':
        return await handleIssues(db, args);

      case 'status':
        return await handleStatus(db, args);

      case 'investigate':
        return await handleInvestigate(db, args, response_url);

      case 'help':
        return await handleHelp(db, args);

      default:
        return formatError(
          `Unknown command: \`${subcommand}\`\n\nUse \`/rb help\` to see available commands.`,
        );
    }
  } catch (err) {
    log.error({ err, subcommand, args }, 'Slack command handler error');
    return formatError('An unexpected error occurred. Please try again or check server logs.');
  }
}
