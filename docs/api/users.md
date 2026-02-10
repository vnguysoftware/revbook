# Users & Subscribers

Base path: `/api/v1/users`

User management with cross-platform identity resolution and timeline views.

---

### GET /api/v1/users

List users with optional search and pagination.

**Auth:** Bearer token
**Scope:** `users:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | `25` | Results per page (max 100) |
| `offset` | number | `0` | Pagination offset |
| `search` | string | - | Search by email or external user ID (min 2 chars, ILIKE match) |

**Response (200):**

```json
{
  "users": [
    {
      "id": "550e8400-...",
      "email": "user@example.com",
      "externalUserId": "usr_abc123",
      "createdAt": "2026-01-15T00:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 25,
    "offset": 0,
    "count": 3200
  }
}
```

```bash
curl "https://your-domain.com/api/v1/users?search=user@example.com&limit=10" \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### GET /api/v1/users/search

Search for users by exact match on email, external user ID, or any identity (Stripe customer_id, Apple original_transaction_id, etc.).

**Auth:** Bearer token
**Scope:** `users:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | - | Search query (min 2 chars, required) |
| `limit` | number | `20` | Results per page (max 50) |

Search priority: email -> external user ID -> identity graph (external IDs from billing providers).

**Response (200):**

```json
{
  "users": [
    {
      "id": "550e8400-...",
      "orgId": "...",
      "email": "user@example.com",
      "externalUserId": "usr_abc123",
      "metadata": {},
      "createdAt": "2026-01-15T00:00:00.000Z",
      "updatedAt": "2026-02-10T00:00:00.000Z"
    }
  ]
}
```

```bash
curl "https://your-domain.com/api/v1/users/search?q=cus_ABC123" \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### GET /api/v1/users/:userId

Full user profile with identities, entitlements, open issues, and recent events.

**Auth:** Bearer token
**Scope:** `users:read`

**Response (200):**

```json
{
  "user": {
    "id": "550e8400-...",
    "orgId": "...",
    "email": "user@example.com",
    "externalUserId": "usr_abc123",
    "metadata": {},
    "createdAt": "...",
    "updatedAt": "..."
  },
  "identities": [
    {
      "id": "...",
      "userId": "...",
      "source": "stripe",
      "externalId": "cus_ABC123",
      "idType": "customer_id",
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
      "currentPeriodEnd": "..."
    }
  ],
  "openIssues": [ ... ],
  "recentEvents": [ ... ]
}
```

The `openIssues` array is limited to the 10 most recent open issues. The `recentEvents` array is limited to the 20 most recent events.

```bash
curl https://your-domain.com/api/v1/users/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### GET /api/v1/users/:userId/timeline

All billing events for a user across all platforms, newest first.

**Auth:** Bearer token
**Scope:** `users:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | `100` | Max events to return (max 500) |

**Response (200):**

```json
{
  "events": [
    {
      "id": "...",
      "source": "stripe",
      "eventType": "renewal",
      "eventTime": "2026-02-01T00:00:00.000Z",
      "status": "success",
      "amountCents": 4999,
      "currency": "USD"
    }
  ]
}
```

```bash
curl "https://your-domain.com/api/v1/users/550e8400-.../timeline?limit=50" \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### GET /api/v1/users/:userId/entitlements

All entitlements for a specific user.

**Auth:** Bearer token
**Scope:** `users:read`

**Response (200):**

```json
{
  "entitlements": [
    {
      "id": "...",
      "productId": "...",
      "source": "stripe",
      "state": "active",
      "externalSubscriptionId": "sub_ABC123",
      "currentPeriodStart": "...",
      "currentPeriodEnd": "...",
      "billingInterval": "month",
      "planTier": "premium"
    }
  ]
}
```

```bash
curl https://your-domain.com/api/v1/users/550e8400-.../entitlements \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### GET /api/v1/users/:userId/identities

All cross-platform identities for a user (Stripe customer ID, Apple transaction ID, etc.).

**Auth:** Bearer token
**Scope:** `users:read`

**Response (200):**

```json
{
  "identities": [
    {
      "id": "...",
      "userId": "...",
      "source": "stripe",
      "externalId": "cus_ABC123",
      "idType": "customer_id",
      "metadata": {},
      "createdAt": "..."
    },
    {
      "id": "...",
      "userId": "...",
      "source": "apple",
      "externalId": "1000000123456789",
      "idType": "original_transaction_id",
      "metadata": {},
      "createdAt": "..."
    }
  ]
}
```

```bash
curl https://your-domain.com/api/v1/users/550e8400-.../identities \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### GET /api/v1/users/:userId/issues

All issues for a specific user.

**Auth:** Bearer token
**Scope:** `users:read`

**Response (200):**

```json
{
  "issues": [ ... ]
}
```

```bash
curl https://your-domain.com/api/v1/users/550e8400-.../issues \
  -H "Authorization: Bearer rev_your_api_key"
```
