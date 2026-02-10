# Types Reference

Domain type enums used across the RevBack API.

---

### Billing Sources

`stripe` | `apple` | `google` | `recurly` | `braintree`

### Event Types

`purchase` | `renewal` | `cancellation` | `refund` | `chargeback` | `grace_period_start` | `grace_period_end` | `billing_retry` | `expiration` | `trial_start` | `trial_conversion` | `upgrade` | `downgrade` | `crossgrade` | `pause` | `resume` | `revoke` | `offer_redeemed` | `price_change`

### Event Statuses

`success` | `failed` | `pending` | `refunded`

### Entitlement States

`inactive` | `trial` | `active` | `offer_period` | `grace_period` | `billing_retry` | `on_hold` | `past_due` | `paused` | `expired` | `revoked` | `refunded`

### Issue Severities

`critical` | `warning` | `info`

### Issue Statuses

`open` | `acknowledged` | `resolved` | `dismissed`

### Alert Channels

`slack` | `email` | `webhook`

### Webhook Event Types (outbound)

`issue.created` | `issue.resolved` | `issue.dismissed` | `issue.acknowledged`
