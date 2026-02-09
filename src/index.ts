import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { getDb, closeDb } from './config/database.js';
import { closeAllQueues } from './config/queue.js';
import { createChildLogger } from './config/logger.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { createWebhookRoutes } from './api/webhooks.js';
import { createIssueRoutes } from './api/issues.js';
import { createUserRoutes } from './api/users.js';
import { createDashboardRoutes } from './api/dashboard.js';
import { createOnboardingRoutes } from './api/onboarding.js';
import { createAlertRoutes } from './api/alerts.js';
import { createAccessCheckRoutes } from './api/access-checks.js';
import { createFirstLookRoutes } from './api/first-look.js';
import { createDlqRoutes } from './queue/dlq.js';
import { createQueueMonitorRoutes } from './queue/monitor.js';
import { startWebhookWorker } from './queue/webhook-worker.js';
import { startScanWorker } from './queue/scan-worker.js';
import { startScanScheduler } from './queue/scan-scheduler.js';
import { createScanRoutes } from './api/scans.js';
import { createAiRoutes } from './api/ai.js';
import { startAiWorker } from './agents/worker.js';
import { registerNormalizer } from './ingestion/normalizer/base.js';
import { StripeNormalizer } from './ingestion/providers/stripe.js';
import { AppleNormalizer } from './ingestion/providers/apple.js';
import { createSlackRoutes, isSlackEnabled } from './slack/index.js';

const log = createChildLogger('server');

// ─── Initialize ──────────────────────────────────────────────────────

const db = getDb();

// Register billing source normalizers
registerNormalizer(new StripeNormalizer());
registerNormalizer(new AppleNormalizer());

// Start queue workers
startWebhookWorker();

// Start scan worker and scheduler (respects ENABLE_SCHEDULED_SCANS env var)
const enableScans = process.env.ENABLE_SCHEDULED_SCANS !== 'false';
if (enableScans) {
  startScanWorker();
  startScanScheduler().catch((err) => {
    log.error({ err }, 'Failed to start scan scheduler — scheduled scans disabled');
  });
} else {
  log.info('Scheduled scans disabled via ENABLE_SCHEDULED_SCANS=false');
}

// Start AI investigation worker (only if ANTHROPIC_API_KEY is set)
startAiWorker();

// ─── App Setup ───────────────────────────────────────────────────────

const app = new Hono();

// Global middleware
app.use('*', cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));
app.use('*', honoLogger());

// Security headers
app.use('*', async (c, next) => {
  await next();
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'microphone=(), camera=(), payment=()');
});

// Health check (no auth)
app.get('/health', (c) => c.json({ status: 'ok', version: '0.1.0' }));

// Webhook endpoints (no API key auth — use provider signature verification)
app.route('/webhooks', createWebhookRoutes(db));

// Setup/onboarding (some endpoints need auth, org creation doesn't)
const onboarding = createOnboardingRoutes(db);
app.route('/setup', onboarding);

// Authenticated API routes
const auth = createAuthMiddleware(db);

const api = new Hono();
api.use('*', auth);
// AI routes mounted first so /issues/incidents and /issues/:id/investigation
// are matched before the generic /issues/:issueId wildcard in issue routes.
api.route('/', createAiRoutes(db));
api.route('/issues', createIssueRoutes(db));
api.route('/users', createUserRoutes(db));
api.route('/dashboard', createDashboardRoutes(db));
api.route('/first-look', createFirstLookRoutes(db));
api.route('/alerts', createAlertRoutes(db));
api.route('/access-checks', createAccessCheckRoutes(db));

// Admin routes (also authenticated)
api.route('/admin/dlq', createDlqRoutes());
api.route('/admin/queues', createQueueMonitorRoutes());
api.route('/admin/scans', createScanRoutes(db));

app.route('/api/v1', api);

// Slack CX Bot (only if configured)
if (isSlackEnabled()) {
  app.route('/slack', createSlackRoutes(db));
  log.info('Slack CX bot routes mounted at /slack');
}

// ─── Error Handler ───────────────────────────────────────────────────

app.onError((err, c) => {
  log.error({ err, path: c.req.path }, 'Unhandled error');
  const isDev = process.env.NODE_ENV !== 'production';
  return c.json(
    { error: 'Internal server error', ...(isDev ? { message: err.message } : {}) },
    500,
  );
});

// ─── Graceful Shutdown ───────────────────────────────────────────────

let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    log.warn({ signal }, 'Shutdown already in progress, ignoring');
    return;
  }
  isShuttingDown = true;

  log.info({ signal }, 'Graceful shutdown initiated');

  // 1. Stop accepting new HTTP connections
  if (server) {
    server.close(() => {
      log.info('HTTP server closed');
    });
  }

  // 2. Drain queue workers (wait for active jobs, stop accepting new ones)
  try {
    await closeAllQueues();
    log.info('Queue workers drained and closed');
  } catch (err) {
    log.error({ err }, 'Error during queue shutdown');
  }

  // 3. Close database connections
  try {
    await closeDb();
    log.info('Database connections closed');
  } catch (err) {
    log.error({ err }, 'Error during database shutdown');
  }

  log.info('Graceful shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ─── Start Server ────────────────────────────────────────────────────

const port = parseInt(process.env.PORT || '3000');

const server = serve({ fetch: app.fetch, port }, () => {
  log.info({ port }, `RevBack server running on port ${port}`);
  log.info('Endpoints:');
  log.info('  POST   /setup/org                → Create organization');
  log.info('  POST   /setup/stripe             → Connect Stripe');
  log.info('  POST   /setup/apple              → Connect Apple');
  log.info('  POST   /setup/verify/stripe      → Verify Stripe connectivity');
  log.info('  POST   /setup/verify/apple       → Verify Apple credentials');
  log.info('  GET    /setup/status             → Integration health (enhanced)');
  log.info('  POST   /setup/backfill/stripe    → Import Stripe history');
  log.info('  GET    /setup/backfill/progress  → Backfill progress');
  log.info('  GET    /setup/security-info      → Security documentation');
  log.info('  POST   /webhooks/:org/stripe     → Stripe webhooks');
  log.info('  POST   /webhooks/:org/apple      → Apple webhooks (with proxy)');
  log.info('  GET    /api/v1/first-look        → First Look report');
  log.info('  GET    /api/v1/issues            → Issue feed');
  log.info('  GET    /api/v1/issues/summary    → Issue summary');
  log.info('  GET    /api/v1/dashboard/*       → Dashboard data');
  log.info('  GET    /api/v1/users/search      → Search users');
  log.info('  GET    /api/v1/users/:id         → User profile');
  log.info('  GET    /api/v1/alerts            → List alert configs');
  log.info('  POST   /api/v1/alerts            → Create alert config');
  log.info('  PUT    /api/v1/alerts/:id        → Update alert config');
  log.info('  DELETE /api/v1/alerts/:id        → Delete alert config');
  log.info('  POST   /api/v1/alerts/test       → Send test alert');
  log.info('  GET    /api/v1/alerts/history    → Alert delivery history');
  log.info('  GET    /api/v1/admin/queues      → Queue health');
  log.info('  GET    /api/v1/admin/dlq         → Dead letter queue');
  log.info('  POST   /api/v1/admin/dlq/:id/retry → Retry DLQ job');
  log.info('  POST   /api/v1/admin/dlq/retry-all → Retry all DLQ');
  log.info('  POST   /api/v1/admin/scans/trigger  → Trigger scan now');
  log.info('  GET    /api/v1/admin/scans/history   → Scan history');
  log.info('  GET    /api/v1/admin/scans/schedules → Scan schedules');
  log.info('  --- AI Investigation ---');
  log.info('  GET    /api/v1/issues/:id/investigation → AI root cause analysis');
  log.info('  GET    /api/v1/insights              → AI billing health insights');
  log.info('  GET    /api/v1/issues/incidents       → AI incident clusters');
  log.info('  POST   /api/v1/issues/:id/feedback   → Submit issue feedback');
  log.info('  GET    /api/v1/detectors/health      → Detector accuracy metrics');
  log.info('  GET    /api/v1/ai/status             → AI system status');
});

export default app;
