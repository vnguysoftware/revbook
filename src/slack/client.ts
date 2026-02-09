import { WebClient } from '@slack/web-api';
import { getEnv } from '../config/env.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('slack-client');

// ─── Lazy Singleton ─────────────────────────────────────────────────

let _client: WebClient | null = null;

export function getSlackClient(): WebClient | null {
  if (_client) return _client;

  const env = getEnv();
  if (!env.SLACK_BOT_TOKEN) {
    return null;
  }

  _client = new WebClient(env.SLACK_BOT_TOKEN);
  log.info('Slack WebClient initialized');
  return _client;
}

export function isSlackEnabled(): boolean {
  return !!getEnv().SLACK_BOT_TOKEN;
}
