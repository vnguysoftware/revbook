import { eq, sql } from 'drizzle-orm';
import type { Database } from '../config/database.js';
import { accessChecks } from '../models/schema.js';

/**
 * Check whether an org has any access-check data.
 * Used by Tier 2 detectors to early-return if the org
 * hasn't integrated the access-check SDK.
 */
export async function hasAccessCheckData(db: Database, orgId: string): Promise<boolean> {
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(accessChecks)
    .where(eq(accessChecks.orgId, orgId));

  return Number(result?.count || 0) > 0;
}
