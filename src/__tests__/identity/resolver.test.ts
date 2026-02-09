import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IdentityResolver } from '../../identity/resolver.js';
import type { IdentityHint } from '../../models/types.js';

// Mock the logger
vi.mock('../../config/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('IdentityResolver', () => {
  const orgId = 'org_test_identity';
  let resolver: IdentityResolver;
  let mockDb: any;

  beforeEach(() => {
    // Reset mocks for each test
    mockDb = createIdentityMockDb();
    resolver = new IdentityResolver(mockDb);
  });

  describe('resolve', () => {
    it('should throw when no hints are provided', async () => {
      await expect(resolver.resolve(orgId, [])).rejects.toThrow(
        'Cannot resolve identity with no hints',
      );
    });

    it('should create a new user when no existing identity matches', async () => {
      const newUserId = 'new-user-uuid-001';

      // No existing identities found
      mockDb._configureSelectResult([]);
      // User creation
      mockDb._configureInsertResult([{ id: newUserId, orgId, email: null, externalUserId: null }]);

      const hints: IdentityHint[] = [
        { source: 'stripe', idType: 'customer_id', externalId: 'cus_new123' },
      ];

      const userId = await resolver.resolve(orgId, hints);

      expect(userId).toBe(newUserId);
      // Should have inserted the user
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should return existing user when identity already exists', async () => {
      const existingUserId = 'existing-user-uuid-001';

      // Configure select to find existing identity
      mockDb._configureSelectResult([{ userId: existingUserId }]);

      const hints: IdentityHint[] = [
        { source: 'stripe', idType: 'customer_id', externalId: 'cus_existing123' },
      ];

      const userId = await resolver.resolve(orgId, hints);

      expect(userId).toBe(existingUserId);
    });

    it('should link new identities when existing user is found', async () => {
      const existingUserId = 'existing-user-uuid-002';

      // First hint finds existing user, second hint doesn't
      let selectCallCount = 0;
      mockDb.limit = vi.fn().mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return Promise.resolve([{ userId: existingUserId }]);
        }
        return Promise.resolve([]);
      });

      const hints: IdentityHint[] = [
        { source: 'stripe', idType: 'customer_id', externalId: 'cus_existing' },
        { source: 'stripe', idType: 'email', externalId: 'user@new.com' },
      ];

      const userId = await resolver.resolve(orgId, hints);

      expect(userId).toBe(existingUserId);
      // Should attempt to link the new identity
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should handle multiple users matching hints (merge scenario)', async () => {
      const userId1 = 'user-1-uuid';
      const userId2 = 'user-2-uuid';

      // First hint matches user1, second hint matches user2
      let selectCallCount = 0;
      mockDb.limit = vi.fn().mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return Promise.resolve([{ userId: userId1 }]);
        }
        if (selectCallCount === 2) {
          return Promise.resolve([{ userId: userId2 }]);
        }
        // For the users.select query in the merge path
        return Promise.resolve([{ id: userId1 }]);
      });

      const hints: IdentityHint[] = [
        { source: 'stripe', idType: 'customer_id', externalId: 'cus_one' },
        { source: 'apple', idType: 'original_transaction_id', externalId: 'txn_two' },
      ];

      const userId = await resolver.resolve(orgId, hints);

      // Should return the first user (MVP strategy)
      expect(userId).toBe(userId1);
    });

    it('should extract email from hints when creating a new user', async () => {
      const newUserId = 'new-user-with-email';

      mockDb._configureSelectResult([]);
      mockDb._configureInsertResult([{
        id: newUserId,
        orgId,
        email: 'user@test.com',
        externalUserId: null,
      }]);

      const hints: IdentityHint[] = [
        { source: 'stripe', idType: 'customer_id', externalId: 'cus_new' },
        { source: 'stripe', idType: 'email', externalId: 'user@test.com' },
      ];

      const userId = await resolver.resolve(orgId, hints);

      expect(userId).toBe(newUserId);
    });

    it('should extract app_user_id from hints when creating a new user', async () => {
      const newUserId = 'new-user-with-app-id';

      mockDb._configureSelectResult([]);
      mockDb._configureInsertResult([{
        id: newUserId,
        orgId,
        email: null,
        externalUserId: 'app_user_789',
      }]);

      const hints: IdentityHint[] = [
        { source: 'apple', idType: 'original_transaction_id', externalId: 'txn_001' },
        { source: 'apple', idType: 'app_user_id', externalId: 'app_user_789' },
      ];

      const userId = await resolver.resolve(orgId, hints);

      expect(userId).toBe(newUserId);
    });

    it('should store all identity links for new users', async () => {
      const newUserId = 'new-user-multi-identity';

      mockDb._configureSelectResult([]);
      mockDb._configureInsertResult([{
        id: newUserId,
        orgId,
        email: null,
        externalUserId: null,
      }]);

      const hints: IdentityHint[] = [
        { source: 'stripe', idType: 'customer_id', externalId: 'cus_multi_1' },
        { source: 'stripe', idType: 'email', externalId: 'multi@test.com' },
        { source: 'stripe', idType: 'app_user_id', externalId: 'app_001' },
      ];

      await resolver.resolve(orgId, hints);

      // insert should be called once for user, then once for each identity
      // Total: 1 (user) + 3 (identities) = 4
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('linkIdentity', () => {
    it('should insert a new identity link', async () => {
      mockDb._configureInsertResult([]);

      await resolver.linkIdentity(orgId, 'user-123', 'stripe', 'cus_link_test', 'customer_id');

      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('getUserIdentities', () => {
    it('should return all identities for a user', async () => {
      const mockIdentities = [
        { id: 'id-1', userId: 'user-123', source: 'stripe', externalId: 'cus_xxx', idType: 'customer_id' },
        { id: 'id-2', userId: 'user-123', source: 'apple', externalId: 'txn_yyy', idType: 'original_transaction_id' },
      ];

      // For getUserIdentities, the final query resolves via .then()
      mockDb.where = vi.fn().mockResolvedValue(mockIdentities);

      const identities = await resolver.getUserIdentities('user-123');

      expect(identities).toHaveLength(2);
      expect(identities[0].source).toBe('stripe');
      expect(identities[1].source).toBe('apple');
    });
  });
});

/**
 * Creates a mock DB tailored for IdentityResolver tests.
 * Supports configuring different results for select and insert operations.
 */
function createIdentityMockDb() {
  let selectResult: any[] = [];
  let insertResult: any[] = [];

  const chainable: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => Promise.resolve(selectResult)),
    returning: vi.fn().mockImplementation(() => Promise.resolve(insertResult)),
    onConflictDoNothing: vi.fn().mockImplementation(() => Promise.resolve([])),
    onConflictDoUpdate: vi.fn().mockImplementation(() => Promise.resolve([])),

    _configureSelectResult(data: any[]) {
      selectResult = data;
    },
    _configureInsertResult(data: any[]) {
      insertResult = data;
    },
  };

  return chainable;
}
