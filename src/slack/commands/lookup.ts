import { eq, and, sql } from 'drizzle-orm';
import type { Database } from '../../config/database.js';
import { users, userIdentities, entitlements, issues, organizations } from '../../models/schema.js';
import type { SlackMessage } from '../types.js';
import { formatUserLookup, formatError } from '../formatters.js';
import { createChildLogger } from '../../config/logger.js';

const log = createChildLogger('slack-lookup');

/**
 * /rb lookup <email|ID>
 *
 * Cross-org user search for CX engineers. Searches by email, external user ID,
 * or billing platform identity (Stripe customer_id, Apple original_transaction_id, etc.).
 */
export async function handleLookup(db: Database, args: string): Promise<SlackMessage> {
  const query = args.trim();
  if (!query || query.length < 2) {
    return formatError('Usage: `/rb lookup <email|user-id|stripe-customer-id>`\n\nProvide an email address, external user ID, or billing platform ID.');
  }

  log.info({ query }, 'CX lookup');

  // Search across ALL orgs (CX is internal, not tenant-scoped)

  // 1. Try exact email match
  const byEmail = await db
    .select()
    .from(users)
    .where(eq(users.email, query))
    .limit(1);

  if (byEmail.length > 0) {
    return buildUserResponse(db, byEmail[0]);
  }

  // 2. Try external user ID
  const byExternalId = await db
    .select()
    .from(users)
    .where(eq(users.externalUserId, query))
    .limit(1);

  if (byExternalId.length > 0) {
    return buildUserResponse(db, byExternalId[0]);
  }

  // 3. Try identity lookup (Stripe customer_id, Apple original_transaction_id, etc.)
  const byIdentity = await db
    .select({ userId: userIdentities.userId, orgId: userIdentities.orgId })
    .from(userIdentities)
    .where(eq(userIdentities.externalId, query))
    .limit(1);

  if (byIdentity.length > 0) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, byIdentity[0].userId))
      .limit(1);

    if (user) {
      return buildUserResponse(db, user);
    }
  }

  // 4. Try ILIKE for partial email match
  const byPartialEmail = await db
    .select()
    .from(users)
    .where(sql`${users.email} ILIKE ${'%' + query + '%'}`)
    .limit(5);

  if (byPartialEmail.length === 1) {
    return buildUserResponse(db, byPartialEmail[0]);
  }

  if (byPartialEmail.length > 1) {
    const lines = byPartialEmail.map(
      (u) => `\u{2022} \`${u.email || u.externalUserId || u.id}\` (org: \`${u.orgId.slice(0, 8)}...\`)`
    ).join('\n');
    return formatError(`Multiple users found for "${query}". Be more specific:\n${lines}`);
  }

  return formatError(`No user found matching "${query}". Try an exact email, external user ID, or billing platform ID.`);
}

async function buildUserResponse(
  db: Database,
  user: typeof users.$inferSelect,
): Promise<SlackMessage> {
  // Get org name
  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, user.orgId))
    .limit(1);

  // Fetch identities, entitlements, and open issues in parallel
  const [identityList, entitlementList, openIssues] = await Promise.all([
    db.select().from(userIdentities).where(eq(userIdentities.userId, user.id)),
    db.select().from(entitlements).where(
      and(eq(entitlements.orgId, user.orgId), eq(entitlements.userId, user.id)),
    ),
    db.select().from(issues).where(
      and(eq(issues.orgId, user.orgId), eq(issues.userId, user.id), eq(issues.status, 'open')),
    ),
  ]);

  return formatUserLookup(
    user,
    org?.name || 'Unknown',
    identityList,
    entitlementList,
    openIssues,
  );
}
