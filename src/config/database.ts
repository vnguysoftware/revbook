import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../models/schema.js';
import { createChildLogger } from './logger.js';

const log = createChildLogger('database');

let _db: ReturnType<typeof drizzle> | null = null;
let _client: ReturnType<typeof postgres> | null = null;

export function getDb(databaseUrl?: string) {
  if (!_db) {
    const url = databaseUrl || process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');

    _client = postgres(url, {
      max: 20,
      idle_timeout: 20,
      connect_timeout: 10,
    });
    _db = drizzle(_client, { schema });
    log.info('Database connection pool created');
  }
  return _db;
}

export async function closeDb() {
  if (_client) {
    await _client.end();
    _client = null;
    _db = null;
    log.info('Database connection closed');
  }
}

export type Database = ReturnType<typeof getDb>;
