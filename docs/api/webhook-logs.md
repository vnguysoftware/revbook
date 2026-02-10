# Webhook Logs

Base path: `/api/v1/webhook-logs`

Audit trail and delivery statistics for all incoming webhooks from billing providers.

---

### GET /api/v1/webhook-logs

List recent webhook delivery logs with filtering.

**Auth:** Bearer token
**Scope:** `admin:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | `50` | Max results (max 200) |
| `offset` | number | `0` | Pagination offset |
| `source` | string | - | Filter by billing source: `stripe`, `apple`, `google`, `recurly` |
| `status` | string | - | Filter by processing status: `received`, `processed`, `failed` |

**Response (200):**

```json
{
  "logs": [
    {
      "id": "550e8400-...",
      "orgId": "...",
      "source": "stripe",
      "sourceEventType": "customer.subscription.updated",
      "status": "processed",
      "receivedAt": "2026-02-10T12:00:00.000Z",
      "processedAt": "2026-02-10T12:00:01.000Z",
      "processingTimeMs": 85,
      "httpStatus": 200
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "count": 15420
  }
}
```

```bash
curl "https://your-domain.com/api/v1/webhook-logs?source=stripe&limit=20" \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### GET /api/v1/webhook-logs/stats

Aggregate webhook delivery statistics.

**Auth:** Bearer token
**Scope:** `admin:read`

**Response (200):**

```json
{
  "totalReceived": 15420,
  "totalProcessed": 15418,
  "totalFailed": 2,
  "bySource": [
    { "source": "stripe", "received": 10000, "processed": 9999, "failed": 1 },
    { "source": "apple", "received": 5420, "processed": 5419, "failed": 1 }
  ],
  "last24h": {
    "received": 142,
    "processed": 142,
    "failed": 0
  }
}
```

```bash
curl https://your-domain.com/api/v1/webhook-logs/stats \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### GET /api/v1/webhook-logs/:id

Get full detail for a specific webhook log entry, including the raw payload.

**Auth:** Bearer token
**Scope:** `admin:read`

**Response (200):**

```json
{
  "log": {
    "id": "550e8400-...",
    "orgId": "...",
    "source": "stripe",
    "sourceEventType": "customer.subscription.updated",
    "sourceEventId": "evt_xxx",
    "status": "processed",
    "receivedAt": "2026-02-10T12:00:00.000Z",
    "processedAt": "2026-02-10T12:00:01.000Z",
    "processingTimeMs": 85,
    "httpStatus": 200,
    "rawPayload": { ... },
    "errorMessage": null
  }
}
```

```bash
curl https://your-domain.com/api/v1/webhook-logs/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer rev_your_api_key"
```
