# Webhook Ingestion

Base path: `/webhooks`

Webhook endpoints receive billing events from providers. They use provider-specific signature verification (not API key auth).

**Design:** Signature is verified BEFORE enqueueing. The webhook is logged and pushed to BullMQ for async processing. Response target is under 100ms.

---

### POST /webhooks/:orgSlug/stripe

Receive Stripe webhook events.

**Auth:** Stripe webhook signature (`stripe-signature` header)
**Rate Limit:** `webhook` (500/min per org slug)

**Request:** Raw Stripe event JSON body with standard Stripe webhook headers.

**Response (200):**

```json
{
  "ok": true,
  "webhookLogId": "550e8400-e29b-41d4-a716-446655440000"
}
```

```bash
# Stripe sends this automatically when configured
curl -X POST https://your-domain.com/webhooks/acme-corp/stripe \
  -H "Content-Type: application/json" \
  -H "stripe-signature: t=1234567890,v1=..." \
  -d '{ "id": "evt_xxx", "type": "customer.subscription.updated", ... }'
```

---

### POST /webhooks/:orgSlug/apple

Receive Apple App Store Server Notifications (V2).

**Auth:** Apple notification signature verification
**Rate Limit:** `webhook`

If the organization has an `originalNotificationUrl` configured, the webhook is proxied (forwarded) to that URL before processing.

**Response:** Same format as Stripe.

---

### POST /webhooks/:orgSlug/google

Receive Google Play real-time developer notifications via Pub/Sub push.

**Auth:** Google Pub/Sub push authentication
**Rate Limit:** `webhook`

**Response:** Same format as Stripe.

---

### POST /webhooks/:orgSlug/recurly

Receive Recurly webhook notifications.

**Auth:** Recurly webhook signature verification
**Rate Limit:** `webhook`

**Response:** Same format as Stripe.

---

### Error Responses

| Status | Body | Meaning |
|--------|------|---------|
| `404` | `{"error": "Organization not found"}` | Invalid org slug |
| `404` | `{"error": "Billing connection not configured"}` | No connection for this source |
| `401` | `{"error": "Invalid signature"}` | Webhook signature verification failed |
| `500` | `{"error": "Signature verification error"}` | Internal error during verification |
