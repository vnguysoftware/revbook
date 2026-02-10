# Dashboard & Reporting

Base path: `/api/v1/dashboard` and `/api/v1/first-look`

Aggregate views for the main dashboard and the First Look onboarding report.

---

### GET /api/v1/dashboard/revenue-impact

Revenue at risk breakdown by severity and issue type, plus revenue saved by resolved issues.

**Auth:** Bearer token
**Scope:** `dashboard:read`

**Response (200):**

```json
{
  "atRisk": {
    "totalCents": 2300000,
    "issueCount": 47
  },
  "bySeverity": [
    {
      "severity": "critical",
      "totalRevenueCents": "1500000",
      "issueCount": 5
    },
    {
      "severity": "warning",
      "totalRevenueCents": "800000",
      "issueCount": 30
    }
  ],
  "byType": [
    {
      "issueType": "unrevoked_refund",
      "totalRevenueCents": "500000",
      "issueCount": 12
    }
  ],
  "saved": {
    "totalCents": 450000,
    "issueCount": 23
  }
}
```

```bash
curl https://your-domain.com/api/v1/dashboard/revenue-impact \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### GET /api/v1/dashboard/events

Real-time event feed with filtering.

**Auth:** Bearer token
**Scope:** `dashboard:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | `50` | Max events (max 200) |
| `source` | string | - | Filter by billing source: `stripe`, `apple`, `google`, `recurly` |
| `type` | string | - | Filter by event type: `purchase`, `renewal`, `refund`, etc. |
| `startDate` | string (ISO 8601) | - | Filter events after this date |
| `endDate` | string (ISO 8601) | - | Filter events before this date |

**Response (200):**

```json
{
  "events": [
    {
      "id": "...",
      "source": "stripe",
      "eventType": "renewal",
      "sourceEventType": "invoice.payment_succeeded",
      "eventTime": "2026-02-10T12:00:00.000Z",
      "status": "success",
      "amountCents": 4999,
      "currency": "USD",
      "userId": "...",
      "environment": "production",
      "ingestedAt": "2026-02-10T12:00:01.000Z"
    }
  ]
}
```

```bash
curl "https://your-domain.com/api/v1/dashboard/events?source=stripe&type=refund&limit=20" \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### GET /api/v1/dashboard/entitlement-health

Entitlement state distribution across all users.

**Auth:** Bearer token
**Scope:** `dashboard:read`

**Response (200):**

```json
{
  "totalUsers": 3200,
  "byState": [
    { "state": "active", "count": 2800 },
    { "state": "trial", "count": 150 },
    { "state": "grace_period", "count": 50 },
    { "state": "expired", "count": 200 }
  ],
  "bySource": [
    { "source": "stripe", "state": "active", "count": 2000 },
    { "source": "apple", "state": "active", "count": 800 }
  ]
}
```

```bash
curl https://your-domain.com/api/v1/dashboard/entitlement-health \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### GET /api/v1/dashboard/trends/issues

Issue trend data for charts, aggregated by day and severity.

**Auth:** Bearer token
**Scope:** `dashboard:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `days` | number | `30` | Number of days of history (max 90) |

**Response (200):**

```json
{
  "trend": [
    {
      "date": "2026-02-01",
      "severity": "critical",
      "count": 2,
      "revenue": "100000"
    },
    {
      "date": "2026-02-01",
      "severity": "warning",
      "count": 5,
      "revenue": "50000"
    }
  ],
  "days": 30
}
```

```bash
curl "https://your-domain.com/api/v1/dashboard/trends/issues?days=14" \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### GET /api/v1/dashboard/trends/events

Event volume trend data for charts, aggregated by day and billing source.

**Auth:** Bearer token
**Scope:** `dashboard:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `days` | number | `30` | Number of days of history (max 90) |

**Response (200):**

```json
{
  "trend": [
    {
      "date": "2026-02-01",
      "source": "stripe",
      "count": 142
    },
    {
      "date": "2026-02-01",
      "source": "apple",
      "count": 58
    }
  ],
  "days": 30
}
```

```bash
curl "https://your-domain.com/api/v1/dashboard/trends/events?days=7" \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### GET /api/v1/first-look

Generate a comprehensive billing health report. The "aha moment" endpoint — after connecting billing systems and importing historical data, this report shows the reality of subscription health.

**Auth:** Bearer token
**Scope:** `dashboard:read`

**Response (200):**

```json
{
  "generatedAt": "2026-02-10T00:00:00.000Z",
  "dataReady": true,
  "overview": {
    "totalSubscribers": 3200,
    "activeSources": ["stripe", "apple"],
    "totalEventsProcessed": 15420,
    "eventsBySource": [
      { "source": "stripe", "count": 10000 },
      { "source": "apple", "count": 5420 }
    ]
  },
  "subscriberHealth": {
    "distribution": [
      { "state": "active", "count": 2800, "percentage": 88 },
      { "state": "grace_period", "count": 50, "percentage": 2 }
    ]
  },
  "revenueImpact": {
    "totalMonthlyRevenueCentsAtRisk": 2300000,
    "totalOpenIssues": 47,
    "bySeverity": [
      { "severity": "critical", "count": 5, "revenueCents": 1500000 }
    ],
    "byType": [
      { "issueType": "unrevoked_refund", "count": 12, "revenueCents": 500000 }
    ]
  },
  "topIssues": [
    {
      "id": "...",
      "type": "unrevoked_refund",
      "severity": "critical",
      "title": "Refund not revoked: user still has access",
      "description": "...",
      "estimatedRevenueCents": 4999,
      "confidence": 0.95
    }
  ],
  "activityTimeline": [
    { "date": "2026-02-01", "events": 142 }
  ],
  "importSummary": [
    { "source": "stripe", "syncStatus": "complete", "lastSyncAt": "..." }
  ]
}
```

```bash
curl https://your-domain.com/api/v1/first-look \
  -H "Authorization: Bearer rev_your_api_key"
```
