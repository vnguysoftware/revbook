# RevBack UI Design Specification: Detector Categories

Design spec for presenting 8 detectors across dashboard, issues list, issue detail, and education pages.

---

## Design System Foundations

### Detector Category Color System

Each category gets a consistent color identity used across all pages:

| Category | Primary Color | Tailwind Prefix | Lucide Icon | Description |
|---|---|---|---|---|
| Integration Health | `slate` | `slate-600/50` | `Wifi` / `WifiOff` | System connectivity |
| Cross-Platform Intelligence | `violet` | `violet-600/50` | `GitCompare` | Multi-source analysis |
| Revenue Protection | `amber` | `amber-600/50` | `ShieldAlert` | Revenue leakage |
| Verified Issues (Tier 2) | `emerald` | `emerald-600/50` | `BadgeCheck` | SDK-confirmed |

### Issue Scope Visual Language

Two distinct visual treatments for scope:

- **Per-user issues**: Show a `User` icon + affected user name/ID. Left border accent using severity color.
- **Aggregate/system issues**: Show a `BarChart3` icon + metric summary (e.g., "47 subscriptions" or "Stripe webhooks"). Left border uses a **dashed** pattern to visually distinguish from per-user solid borders.

### Tier Visual Treatment

- **Tier 1** (webhook-derived): No special badge. Default presentation.
- **Tier 2** (SDK-verified): Green `BadgeCheck` icon + "Verified" label. On the issue card, a subtle `border-l-emerald-500` left accent replaces the default severity accent when the issue is Tier 2.

---

## A. Dashboard Page Redesign

### Layout (top to bottom)

#### Row 1: KPI Cards (unchanged layout, updated content)
Keep the existing 4-column grid. No changes needed here -- the KPIs already summarize correctly across all detector types.

```
[Revenue at Risk] [Critical Issues] [Revenue Saved] [Active Subscribers]
```

#### Row 2: Recent Issues + Severity (unchanged)
Keep the existing `lg:grid-cols-3` layout with the donut chart (1 col) and recent issues list (2 cols). No changes.

#### Row 3: Category Health Cards (NEW -- replaces current bottom row)

Replace the current 3-column bottom section ("Integration Health", "Issues by Type", "Subscriber Health") with a **4-column grid of category summary cards**. Each card represents one detector category.

```
[Integration Health] [Cross-Platform] [Revenue Protection] [Verified Issues]
```

**Category Card Component** (`CategoryHealthCard`):

```
Container: Card component, padding="md"

Header row:
  Left: Category icon (16px, category color) + Category name (text-sm font-semibold text-gray-900)
  Right: Issue count badge -- circular, 20x20px
    - bg-red-100 text-red-700 if any critical issues
    - bg-amber-100 text-amber-700 if warning only
    - bg-green-100 text-green-700 if all clear (show checkmark instead of number)

Metric row (mt-3):
  Large number: total open issues in category (text-2xl font-bold text-gray-900)
  Sublabel: revenue at risk for this category (text-xs text-gray-500)

Detector list (mt-3, space-y-1.5):
  For each detector in category:
    Row: flex items-center justify-between
      Left: detector name (text-xs text-gray-600)
      Right: issue count (text-xs font-semibold text-gray-900) + severity dot (w-1.5 h-1.5 rounded-full)

    If detector has 0 issues:
      Right shows: checkmark icon (CheckCircle size={12} text-green-400) + "Clear" text-xs text-green-600
```

**Integration Health card** (special treatment):

This card includes provider status rows similar to the current `IntegrationStatusRow` component, but more compact:

```
Container: Same CategoryHealthCard shell

Content:
  For each connected provider:
    Row (flex items-center gap-2 py-1.5):
      Status dot: w-2 h-2 rounded-full
        - bg-green-500 if healthy (webhooks < 1hr old)
        - bg-amber-500 if stale (webhooks 1-6hr old)
        - bg-red-500 if gap detected (webhooks > 6hr or gap alert active)
      Provider name: text-xs font-medium text-gray-700 (e.g., "Stripe")
      Last webhook: text-xs text-gray-400 (e.g., "5m ago")

  Detector summary below providers:
    "Webhook Gap" detector row + "Stale Billing Data" detector row
    Same format as other category cards

  If stale_subscription detector has findings:
    Warning banner (mt-2):
      bg-amber-50 border border-amber-200 rounded-md px-3 py-2
      text-xs text-amber-700: "12% of subscriptions have stale data (>35 days)"
```

**Verified Issues card** (Tier 2 -- special treatment for upsell):

When SDK is NOT connected:
```
Container: Card with dashed border (border-dashed border-gray-300) instead of solid

Header: Same pattern, but icon uses Lock (lucide) in gray-400

Content:
  Illustration area (py-6, flex flex-col items-center):
    Icon: BadgeCheck size={32} text-gray-300
    Title: "Unlock Verified Detection" (text-sm font-semibold text-gray-700 mt-2)
    Subtitle: "Confirm real user access with our SDK" (text-xs text-gray-500 mt-1)

    Preview metrics (mt-4, bg-gray-50 rounded-lg p-3 w-full):
      Two rows showing what they'd see, but blurred/faded:
      "Paid But No Access" -- text-xs text-gray-400 with opacity-50
      "Access Without Payment" -- text-xs text-gray-400 with opacity-50

    CTA button (mt-3):
      Link to="/connect-app"
      text-xs font-medium text-brand-600 hover:text-brand-700
      "Set up SDK integration ->"
```

When SDK IS connected:
```
Same as other category cards, but with a subtle emerald accent:
  border-t-2 border-t-emerald-500 on the Card container
  Each detector row shows the green BadgeCheck icon (size={12}) before the name
```

#### Row 4: Subscriber Health (moved, simplified)

Move the current "Subscriber Health" entitlement state distribution card to a full-width row below the category cards. Make it horizontal bar chart style in a single card spanning full width.

```
Card (full width):
  CardHeader: "Subscriber Health" / "Entitlement state distribution across all platforms"

  Content: Horizontal stacked bar (h-4 rounded-full, flex overflow-hidden)
    Each segment colored by state (active=green-500, trial=blue-500, etc.)

  Legend below (flex flex-wrap gap-4 mt-3):
    Each state: dot + label + count + percentage
```

---

## B. Issues List Page Redesign

### Filter Bar Changes

Add a **Category filter** between severity and type filters:

```
Filter bar layout:
  [Status Tabs: Open | Acknowledged | Resolved | Dismissed]

  [Severity ▼]  [Category ▼]  [Type ▼]  [Tier ▼]  ... [Sort ▼]
```

**Category dropdown**:
```html
<select>
  <option value="">All categories</option>
  <option value="integration_health">Integration Health</option>
  <option value="cross_platform">Cross-Platform Intelligence</option>
  <option value="revenue_protection">Revenue Protection</option>
  <option value="verified">Verified Issues</option>
</select>
```

Selecting a category pre-filters the Type dropdown to only show detectors in that category.

**Tier dropdown**:
```html
<select>
  <option value="">All tiers</option>
  <option value="webhook_derived">Tier 1: Webhook Derived</option>
  <option value="app_verified">Tier 2: App Verified</option>
</select>
```

### Category Section Headers (optional grouping)

When no category filter is active and sort is "Newest First", inject **lightweight section headers** between groups of issues from different categories. These are NOT sticky headers -- they're inline dividers.

```
Section header (when category changes in the list):
  Container: flex items-center gap-2 px-4 py-2 mt-4 mb-2
    Category icon (14px, category color)
    Category name (text-xs font-semibold text-gray-500 uppercase tracking-wider)
    Divider line (flex-1 h-px bg-gray-200)
    Count badge (text-xs text-gray-400): "4 issues"
```

When sorting by Revenue or Severity, do NOT show section headers (mixed categories is expected).

### Aggregate Issue Card Design

Aggregate issues (webhook_delivery_gap, stale_subscription, unusual_renewal_pattern) need a distinct card to show they are system-level, not user-level.

**Aggregate Issue Card** (replaces `IssueRow` for aggregate types):

```
Container: Same outer structure as IssueRow but with these differences:
  - Left border: 3px dashed (border-l-[3px] border-dashed) using severity color
  - Background: bg-gradient-to-r from-slate-50/50 to-white (subtle tint)

Layout:
  [Checkbox] [Scope Icon] [Content] [Metric] [Time]

  Scope Icon area (w-8 h-8, replacing the severity dot):
    Rounded square (rounded-lg) with category background color at 10% opacity
    Icon inside: category-appropriate icon

    Integration Health: Wifi icon, bg-slate-100 text-slate-600
    Revenue Protection: TrendingDown icon, bg-amber-100 text-amber-600

  Content area:
    Badge row: [severity badge] [type label]
      + scope badge: "System" or "Aggregate"
        (inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-slate-100 text-slate-600 border border-slate-200)
        Icon: BarChart3 size={10}

    Title: Same styling as per-user card

    Description: Same, but aggregate descriptions mention cohort:
      "No Apple App Store webhooks received in the last 2+ hours"
      "Renewal rate for Stripe dropped 23% vs 30-day baseline"
      "47 subscriptions across Stripe have no events in 35+ days"

    Affected scope line (below description, text-[11px] text-gray-400 mt-1):
      For webhook gap: "Affects: Apple App Store"
      For stale data: "Affects: 47 of 312 subscriptions (15%)"
      For renewal anomaly: "Affects: Stripe monthly plans"

      This replaces the user name that per-user issues show.

  Metric area (right side):
    For aggregate issues, show estimated total revenue impact
    Same styling as per-user (red, bold)
    Below: "est. aggregate" in text-[10px] text-gray-400 instead of confidence %
```

**Per-user Issue Card** (update to existing `IssueRow`):

Mostly unchanged, but add:
```
  After the description line, show affected user:
    text-[11px] text-gray-400 mt-0.5
    User icon (size={10}) + user ID (truncated to 12 chars) or user name if available
    This makes the per-user scope explicit even in the list view.
```

### Recommended Action on Issue Cards

Show a **collapsed action hint** on hover for open issues only:

```
On the issue card, when status === 'open':
  After the description, on hover, reveal an action hint:

  Container (hidden by default, shown on group-hover):
    transition-all duration-200 max-h-0 group-hover:max-h-8 overflow-hidden

    Content: flex items-center gap-1.5 mt-1.5
      ArrowRight icon (size={11} text-brand-500)
      Text (text-[11px] font-medium text-brand-600):
        webhook_delivery_gap: "Check provider status and webhook configuration"
        stale_subscription: "Review stale accounts and trigger re-sync"
        duplicate_subscription: "Review and cancel duplicate platform"
        cross_platform_mismatch: "Reconcile entitlement states"
        refund_not_revoked: "Revoke access for refunded users"
        unusual_renewal_pattern: "Investigate renewal drop with cohort analysis"
        verified_paid_no_access: "Provision access immediately"
        verified_access_no_payment: "Revoke access or recover payment"
```

This keeps cards clean by default while providing actionable guidance on interaction.

---

## C. Issue Detail Page Updates

### Recommended Action Section (NEW)

Insert between the Issue Header Card and the AI Investigation section:

```
Card (padding="md", className="mb-6"):
  Left accent: border-l-4 border-l-brand-500
  Background: bg-gradient-to-r from-brand-50/30 to-white

  Layout: flex items-start gap-4

  Left icon:
    div (w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center)
      Lightbulb icon (size={20} text-brand-600) -- from lucide: "Lightbulb"

  Content:
    Label: "Recommended Action" (text-xs font-semibold text-brand-600 uppercase tracking-wider)

    Action text (text-sm text-gray-800 mt-1 leading-relaxed):
      Specific per detector type:

      webhook_delivery_gap:
        "Check your [Provider] webhook configuration in the provider dashboard.
         Verify the endpoint URL is correct and the signing secret matches.
         If the provider is experiencing an outage, monitor their status page."

      stale_subscription:
        "Review the [count] subscriptions with stale data. These accounts may have
         churned silently or have broken webhook delivery. Consider triggering a
         re-sync via the Stripe API to refresh their state."

      duplicate_subscription:
        "This user is paying on both [Platform A] and [Platform B]. Cancel the
         duplicate subscription on the platform the user does not actively use,
         and issue a prorated refund for the overlap period."

      cross_platform_mismatch:
        "The user's entitlement state differs between platforms. Review both
         platform dashboards to determine the correct state and reconcile.
         If one platform shows expired, verify whether the user intended to cancel."

      refund_not_revoked:
        "A refund was processed but the user's access was not revoked. Update
         the user's entitlement state to 'refunded' and revoke access. For
         chargebacks, also flag the account for review."

      unusual_renewal_pattern:
        "Renewal rates dropped significantly vs baseline. Investigate whether
         this correlates with a pricing change, payment method expiry cohort,
         or a billing provider issue. Check failed payment logs."

      verified_paid_no_access:
        "URGENT: This paying customer cannot access the product. Provision their
         entitlement immediately. Check your access provisioning logic for race
         conditions or webhook processing delays."

      verified_access_no_payment:
        "This user has access without an active payment. Verify whether this is
         intentional (comp/internal account) or a provisioning bug. If unauthorized,
         revoke access and investigate the access grant path."

    Action buttons row (mt-3, flex gap-2):
      Primary CTA varies by type:
        For per-user issues:
          Link to user profile: "View User Profile ->" (text-xs font-medium text-brand-600)
        For aggregate issues:
          Link to filtered issues list: "View Affected [scope] ->"

      Secondary: "Mark as Acknowledged" button (if status is open)
        (text-xs text-gray-500 hover:text-gray-700)
```

### Aggregate Issue Detail (replacing "Affected User" section)

When `issue.userId` is null (aggregate issues), replace the "Affected User" card with an **Affected Scope** card:

```
Card (padding="lg", className="mb-6"):
  CardHeader: "Affected Scope" / "System-wide impact assessment"

  Content varies by detector type:

  For webhook_delivery_gap:
    Provider info row:
      flex items-center gap-3 p-3 bg-gray-50 rounded-lg
      Provider icon + name + status dot
      "Last webhook: [time]" / "Expected frequency: every 5-15 min"

    Timeline visualization (mt-4):
      Horizontal bar showing webhook delivery over last 24h
      Segments: green (received), red (gap), gray (before monitoring)
      Simple CSS bar, not a chart library

    Stats row (mt-3, grid grid-cols-3 gap-3):
      "Gap Duration": "2h 15m" (text-lg font-bold)
      "Missed Webhooks (est.)": "~15"
      "Revenue at Risk": "$4,500"

  For stale_subscription:
    Summary metrics (grid grid-cols-3 gap-3):
      "Stale Subscriptions": count (text-lg font-bold text-gray-900)
      "Total Monitored": total count
      "Stale Rate": percentage with color coding
        < 5%: text-green-600
        5-10%: text-amber-600
        > 10%: text-red-600

    Breakdown by source (mt-4):
      Table-like list:
      [Source icon] [Source name] [Stale count] [Total] [% stale] [Bar visualization]

    Sample affected subscriptions (mt-4):
      "Sample accounts (showing 5 of [count]):"
      List of subscription IDs with last event date
      Link: "View all affected subscriptions ->"

  For unusual_renewal_pattern:
    Metric comparison (grid grid-cols-2 gap-4):
      Left card: "Current Renewal Rate"
        Large number (text-2xl font-bold text-red-600): "67%"
        "vs 30-day baseline"
      Right card: "Baseline Renewal Rate"
        Large number (text-2xl font-bold text-gray-900): "87%"
        "30-day rolling average"

    Drop indicator:
      Large text: "-23%" with down arrow, text-red-600
      "Renewal rate drop detected"

    Breakdown (mt-4):
      By plan: which plans are affected most
      By payment method: are certain payment types failing more
```

### Tier 2 "App Verified" Enhanced Display

For Tier 2 issues, upgrade the small badge to a more prominent verification banner:

```
Inside the Issue Header Card, after the badge row:

When detectionTier === 'app_verified':
  Verification banner (mt-3):
    Container: flex items-center gap-3 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg

    Left: BadgeCheck icon (size={18} text-emerald-600)

    Content:
      Title: "Verified by App Integration" (text-sm font-semibold text-emerald-800)
      Detail: "Your app confirmed this user's access state at [timestamp]"
              (text-xs text-emerald-600)

    Right: Confidence display
      "95% confidence" (text-sm font-bold text-emerald-700)

  This REPLACES the current small green badge and the "Verified via app integration"
  text line below the description. Consolidate into this single prominent banner.
```

---

## D. "What We Monitor" Education Page

### Sidebar Navigation Addition

Add a new nav item to the sidebar between "Insights" and "Setup":

```
In Layout.tsx navItems array, add:
  { to: '/monitors', icon: Radar, label: 'Monitors' }

Position: After "Insights", before the bottom section
The Radar icon (from lucide-react) represents scanning/monitoring.
```

### Route

```
<Route path="/monitors" element={<MonitorsPage />} />
```

### Page Design

```
Page container: p-6 max-w-5xl mx-auto

PageHeader:
  Title: "What We Monitor"
  Subtitle: "RevBack continuously watches for these subscription and billing issues"

SDK Connection Status Banner (conditional):
  If SDK not connected:
    Container: bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-8
    Layout: flex items-center justify-between
    Left:
      flex items-center gap-3
      BadgeCheck icon (size={24} text-emerald-600)
      div:
        "Unlock Verified Detection" (text-sm font-semibold text-emerald-800)
        "2 additional detectors available with SDK integration" (text-xs text-emerald-600)
    Right:
      Link to="/connect-app"
      Button style: px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700

Category Sections (space-y-8):

For each category:

  Section container:
    Category header row (flex items-center gap-3 mb-4):
      Icon container (w-8 h-8 rounded-lg [category-bg-color] flex items-center justify-center):
        Category icon (size={16} [category-text-color])
      Category name (text-lg font-semibold text-gray-900)
      Issue count badge (if any open issues):
        (text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700)
        "[N] open"
      Divider (flex-1 h-px bg-gray-200 ml-2)

    Detector cards grid (grid grid-cols-1 md:grid-cols-2 gap-4):

Detector Card:

  Container:
    bg-white rounded-xl border border-gray-200 p-5
    If detector has open issues: border-l-4 border-l-[severity-color]
    If detector is Tier 2 and SDK not connected: opacity-75, border-dashed

  Header row (flex items-start justify-between):
    Left:
      Detector name (text-sm font-semibold text-gray-900)
      Scope badge below name (mt-1):
        Per-user scope:
          inline-flex items-center gap-1 text-[10px] text-gray-500
          User icon (size={10}) + "Per user"
        Aggregate scope:
          inline-flex items-center gap-1 text-[10px] text-gray-500
          BarChart3 icon (size={10}) + "System-wide"
    Right:
      Status indicator:
        If has open issues:
          Circle with count (w-6 h-6 rounded-full bg-[severity]-100 text-[severity]-700 text-xs font-bold flex items-center justify-center)
        If clear:
          CheckCircle (size={16} text-green-400)
        If SDK not connected (Tier 2):
          Lock icon (size={16} text-gray-400)

  Description (mt-2):
    text-xs text-gray-600 leading-relaxed

    webhook_delivery_gap:
      "Alerts when no webhooks are received from a billing provider for an unusual
       period. Catches webhook endpoint failures, provider outages, and misconfigured
       signing secrets before they cause data gaps."

    stale_subscription:
      "Detects when a significant portion of subscriptions have not generated any
       billing events recently. Indicates silent churn, webhook delivery issues,
       or data sync problems across your subscriber base."

    duplicate_subscription:
      "Identifies users paying for the same product on multiple platforms simultaneously.
       Common when users subscribe via both the App Store and your website. Each duplicate
       represents direct revenue leakage."

    cross_platform_mismatch:
      "Finds users whose subscription state differs between platforms -- for example,
       active on Stripe but expired on Apple. Indicates failed cancellation propagation
       or sync delays between systems."

    refund_not_revoked:
      "Detects when a refund or chargeback is processed but the user's access is not
       revoked. The user continues using the product for free until manually caught."

    unusual_renewal_pattern:
      "Monitors renewal rates against a rolling baseline and alerts when rates drop
       significantly. Early warning for payment processing issues, pricing problems,
       or payment method expiry waves."

    verified_paid_no_access:
      "Confirms with your app's SDK that a paying user genuinely cannot access the
       product. Higher confidence than webhook-only detection because it verifies
       the actual user experience."

    verified_access_no_payment:
      "Confirms with your app's SDK that a non-paying user has unauthorized access.
       Catches provisioning bugs, revocation failures, and access control bypasses
       that webhooks alone cannot detect."

  Severity & action row (mt-3 pt-3 border-t border-gray-100):
    flex items-center justify-between
    Left:
      Default severity: Badge component (variant matches detector default severity)
        webhook_delivery_gap: warning
        stale_subscription: warning
        duplicate_subscription: critical
        cross_platform_mismatch: warning
        refund_not_revoked: critical
        unusual_renewal_pattern: warning
        verified_paid_no_access: critical
        verified_access_no_payment: critical
    Right:
      If detector has open issues:
        Link to="/issues?issueType=[detector_type]"
        "View [N] issues ->" (text-xs font-medium text-brand-600)
      If Tier 2 and SDK not connected:
        Link to="/connect-app"
        "Enable with SDK ->" (text-xs font-medium text-emerald-600)
      If clear:
        "No issues" (text-xs text-gray-400)

  Tier 2 overlay (for Tier 2 detectors when SDK not connected):
    After the main card content, additional row:
      Container: mt-3 pt-3 border-t border-dashed border-gray-200
      flex items-center gap-2
      BadgeCheck icon (size={14} text-emerald-500)
      "Requires SDK integration" (text-xs font-medium text-emerald-600)
      "Higher confidence detection" (text-[10px] text-gray-400 ml-auto)
```

---

## E. Notification/Alert Card Patterns

### In-App Notification (Bell icon dropdown or notification center)

```
Notification item:
  Container: flex items-start gap-3 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 cursor-pointer
  If unread: bg-blue-50/30 border-l-2 border-l-brand-500

  Left:
    Category icon in colored circle (w-8 h-8 rounded-full [category-bg] flex items-center justify-center)

  Content:
    Title line (text-sm font-medium text-gray-900):
      Per-user: "[Detector name]: [User name/ID]"
      Aggregate: "[Detector name]: [scope]"

    Description (text-xs text-gray-600 mt-0.5):
      Action-oriented, one line:

      webhook_delivery_gap:
        "No webhooks from Apple App Store in 2+ hours. Check configuration."
      stale_subscription:
        "47 Stripe subscriptions have stale data. Review and re-sync."
      duplicate_subscription:
        "Ava Kim is paying on both Stripe ($14.99/mo) and Apple ($14.99/mo). Cancel duplicate."
      cross_platform_mismatch:
        "Paul Lee: active on Stripe, expired on Apple. Reconcile state."
      refund_not_revoked:
        "Jennifer Adams refunded $349.99 but still has access. Revoke entitlement."
      unusual_renewal_pattern:
        "Stripe monthly renewal rate dropped 23% vs baseline. Investigate."
      verified_paid_no_access:
        "URGENT: Jennifer Adams is paying $349.99/mo but cannot access the product."
      verified_access_no_payment:
        "Paul Lee has product access without active payment. Verify and revoke."

    Revenue badge (inline, if applicable):
      text-xs font-semibold text-red-600: "$349.99 at risk"

    Time: text-[10px] text-gray-400 mt-1

  Right:
    Severity dot (w-2 h-2 rounded-full)
```

### Email Notification Format

```
Subject lines (action-oriented):
  webhook_delivery_gap:
    "[RevBack] Webhook gap detected: No data from Apple App Store for 2h"
  stale_subscription:
    "[RevBack] 47 subscriptions have stale billing data"
  duplicate_subscription:
    "[RevBack Critical] Ava Kim is being double-billed on Stripe + Apple"
  cross_platform_mismatch:
    "[RevBack] Cross-platform state conflict for Paul Lee"
  refund_not_revoked:
    "[RevBack Critical] Refund not revoked: Jennifer Adams still has access"
  unusual_renewal_pattern:
    "[RevBack] Renewal rate dropped 23% for Stripe monthly plans"
  verified_paid_no_access:
    "[RevBack URGENT] Paying customer Jennifer Adams cannot access product"
  verified_access_no_payment:
    "[RevBack Critical] Unauthorized access detected for Paul Lee"

Email body structure:
  Hero section:
    Category icon + detector name
    Severity badge (colored)
    One-sentence summary (bold)
    Revenue impact (large red text, if applicable)

  Details section:
    2-3 bullet points with specifics
    For per-user: user identifier, platform, plan, amount
    For aggregate: scope, count, percentage, baseline comparison

  Action section:
    Primary CTA button: "Review in RevBack" (links to issue detail or filtered list)
    Secondary text link: "View all open issues"

  Footer:
    "This alert was triggered by the [Detector Name] detector."
    Unsubscribe / manage alert preferences link
```

### Slack Notification Format

```
Slack message structure (using Block Kit concepts for rich formatting):

Header block:
  emoji prefix based on severity:
    critical: ":rotating_light:"
    warning: ":warning:"
    info: ":information_source:"

  Bold title: detector-specific one-liner

Context block:
  Category | Detector | Severity | Time

Section block (details):
  Per-user format:
    "*User:* Ava Kim (cus_abc123)"
    "*Platform:* Stripe + Apple App Store"
    "*Revenue Impact:* $14.99/mo duplicate"
    "*Action:* Cancel duplicate and refund overlap"

  Aggregate format:
    "*Scope:* Apple App Store webhooks"
    "*Duration:* 2h 15m gap"
    "*Est. Revenue at Risk:* $4,500"
    "*Action:* Check webhook endpoint and provider status"

Action block:
  Button: "View in RevBack" (links to issue detail)
  Button: "Acknowledge" (triggers acknowledge API call)

Examples:

  :rotating_light: *Duplicate billing detected: Ava Kim paying on Stripe AND Apple*
  Cross-Platform Intelligence | Duplicate Billing | Critical | 2 min ago

  *User:* Ava Kim (`cus_abc123`)
  *Platforms:* Stripe ($14.99/mo) + Apple ($14.99/mo)
  *Revenue Impact:* $14.99/mo being double-charged
  *Action:* Cancel the duplicate subscription and issue a prorated refund

  [View in RevBack]  [Acknowledge]

---

  :warning: *Stripe monthly renewal rate dropped 23%*
  Revenue Protection | Unusual Renewal Pattern | Warning | 15 min ago

  *Current Rate:* 67% (was 87% baseline)
  *Affected Plans:* Stripe monthly subscriptions
  *Est. Revenue at Risk:* $12,400/mo
  *Action:* Investigate failed payments and payment method expiry rates

  [View in RevBack]  [Acknowledge]

---

  :rotating_light: *URGENT: Paying customer cannot access product*
  Verified Issues | Paid But No Access | Critical | just now

  *User:* Jennifer Adams (`cus_xyz789`)
  *Plan:* Pro Annual ($349.99/yr) via Stripe
  *Verified:* App SDK confirmed `hasAccess=false`
  *Action:* Provision access immediately -- customer is paying but locked out

  [View in RevBack]  [Resolve]
```

---

## F. Data Model / Constants Updates

### New constants needed in `dashboard/src/lib/constants.ts`

```typescript
// Detector category definitions
export const DETECTOR_CATEGORIES = {
  integration_health: {
    label: 'Integration Health',
    icon: 'Wifi',          // lucide icon name
    color: 'slate',        // tailwind color prefix
    detectors: ['webhook_delivery_gap', 'stale_subscription'],
  },
  cross_platform: {
    label: 'Cross-Platform Intelligence',
    icon: 'GitCompare',
    color: 'violet',
    detectors: ['duplicate_subscription', 'cross_platform_mismatch'],
  },
  revenue_protection: {
    label: 'Revenue Protection',
    icon: 'ShieldAlert',
    color: 'amber',
    detectors: ['refund_not_revoked', 'unusual_renewal_pattern'],
  },
  verified: {
    label: 'Verified Issues',
    icon: 'BadgeCheck',
    color: 'emerald',
    detectors: ['verified_paid_no_access', 'verified_access_no_payment'],
  },
} as const;

// Detector metadata
export const DETECTOR_META: Record<string, {
  category: string;
  scope: 'per_user' | 'aggregate';
  tier: 1 | 2;
  defaultSeverity: 'critical' | 'warning' | 'info';
  recommendedAction: string;
}> = {
  webhook_delivery_gap: {
    category: 'integration_health',
    scope: 'aggregate',
    tier: 1,
    defaultSeverity: 'warning',
    recommendedAction: 'Check provider webhook configuration and endpoint status.',
  },
  stale_subscription: {
    category: 'integration_health',
    scope: 'aggregate',
    tier: 1,
    defaultSeverity: 'warning',
    recommendedAction: 'Review stale subscriptions and trigger a data re-sync.',
  },
  duplicate_subscription: {
    category: 'cross_platform',
    scope: 'per_user',
    tier: 1,
    defaultSeverity: 'critical',
    recommendedAction: 'Cancel the duplicate subscription and refund the overlap period.',
  },
  cross_platform_mismatch: {
    category: 'cross_platform',
    scope: 'per_user',
    tier: 1,
    defaultSeverity: 'warning',
    recommendedAction: 'Reconcile entitlement states across platforms.',
  },
  refund_not_revoked: {
    category: 'revenue_protection',
    scope: 'per_user',
    tier: 1,
    defaultSeverity: 'critical',
    recommendedAction: 'Revoke access for refunded users immediately.',
  },
  unusual_renewal_pattern: {
    category: 'revenue_protection',
    scope: 'aggregate',
    tier: 1,
    defaultSeverity: 'warning',
    recommendedAction: 'Investigate renewal rate drop with cohort analysis.',
  },
  verified_paid_no_access: {
    category: 'verified',
    scope: 'per_user',
    tier: 2,
    defaultSeverity: 'critical',
    recommendedAction: 'Provision access immediately. Customer is paying but locked out.',
  },
  verified_access_no_payment: {
    category: 'verified',
    scope: 'per_user',
    tier: 2,
    defaultSeverity: 'critical',
    recommendedAction: 'Verify authorization and revoke access if unauthorized.',
  },
};

// Mapping from detector type to category for filtering
export const DETECTOR_TO_CATEGORY: Record<string, string> = Object.fromEntries(
  Object.entries(DETECTOR_CATEGORIES).flatMap(([catId, cat]) =>
    cat.detectors.map(d => [d, catId])
  )
);
```

---

## G. Implementation Priority

### Phase 1 (Quick wins -- can ship independently)
1. Add `DETECTOR_CATEGORIES` and `DETECTOR_META` constants
2. Update Issue Detail page with Recommended Action section
3. Update Issue Detail with enhanced Tier 2 banner
4. Add category + tier filters to Issues list

### Phase 2 (Dashboard redesign)
5. Build `CategoryHealthCard` component
6. Replace Dashboard bottom row with 4 category cards
7. Implement Verified Issues upsell card
8. Update Integration Health card with enhanced status

### Phase 3 (Aggregate issue support)
9. Build aggregate issue card variant for Issues list
10. Build aggregate issue detail views (scope cards)
11. Add section headers to Issues list

### Phase 4 (Education + notifications)
12. Build "What We Monitor" page
13. Add sidebar nav item
14. Implement notification card patterns
15. Implement email/Slack notification templates

---

## H. API Requirements

The frontend needs these new/updated API responses:

### GET /dashboard/category-summary
Returns issue counts and revenue grouped by detector category.

```json
{
  "categories": {
    "integration_health": {
      "openIssues": 2,
      "criticalIssues": 0,
      "revenueAtRiskCents": 450000,
      "detectors": {
        "webhook_delivery_gap": { "openIssues": 1, "maxSeverity": "warning" },
        "stale_subscription": { "openIssues": 1, "maxSeverity": "warning" }
      }
    },
    "cross_platform": { ... },
    "revenue_protection": { ... },
    "verified": { ... }
  },
  "sdkConnected": false
}
```

### GET /issues (updated)
Add `category` query parameter for filtering. Existing `issueType` filter still works.
Add `tier` query parameter: `"webhook_derived"` or `"app_verified"`.

### GET /issues/:id (updated)
Add `recommendedAction` field to response (server-side, from detector metadata).
Add `scope` field: `"per_user"` or `"aggregate"`.
Add `affectedScope` field for aggregate issues:
```json
{
  "scope": "aggregate",
  "affectedScope": {
    "type": "provider",
    "provider": "apple",
    "metric": "No webhooks in 2h 15m",
    "count": null
  }
}
```
