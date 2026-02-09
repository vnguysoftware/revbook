import type { Config } from 'drizzle-kit';

export default {
  schema: './src/models/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://localhost:5432/revback',
  },
} satisfies Config;
