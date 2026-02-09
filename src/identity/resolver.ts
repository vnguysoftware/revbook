import { eq, and, inArray, asc } from 'drizzle-orm';
import type { Database } from '../config/database.js';
import { users, userIdentities } from '../models/schema.js';
import type { IdentityHint, BillingSource } from '../models/types.js';
import { createChildLogger } from '../config/logger.js';

const log = createChildLogger('identity-resolver');

/**
 * Identity Resolution Service
 *
 * Resolves a set of identity hints from a billing event into a single
 * canonical user ID. Handles the messiness of cross-platform identity:
 * - Stripe customer_id
 * - Apple original_transaction_id
 * - Google purchase_token
 * - Developer-provided app_user_id
 * - Email
 *
 * Strategy:
 * 1. Check if any hint matches an existing identity → return that user
 * 2. If multiple hints match different users → merge (flag for review)
 * 3. If no match → create new user and store identities
 */
export class IdentityResolver {
  constructor(private db: Database) {}

  /**
   * Resolve identity hints to a user ID.
   * Creates the user if they don't exist yet.
   */
  async resolve(orgId: string, hints: IdentityHint[]): Promise<string> {
    if (hints.length === 0) {
      throw new Error('Cannot resolve identity with no hints');
    }

    // 1. Try to find existing user from any hint
    const matchedUserIds = new Set<string>();
    for (const hint of hints) {
      const existing = await this.db
        .select({ userId: userIdentities.userId })
        .from(userIdentities)
        .where(
          and(
            eq(userIdentities.orgId, orgId),
            eq(userIdentities.source, hint.source),
            eq(userIdentities.externalId, hint.externalId),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        matchedUserIds.add(existing[0].userId);
      }
    }

    // 2. If exactly one user found, link any new identities and return
    if (matchedUserIds.size === 1) {
      const userId = Array.from(matchedUserIds)[0];
      await this.linkNewIdentities(orgId, userId, hints);
      return userId;
    }

    // 3. If multiple users found, we have a merge situation
    //    For MVP: pick the oldest user and log a warning
    if (matchedUserIds.size > 1) {
      log.warn(
        { orgId, matchedUserIds: Array.from(matchedUserIds), hints },
        'Multiple users matched identity hints — possible duplicate accounts',
      );
      // TODO: Create a merge issue for the customer to review
      const userIds = Array.from(matchedUserIds);
      const matchedUsers = await this.db
        .select()
        .from(users)
        .where(
          and(
            eq(users.orgId, orgId),
            inArray(users.id, userIds),
          ),
        )
        .orderBy(asc(users.createdAt))
        .limit(1);

      const primaryUserId = matchedUsers[0].id;
      await this.linkNewIdentities(orgId, primaryUserId, hints);
      return primaryUserId;
    }

    // 4. No match — create new user
    return this.createUser(orgId, hints);
  }

  private async createUser(orgId: string, hints: IdentityHint[]): Promise<string> {
    // Extract email if available
    const emailHint = hints.find(h => h.idType === 'email');
    const appUserIdHint = hints.find(h => h.idType === 'app_user_id');

    const [newUser] = await this.db
      .insert(users)
      .values({
        orgId,
        email: emailHint?.externalId,
        externalUserId: appUserIdHint?.externalId,
      })
      .returning();

    // Store all identity links
    for (const hint of hints) {
      await this.db
        .insert(userIdentities)
        .values({
          userId: newUser.id,
          orgId,
          source: hint.source,
          externalId: hint.externalId,
          idType: hint.idType,
          metadata: hint.metadata || {},
        })
        .onConflictDoNothing();
    }

    log.info({ orgId, userId: newUser.id, hints: hints.length }, 'Created new user from identity hints');
    return newUser.id;
  }

  private async linkNewIdentities(orgId: string, userId: string, hints: IdentityHint[]) {
    for (const hint of hints) {
      await this.db
        .insert(userIdentities)
        .values({
          userId,
          orgId,
          source: hint.source,
          externalId: hint.externalId,
          idType: hint.idType,
          metadata: hint.metadata || {},
        })
        .onConflictDoNothing();
    }
  }

  /**
   * Manual identity linking — used when the customer tells us
   * which external IDs belong to which user via their API/SDK.
   */
  async linkIdentity(
    orgId: string,
    userId: string,
    source: BillingSource,
    externalId: string,
    idType: string,
  ): Promise<void> {
    await this.db
      .insert(userIdentities)
      .values({ userId, orgId, source, externalId, idType })
      .onConflictDoNothing();
  }

  /**
   * Get all known identities for a user — used for the user timeline view.
   */
  async getUserIdentities(userId: string) {
    return this.db
      .select()
      .from(userIdentities)
      .where(eq(userIdentities.userId, userId));
  }
}
