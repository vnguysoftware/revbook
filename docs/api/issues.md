# Issues & Detection

Base path: `/api/v1/issues`

The core issue management and AI investigation API. Think "Sentry for money."

---

### GET /api/v1/issues

List issues with filtering and pagination.

**Auth:** Bearer token
**Scope:** `issues:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | string | `"open"` | Filter by status: `open`, `acknowledged`, `resolved`, `dismissed` |
| `severity` | string | - | Filter by severity: `critical`, `warning`, `info` |
| `type` | string | - | Filter by issue type (e.g., `unrevoked_refund`) |
| `category` | string | - | Filter by detector category (e.g., `revenue_protection`) |
| `limit` | number | `50` | Results per page (max 100) |
| `offset` | number | `0` | Pagination offset |

**Response (200):**

```json
{
  "issues": [
    {
      "id": "550e8400-...",
      "orgId": "...",
      "userId": "...",
      "issueType": "unrevoked_refund",
      "severity": "critical",
      "status": "open",
      "title": "Refund not revoked: user still has access",
      "description": "User was refunded $49.99 but still has active entitlement...",
      "estimatedRevenueCents": 4999,
      "confidence": 0.95,
      "detectorId": "unrevoked_refund",
      "detectionTier": "billing_only",
      "evidence": { ... },
      "createdAt": "2026-02-10T00:00:00.000Z",
      "updatedAt": "2026-02-10T00:00:00.000Z",
      "category": "revenue_protection",
      "recommendedAction": "Revoke the entitlement for this user...",
      "detectorDisplayName": "Unrevoked Refund"
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "count": 12
  }
}
```

Issues are enriched with detector metadata including `category`, `recommendedAction`, and `detectorDisplayName`.

```bash
curl "https://your-domain.com/api/v1/issues?status=open&severity=critical&limit=10" \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### GET /api/v1/issues/summary

Aggregated issue statistics for dashboard headers.

**Auth:** Bearer token
**Scope:** `issues:read`

**Response (200):**

```json
{
  "open": 47,
  "critical": 5,
  "revenueAtRiskCents": 2300000,
  "byType": [
    {
      "issueType": "unrevoked_refund",
      "count": 12,
      "revenue": "150000",
      "category": "revenue_protection"
    }
  ],
  "byCategory": {
    "revenue_protection": { "count": 15, "revenue": 200000 },
    "cross_platform": { "count": 8, "revenue": 50000 }
  }
}
```

```bash
curl https://your-domain.com/api/v1/issues/summary \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### GET /api/v1/issues/:issueId

Get a single issue with full detail.

**Auth:** Bearer token
**Scope:** `issues:read`

**Response (200):**

```json
{
  "issue": {
    "id": "550e8400-...",
    "issueType": "unrevoked_refund",
    "severity": "critical",
    "status": "open",
    "title": "Refund not revoked: user still has access",
    "description": "...",
    "estimatedRevenueCents": 4999,
    "confidence": 0.95,
    "evidence": { ... },
    "category": "revenue_protection",
    "recommendedAction": "...",
    "detectorDisplayName": "Unrevoked Refund",
    "createdAt": "2026-02-10T00:00:00.000Z",
    "updatedAt": "2026-02-10T00:00:00.000Z"
  }
}
```

```bash
curl https://your-domain.com/api/v1/issues/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### POST /api/v1/issues/:issueId/acknowledge

Mark an issue as acknowledged.

**Auth:** Bearer token
**Scope:** `issues:write`

**Request Body:** None

**Response (200):**

```json
{ "ok": true }
```

Triggers `issue.acknowledged` webhook event.

```bash
curl -X POST https://your-domain.com/api/v1/issues/550e8400-.../acknowledge \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### POST /api/v1/issues/:issueId/resolve

Mark an issue as resolved with optional resolution notes.

**Auth:** Bearer token
**Scope:** `issues:write`

**Request Body (optional):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `resolution` | string | No | Resolution notes (max 2000 chars) |

**Response (200):**

```json
{ "ok": true }
```

Triggers `issue.resolved` webhook event.

```bash
curl -X POST https://your-domain.com/api/v1/issues/550e8400-.../resolve \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"resolution": "Revoked entitlement in Stripe dashboard"}'
```

---

### POST /api/v1/issues/:issueId/dismiss

Dismiss an issue with optional reason.

**Auth:** Bearer token
**Scope:** `issues:write`

**Request Body (optional):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string | No | Dismissal reason (max 2000 chars) |

**Response (200):**

```json
{ "ok": true }
```

Triggers `issue.dismissed` webhook event.

```bash
curl -X POST https://your-domain.com/api/v1/issues/550e8400-.../dismiss \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Known test account, not a real issue"}'
```

---

### GET /api/v1/issues/:id/investigation

Get or trigger an AI root cause analysis for a specific issue.

**Auth:** Bearer token
**Scope:** `issues:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `async` | string | `"false"` | Set to `"true"` to force async processing |

**Response (200) -- cached result:**

```json
{
  "available": true,
  "investigation": {
    "rootCause": "The refund was processed but the entitlement engine...",
    "timeline": [ ... ],
    "suggestedActions": [ ... ],
    "generatedAt": "2026-02-10T00:00:00.000Z"
  },
  "cached": true
}
```

**Response (202) -- processing:**

```json
{
  "available": true,
  "status": "processing",
  "message": "AI investigation is being generated. Poll this endpoint to get results.",
  "jobId": "inv_550e8400..."
}
```

**Response (200) -- AI not enabled:**

```json
{
  "available": false,
  "message": "AI investigation is not currently enabled for this account"
}
```

Cached investigations are valid for 24 hours or until the issue is updated.

```bash
curl https://your-domain.com/api/v1/issues/550e8400-.../investigation \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### GET /api/v1/insights

AI-generated billing health insights.

**Auth:** Bearer token
**Scope:** `issues:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `period` | string | `"daily"` | Analysis period: `"daily"` or `"weekly"` |

**Response (200):**

```json
{
  "insights": [ ... ],
  "generatedAt": "2026-02-10T00:00:00.000Z",
  "aiEnabled": true
}
```

```bash
curl "https://your-domain.com/api/v1/insights?period=weekly" \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### GET /api/v1/issues/incidents

Group open issues into incident clusters (co-occurring issues that likely share a root cause).

**Auth:** Bearer token
**Scope:** `issues:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `window` | number | `4` | Time window in hours for clustering (max 48) |
| `min_size` | number | `3` | Minimum cluster size (min 2) |

**Response (200):**

```json
{
  "incidents": [
    {
      "id": "cluster_1",
      "issueCount": 8,
      "commonType": "webhook_delivery_gap",
      "issues": [ ... ],
      "summary": "..."
    }
  ],
  "count": 2,
  "aiEnabled": true
}
```

```bash
curl "https://your-domain.com/api/v1/issues/incidents?window=6&min_size=2" \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### POST /api/v1/issues/:id/feedback

Submit resolution feedback. Used to train detector accuracy over time.

**Auth:** Bearer token
**Scope:** `issues:write`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `wasRealIssue` | boolean | Yes | Whether this was a genuine issue |
| `actualCause` | string | No | What the actual root cause was (max 2000 chars) |
| `notes` | string | No | Additional notes (max 5000 chars) |

**Response (200):**

```json
{
  "ok": true,
  "status": "resolved"
}
```

The `status` is `"resolved"` if `wasRealIssue` is true, `"dismissed"` if false.

```bash
curl -X POST https://your-domain.com/api/v1/issues/550e8400-.../feedback \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"wasRealIssue": true, "actualCause": "Stripe webhook was delayed by 30 minutes"}'
```

---

### GET /api/v1/detectors/health

Detector accuracy metrics computed from feedback data.

**Auth:** Bearer token
**Scope:** `issues:read`

**Response (200):**

```json
{
  "detectors": {
    "unrevoked_refund": {
      "totalIssues": 100,
      "truePositives": 92,
      "falsePositives": 8,
      "accuracy": 0.92
    }
  }
}
```

```bash
curl https://your-domain.com/api/v1/detectors/health \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### GET /api/v1/ai/status

Check AI system status and token usage.

**Auth:** Bearer token
**Scope:** `issues:read`

**Response (200):**

```json
{
  "enabled": true,
  "tokenUsage": {
    "inputTokens": 15000,
    "outputTokens": 3000
  },
  "model": "claude-sonnet-4-5-20250929"
}
```

```bash
curl https://your-domain.com/api/v1/ai/status \
  -H "Authorization: Bearer rev_your_api_key"
```
