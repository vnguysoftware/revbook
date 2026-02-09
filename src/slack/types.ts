// ─── Slack Payload Types ────────────────────────────────────────────

/** Slack slash command payload (application/x-www-form-urlencoded) */
export interface SlackCommandPayload {
  token: string;
  team_id: string;
  team_domain: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  user_name: string;
  command: string;
  text: string;
  response_url: string;
  trigger_id: string;
  api_app_id: string;
}

/** Slack event callback wrapper */
export interface SlackEventPayload {
  type: 'url_verification' | 'event_callback';
  challenge?: string;
  token: string;
  team_id: string;
  event?: SlackEvent;
}

/** Slack event types we handle */
export interface SlackEvent {
  type: string;
  user: string;
  text: string;
  channel: string;
  ts: string;
  thread_ts?: string;
  bot_id?: string;
}

/** Slack interaction payload (button clicks, etc.) */
export interface SlackInteractionPayload {
  type: 'block_actions' | 'message_action';
  user: { id: string; username: string };
  channel: { id: string };
  actions: Array<{
    action_id: string;
    value?: string;
    block_id: string;
  }>;
  trigger_id: string;
  response_url: string;
  message?: { ts: string; thread_ts?: string };
}

/** Block Kit message structure */
export interface SlackMessage {
  text?: string;
  blocks?: SlackBlock[];
  attachments?: SlackAttachment[];
  response_type?: 'ephemeral' | 'in_channel';
  replace_original?: boolean;
}

export interface SlackBlock {
  type: string;
  text?: SlackText;
  fields?: SlackText[];
  elements?: Array<Record<string, unknown>>;
  block_id?: string;
  accessory?: Record<string, unknown>;
}

export interface SlackText {
  type: 'plain_text' | 'mrkdwn';
  text: string;
  emoji?: boolean;
}

export interface SlackAttachment {
  color?: string;
  blocks?: SlackBlock[];
}
