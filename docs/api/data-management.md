# Data Management (GDPR)

Base path: `/api/v1/data-management`

GDPR right-to-delete and data portability endpoints.

---

### DELETE /api/v1/data-management/users/:userId/data

Permanently delete all data for a user (GDPR right to erasure).

**Auth:** Bearer token
**Scope:** `admin:write`

Deletes in dependency order within a transaction: access checks, issues, entitlements, canonical events, user identities, then the user record. An audit log entry is created before deletion.

**Response (200):**

```json
{
  "ok": true,
  "userId": "550e8400-...",
  "deleted": {
    "accessChecksDeleted": 5,
    "issuesDeleted": 2,
    "entitlementsDeleted": 1,
    "eventsDeleted": 47,
    "identitiesDeleted": 3,
    "userDeleted": true
  },
  "message": "All user data has been permanently deleted."
}
```

```bash
curl -X DELETE https://your-domain.com/api/v1/data-management/users/550e8400-.../data \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### GET /api/v1/data-management/users/:userId/data-export

Export all data for a user (GDPR right to portability).

**Auth:** Bearer token
**Scope:** `admin:read`

**Response (200):**

```json
{
  "exportedAt": "2026-02-10T00:00:00.000Z",
  "user": {
    "id": "...",
    "externalUserId": "usr_abc123",
    "email": "user@example.com",
    "metadata": {},
    "createdAt": "..."
  },
  "identities": [
    {
      "source": "stripe",
      "externalId": "cus_ABC123",
      "idType": "customer_id",
      "createdAt": "..."
    }
  ],
  "events": [
    {
      "id": "...",
      "source": "stripe",
      "eventType": "renewal",
      "eventTime": "...",
      "status": "success",
      "amountCents": 4999,
      "currency": "USD",
      "createdAt": "..."
    }
  ],
  "entitlements": [
    {
      "id": "...",
      "productId": "...",
      "source": "stripe",
      "state": "active",
      "currentPeriodStart": "...",
      "currentPeriodEnd": "...",
      "createdAt": "..."
    }
  ],
  "issues": [
    {
      "id": "...",
      "issueType": "unrevoked_refund",
      "severity": "critical",
      "status": "resolved",
      "title": "...",
      "description": "...",
      "createdAt": "...",
      "resolvedAt": "..."
    }
  ],
  "accessChecks": [
    {
      "id": "...",
      "externalUserId": "user@example.com",
      "hasAccess": true,
      "reportedAt": "..."
    }
  ]
}
```

```bash
curl https://your-domain.com/api/v1/data-management/users/550e8400-.../data-export \
  -H "Authorization: Bearer rev_your_api_key"
```
