# Access Checks (SDK)

Base path: `/api/v1/access-checks`

Report access check results from your application SDK. These are used by Tier 2 ("verified") detectors to confirm whether users actually have access to your product.

---

### POST /api/v1/access-checks

Report a single access check.

**Auth:** Bearer token
**Scope:** `access-checks:write`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `user` | string | Yes | External user identifier (email, user ID, or billing platform ID) |
| `productId` | string | No | Product UUID. Required if org has multiple products. Auto-resolved if single product. |
| `hasAccess` | boolean | Yes | Whether the user currently has access |
| `checkedAt` | string (ISO 8601) | No | When the check was performed. Defaults to now. |

**Response (200):**

```json
{
  "ok": true,
  "accessCheckId": "550e8400-..."
}
```

```bash
curl -X POST https://your-domain.com/api/v1/access-checks \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"user": "user@example.com", "hasAccess": true}'
```

---

### POST /api/v1/access-checks/test

Validate an access check payload without storing it. Useful for integration testing.

**Auth:** Bearer token
**Scope:** `access-checks:write`

**Request Body:** Same as `POST /access-checks`.

**Response (200):**

```json
{
  "ok": true,
  "parsed": {
    "user": "user@example.com",
    "hasAccess": true
  },
  "userResolved": true,
  "resolvedUserId": "550e8400-..."
}
```

```bash
curl -X POST https://your-domain.com/api/v1/access-checks/test \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"user": "user@example.com", "hasAccess": true}'
```

---

### POST /api/v1/access-checks/batch

Report up to 100 access checks in a single request.

**Auth:** Bearer token
**Scope:** `access-checks:write`

**Request Body:** Array of access check objects (same schema as single check, max 100).

```json
[
  { "user": "user1@example.com", "hasAccess": true },
  { "user": "user2@example.com", "hasAccess": false }
]
```

**Response (200):**

```json
{
  "ok": true,
  "results": [
    { "ok": true, "accessCheckId": "..." },
    { "ok": true, "accessCheckId": "..." }
  ]
}
```

Individual items that fail still appear in the results with `ok: false` and an error message.

```bash
curl -X POST https://your-domain.com/api/v1/access-checks/batch \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '[{"user":"user1@example.com","hasAccess":true},{"user":"user2@example.com","hasAccess":false}]'
```

---

### GET /api/v1/access-checks

List recent access checks.

**Auth:** Bearer token
**Scope:** `access-checks:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | `50` | Max results (max 100) |

**Response (200):**

```json
{
  "accessChecks": [
    {
      "id": "...",
      "orgId": "...",
      "userId": "...",
      "productId": "...",
      "externalUserId": "user@example.com",
      "hasAccess": true,
      "reportedAt": "2026-02-10T12:00:00.000Z",
      "metadata": {},
      "createdAt": "..."
    }
  ]
}
```

```bash
curl "https://your-domain.com/api/v1/access-checks?limit=20" \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### GET /api/v1/access-checks/stats

Access check statistics for the organization.

**Auth:** Bearer token
**Scope:** `access-checks:read`

**Response (200):**

```json
{
  "accessChecksReceived": 15420,
  "accessChecksToday": 87
}
```

```bash
curl https://your-domain.com/api/v1/access-checks/stats \
  -H "Authorization: Bearer rev_your_api_key"
```
