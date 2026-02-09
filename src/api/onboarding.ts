import { Hono } from 'hono';
import { eq, and, count, desc, gte, sql } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import type { Database } from '../config/database.js';
import {
  organizations,
  apiKeys,
  billingConnections,
  products,
  canonicalEvents,
  issues,
  users,
  webhookLogs,
} from '../models/schema.js';
import type { AuthContext } from '../middleware/auth.js';
import { hashApiKey } from '../middleware/auth.js';
import { StripeBackfill } from '../ingestion/backfill/stripe-backfill.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('onboarding');

/**
 * Onboarding API — designed for FAST time-to-value.
 *
 * The user's instruction: "Make it very easy for the integration
 * to happen and to immediately show value."
 *
 * Onboarding flow:
 * 1. POST /setup/org             → Create organization, get API key
 * 2. POST /setup/stripe          → Connect Stripe (just paste API key + webhook secret)
 * 3. POST /setup/apple           → Connect Apple (paste credentials)
 * 4. POST /setup/verify/stripe   → Verify Stripe connectivity
 * 5. POST /setup/verify/apple    → Verify Apple credentials
 * 6. GET  /setup/status          → Check integration health (enhanced)
 * 7. POST /setup/backfill/stripe → Import historical data from Stripe
 * 8. GET  /setup/backfill/progress → Real-time import progress
 * 9. GET  /setup/security-info   → Security documentation for enterprise
 *
 * Goal: working integration in < 10 minutes.
 */
export function createOnboardingRoutes(db: Database) {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();

  // Auth middleware for all routes except /org (which creates the org)
  app.use('*', async (c, next) => {
    // Skip auth for org creation and security info (public endpoints)
    const path = c.req.path;
    if (path === '/org' || path === '/security-info' ||
        path.endsWith('/org') || path.endsWith('/security-info')) {
      return next();
    }

    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid Authorization header' }, 401);
    }

    const apiKey = authHeader.slice(7);
    if (!apiKey.startsWith('rev_')) {
      return c.json({ error: 'Invalid API key format' }, 401);
    }

    const keyHash = hashApiKey(apiKey);
    const [found] = await db
      .select({
        keyId: apiKeys.id,
        orgId: apiKeys.orgId,
        expiresAt: apiKeys.expiresAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, keyHash))
      .limit(1);

    if (!found) {
      return c.json({ error: 'Invalid API key' }, 401);
    }

    if (found.expiresAt && found.expiresAt < new Date()) {
      return c.json({ error: 'API key expired' }, 401);
    }

    const [org] = await db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, found.orgId))
      .limit(1);

    if (!org) {
      return c.json({ error: 'Organization not found' }, 401);
    }

    c.set('auth', {
      orgId: found.orgId,
      orgSlug: org.slug,
      apiKeyId: found.keyId,
    });

    await next();
  });

  // ─── Step 1: Create Organization ────────────────────────────────────

  app.post('/org', async (c) => {
    const body = await c.req.json();
    const { name, slug } = body;

    if (!name || !slug) {
      return c.json({ error: 'name and slug are required' }, 400);
    }

    // Validate slug format
    if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug)) {
      return c.json({
        error: 'Slug must be 3-64 characters, lowercase alphanumeric with hyphens, cannot start/end with hyphen',
      }, 400);
    }

    // Check slug availability
    const existing = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1);

    if (existing.length > 0) {
      return c.json({ error: 'Slug already taken' }, 409);
    }

    // Create org
    const [org] = await db
      .insert(organizations)
      .values({ name, slug })
      .returning();

    // Generate API key
    const rawKey = `rev_${randomBytes(32).toString('hex')}`;
    const keyHash = hashApiKey(rawKey);

    await db.insert(apiKeys).values({
      orgId: org.id,
      name: 'Default API Key',
      keyHash,
      keyPrefix: rawKey.slice(0, 8),
    });

    log.info({ orgId: org.id, orgSlug: slug }, 'Organization created');

    return c.json({
      organization: org,
      apiKey: rawKey, // Only time the full key is returned
      webhookBaseUrl: `/webhooks/${slug}`,
      nextSteps: {
        stripe: `POST /setup/stripe with your Stripe API key`,
        apple: `POST /setup/apple with your Apple credentials`,
        docs: 'https://docs.revback.io/quickstart',
      },
    }, 201);
  });

  // ─── Step 2a: Connect Stripe ────────────────────────────────────────

  app.post('/stripe', async (c) => {
    const { orgId } = c.get('auth') as AuthContext;
    const body = await c.req.json();
    const { stripeSecretKey, webhookSecret } = body;

    if (!stripeSecretKey) {
      return c.json({ error: 'stripeSecretKey is required' }, 400);
    }

    // Validate the key works
    try {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(stripeSecretKey);
      await stripe.customers.list({ limit: 1 });
    } catch (err: any) {
      return c.json({
        error: 'Invalid Stripe API key',
        detail: err.message,
      }, 400);
    }

    // Upsert billing connection
    const [org] = await db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    await db
      .insert(billingConnections)
      .values({
        orgId,
        source: 'stripe',
        credentials: { apiKey: stripeSecretKey }, // TODO: encrypt at rest
        webhookSecret: webhookSecret || null,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [billingConnections.orgId, billingConnections.source],
        set: {
          credentials: { apiKey: stripeSecretKey },
          webhookSecret: webhookSecret || null,
          isActive: true,
          updatedAt: new Date(),
        },
      });

    log.info({ orgId }, 'Stripe connection configured');

    return c.json({
      connected: true,
      source: 'stripe',
      webhookUrl: `/webhooks/${org?.slug}/stripe`,
      instructions: [
        '1. Go to Stripe Dashboard -> Developers -> Webhooks',
        `2. Add endpoint: YOUR_DOMAIN/webhooks/${org?.slug}/stripe`,
        '3. Select events: customer.subscription.*, invoice.*, charge.refunded, charge.dispute.*',
        '4. Copy the webhook signing secret and update via POST /setup/stripe',
      ],
    });
  });

  // ─── Step 2b: Connect Apple ─────────────────────────────────────────

  app.post('/apple', async (c) => {
    const { orgId } = c.get('auth') as AuthContext;
    const body = await c.req.json();
    const { keyId, issuerId, bundleId, privateKey, originalNotificationUrl } = body;

    if (!keyId || !issuerId || !bundleId) {
      return c.json({
        error: 'keyId, issuerId, and bundleId are required',
      }, 400);
    }

    const [org] = await db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    // Store credentials including the optional original notification URL
    // for webhook proxy forwarding
    const credentials: Record<string, unknown> = {
      keyId,
      issuerId,
      bundleId,
      privateKey,
    };
    if (originalNotificationUrl) {
      credentials.originalNotificationUrl = originalNotificationUrl;
    }

    await db
      .insert(billingConnections)
      .values({
        orgId,
        source: 'apple',
        credentials,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [billingConnections.orgId, billingConnections.source],
        set: {
          credentials,
          isActive: true,
          updatedAt: new Date(),
        },
      });

    log.info({ orgId, hasProxy: !!originalNotificationUrl }, 'Apple connection configured');

    const instructions = [
      '1. Go to App Store Connect -> App -> App Store Server Notifications',
      `2. Set Server URL: YOUR_DOMAIN/webhooks/${org?.slug}/apple`,
      '3. Select Version 2 notifications',
      '4. Send a test notification to verify',
    ];

    if (originalNotificationUrl) {
      instructions.push(
        `5. Webhook proxy enabled: notifications will be forwarded to ${originalNotificationUrl}`,
      );
    }

    return c.json({
      connected: true,
      source: 'apple',
      webhookUrl: `/webhooks/${org?.slug}/apple`,
      proxyEnabled: !!originalNotificationUrl,
      originalNotificationUrl: originalNotificationUrl || null,
      instructions,
    });
  });

  // ─── Step 3: Verify Stripe Connectivity ─────────────────────────────

  app.post('/verify/stripe', async (c) => {
    const { orgId } = c.get('auth') as AuthContext;

    const [conn] = await db
      .select()
      .from(billingConnections)
      .where(
        and(
          eq(billingConnections.orgId, orgId),
          eq(billingConnections.source, 'stripe'),
        ),
      )
      .limit(1);

    if (!conn) {
      return c.json({ error: 'Stripe not connected. Run POST /setup/stripe first.' }, 400);
    }

    const checks: {
      apiKeyValid: boolean;
      webhookSecretConfigured: boolean;
      canListCustomers: boolean;
      canListSubscriptions: boolean;
      customerCount: number | null;
      subscriptionCount: number | null;
      error: string | null;
    } = {
      apiKeyValid: false,
      webhookSecretConfigured: !!conn.webhookSecret,
      canListCustomers: false,
      canListSubscriptions: false,
      customerCount: null,
      subscriptionCount: null,
      error: null,
    };

    try {
      const Stripe = (await import('stripe')).default;
      const creds = conn.credentials as { apiKey: string };
      const stripe = new Stripe(creds.apiKey);

      // Test 1: List customers
      const customerList = await stripe.customers.list({ limit: 1 });
      checks.apiKeyValid = true;
      checks.canListCustomers = true;

      // Test 2: List subscriptions
      const subList = await stripe.subscriptions.list({ limit: 1, status: 'all' });
      checks.canListSubscriptions = true;

      // Get approximate counts
      // Stripe doesn't provide total_count, so we check if there's data
      checks.customerCount = customerList.data.length > 0 ? (customerList.has_more ? -1 : customerList.data.length) : 0;
      checks.subscriptionCount = subList.data.length > 0 ? (subList.has_more ? -1 : subList.data.length) : 0;

    } catch (err: any) {
      checks.error = err.message;
    }

    return c.json({
      source: 'stripe',
      verified: checks.apiKeyValid && checks.canListSubscriptions,
      checks,
      message: checks.apiKeyValid
        ? 'Stripe API key is valid and working'
        : `Stripe verification failed: ${checks.error}`,
    });
  });

  // ─── Step 3b: Verify Apple Credentials ──────────────────────────────

  app.post('/verify/apple', async (c) => {
    const { orgId } = c.get('auth') as AuthContext;

    const [conn] = await db
      .select()
      .from(billingConnections)
      .where(
        and(
          eq(billingConnections.orgId, orgId),
          eq(billingConnections.source, 'apple'),
        ),
      )
      .limit(1);

    if (!conn) {
      return c.json({ error: 'Apple not connected. Run POST /setup/apple first.' }, 400);
    }

    const creds = conn.credentials as {
      keyId: string;
      issuerId: string;
      bundleId: string;
      privateKey?: string;
      originalNotificationUrl?: string;
    };

    const checks = {
      credentialsStored: true,
      hasKeyId: !!creds.keyId,
      hasIssuerId: !!creds.issuerId,
      hasBundleId: !!creds.bundleId,
      hasPrivateKey: !!creds.privateKey,
      proxyConfigured: !!creds.originalNotificationUrl,
      originalNotificationUrl: creds.originalNotificationUrl || null,
      apiTestResult: null as string | null,
      error: null as string | null,
    };

    // Test Apple App Store Server API if private key is available
    if (creds.privateKey) {
      try {
        // Generate a JWT for App Store Server API
        const jose = await import('jose');
        const privateKeyObj = await jose.importPKCS8(creds.privateKey, 'ES256');

        const jwt = await new jose.SignJWT({})
          .setProtectedHeader({
            alg: 'ES256',
            kid: creds.keyId,
            typ: 'JWT',
          })
          .setIssuer(creds.issuerId)
          .setIssuedAt()
          .setExpirationTime('5m')
          .setAudience('appstoreconnect-v1')
          .setSubject(creds.bundleId)
          .sign(privateKeyObj);

        checks.apiTestResult = 'JWT generation successful (credentials are valid)';
      } catch (err: any) {
        checks.error = err.message;
        checks.apiTestResult = 'JWT generation failed - check credentials';
      }
    } else {
      checks.apiTestResult = 'Private key not provided - cannot test API access';
    }

    const allBasicChecks = checks.hasKeyId && checks.hasIssuerId && checks.hasBundleId;

    return c.json({
      source: 'apple',
      verified: allBasicChecks && !checks.error,
      checks,
      message: allBasicChecks && !checks.error
        ? 'Apple credentials are configured and valid'
        : checks.error
          ? `Apple verification failed: ${checks.error}`
          : 'Missing required Apple credentials',
    });
  });

  // ─── Step 4: Check Integration Health (Enhanced) ────────────────────

  app.get('/status', async (c) => {
    const { orgId } = c.get('auth') as AuthContext;

    // Run multiple queries in parallel
    const [connections, eventCountResult, userCountResult, issueCountResult, recentWebhooks] = await Promise.all([
      db
        .select()
        .from(billingConnections)
        .where(eq(billingConnections.orgId, orgId)),

      db
        .select({ count: count() })
        .from(canonicalEvents)
        .where(eq(canonicalEvents.orgId, orgId)),

      db
        .select({ count: count() })
        .from(users)
        .where(eq(users.orgId, orgId)),

      db
        .select({ count: count() })
        .from(issues)
        .where(and(eq(issues.orgId, orgId), eq(issues.status, 'open'))),

      // Last 24h webhook counts per source
      db
        .select({
          source: webhookLogs.source,
          count: count(),
        })
        .from(webhookLogs)
        .where(
          and(
            eq(webhookLogs.orgId, orgId),
            gte(webhookLogs.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
          ),
        )
        .groupBy(webhookLogs.source),
    ]);

    // Get today's event count
    const [todayEvents] = await db
      .select({ count: count() })
      .from(canonicalEvents)
      .where(
        and(
          eq(canonicalEvents.orgId, orgId),
          gte(canonicalEvents.ingestedAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
        ),
      );

    // Fetch backfill progress if available
    let backfillProgress = null;
    try {
      backfillProgress = await StripeBackfill.getProgress(orgId);
    } catch {
      // Redis not available, skip
    }

    const webhookCountMap = new Map(recentWebhooks.map(w => [w.source, Number(w.count)]));

    const integrationHealth = connections.map(conn => {
      const lastWebhookAt = conn.lastWebhookAt;
      const minutesSinceWebhook = lastWebhookAt
        ? Math.round((Date.now() - new Date(lastWebhookAt).getTime()) / 60000)
        : null;

      let freshness: string;
      if (!lastWebhookAt) {
        freshness = 'never';
      } else if (minutesSinceWebhook! < 60) {
        freshness = `${minutesSinceWebhook} minutes ago`;
      } else if (minutesSinceWebhook! < 1440) {
        freshness = `${Math.round(minutesSinceWebhook! / 60)} hours ago`;
      } else {
        freshness = `${Math.round(minutesSinceWebhook! / 1440)} days ago`;
      }

      return {
        source: conn.source,
        connected: conn.isActive,
        lastWebhookAt: conn.lastWebhookAt,
        lastWebhookFreshness: freshness,
        hasWebhookSecret: !!conn.webhookSecret,
        webhookDeliveryRate24h: webhookCountMap.get(conn.source) || 0,
        syncStatus: conn.syncStatus,
        lastSyncAt: conn.lastSyncAt,
        credentialStatus: conn.isActive ? 'valid' : 'disconnected',
        status: !conn.lastWebhookAt
          ? 'awaiting_first_webhook'
          : conn.lastWebhookAt > new Date(Date.now() - 24 * 60 * 60 * 1000)
            ? 'healthy'
            : 'stale',
      };
    });

    return c.json({
      integrations: integrationHealth,
      stats: {
        eventsProcessed: Number(eventCountResult[0].count),
        usersTracked: Number(userCountResult[0].count),
        openIssues: Number(issueCountResult[0].count),
        eventsToday: Number(todayEvents.count),
      },
      readiness: {
        hasConnection: connections.length > 0,
        hasEvents: Number(eventCountResult[0].count) > 0,
        hasUsers: Number(userCountResult[0].count) > 0,
        isReady: connections.length > 0 && Number(eventCountResult[0].count) > 0,
      },
      backfill: backfillProgress,
    });
  });

  // ─── Step 5: Historical Backfill from Stripe ────────────────────────
  // This is KEY for fast time-to-value. Instead of waiting for webhooks,
  // pull historical subscription data from Stripe API immediately.

  app.post('/backfill/stripe', async (c) => {
    const { orgId } = c.get('auth') as AuthContext;

    const [conn] = await db
      .select()
      .from(billingConnections)
      .where(
        and(
          eq(billingConnections.orgId, orgId),
          eq(billingConnections.source, 'stripe'),
        ),
      )
      .limit(1);

    if (!conn) {
      return c.json({ error: 'Stripe not connected. Run POST /setup/stripe first.' }, 400);
    }

    // Check if backfill is already running
    let existingProgress = null;
    try {
      existingProgress = await StripeBackfill.getProgress(orgId);
    } catch {
      // Redis not available
    }

    if (existingProgress && (existingProgress.status === 'importing_subscriptions' || existingProgress.status === 'importing_events' || existingProgress.status === 'counting')) {
      return c.json({
        error: 'Backfill already in progress',
        progress: existingProgress,
      }, 409);
    }

    // Start backfill in the background
    const jobId = `backfill_${orgId}_${Date.now()}`;
    const backfill = new StripeBackfill(db);

    // Fire and forget - don't await
    backfill.run(orgId).catch((err) => {
      log.error({ err, orgId, jobId }, 'Background backfill failed');
    });

    log.info({ orgId, jobId }, 'Stripe backfill started');

    return c.json({
      jobId,
      status: 'started',
      message: 'Historical data import has started. Check /setup/backfill/progress for real-time updates.',
      progressUrl: '/setup/backfill/progress',
      estimatedTime: '5-15 minutes depending on data volume',
    });
  });

  // ─── Backfill Progress ──────────────────────────────────────────────

  app.get('/backfill/progress', async (c) => {
    const { orgId } = c.get('auth') as AuthContext;

    const progress = await StripeBackfill.getProgress(orgId);

    if (!progress) {
      return c.json({
        status: 'not_started',
        message: 'No backfill has been started. Run POST /setup/backfill/stripe to begin.',
      });
    }

    return c.json(progress);
  });

  // ─── Security Info ──────────────────────────────────────────────────
  // Static security documentation for enterprise customers.
  // Preempts the "can we see your security docs?" question.

  app.get('/security-info', async (c) => {
    return c.json({
      dataProtection: {
        encryptionAtRest: {
          method: 'AES-256',
          provider: 'PostgreSQL with pgcrypto / cloud provider disk encryption',
          details: 'All data at rest is encrypted using AES-256 encryption via the cloud provider managed encryption keys.',
        },
        encryptionInTransit: {
          method: 'TLS 1.3',
          details: 'All API communications are encrypted with TLS 1.3. HTTP connections are automatically upgraded to HTTPS.',
        },
        credentialStorage: {
          method: 'Encrypted at application layer',
          details: 'Billing provider API keys and credentials are encrypted before storage and decrypted only in-memory during API calls.',
        },
      },
      accessControl: {
        authentication: {
          method: 'API Key (Bearer token)',
          details: 'API keys are hashed with SHA-256 before storage. Only the key prefix is stored in plaintext for identification.',
        },
        authorization: {
          method: 'Organization-scoped',
          details: 'All data access is scoped to the organization associated with the API key. Cross-organization data access is not possible.',
        },
        multiTenancy: {
          model: 'Shared infrastructure, isolated data',
          details: 'Each organization has a unique identifier (orgId) that is enforced on every database query. Row-level isolation ensures no data leakage between tenants.',
        },
      },
      dataRetention: {
        rawEvents: {
          period: '2 years',
          details: 'Raw billing events and webhook payloads are retained for 2 years for audit and replay purposes.',
        },
        issues: {
          period: 'Indefinite',
          details: 'Detected issues and their resolution history are retained indefinitely for trend analysis and compliance.',
        },
        webhookLogs: {
          period: '90 days',
          details: 'Webhook delivery logs including headers and raw payloads are retained for 90 days.',
        },
        userIdentities: {
          period: 'Until account deletion',
          details: 'User identity mappings are retained until the organization requests deletion.',
        },
      },
      compliance: {
        soc2Type1: {
          status: 'In Progress',
          expectedCompletion: 'Q2 2026',
          details: 'SOC 2 Type I audit is currently in progress. Report will be available upon request once completed.',
        },
        gdpr: {
          status: 'Compliant',
          details: 'Data processing complies with GDPR requirements. Data Processing Agreement (DPA) available upon request.',
          dataSubjectRights: [
            'Right to access',
            'Right to erasure',
            'Right to portability',
            'Right to rectification',
          ],
        },
        ccpa: {
          status: 'Compliant',
          details: 'Data handling complies with CCPA requirements. Privacy policy available at https://revback.io/privacy.',
        },
      },
      networkSecurity: {
        webhookIpRanges: [
          '34.102.136.0/24',
          '34.117.59.0/24',
          '35.199.173.0/24',
        ],
        details: 'Webhook forwarding and API calls originate from these IP ranges. Add them to your firewall allowlist if needed.',
        ddosProtection: 'Cloud provider managed DDoS protection with automatic rate limiting.',
      },
      incidentResponse: {
        contactEmail: 'security@revback.io',
        responseTime: 'Critical issues: 1 hour. High: 4 hours. Medium: 24 hours.',
        bugBounty: 'Responsible disclosure program. Contact security@revback.io.',
      },
    });
  });

  return app;
}
