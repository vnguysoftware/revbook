import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../config/database.js';
import { alertConfigurations, alertDeliveryLogs } from '../models/schema.js';
import type { AuthContext } from '../middleware/auth.js';
import type { SlackAlertConfig, EmailAlertConfig, WebhookAlertConfig } from '../models/types.js';
import { sendSlackTestAlert } from '../alerts/slack.js';
import { sendEmailTestAlert } from '../alerts/email.js';
import { sendWebhookTestAlert } from '../alerts/webhook.js';
import { generateSigningSecret } from '../alerts/webhook-signing.js';
import { createChildLogger } from '../config/logger.js';
import { requireScope } from '../middleware/require-scope.js';
import { auditLog } from '../security/audit.js';

const log = createChildLogger('alerts-api');

// ─── Validation Schemas ────────────────────────────────────────────

const slackConfigSchema = z.object({
  webhookUrl: z.string().url().startsWith('https://hooks.slack.com/'),
  channelName: z.string().optional(),
});

const emailConfigSchema = z.object({
  recipients: z.array(z.string().email()).min(1).max(50),
});

const webhookConfigSchema = z.object({
  url: z.string().url(),
  eventTypes: z.array(z.enum(['issue.created', 'issue.resolved', 'issue.dismissed', 'issue.acknowledged'])).optional(),
});

const severityFilterSchema = z.array(
  z.enum(['critical', 'warning', 'info']),
).min(1);

const createAlertSchema = z.object({
  channel: z.enum(['slack', 'email', 'webhook']),
  config: z.union([
    slackConfigSchema,
    emailConfigSchema,
    webhookConfigSchema,
  ]),
  severityFilter: severityFilterSchema.default(['critical', 'warning', 'info']),
  issueTypes: z.array(z.string()).nullable().default(null),
  enabled: z.boolean().default(true),
});

const updateAlertSchema = z.object({
  config: z.union([slackConfigSchema, emailConfigSchema, webhookConfigSchema]).optional(),
  severityFilter: severityFilterSchema.optional(),
  issueTypes: z.array(z.string()).nullable().optional(),
  enabled: z.boolean().optional(),
});

const testAlertSchema = z.object({
  alertConfigId: z.string().uuid('alertConfigId must be a valid UUID'),
});

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Mask a Slack webhook URL for safe display.
 * Only shows the last 8 characters.
 */
function maskWebhookUrl(url: string): string {
  if (url.length <= 8) return '***';
  return `***${url.slice(-8)}`;
}

/**
 * Sanitize alert config for API responses — never expose secrets.
 */
function sanitizeConfig(channel: string, config: unknown): unknown {
  if (channel === 'slack') {
    const slackConfig = config as SlackAlertConfig;
    return {
      webhookUrl: maskWebhookUrl(slackConfig.webhookUrl),
      channelName: slackConfig.channelName || null,
    };
  }
  if (channel === 'webhook') {
    const webhookConfig = config as WebhookAlertConfig;
    return {
      url: webhookConfig.url,
      signingSecret: '***',
      eventTypes: webhookConfig.eventTypes || null,
    };
  }
  // Email config is safe to return as-is
  return config;
}

// ─── Routes ────────────────────────────────────────────────────────

export function createAlertRoutes(db: Database) {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();

  // ─── Create alert configuration ────────────────────────────────

  app.post('/', requireScope('alerts:write'), async (c) => {
    const { orgId } = c.get('auth');
    const body = await c.req.json();

    const parsed = createAlertSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({
        error: 'Invalid alert configuration',
        details: parsed.error.flatten().fieldErrors,
      }, 400);
    }

    const data = parsed.data;

    // Validate config matches channel type
    if (data.channel === 'slack') {
      const check = slackConfigSchema.safeParse(data.config);
      if (!check.success) {
        return c.json({
          error: 'Invalid Slack configuration. Provide webhookUrl (must start with https://hooks.slack.com/).',
          details: check.error.flatten().fieldErrors,
        }, 400);
      }
    } else if (data.channel === 'email') {
      const check = emailConfigSchema.safeParse(data.config);
      if (!check.success) {
        return c.json({
          error: 'Invalid email configuration. Provide recipients array with valid email addresses.',
          details: check.error.flatten().fieldErrors,
        }, 400);
      }
    } else if (data.channel === 'webhook') {
      const check = webhookConfigSchema.safeParse(data.config);
      if (!check.success) {
        return c.json({
          error: 'Invalid webhook configuration. Provide a valid url.',
          details: check.error.flatten().fieldErrors,
        }, 400);
      }
    }

    // Auto-generate signing secret for webhook configs
    let configToStore = data.config;
    let signingSecret: string | undefined;
    if (data.channel === 'webhook') {
      signingSecret = generateSigningSecret();
      configToStore = { ...data.config, signingSecret } as any;
    }

    const [created] = await db
      .insert(alertConfigurations)
      .values({
        orgId,
        channel: data.channel,
        config: configToStore,
        severityFilter: data.severityFilter,
        issueTypes: data.issueTypes,
        enabled: data.enabled,
      })
      .returning();

    log.info({ orgId, configId: created.id, channel: data.channel }, 'Alert configuration created');
    auditLog(db, c.get('auth'), 'alert.created', 'alert_configuration', created.id, { channel: data.channel });

    // For webhooks, return the signing secret once (only on creation)
    const responseConfig = data.channel === 'webhook'
      ? { ...(sanitizeConfig(created.channel, created.config) as any), signingSecret }
      : sanitizeConfig(created.channel, created.config);

    return c.json({
      alertConfig: {
        ...created,
        config: responseConfig,
      },
    }, 201);
  });

  // ─── List alert configurations ─────────────────────────────────

  app.get('/', requireScope('alerts:read'), async (c) => {
    const { orgId } = c.get('auth');

    const configs = await db
      .select()
      .from(alertConfigurations)
      .where(eq(alertConfigurations.orgId, orgId))
      .orderBy(desc(alertConfigurations.createdAt));

    const sanitized = configs.map((config) => ({
      ...config,
      config: sanitizeConfig(config.channel, config.config),
    }));

    return c.json({ alertConfigs: sanitized });
  });

  // ─── Update alert configuration ────────────────────────────────

  app.put('/:id', requireScope('alerts:write'), async (c) => {
    const { orgId } = c.get('auth');
    const id = c.req.param('id');
    const body = await c.req.json();

    const parsed = updateAlertSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({
        error: 'Invalid update data',
        details: parsed.error.flatten().fieldErrors,
      }, 400);
    }

    // Verify the alert config belongs to this org
    const [existing] = await db
      .select()
      .from(alertConfigurations)
      .where(
        and(
          eq(alertConfigurations.id, id),
          eq(alertConfigurations.orgId, orgId),
        ),
      )
      .limit(1);

    if (!existing) {
      return c.json({ error: 'Alert configuration not found' }, 404);
    }

    // If config is being updated, validate it matches the channel
    if (parsed.data.config) {
      if (existing.channel === 'slack') {
        const check = slackConfigSchema.safeParse(parsed.data.config);
        if (!check.success) {
          return c.json({
            error: 'Invalid Slack configuration',
            details: check.error.flatten().fieldErrors,
          }, 400);
        }
      } else if (existing.channel === 'email') {
        const check = emailConfigSchema.safeParse(parsed.data.config);
        if (!check.success) {
          return c.json({
            error: 'Invalid email configuration',
            details: check.error.flatten().fieldErrors,
          }, 400);
        }
      } else if (existing.channel === 'webhook') {
        const check = webhookConfigSchema.safeParse(parsed.data.config);
        if (!check.success) {
          return c.json({
            error: 'Invalid webhook configuration',
            details: check.error.flatten().fieldErrors,
          }, 400);
        }
        // Preserve the existing signing secret
        const existingConfig = existing.config as unknown as WebhookAlertConfig;
        parsed.data.config = { ...parsed.data.config, signingSecret: existingConfig.signingSecret } as any;
      }
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.config !== undefined) updateData.config = parsed.data.config;
    if (parsed.data.severityFilter !== undefined) updateData.severityFilter = parsed.data.severityFilter;
    if (parsed.data.issueTypes !== undefined) updateData.issueTypes = parsed.data.issueTypes;
    if (parsed.data.enabled !== undefined) updateData.enabled = parsed.data.enabled;

    const [updated] = await db
      .update(alertConfigurations)
      .set(updateData)
      .where(
        and(
          eq(alertConfigurations.id, id),
          eq(alertConfigurations.orgId, orgId),
        ),
      )
      .returning();

    log.info({ orgId, configId: id }, 'Alert configuration updated');
    auditLog(db, c.get('auth'), 'alert.updated', 'alert_configuration', id);

    return c.json({
      alertConfig: {
        ...updated,
        config: sanitizeConfig(updated.channel, updated.config),
      },
    });
  });

  // ─── Delete alert configuration ────────────────────────────────

  app.delete('/:id', requireScope('alerts:write'), async (c) => {
    const { orgId } = c.get('auth');
    const id = c.req.param('id');

    const [existing] = await db
      .select({ id: alertConfigurations.id })
      .from(alertConfigurations)
      .where(
        and(
          eq(alertConfigurations.id, id),
          eq(alertConfigurations.orgId, orgId),
        ),
      )
      .limit(1);

    if (!existing) {
      return c.json({ error: 'Alert configuration not found' }, 404);
    }

    // Delete delivery logs first (FK constraint)
    await db
      .delete(alertDeliveryLogs)
      .where(eq(alertDeliveryLogs.alertConfigId, id));

    await db
      .delete(alertConfigurations)
      .where(
        and(
          eq(alertConfigurations.id, id),
          eq(alertConfigurations.orgId, orgId),
        ),
      );

    log.info({ orgId, configId: id }, 'Alert configuration deleted');
    auditLog(db, c.get('auth'), 'alert.deleted', 'alert_configuration', id);

    return c.json({ ok: true });
  });

  // ─── Test alert ────────────────────────────────────────────────

  app.post('/test', requireScope('alerts:write'), async (c) => {
    const { orgId } = c.get('auth');
    const body = await c.req.json();

    const parsed = testAlertSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', details: parsed.error.flatten().fieldErrors }, 400);
    }

    const { alertConfigId } = parsed.data;

    const [config] = await db
      .select()
      .from(alertConfigurations)
      .where(
        and(
          eq(alertConfigurations.id, alertConfigId),
          eq(alertConfigurations.orgId, orgId),
        ),
      )
      .limit(1);

    if (!config) {
      return c.json({ error: 'Alert configuration not found' }, 404);
    }

    let result: { success: boolean; error?: string };

    switch (config.channel) {
      case 'slack': {
        const slackConfig = config.config as unknown as SlackAlertConfig;
        result = await sendSlackTestAlert(slackConfig.webhookUrl);
        break;
      }
      case 'email': {
        const emailConfig = config.config as unknown as EmailAlertConfig;
        result = await sendEmailTestAlert(emailConfig.recipients);
        break;
      }
      case 'webhook': {
        const webhookConfig = config.config as unknown as WebhookAlertConfig;
        result = await sendWebhookTestAlert(webhookConfig);
        break;
      }
      default:
        return c.json({ error: `Unknown channel: ${config.channel}` }, 400);
    }

    // Log the test delivery
    await db.insert(alertDeliveryLogs).values({
      orgId,
      alertConfigId: config.id,
      channel: config.channel,
      status: result.success ? 'sent' : 'failed',
      errorMessage: result.error || null,
    }).catch((err) => {
      log.error({ err }, 'Failed to log test alert delivery');
    });

    if (result.success) {
      return c.json({ ok: true, message: `Test alert sent via ${config.channel}` });
    } else {
      return c.json({
        ok: false,
        error: result.error || 'Failed to send test alert',
      }, 500);
    }
  });

  // ─── Reveal signing secret (one-time) ────────────────────────

  app.get('/:id/signing-secret', requireScope('alerts:read'), async (c) => {
    const { orgId } = c.get('auth');
    const id = c.req.param('id');

    const [config] = await db
      .select()
      .from(alertConfigurations)
      .where(
        and(
          eq(alertConfigurations.id, id),
          eq(alertConfigurations.orgId, orgId),
        ),
      )
      .limit(1);

    if (!config) {
      return c.json({ error: 'Alert configuration not found' }, 404);
    }

    if (config.channel !== 'webhook') {
      return c.json({ error: 'Signing secret is only available for webhook configurations' }, 400);
    }

    const webhookConfig = config.config as unknown as WebhookAlertConfig;
    return c.json({ signingSecret: webhookConfig.signingSecret });
  });

  // ─── Delivery history ─────────────────────────────────────────

  app.get('/history', requireScope('alerts:read'), async (c) => {
    const { orgId } = c.get('auth');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);

    const deliveries = await db
      .select()
      .from(alertDeliveryLogs)
      .where(eq(alertDeliveryLogs.orgId, orgId))
      .orderBy(desc(alertDeliveryLogs.sentAt))
      .limit(limit);

    return c.json({ deliveries });
  });

  return app;
}
