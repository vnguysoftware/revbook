# Admin & Operations

Administrative endpoints for managing scans, queues, dead letter queue, and circuit breakers.

---

## Scans

Base path: `/api/v1/admin/scans`

Manage issue detection scans. Scans run on schedules automatically, but can also be triggered manually.

### POST /api/v1/admin/scans/trigger

Trigger an issue detection scan immediately.

**Auth:** Bearer token
**Scope:** `admin:write`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `detectorId` | string | No | Specific detector to run (e.g., `"unrevoked_refund"`). Default: `"all"` |

Validates that the detector exists and has a scheduled scan method.

**Response (200):**

```json
{
  "ok": true,
  "jobId": "scan_123",
  "detectorId": "unrevoked_refund",
  "orgId": "550e8400-...",
  "message": "Scan job queued. Check /admin/scans/history for results."
}
```

```bash
curl -X POST https://your-domain.com/api/v1/admin/scans/trigger \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"detectorId": "unrevoked_refund"}'
```

---

### GET /api/v1/admin/scans/history

View recent scan results, including active, waiting, completed, and failed scans.

**Auth:** Bearer token
**Scope:** `admin:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | `50` | Max completed results (max 200) |

**Response (200):**

```json
{
  "active": [
    {
      "id": "123",
      "name": "scheduled-scan",
      "detectorId": "unrevoked_refund",
      "orgId": "...",
      "status": "active",
      "scheduledAt": "...",
      "processedOn": "..."
    }
  ],
  "waiting": [ ... ],
  "completed": [
    {
      "id": "122",
      "name": "scheduled-scan",
      "detectorId": "all",
      "orgId": null,
      "status": "completed",
      "result": { "issuesCreated": 3, "detectorId": "all" },
      "scheduledAt": "...",
      "processedOn": "...",
      "finishedOn": "...",
      "duration": 12500
    }
  ],
  "failed": [ ... ],
  "nextScheduledRuns": [
    {
      "name": "scheduled-scan",
      "pattern": "0 */6 * * *",
      "next": "2026-02-10T18:00:00.000Z"
    }
  ],
  "timestamp": "2026-02-10T14:00:00.000Z"
}
```

```bash
curl "https://your-domain.com/api/v1/admin/scans/history?limit=20" \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### GET /api/v1/admin/scans/schedules

List all configured scan schedules and available detectors.

**Auth:** Bearer token
**Scope:** `admin:read`

**Response (200):**

```json
{
  "schedules": [ ... ],
  "detectors": [
    {
      "id": "unrevoked_refund",
      "hasScheduledScan": true
    }
  ]
}
```

```bash
curl https://your-domain.com/api/v1/admin/scans/schedules \
  -H "Authorization: Bearer rev_your_api_key"
```

---

## Queue Monitor

Base path: `/api/v1/admin/queues`

Real-time health metrics for all BullMQ queues.

### GET /api/v1/admin/queues

Health overview for all queues.

**Auth:** Bearer token
**Scope:** Authenticated (no specific scope check)

**Response (200):**

```json
{
  "queues": {
    "webhook-processing": {
      "name": "webhook-processing",
      "counts": {
        "waiting": 3,
        "active": 1,
        "completed": 15420,
        "failed": 2,
        "delayed": 0,
        "paused": 0
      },
      "metrics": {
        "processingRatePerMinute": 12,
        "avgProcessingTimeMs": 85,
        "oldestWaitingAgeMs": 1500
      }
    }
  },
  "timestamp": "2026-02-10T14:00:00.000Z"
}
```

```bash
curl https://your-domain.com/api/v1/admin/queues \
  -H "Authorization: Bearer rev_your_api_key"
```

---

## Dead Letter Queue

Base path: `/api/v1/admin/dlq`

Manage webhook events that failed processing after 3 attempts.

### GET /api/v1/admin/dlq

List failed (DLQ) jobs.

**Auth:** Bearer token
**Scope:** Authenticated (no specific scope check)

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `offset` | number | `0` | Pagination offset |
| `limit` | number | `50` | Max results (max 200) |

**Response (200):**

```json
{
  "total": 2,
  "offset": 0,
  "limit": 50,
  "items": [
    {
      "id": "job_123",
      "orgId": "...",
      "source": "stripe",
      "webhookLogId": "...",
      "receivedAt": "2026-02-10T12:00:00.000Z",
      "attempts": 3,
      "failedReason": "Error: Failed to normalize event...",
      "stacktrace": ["..."],
      "timestamp": 1707523200000,
      "processedOn": 1707523200100,
      "finishedOn": 1707523200200
    }
  ]
}
```

```bash
curl "https://your-domain.com/api/v1/admin/dlq?limit=10" \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### POST /api/v1/admin/dlq/:id/retry

Re-queue a specific failed job for processing.

**Auth:** Bearer token
**Scope:** Authenticated

**Response (200):**

```json
{
  "ok": true,
  "jobId": "job_123",
  "message": "Job re-queued for processing"
}
```

Returns 400 if the job is not in `"failed"` state.

```bash
curl -X POST https://your-domain.com/api/v1/admin/dlq/job_123/retry \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### POST /api/v1/admin/dlq/retry-all

Re-queue all failed jobs.

**Auth:** Bearer token
**Scope:** Authenticated

**Response (200):**

```json
{
  "ok": true,
  "retried": 5,
  "errors": 0,
  "total": 5
}
```

```bash
curl -X POST https://your-domain.com/api/v1/admin/dlq/retry-all \
  -H "Authorization: Bearer rev_your_api_key"
```

---

## Circuit Breakers

Base path: `/api/v1/admin/circuit-breakers`

Monitor circuit breaker states for external service calls.

### GET /api/v1/admin/circuit-breakers

List all circuit breaker statuses.

**Auth:** Bearer token
**Scope:** Authenticated (no specific scope check)

**Response (200):**

```json
{
  "breakers": {
    "stripe-api": {
      "state": "closed",
      "failureCount": 0,
      "lastFailure": null
    },
    "apple-api": {
      "state": "open",
      "failureCount": 5,
      "lastFailure": "2026-02-10T12:00:00.000Z"
    }
  }
}
```

Circuit breaker states: `"closed"` (healthy), `"open"` (failing, requests blocked), `"half-open"` (testing recovery).

```bash
curl https://your-domain.com/api/v1/admin/circuit-breakers \
  -H "Authorization: Bearer rev_your_api_key"
```
