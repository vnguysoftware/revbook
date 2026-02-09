import { sql } from 'drizzle-orm';
import { getDb, closeDb } from '../src/config/database.js';

async function migrate() {
  const db = getDb();

  // Add detection_tier column to issues
  await db.execute(
    sql.raw(`ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "detection_tier" varchar(20) NOT NULL DEFAULT 'billing_only'`)
  );
  console.log('Added detection_tier column to issues');

  // Create access_checks table
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "access_checks" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
        "user_id" uuid REFERENCES "users"("id"),
        "product_id" uuid REFERENCES "products"("id"),
        "external_user_id" varchar(512) NOT NULL,
        "has_access" boolean NOT NULL,
        "reported_at" timestamp NOT NULL,
        "metadata" jsonb DEFAULT '{}'::jsonb,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `)
  );
  console.log('Created access_checks table');

  // Create indexes
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "access_checks_org_idx" ON "access_checks" ("org_id")`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "access_checks_org_user_idx" ON "access_checks" ("org_id", "user_id")`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "access_checks_org_reported_idx" ON "access_checks" ("org_id", "reported_at")`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "access_checks_external_user_idx" ON "access_checks" ("org_id", "external_user_id")`));
  console.log('Created indexes');

  await closeDb();
  console.log('Migration complete!');
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
