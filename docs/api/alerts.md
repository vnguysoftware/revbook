# Alerts & Notifications

Base path: `/api/v1/alerts`

Configure alert notifications via Slack, email, or webhooks when issues are detected.

---

### POST /api/v1/alerts

Create an alert configuration.

**Auth:** Bearer token
**Scope:** `alerts:write`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `channel` | string | Yes | `"slack"`, `"email"`, or `"webhook"` |
| `config` | object | Yes | Channel-specific configuration (see below) |
| `severityFilter` | string[] | No | Severity levels to alert on. Default: `["critical", "warning", "info"]` |
| `issueTypes` | string[] | No | Specific issue types to alert on. `null` = all types |
| `enabled` | boolean | No | Whether the alert is active. Default: `true` |

**Slack config:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `webhookUrl` | string | Yes | Slack incoming webhook URL (must start with `https://hooks.slack.com/`) |
| `channelName` | string | No | Display name for the channel |

**Email config:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `recipients` | string[] | Yes | Array of email addresses (1-50) |

**Webhook config:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | Webhook endpoint URL |
| `eventTypes` | string[] | No | Event types to send: `"issue.created"`, `"issue.resolved"`, `"issue.dismissed"`, `"issue.acknowledged"` |

For webhook configs, a signing secret is auto-generated and returned in the creation response (one-time reveal).

**Response (201):**

```json
{
  "alertConfig": {
    "id": "550e8400-...",
    "orgId": "...",
    "channel": "webhook",
    "config": {
      "url": "https://your-server.com/revback-webhook",
      "signingSecret": "whsec_abc123...",
      "eventTypes": ["issue.created", "issue.resolved"]
    },
    "severityFilter": ["critical", "warning"],
    "issueTypes": null,
    "enabled": true,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

The `signingSecret` is only returned on creation for webhook configs. After creation, it is masked as `"***"`.

```bash
curl -X POST https://your-domain.com/api/v1/alerts \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "slack",
    "config": {
      "webhookUrl": "https://hooks.slack.com/services/T.../B.../xxx"
    },
    "severityFilter": ["critical", "warning"]
  }'
```

---

### GET /api/v1/alerts

List all alert configurations for the organization.

**Auth:** Bearer token
**Scope:** `alerts:read`

**Response (200):**

```json
{
  "alertConfigs": [
    {
      "id": "...",
      "channel": "slack",
      "config": {
        "webhookUrl": "***xxx12345",
        "channelName": "#billing-alerts"
      },
      "severityFilter": ["critical", "warning"],
      "issueTypes": null,
      "enabled": true,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

Sensitive config values are masked (Slack webhook URLs show only last 8 chars, webhook signing secrets show `"***"`).

```bash
curl https://your-domain.com/api/v1/alerts \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### PUT /api/v1/alerts/:id

Update an existing alert configuration. Only provided fields are updated.

**Auth:** Bearer token
**Scope:** `alerts:write`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `config` | object | No | Updated channel config |
| `severityFilter` | string[] | No | Updated severity filter |
| `issueTypes` | string[] or null | No | Updated issue type filter |
| `enabled` | boolean | No | Enable/disable the alert |

For webhook configs, the signing secret is preserved when updating the config.

**Response (200):**

```json
{
  "alertConfig": { ... }
}
```

```bash
curl -X PUT https://your-domain.com/api/v1/alerts/550e8400-... \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

---

### DELETE /api/v1/alerts/:id

Delete an alert configuration and its delivery logs.

**Auth:** Bearer token
**Scope:** `alerts:write`

**Response (200):**

```json
{ "ok": true }
```

```bash
curl -X DELETE https://your-domain.com/api/v1/alerts/550e8400-... \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### POST /api/v1/alerts/test

Send a test alert to verify the configuration is working.

**Auth:** Bearer token
**Scope:** `alerts:write`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `alertConfigId` | string (UUID) | Yes | ID of the alert configuration to test |

**Response (200):**

```json
{
  "ok": true,
  "message": "Test alert sent via slack"
}
```

**Response (500):**

```json
{
  "ok": false,
  "error": "Failed to send test alert"
}
```

```bash
curl -X POST https://your-domain.com/api/v1/alerts/test \
  -H "Authorization: Bearer rev_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"alertConfigId": "550e8400-..."}'
```

---

### GET /api/v1/alerts/:id/signing-secret

Retrieve the signing secret for a webhook alert configuration.

**Auth:** Bearer token
**Scope:** `alerts:read`

Only works for `webhook` channel configs. Returns 400 for other channels.

**Response (200):**

```json
{
  "signingSecret": "whsec_abc123..."
}
```

```bash
curl https://your-domain.com/api/v1/alerts/550e8400-.../signing-secret \
  -H "Authorization: Bearer rev_your_api_key"
```

---

### GET /api/v1/alerts/history

View recent alert delivery logs.

**Auth:** Bearer token
**Scope:** `alerts:read`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | `20` | Max entries (max 100) |

**Response (200):**

```json
{
  "deliveries": [
    {
      "id": "...",
      "orgId": "...",
      "alertConfigId": "...",
      "issueId": "...",
      "channel": "slack",
      "status": "sent",
      "errorMessage": null,
      "sentAt": "2026-02-10T12:00:00.000Z"
    }
  ]
}
```

```bash
curl "https://your-domain.com/api/v1/alerts/history?limit=50" \
  -H "Authorization: Bearer rev_your_api_key"
```
