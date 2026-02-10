import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createDataManagementRoutes } from '../../api/data-management.js';
import type { AuthContext } from '../../middleware/auth.js';

// Mock the logger
vi.mock('../../config/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock the audit module
vi.mock('../../security/audit.js', () => ({
  auditLog: vi.fn(),
}));

// Mock the require-scope middleware to pass through
vi.mock('../../middleware/require-scope.js', () => ({
  requireScope: () => async (_c: any, next: any) => next(),
}));

const TEST_ORG_ID = 'org-test-123';
const TEST_USER_ID = 'user-test-456';

function createAuth(): AuthContext {
  return {
    orgId: TEST_ORG_ID,
    orgSlug: 'test-org',
    apiKeyId: 'key-test-789',
    scopes: ['admin:write', 'admin:read'],
  };
}

describe('Data Management API', () => {
  let app: Hono;
  let mockDb: any;

  beforeEach(() => {
    mockDb = createDataManagementMockDb();
    const routes = createDataManagementRoutes(mockDb);

    app = new Hono();
    // Inject auth context
    app.use('*', async (c, next) => {
      c.set('auth', createAuth());
      await next();
    });
    app.route('/data-management', routes);
  });

  describe('DELETE /data-management/users/:userId/data', () => {
    it('should return 404 when user not found', async () => {
      mockDb._configureUserLookup(null);

      const res = await app.request('/data-management/users/nonexistent/data', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('User not found');
    });

    it('should delete all user data and return counts', async () => {
      mockDb._configureUserLookup({ id: TEST_USER_ID });
      mockDb._configureDeleteCounts({
        accessChecks: 2,
        issues: 3,
        entitlements: 1,
        events: 15,
        identities: 2,
      });

      const res = await app.request(`/data-management/users/${TEST_USER_ID}/data`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.userId).toBe(TEST_USER_ID);
      expect(body.deleted).toBeDefined();
      expect(body.deleted.userDeleted).toBe(true);
      expect(body.deleted.accessChecksDeleted).toBe(2);
      expect(body.deleted.issuesDeleted).toBe(3);
      expect(body.deleted.entitlementsDeleted).toBe(1);
      expect(body.deleted.eventsDeleted).toBe(15);
      expect(body.deleted.identitiesDeleted).toBe(2);
      expect(body.message).toContain('permanently deleted');
    });

    it('should handle user with no related data', async () => {
      mockDb._configureUserLookup({ id: TEST_USER_ID });
      mockDb._configureDeleteCounts({
        accessChecks: 0,
        issues: 0,
        entitlements: 0,
        events: 0,
        identities: 0,
      });

      const res = await app.request(`/data-management/users/${TEST_USER_ID}/data`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.deleted.eventsDeleted).toBe(0);
      expect(body.deleted.userDeleted).toBe(true);
    });
  });

  describe('GET /data-management/users/:userId/data-export', () => {
    it('should return 404 when user not found', async () => {
      mockDb._configureUserLookup(null);

      const res = await app.request('/data-management/users/nonexistent/data-export');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('User not found');
    });

    it('should export all user data', async () => {
      const testUser = {
        id: TEST_USER_ID,
        externalUserId: 'ext_user_1',
        email: 'test@example.com',
        metadata: { plan: 'premium' },
        createdAt: new Date('2025-01-01'),
      };

      mockDb._configureUserLookup(testUser);
      mockDb._configureExportData({
        identities: [
          { source: 'stripe', externalId: 'cus_123', idType: 'customer_id', createdAt: new Date('2025-01-01') },
        ],
        events: [
          {
            id: 'evt-1',
            source: 'stripe',
            eventType: 'renewal',
            eventTime: new Date('2025-01-15'),
            status: 'success',
            amountCents: 1999,
            currency: 'USD',
            createdAt: new Date('2025-01-15'),
          },
        ],
        entitlements: [
          {
            id: 'ent-1',
            productId: 'prod-1',
            source: 'stripe',
            state: 'active',
            currentPeriodStart: new Date('2025-01-01'),
            currentPeriodEnd: new Date('2025-02-01'),
            createdAt: new Date('2025-01-01'),
          },
        ],
        issues: [
          {
            id: 'iss-1',
            issueType: 'duplicate_billing',
            severity: 'warning',
            status: 'open',
            title: 'Duplicate billing detected',
            description: 'User billed on both platforms',
            createdAt: new Date('2025-01-10'),
            resolvedAt: null,
          },
        ],
        accessChecks: [
          {
            id: 'ac-1',
            externalUserId: 'ext_user_1',
            hasAccess: true,
            reportedAt: new Date('2025-01-15'),
          },
        ],
      });

      const res = await app.request(`/data-management/users/${TEST_USER_ID}/data-export`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.exportedAt).toBeDefined();
      expect(body.user.id).toBe(TEST_USER_ID);
      expect(body.user.email).toBe('test@example.com');
      expect(body.identities).toHaveLength(1);
      expect(body.events).toHaveLength(1);
      expect(body.entitlements).toHaveLength(1);
      expect(body.issues).toHaveLength(1);
      expect(body.accessChecks).toHaveLength(1);
    });

    it('should export empty arrays when user has no related data', async () => {
      const testUser = {
        id: TEST_USER_ID,
        externalUserId: 'ext_user_1',
        email: 'test@example.com',
        metadata: {},
        createdAt: new Date('2025-01-01'),
      };

      mockDb._configureUserLookup(testUser);
      mockDb._configureExportData({
        identities: [],
        events: [],
        entitlements: [],
        issues: [],
        accessChecks: [],
      });

      const res = await app.request(`/data-management/users/${TEST_USER_ID}/data-export`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.identities).toHaveLength(0);
      expect(body.events).toHaveLength(0);
      expect(body.entitlements).toHaveLength(0);
      expect(body.issues).toHaveLength(0);
      expect(body.accessChecks).toHaveLength(0);
    });
  });
});

/**
 * Creates a mock database for data management routes.
 *
 * This mock handles the complex patterns in the data management API:
 * - User lookup via select().from().where().limit()
 * - Transaction-based deletions with returning()
 * - Parallel data export queries via Promise.all with then()
 */
function createDataManagementMockDb() {
  let userLookupResult: any = null;
  let deleteCounts = {
    accessChecks: 0,
    issues: 0,
    entitlements: 0,
    events: 0,
    identities: 0,
  };
  let exportData: any = {
    identities: [],
    events: [],
    entitlements: [],
    issues: [],
    accessChecks: [],
  };

  // Track delete call order to return proper counts
  let deleteCallCount = 0;
  // Track then call order for export queries
  let thenCallCount = 0;

  const chainable: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockImplementation(() => {
      deleteCallCount++;
      return chainable;
    }),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    and: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => {
      return Promise.resolve(userLookupResult ? [userLookupResult] : []);
    }),
    returning: vi.fn().mockImplementation(() => {
      // Returns arrays of { id } objects matching the count
      const currentDelete = deleteCallCount;
      let count = 0;
      switch (currentDelete) {
        case 1: count = deleteCounts.accessChecks; break;
        case 2: count = deleteCounts.issues; break;
        case 3: count = deleteCounts.entitlements; break;
        case 4: count = deleteCounts.events; break;
        case 5: count = deleteCounts.identities; break;
        default: count = 0;
      }
      return Promise.resolve(Array.from({ length: count }, (_, i) => ({ id: `deleted-${currentDelete}-${i}` })));
    }),
    catch: vi.fn().mockReturnThis(),
    then: vi.fn().mockImplementation((resolve: any) => {
      thenCallCount++;
      switch (thenCallCount) {
        case 1: return resolve(exportData.identities);
        case 2: return resolve(exportData.events);
        case 3: return resolve(exportData.entitlements);
        case 4: return resolve(exportData.issues);
        case 5: return resolve(exportData.accessChecks);
        default: return resolve([]);
      }
    }),

    // Transaction support: pass-through that calls the callback with the same mock
    transaction: vi.fn().mockImplementation(async (cb: any) => {
      deleteCallCount = 0;
      return cb(chainable);
    }),

    _configureUserLookup(user: any) {
      userLookupResult = user;
      deleteCallCount = 0;
      thenCallCount = 0;
    },
    _configureDeleteCounts(counts: typeof deleteCounts) {
      deleteCounts = counts;
      deleteCallCount = 0;
    },
    _configureExportData(data: typeof exportData) {
      exportData = data;
      thenCallCount = 0;
    },
  };

  return chainable;
}
