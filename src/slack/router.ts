import { Hono } from 'hono';
import type { Database } from '../config/database.js';
import { verifySlackSignature } from './verify.js';
import { handleSlackCommand } from './handler.js';
import { handleConversation } from './conversation.js';
import type { SlackCommandPayload, SlackEventPayload } from './types.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('slack-router');

/**
 * Create Hono routes for Slack integration.
 * Mounts at /slack — endpoints:
 *   POST /slack/commands   — Slash command handler (/rb)
 *   POST /slack/events     — Event subscriptions (app_mention, message)
 *   POST /slack/interactions — Block Kit interactions (button clicks)
 */
export function createSlackRoutes(db: Database) {
  const app = new Hono();

  // All routes verify Slack request signature
  app.use('*', verifySlackSignature);

  // ─── Slash Commands (/rb) ────────────────────────────────────────

  app.post('/commands', async (c) => {
    // Parse the URL-encoded body (stored by verify middleware)
    const rawBody = c.get('rawBody') as string;
    const params = new URLSearchParams(rawBody);
    const payload: SlackCommandPayload = {
      token: params.get('token') || '',
      team_id: params.get('team_id') || '',
      team_domain: params.get('team_domain') || '',
      channel_id: params.get('channel_id') || '',
      channel_name: params.get('channel_name') || '',
      user_id: params.get('user_id') || '',
      user_name: params.get('user_name') || '',
      command: params.get('command') || '',
      text: params.get('text') || '',
      response_url: params.get('response_url') || '',
      trigger_id: params.get('trigger_id') || '',
      api_app_id: params.get('api_app_id') || '',
    };

    log.info({
      userId: payload.user_id,
      userName: payload.user_name,
      command: payload.command,
      text: payload.text,
    }, 'Slash command received');

    const response = await handleSlackCommand(db, payload);

    // Slack expects 200 within 3s; response_type controls visibility
    return c.json(response, 200);
  });

  // ─── Events API ─────────────────────────────────────────────────

  app.post('/events', async (c) => {
    const rawBody = c.get('rawBody') as string;
    let payload: SlackEventPayload;

    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    // Handle URL verification challenge (Slack app setup)
    if (payload.type === 'url_verification') {
      return c.json({ challenge: payload.challenge });
    }

    // Handle event callbacks
    if (payload.type === 'event_callback' && payload.event) {
      const event = payload.event;

      // Ignore bot messages to prevent loops
      if (event.bot_id) {
        return c.json({ ok: true });
      }

      // Handle @mentions and DMs
      if (event.type === 'app_mention' || event.type === 'message') {
        // Strip the bot mention from the text
        const cleanText = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();

        if (cleanText) {
          // Fire and forget — respond async in thread
          handleConversation(
            db,
            event.user,
            cleanText,
            event.channel,
            event.thread_ts,
            event.ts,
          ).catch((err) => {
            log.error({ err }, 'Conversation handler error');
          });
        }
      }
    }

    // Always respond 200 quickly to avoid Slack retries
    return c.json({ ok: true });
  });

  // ─── Interactions (Block Kit) ───────────────────────────────────

  app.post('/interactions', async (c) => {
    const rawBody = c.get('rawBody') as string;
    const params = new URLSearchParams(rawBody);
    const payloadStr = params.get('payload');

    if (!payloadStr) {
      return c.json({ error: 'Missing payload' }, 400);
    }

    try {
      const _payload = JSON.parse(payloadStr);
      // For now, just acknowledge interactions — expand later if needed
      log.info({ type: _payload.type }, 'Slack interaction received');
    } catch {
      return c.json({ error: 'Invalid payload' }, 400);
    }

    return c.json({ ok: true });
  });

  return app;
}
