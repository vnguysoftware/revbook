# PagerDuty Alert Channel Implementation

## Status: Queued for Future Implementation

## Overview
Implement PagerDuty alert integration matching the pattern of existing alert channels.

## Existing Patterns to Follow
- Slack: `src/alerts/slack.ts` - Block Kit formatted messages via incoming webhooks
- Email: `src/alerts/email.ts` - SMTP-based with HTML/text templates
- Webhook: `src/alerts/webhook.ts` - HMAC-SHA256 signed webhook delivery
- Dispatcher: `src/alerts/dispatcher.ts` - Routes alerts to configured channels
- Types: `src/models/types.ts` line 138 - `AlertChannel = 'slack' | 'email' | 'webhook'`

## Requirements
1. Create `src/alerts/pagerduty.ts` using PagerDuty Events API v2
2. Add `'pagerduty'` to the `AlertChannel` union type in `src/models/types.ts`
3. Register PagerDuty in the alert dispatcher (`src/alerts/dispatcher.ts`)
4. Support `routing_key` configuration in alert rules
5. Map issue severity to PagerDuty severity:
   - critical → critical
   - warning → warning
   - info → info
6. Include issue details in the PagerDuty event payload (title, description, severity, revenue impact, affected users)
7. Support dedup_key for auto-resolving issues when they're fixed
8. Add tests following existing test patterns

## PagerDuty Events API v2
- Endpoint: `https://events.pagerduty.com/v2/enqueue`
- Auth: routing_key (integration key) per alert rule
- Payload format: https://developer.pagerduty.com/api-reference/368ae3d938c9e-send-an-event-to-pager-duty

## Acceptance Criteria
- [ ] PagerDuty alerts fire when issues are detected (matching severity threshold)
- [ ] Alert payload includes issue title, description, severity, revenue impact
- [ ] Dedup key prevents duplicate pages for the same issue
- [ ] Auto-resolve when issue is resolved/dismissed
- [ ] Tests pass
- [ ] Update landing page to add PagerDuty back to alert channel list
