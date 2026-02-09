import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  APPLE_KEY_ID: z.string().optional(),
  APPLE_ISSUER_ID: z.string().optional(),
  APPLE_BUNDLE_ID: z.string().optional(),
  APPLE_PRIVATE_KEY_PATH: z.string().optional(),
  APPLE_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),

  JWT_SECRET: z.string().min(16),
  API_KEY_SALT: z.string().min(16),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // ─── SMTP (optional — email alerts only work if configured) ───
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  // ─── Dashboard URL (for "View in Dashboard" links in alerts) ──
  DASHBOARD_URL: z.string().url().default('http://localhost:5173'),

  // ─── AI / Anthropic (optional — AI features gracefully degrade) ──
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-sonnet-4-5-20250929'),

  // ─── Scheduled Scans ──────────────────────────────────────────────
  ENABLE_SCHEDULED_SCANS: z.enum(['true', 'false']).default('true'),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
      process.exit(1);
    }
    _env = parsed.data;
  }
  return _env;
}
