import Anthropic from '@anthropic-ai/sdk';
import { getEnv } from '../config/env.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('ai-client');

// ─── Types ──────────────────────────────────────────────────────────

interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AiCallOptions {
  systemPrompt: string;
  messages: AiMessage[];
  maxTokens?: number;
  temperature?: number;
}

interface AiResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

// ─── Token Usage Tracking ───────────────────────────────────────────

interface TokenUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
  lastCallAt: Date | null;
}

const _usage: TokenUsage = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCalls: 0,
  lastCallAt: null,
};

// ─── Lazy Client ────────────────────────────────────────────────────

let _client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (_client) return _client;

  const env = getEnv();
  if (!env.ANTHROPIC_API_KEY) {
    return null;
  }

  _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  log.info('Anthropic client initialized');
  return _client;
}

/**
 * Check whether AI features are available (API key configured).
 */
export function isAiEnabled(): boolean {
  return !!getEnv().ANTHROPIC_API_KEY;
}

/**
 * Call Claude with a structured prompt. Returns null if AI is not configured.
 *
 * Handles:
 * - Lazy initialization of the Anthropic client
 * - Token usage tracking / logging
 * - Rate limit retries (1 retry with backoff)
 * - Graceful error handling
 */
export async function callClaude(opts: AiCallOptions): Promise<AiResponse | null> {
  const client = getClient();
  if (!client) {
    log.debug('AI not configured — skipping Claude call');
    return null;
  }

  const env = getEnv();
  const model = env.AI_MODEL;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.3,
      system: opts.systemPrompt,
      messages: opts.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    // Track usage
    _usage.totalInputTokens += inputTokens;
    _usage.totalOutputTokens += outputTokens;
    _usage.totalCalls += 1;
    _usage.lastCallAt = new Date();

    log.info(
      { inputTokens, outputTokens, model, totalCalls: _usage.totalCalls },
      'Claude API call completed',
    );

    // Extract text content from the response
    const textBlock = response.content.find((block) => block.type === 'text');
    const content = textBlock ? textBlock.text : '';

    return {
      content,
      inputTokens,
      outputTokens,
      model,
    };
  } catch (err: any) {
    // Handle rate limits with a single retry
    if (err?.status === 429) {
      log.warn('Rate limited by Anthropic API — retrying after 5s');
      await sleep(5000);

      try {
        const retryResponse = await client.messages.create({
          model,
          max_tokens: opts.maxTokens ?? 2048,
          temperature: opts.temperature ?? 0.3,
          system: opts.systemPrompt,
          messages: opts.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        });

        const inputTokens = retryResponse.usage.input_tokens;
        const outputTokens = retryResponse.usage.output_tokens;

        _usage.totalInputTokens += inputTokens;
        _usage.totalOutputTokens += outputTokens;
        _usage.totalCalls += 1;
        _usage.lastCallAt = new Date();

        const textBlock = retryResponse.content.find((block) => block.type === 'text');
        const content = textBlock ? textBlock.text : '';

        return { content, inputTokens, outputTokens, model };
      } catch (retryErr) {
        log.error({ err: retryErr }, 'Claude API retry also failed');
        return null;
      }
    }

    // Handle overloaded API
    if (err?.status === 529) {
      log.error('Anthropic API overloaded — skipping AI call');
      return null;
    }

    log.error({ err: err?.message, status: err?.status }, 'Claude API call failed');
    return null;
  }
}

/**
 * Parse a JSON block from Claude's response text.
 * Claude often wraps JSON in ```json ... ``` markers.
 */
export function parseJsonFromResponse<T>(text: string): T | null {
  try {
    // Try direct parse first
    return JSON.parse(text) as T;
  } catch {
    // Try extracting from code block
    const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]) as T;
      } catch {
        // Fall through
      }
    }

    // Try finding JSON object/array in the text
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]) as T;
      } catch {
        // Fall through
      }
    }

    log.warn('Failed to parse JSON from Claude response');
    return null;
  }
}

/**
 * Get current token usage metrics.
 */
export function getTokenUsage(): TokenUsage {
  return { ..._usage };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
